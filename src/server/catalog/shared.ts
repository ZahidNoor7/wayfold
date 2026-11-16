import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import type { TenantScope } from "../db/context";
import { tours } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";

export type Tx = TenantScope["tx"];
export type TourRow = typeof tours.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const FOREIGN_KEY_VIOLATION = "23503";
export const SLUG_MAX = 80;

/** Validates input at the service boundary; issues are grouped by top-level field. */
export function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new ValidationError(undefined, fieldErrors);
}

/** A ValidationError carrying one message for one field. */
export function invalid(field: string, message: string): ValidationError {
  return new ValidationError(undefined, { [field]: [message] });
}

/**
 * An id that is not even a UUID cannot name a record, so it is "not found"
 * rather than a database syntax error that would abort the transaction.
 */
export function requireId(id: unknown, what: string): string {
  if (typeof id !== "string" || !UUID.test(id)) throw new NotFoundError(what);
  return id;
}

/** `today` is computed by the server from the tenant timezone; a bad value is a programming error. */
export function requireToday(today: unknown): string {
  if (!isIsoDate(today)) throw new RangeError("today must be a YYYY-MM-DD calendar date");
  return today;
}

export const text = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Add a web address.")
  .max(SLUG_MAX, `Keep the web address under ${SLUG_MAX} characters.`)
  .regex(SLUG, "Use lowercase letters, numbers and single hyphens only.");

export const isoDateSchema = z.string().refine(isIsoDate, { error: "Use a valid date (YYYY-MM-DD)." });

export const timeSchema = z.string().trim().regex(HH_MM, "Use a 24-hour time such as 09:00.");

/** A complete new ordering of a list, as ids. */
export const reorderSchema = z.object({ orderedIds: z.array(z.uuid()).max(500) });

/** PostgreSQL returns `time` columns as `HH:MM:SS`; the app speaks `HH:MM`. */
export function toHourMinute(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5);
}

/** Lower-case, accent-free, hyphen-separated; `fallback` covers titles with no Latin letters or digits. */
export function slugify(input: string, fallback: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return slug || fallback;
}

/** `base`, or the first of `base-2`, `base-3`, ... that is not in `taken`. */
export function nextFreeSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Makes user text literal inside a LIKE pattern (backslash is PostgreSQL's default escape). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function containsPattern(search: string): string {
  return `%${escapeLike(search)}%`;
}

/** The PostgreSQL error code and constraint, wherever the driver put them. */
export function pgError(error: unknown): { code?: string; constraint?: string } {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 4; depth += 1) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
      return { code: e.code, constraint: typeof e.constraint === "string" ? e.constraint : undefined };
    }
    current = e.cause;
  }
  return {};
}

export type ReferenceMessages = Record<string, { field: string; message: string }>;

/**
 * Runs writes that reference other records (category, destination, media).
 *
 * The composite foreign keys `(tenant_id, x_id)` are what guarantee a
 * reference stays inside the tenant, so we let the database decide and turn
 * its refusal into a field error. The savepoint keeps the caller's
 * transaction usable after a refused write.
 */
export async function withReferenceCheck<T>(scope: TenantScope, references: ReferenceMessages, write: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await scope.tx.transaction((savepoint) => write(savepoint));
  } catch (error) {
    const { code, constraint } = pgError(error);
    const reference = code === FOREIGN_KEY_VIOLATION && constraint ? references[constraint] : undefined;
    if (reference) throw invalid(reference.field, reference.message);
    throw error;
  }
}

/**
 * Like `withReferenceCheck`, for deletes: a foreign key still pointing at the
 * row becomes `onBlocked(constraint)` instead of an internal error.
 */
export async function withDeleteCheck<T>(scope: TenantScope, onBlocked: (constraint?: string) => Error, write: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await scope.tx.transaction((savepoint) => write(savepoint));
  } catch (error) {
    const { code, constraint } = pgError(error);
    if (code === FOREIGN_KEY_VIOLATION) throw onBlocked(constraint);
    throw error;
  }
}

/**
 * Serialises catalogue writes that depend on a count or on slug uniqueness
 * (publishing against the plan limit, allocating a slug) for one tenant.
 * Transaction-level advisory lock: released on commit or rollback.
 */
export async function lockCatalog(scope: TenantScope): Promise<void> {
  const key = createHash("sha256").update(`wayfold:catalog:${scope.tenantId}`).digest().readBigInt64BE(0);
  await scope.tx.execute(sql`select pg_advisory_xact_lock(${key.toString()}::bigint)`);
}

/** Looks a tour up by `(tenant, id)`. Unknown and foreign ids are the same "not found". */
export async function findTourRow(scope: TenantScope, id: string): Promise<TourRow> {
  requireId(id, "Tour");
  const [row] = await scope.tx
    .select()
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("Tour");
  return row;
}

/** Checks that `orderedIds` is exactly `existingIds` in some order. */
export function assertSameIds(orderedIds: string[], existingIds: string[], field: string): void {
  const wanted = new Set(orderedIds);
  if (wanted.size !== orderedIds.length || wanted.size !== existingIds.length || existingIds.some((id) => !wanted.has(id))) {
    throw invalid(field, "The list is out of date. Refresh and try again.");
  }
}
