import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { isIsoDate } from "../../lib/dates";
import type { TenantScope } from "../db/context";
import { tenants, tourDepartures, tours } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A malformed id cannot name a record, so it is "not found" like any other
 * unknown id, instead of reaching PostgreSQL and failing as a driver error.
 */
export function assertId(value: unknown, what: string): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new NotFoundError(what);
}

/** `HH:MM`. PostgreSQL returns `time` columns as `HH:MM:SS`; slots are stored without seconds. */
export function normaliseTime(value: string): string {
  return value.slice(0, 5);
}

export const isoDateSchema = z.string().refine(isIsoDate, "Enter a valid date.");

export const slotTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Enter a valid start time.")
  .transform(normaliseTime);

/** Parses service input; a failure becomes a ValidationError with per-field messages. */
export function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const flat = z.flattenError(result.error);
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(flat.fieldErrors as Record<string, string[] | undefined>)) {
    if (messages && messages.length > 0) fieldErrors[key] = messages;
  }
  if (flat.formErrors.length > 0) fieldErrors.form = flat.formErrors;
  throw new ValidationError(undefined, fieldErrors);
}

/** Escapes `%`, `_` and `\` so user text is matched literally by LIKE / ILIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Advisory-lock key for one bookable unit of one tenant. The tenant id is part
 * of the hashed text, so two tenants can never contend for (or block) the
 * same key except by a 64-bit hash collision, which only costs a short wait.
 */
export function advisoryKey(tenantId: string, unit: string): bigint {
  return createHash("sha256").update(`${tenantId}|${unit}`).digest().readBigInt64BE(0);
}

/**
 * Serialises every transaction that changes the seats of one bookable unit.
 * The lock is transaction-level: PostgreSQL releases it at commit or rollback
 * and it cannot be released early, so the availability check and the write
 * that follows it are atomic with respect to other requests for the same unit.
 *
 * Lock order, to stay deadlock-free: a transaction locks at most one booking
 * row (`FOR UPDATE`) first, then the plan-quota key, then one unit key.
 *
 * The check after the lock only sees the previous holder's booking under
 * READ COMMITTED, where each statement takes a fresh snapshot. A transaction
 * with a snapshot fixed before the lock would re-check stale data and could
 * double-book, so any other isolation level is refused outright.
 */
export async function lockUnit(scope: TenantScope, unit: string): Promise<void> {
  const result = await scope.tx.execute<{ isolation: string }>(
    sql`select pg_advisory_xact_lock(${advisoryKey(scope.tenantId, unit).toString()}::bigint), current_setting('transaction_isolation') as isolation`,
  );
  const isolation = result.rows[0]?.isolation;
  if (isolation !== "read committed") {
    throw new Error(`Booking locks need a READ COMMITTED transaction, not "${isolation}".`);
  }
}

export type TourKind = "day" | "departure" | "private";

/** The unit whose seats a booking consumes. Private tours share one guide, so they share one unit. */
export function bookableUnit(
  tour: { id: string; kind: TourKind },
  booking: { startDate: string; slotTime: string | null; departureId: string | null },
): string {
  if (tour.kind === "private") return "private";
  if (tour.kind === "departure") return `departure:${tour.id}:${booking.departureId ?? booking.startDate}`;
  // Normalised, so `09:00` from a form and `09:00:00` from the database lock the same key.
  return `day:${tour.id}:${booking.startDate}:${booking.slotTime ? normaliseTime(booking.slotTime) : ""}`;
}

export type TourRow = typeof tours.$inferSelect;
export type DepartureRow = typeof tourDepartures.$inferSelect;

/**
 * Re-reads a tour under a share lock, after the unit lock is held. The row
 * read before the lock may be stale: a catalogue edit (capacity, schedule,
 * party size, status) that was in flight then has either committed by now,
 * or it waits for this booking to commit, because its `FOR UPDATE` conflicts
 * with `FOR SHARE`. Every check and the price must use the returned row.
 *
 * Lock order matches the catalogue's: unit key(s) first, then the tour row.
 */
export async function lockTourRow(scope: TenantScope, tourId: string): Promise<TourRow | null> {
  const [row] = await scope.tx
    .select()
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.id, tourId)))
    .limit(1)
    .for("share");
  return row ?? null;
}

/** Same as `lockTourRow`, for a departure's capacity, date and open flag. */
export async function lockDepartureRow(scope: TenantScope, departureId: string): Promise<DepartureRow | null> {
  const [row] = await scope.tx
    .select()
    .from(tourDepartures)
    .where(and(eq(tourDepartures.tenantId, scope.tenantId), eq(tourDepartures.id, departureId)))
    .limit(1)
    .for("share");
  return row ?? null;
}

/**
 * The tour's kind decides which unit was locked. If it changed while this
 * request waited, the lock taken guards the wrong unit, so the request stops
 * rather than take a second lock out of order.
 */
export class TourChangedError extends ConflictError {
  constructor() {
    super("This tour was changed while your request was being processed. Please review it and try again.", "tour_changed");
  }
}

/** Key that serialises booking creation while a monthly plan limit applies. */
export const QUOTA_UNIT = "quota";

export interface TenantInfo {
  name: string;
  /** Public contact address of the business; may be empty. */
  email: string;
  phone: string;
  currency: string;
  timezone: string;
}

/**
 * The tenant's own directory row. `tenants` is readable across tenants (it is
 * what host resolution reads), so the explicit id filter is the only fence.
 */
export async function loadTenantInfo(scope: TenantScope): Promise<TenantInfo> {
  const [row] = await scope.tx
    .select({ name: tenants.name, email: tenants.email, phone: tenants.phone, currency: tenants.currency, timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, scope.tenantId))
    .limit(1);
  if (!row) throw new ForbiddenError("This workspace is not available.");
  return row;
}
