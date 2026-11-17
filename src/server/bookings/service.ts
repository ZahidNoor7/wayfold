import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { addDays, eachDate, isValidTimezone, todayIn } from "../../lib/dates";
import { recordAudit } from "../audit";
import type { TenantScope } from "../db/context";
import { availabilityBlocks, bookingEvents, bookings, customers, tourDepartures, tours, users, type TourSchedule } from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { sendReviewRequest } from "../content/review-requests";
import { enqueueNotification } from "../notifications";
import { getBookingSettings } from "../settings/tenant-settings";
import { holdingSeats, isHoldingSeats, spanEnd } from "./availability";
import { detectClashes, type Clash, type LiveBooking } from "./clashes";
import { minorToDecimal, toCsv } from "./csv";
import { bookingCancelledMessage, bookingConfirmedMessage, bookingRescheduledMessage, describeWhen, type CancelKind } from "./messages";
import {
  assertId,
  bookableUnit,
  escapeLike,
  isoDateSchema,
  loadTenantInfo,
  lockDepartureRow,
  lockTourRow,
  lockUnit,
  normaliseTime,
  parse,
  slotTimeSchema,
  TourChangedError,
} from "./shared";

export type BookingRow = typeof bookings.$inferSelect;
export type BookingStatus = BookingRow["status"];
export type PaymentStatus = BookingRow["paymentStatus"];
type TourRow = typeof tours.$inferSelect;

const STATUSES = ["pending", "confirmed", "completed", "cancelled"] as const;
const PAYMENT_STATUSES = ["unpaid", "deposit_paid", "paid", "refunded"] as const;

/** The whole status machine. `completed` is terminal. */
export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  cancelled: ["pending"],
  completed: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

/** The action would double-book. Staff may repeat it with `force` where the action allows that. */
export class BookingClashError extends ConflictError {
  constructor(readonly clashes: string[]) {
    super(`This would cause a scheduling clash: ${clashes.join(" · ")}.`, "booking_clash");
  }
}

const invalidTransition = (row: BookingRow, action: string) => new ConflictError(`A ${row.status} booking cannot be ${action}.`, "invalid_transition");

/** Rows leave this module with `slotTime` as `HH:MM`, the way slots are written everywhere else. */
function view(row: BookingRow): BookingRow {
  return row.slotTime ? { ...row, slotTime: normaliseTime(row.slotTime) } : row;
}

/* ------------------------------------------------------------- clash checks */

interface LiveRow extends LiveBooking {
  schedule: TourSchedule;
}

function toLive(row: BookingRow, tour: Pick<TourRow, "kind" | "schedule">): LiveRow {
  return {
    id: row.id,
    reference: row.reference,
    contactName: row.contactName,
    tourId: row.tourId,
    tourKind: tour.kind,
    departureId: row.departureId,
    startDate: row.startDate,
    endDate: row.endDate,
    slotTime: row.slotTime ? normaliseTime(row.slotTime) : null,
    seats: row.adults + row.children,
    status: row.status === "confirmed" ? "confirmed" : "pending",
    schedule: tour.schedule,
  };
}

/** Every booking of the tenant that holds seats now, optionally only those touching a date range. */
async function loadLiveBookings(scope: TenantScope, now: Date, range?: { from: string; to: string }): Promise<LiveRow[]> {
  const rows = await scope.tx
    .select({ booking: bookings, kind: tours.kind, schedule: tours.schedule })
    .from(bookings)
    .innerJoin(tours, and(eq(tours.tenantId, bookings.tenantId), eq(tours.id, bookings.tourId)))
    .where(
      and(
        eq(bookings.tenantId, scope.tenantId),
        holdingSeats(now),
        range ? lte(bookings.startDate, range.to) : undefined,
        range ? gte(bookings.endDate, range.from) : undefined,
      ),
    )
    .orderBy(asc(bookings.startDate), asc(bookings.createdAt), asc(bookings.id));
  return rows.map((row) => toLive(row.booking, row));
}

/** Clashes of each target against `pool`, keyed by booking id. Targets without a clash are absent. */
async function clashesAmong(scope: TenantScope, targets: LiveRow[], pool: LiveRow[]): Promise<Map<string, Clash[]>> {
  const departureIds = [...new Set(targets.filter((t) => t.tourKind === "departure" && t.departureId).map((t) => t.departureId!))];
  const departures =
    departureIds.length > 0
      ? await scope.tx
          .select({ id: tourDepartures.id, capacity: tourDepartures.capacity })
          .from(tourDepartures)
          .where(and(eq(tourDepartures.tenantId, scope.tenantId), inArray(tourDepartures.id, departureIds)))
      : [];
  const departureCapacity = new Map(departures.map((d) => [d.id, d.capacity]));

  const result = new Map<string, Clash[]>();
  for (const target of targets) {
    let capacity: number | null = null;
    if (target.tourKind === "day") {
      capacity = target.schedule.slots.find((slot) => normaliseTime(slot.time) === target.slotTime)?.capacity ?? null;
    } else if (target.tourKind === "departure" && target.departureId) {
      capacity = departureCapacity.get(target.departureId) ?? null;
    }
    const clashes = detectClashes(target, pool, capacity);
    if (clashes.length > 0) result.set(target.id, clashes);
  }
  return result;
}

async function clashesOf(scope: TenantScope, target: LiveRow, now: Date): Promise<Clash[]> {
  const pool = await loadLiveBookings(scope, now, { from: target.startDate, to: target.endDate });
  return (await clashesAmong(scope, [target], pool)).get(target.id) ?? [];
}

export interface BookingClashes {
  bookingId: string;
  reference: string;
  contactName: string;
  startDate: string;
  clashes: Clash[];
}

/** Bookings that overlap or overfill a unit, for the dashboard's conflict banner. */
export async function findClashes(scope: TenantScope, options: { now?: Date } = {}): Promise<BookingClashes[]> {
  const pool = await loadLiveBookings(scope, options.now ?? new Date());
  const clashes = await clashesAmong(scope, pool, pool);
  return pool
    .filter((row) => clashes.has(row.id))
    .map((row) => ({ bookingId: row.id, reference: row.reference, contactName: row.contactName, startDate: row.startDate, clashes: clashes.get(row.id)! }));
}

/* -------------------------------------------------------------------- reads */

const filterShape = {
  status: z.enum(STATUSES).optional(),
  tourId: z.uuid().optional(),
  /** Matches reference, guest name, guest e-mail and tour title. */
  search: z.string().trim().max(120).optional(),
  /** Tour start date range, inclusive. */
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  payment: z.enum(PAYMENT_STATUSES).optional(),
  /** Only bookings with a scheduling conflict. */
  clashOnly: z.boolean().optional(),
};

export const bookingFiltersSchema = z.object(filterShape);
export type BookingFilters = z.input<typeof bookingFiltersSchema>;

export const listBookingsSchema = z.object({
  ...filterShape,
  sort: z.enum(["newest", "oldest", "date_asc", "date_desc"]).default("newest"),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});
export type ListBookingsInput = z.input<typeof listBookingsSchema>;

/** Conditions shared by the list, its tab counts and the export. Always starts with the tenant. */
function filterConditions(scope: TenantScope, filters: z.output<typeof bookingFiltersSchema>): SQL[] {
  const conditions: SQL[] = [eq(bookings.tenantId, scope.tenantId)];
  if (filters.tourId) conditions.push(eq(bookings.tourId, filters.tourId));
  if (filters.from) conditions.push(gte(bookings.startDate, filters.from));
  if (filters.to) conditions.push(lte(bookings.startDate, filters.to));
  if (filters.payment) conditions.push(eq(bookings.paymentStatus, filters.payment));
  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    conditions.push(
      or(ilike(bookings.reference, pattern), ilike(bookings.contactName, pattern), ilike(bookings.contactEmail, pattern), ilike(bookings.tourTitle, pattern))!,
    );
  }
  return conditions;
}

const SORTS = {
  newest: [desc(bookings.createdAt), desc(bookings.id)],
  oldest: [asc(bookings.createdAt), asc(bookings.id)],
  date_asc: [asc(bookings.startDate), asc(bookings.slotTime), asc(bookings.id)],
  date_desc: [desc(bookings.startDate), desc(bookings.slotTime), desc(bookings.id)],
} as const;

export type BookingListItem = BookingRow & { clashes: Clash[] };

export interface BookingList {
  rows: BookingListItem[];
  /** Rows matching every filter, before paging. */
  total: number;
  /** Per-status totals for the tabs: search, tour, date and payment filters applied; status and clash filters not. */
  counts: Record<BookingStatus | "all", number>;
}

export async function listBookings(scope: TenantScope, raw: ListBookingsInput = {}, options: { now?: Date } = {}): Promise<BookingList> {
  const input = parse(listBookingsSchema, raw);
  const now = options.now ?? new Date();
  const base = filterConditions(scope, input);

  const byStatus = await scope.tx
    .select({ status: bookings.status, n: sql<number>`count(*)`.mapWith(Number) })
    .from(bookings)
    .where(and(...base))
    .groupBy(bookings.status);
  const counts: BookingList["counts"] = { all: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
  for (const row of byStatus) {
    counts[row.status] = row.n;
    counts.all += row.n;
  }

  const allClashes = input.clashOnly ? new Map((await findClashes(scope, { now })).map((entry) => [entry.bookingId, entry.clashes])) : null;
  const where = and(
    ...base,
    input.status ? eq(bookings.status, input.status) : undefined,
    allClashes ? inArray(bookings.id, [...allClashes.keys()]) : undefined,
  );

  const rows = await scope.tx
    .select()
    .from(bookings)
    .where(where)
    .orderBy(...SORTS[input.sort])
    .limit(input.limit)
    .offset(input.offset);
  const [count] = await scope.tx
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(bookings)
    .where(where);

  let clashes = allClashes;
  if (!clashes) {
    // Only the rows on this page need a flag, so only bookings near their dates are loaded.
    const live = rows.filter((row) => isHoldingSeats(row, now));
    clashes = new Map();
    if (live.length > 0) {
      const from = live.reduce((min, row) => (row.startDate < min ? row.startDate : min), live[0]!.startDate);
      const to = live.reduce((max, row) => (row.endDate > max ? row.endDate : max), live[0]!.endDate);
      const pool = await loadLiveBookings(scope, now, { from, to });
      const ids = new Set(live.map((row) => row.id));
      clashes = await clashesAmong(scope, pool.filter((row) => ids.has(row.id)), pool);
    }
  }

  return {
    rows: rows.map((row) => ({ ...view(row), clashes: clashes.get(row.id) ?? [] })),
    total: count?.total ?? 0,
    counts,
  };
}

async function findBooking(scope: TenantScope, id: string, lock = false): Promise<BookingRow> {
  assertId(id, "Booking");
  const query = scope.tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.id, id)))
    .limit(1);
  // The row lock stops two staff actions on one booking from interleaving.
  const [row] = lock ? await query.for("update") : await query;
  // Same answer whether the id is unknown or belongs to another tenant.
  if (!row) throw new NotFoundError("Booking");
  return row;
}

async function tourOf(scope: TenantScope, row: BookingRow): Promise<TourRow> {
  const [tour] = await scope.tx
    .select()
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.id, row.tourId)))
    .limit(1);
  // The composite foreign key guarantees the tour exists in this tenant.
  return tour!;
}

/**
 * Takes the unit lock for `unit` (named from `planned`, the tour as read
 * before locking), then re-reads the tour and the departure under share
 * locks. Only the returned row may be used for capacity, schedule and length:
 * a catalogue edit that was in flight has either committed by now or waits
 * for this transaction. Same order as the catalogue: unit key, then rows.
 */
async function lockSeats(
  scope: TenantScope,
  planned: TourRow,
  unit: Pick<BookingRow, "startDate" | "slotTime" | "departureId">,
): Promise<TourRow> {
  await lockUnit(scope, bookableUnit(planned, unit));
  const fresh = (await lockTourRow(scope, planned.id))!;
  if (fresh.kind !== planned.kind) throw new TourChangedError();
  if (unit.departureId) await lockDepartureRow(scope, unit.departureId);
  return fresh;
}

export interface BookingEvent {
  id: string;
  kind: "created" | "status" | "reschedule" | "payment" | "note" | "notification";
  message: string;
  actorId: string | null;
  actorName: string | null;
  createdAt: Date;
}

export interface BookingDetail {
  booking: BookingRow;
  customer: typeof customers.$inferSelect;
  /** Newest first: status changes, date changes, payments and internal notes. */
  events: BookingEvent[];
  clashes: Clash[];
}

export async function getBooking(scope: TenantScope, id: string, options: { now?: Date } = {}): Promise<BookingDetail> {
  const now = options.now ?? new Date();
  const row = await findBooking(scope, id);
  const [customer] = await scope.tx
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, scope.tenantId), eq(customers.id, row.customerId)))
    .limit(1);
  const events = await scope.tx
    .select({
      id: bookingEvents.id,
      kind: bookingEvents.kind,
      message: bookingEvents.message,
      actorId: bookingEvents.actorId,
      actorName: users.name,
      createdAt: bookingEvents.createdAt,
    })
    .from(bookingEvents)
    .leftJoin(users, eq(users.id, bookingEvents.actorId))
    .where(and(eq(bookingEvents.tenantId, scope.tenantId), eq(bookingEvents.bookingId, row.id)))
    .orderBy(desc(bookingEvents.createdAt), desc(bookingEvents.id));
  const clashes = isHoldingSeats(row, now) ? await clashesOf(scope, toLive(row, await tourOf(scope, row)), now) : [];
  return { booking: view(row), customer: customer!, events, clashes };
}

/** Looks a booking up by its human reference, e.g. `AJ-SHE-4821`. Case-insensitive. */
export async function getBookingByReference(scope: TenantScope, reference: string, options: { now?: Date } = {}): Promise<BookingDetail> {
  const wanted = String(reference).trim().toUpperCase();
  const [row] = await scope.tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.reference, wanted)))
    .limit(1);
  if (!row) throw new NotFoundError("Booking");
  return getBooking(scope, row.id, options);
}

/* ------------------------------------------------------------- state changes */

type EventKind = BookingEvent["kind"];

/** Timeline entry plus audit record: every change to a booking leaves both. */
async function record(
  scope: TenantScope,
  row: BookingRow,
  kind: EventKind,
  message: string,
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await scope.tx.insert(bookingEvents).values({ tenantId: scope.tenantId, bookingId: row.id, kind, message, actorId: scope.userId });
  await recordAudit(scope, { action, targetType: "booking", targetId: row.id, metadata: { reference: row.reference, ...metadata } });
}

async function save(scope: TenantScope, id: string, changes: Partial<typeof bookings.$inferInsert>): Promise<BookingRow> {
  const [row] = (await scope.tx
    .update(bookings)
    .set(changes)
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.id, id)))
    .returning()) as [BookingRow];
  return row;
}

export interface ConfirmOptions {
  /** Confirm even though it double-books. Recorded on the timeline and in the audit log. */
  force?: boolean;
  now?: Date;
}

/** pending → confirmed. Re-checks capacity under the unit's lock; a clash needs `force`. */
export async function confirmBooking(scope: TenantScope, id: string, options: ConfirmOptions = {}): Promise<BookingRow> {
  const now = options.now ?? new Date();
  const row = await findBooking(scope, id, true);
  if (row.status !== "pending") throw invalidTransition(row, "confirmed");
  const tour = await lockSeats(scope, await tourOf(scope, row), row);

  const clashes = await clashesOf(scope, toLive(row, tour), now);
  if (clashes.length > 0 && !options.force) throw new BookingClashError(clashes.map((clash) => clash.message));

  const updated = await save(scope, id, { status: "confirmed", confirmedAt: now, holdExpiresAt: null, cancelKind: null, cancelReason: null, cancelledAt: null });
  const forced = clashes.length > 0;
  await record(scope, updated, "status", forced ? "Booking confirmed despite a scheduling clash." : "Booking confirmed.", "booking.confirmed", {
    forced,
    clashes: clashes.map((clash) => clash.message),
  });
  const tenant = await loadTenantInfo(scope);
  await enqueueNotification(scope, bookingConfirmedMessage(tenant, updated));
  return view(updated);
}

const reasonSchema = z.string().trim().max(500);

async function cancel(scope: TenantScope, row: BookingRow, kind: CancelKind, reason: string | null, now: Date, message: string): Promise<BookingRow> {
  const updated = await save(scope, row.id, { status: "cancelled", cancelKind: kind, cancelReason: reason, cancelledAt: now, holdExpiresAt: null });
  await record(scope, updated, "status", reason ? `${message} Reason: ${reason}` : message, "booking.cancelled", { kind, from: row.status });
  const tenant = await loadTenantInfo(scope);
  await enqueueNotification(scope, bookingCancelledMessage(tenant, updated, kind, reason));
  return view(updated);
}

/** pending → cancelled (declined). The seats are released at once. */
export async function declineBooking(scope: TenantScope, id: string, options: { reason?: string; now?: Date } = {}): Promise<BookingRow> {
  const { reason } = parse(z.object({ reason: reasonSchema.optional() }), { reason: options.reason });
  const row = await findBooking(scope, id, true);
  if (row.status !== "pending") throw invalidTransition(row, "declined");
  return cancel(scope, row, "declined", reason || null, options.now ?? new Date(), "Request declined.");
}

export const cancelBookingSchema = z.object({
  kind: z.enum(["by_business", "by_customer"]),
  reason: reasonSchema.min(1, "Give a reason for the cancellation."),
});

/** confirmed → cancelled, by the business or at the customer's request. */
export async function cancelBooking(
  scope: TenantScope,
  id: string,
  raw: z.input<typeof cancelBookingSchema>,
  options: { now?: Date } = {},
): Promise<BookingRow> {
  const input = parse(cancelBookingSchema, raw);
  const row = await findBooking(scope, id, true);
  if (row.status !== "confirmed") throw invalidTransition(row, "cancelled");
  const message = input.kind === "by_customer" ? "Booking cancelled at the customer's request." : "Booking cancelled by the business.";
  return cancel(scope, row, input.kind, input.reason, options.now ?? new Date(), message);
}

/**
 * confirmed → completed. Terminal. Unless told not to, the customer is
 * e-mailed a private link to review the tour.
 */
export async function completeBooking(scope: TenantScope, id: string, options: { now?: Date; requestReview?: boolean } = {}): Promise<BookingRow> {
  const now = options.now ?? new Date();
  const row = await findBooking(scope, id, true);
  if (row.status !== "confirmed") throw invalidTransition(row, "completed");
  const updated = await save(scope, id, { status: "completed", completedAt: now });
  await record(scope, updated, "status", "Tour completed.", "booking.completed");
  if (options.requestReview !== false && updated.contactEmail) {
    await sendReviewRequest(scope, updated.id, now);
    await record(scope, updated, "notification", "Review link e-mailed to the customer.", "booking.review_requested");
  }
  return view(updated);
}

/**
 * cancelled → pending. The seats may have been sold since, so the booking
 * must still fit; there is no override here. It gets a fresh hold.
 */
export async function reopenBooking(scope: TenantScope, id: string, options: { now?: Date } = {}): Promise<BookingRow> {
  const now = options.now ?? new Date();
  const row = await findBooking(scope, id, true);
  if (row.status !== "cancelled") throw invalidTransition(row, "reopened");
  const tour = await lockSeats(scope, await tourOf(scope, row), row);

  const clashes = await clashesOf(scope, toLive(row, tour), now);
  if (clashes.length > 0) throw new BookingClashError(clashes.map((clash) => clash.message));

  const { holdHours } = await getBookingSettings(scope);
  const holdExpiresAt = new Date(now.getTime() + holdHours * 3_600_000);
  const updated = await save(scope, id, {
    status: "pending",
    holdExpiresAt,
    cancelKind: null,
    cancelReason: null,
    cancelledAt: null,
    confirmedAt: null,
  });
  await record(scope, updated, "status", `Reopened as pending. Seats held until ${holdExpiresAt.toISOString()}.`, "booking.reopened");
  return view(updated);
}

export const rescheduleSchema = z.object({
  date: isoDateSchema,
  /** Day tours only; keeps the current start time when omitted. */
  slotTime: slotTimeSchema.nullish(),
  /** Save although the new date clashes or is closed. */
  force: z.boolean().optional(),
});

/**
 * Moves a booking to another date (and start time). Staff may pick dates the
 * storefront would not offer, but a date that overbooks a unit, overlaps
 * another private tour or falls in a closure needs `force`.
 */
export async function rescheduleBooking(
  scope: TenantScope,
  id: string,
  raw: z.input<typeof rescheduleSchema>,
  options: { now?: Date } = {},
): Promise<BookingRow> {
  const input = parse(rescheduleSchema, raw);
  const now = options.now ?? new Date();
  const row = view(await findBooking(scope, id, true));
  if (row.status === "completed") throw invalidTransition(row, "rescheduled");
  const planned = await tourOf(scope, row);

  // First pass, only to name the unit to lock. Everything is checked again
  // against the rows read under the lock.
  const slotTime = planned.kind === "day" ? (input.slotTime ?? row.slotTime) : null;
  if (planned.kind === "day" && !slotTime) throw new ValidationError(undefined, { slotTime: ["Choose one of this tour's start times."] });
  let departureId: string | null = null;
  if (planned.kind === "departure") {
    const [departure] = await scope.tx
      .select({ id: tourDepartures.id })
      .from(tourDepartures)
      .where(and(eq(tourDepartures.tenantId, scope.tenantId), eq(tourDepartures.tourId, planned.id), eq(tourDepartures.startDate, input.date)))
      .limit(1);
    if (!departure) throw new ValidationError(undefined, { date: ["This tour has no departure on that date."] });
    departureId = departure.id;
  }
  if (input.date === row.startDate && slotTime === row.slotTime) {
    throw new ValidationError(undefined, { date: ["The booking is already on that date."] });
  }

  const tour = await lockSeats(scope, planned, { startDate: input.date, slotTime, departureId });
  const warnings: string[] = [];
  if (tour.kind === "day" && !tour.schedule.slots.some((slot) => normaliseTime(slot.time) === slotTime)) {
    throw new ValidationError(undefined, { slotTime: ["Choose one of this tour's start times."] });
  }
  if (departureId) {
    const [departure] = await scope.tx
      .select({ startDate: tourDepartures.startDate, isOpen: tourDepartures.isOpen })
      .from(tourDepartures)
      .where(and(eq(tourDepartures.tenantId, scope.tenantId), eq(tourDepartures.id, departureId)))
      .limit(1);
    // Moved or removed while this request waited for the lock.
    if (!departure || departure.startDate !== input.date) throw new ValidationError(undefined, { date: ["This tour has no departure on that date."] });
    if (!departure.isOpen) warnings.push(`The departure on ${input.date} is closed for booking`);
  }

  const moved: BookingRow = { ...row, startDate: input.date, endDate: spanEnd(input.date, tour.durationDays), slotTime, departureId };

  const closures = await scope.tx
    .select({ startDate: availabilityBlocks.startDate, endDate: availabilityBlocks.endDate, reason: availabilityBlocks.reason })
    .from(availabilityBlocks)
    .where(
      and(
        eq(availabilityBlocks.tenantId, scope.tenantId),
        or(isNull(availabilityBlocks.tourId), eq(availabilityBlocks.tourId, tour.id)),
        lte(availabilityBlocks.startDate, moved.endDate),
        gte(availabilityBlocks.endDate, moved.startDate),
      ),
    );
  for (const closure of closures) {
    warnings.push(`Closed ${closure.startDate} – ${closure.endDate}${closure.reason ? ` (${closure.reason})` : ""}`);
  }
  // A cancelled booking holds no seats; it is checked when it is reopened.
  if (row.status !== "cancelled") {
    warnings.push(...(await clashesOf(scope, toLive(moved, tour), now)).map((clash) => clash.message));
  }
  if (warnings.length > 0 && !input.force) throw new BookingClashError(warnings);

  const updated = await save(scope, id, { startDate: moved.startDate, endDate: moved.endDate, slotTime, departureId });
  const forced = warnings.length > 0;
  await record(
    scope,
    updated,
    "reschedule",
    `Date changed from ${describeWhen(row)} to ${describeWhen(updated)}${forced ? " (clash acknowledged)" : ""}.`,
    "booking.rescheduled",
    { from: row.startDate, to: updated.startDate, forced, warnings },
  );
  if (updated.status !== "cancelled") {
    const tenant = await loadTenantInfo(scope);
    await enqueueNotification(scope, bookingRescheduledMessage(tenant, updated, row));
  }
  return view(updated);
}

export const paymentSchema = z.object({
  paymentStatus: z.enum(PAYMENT_STATUSES),
  /** Minor units received so far. Defaults: nothing when unpaid, the total when paid. */
  amountPaid: z.number().int().min(0).optional(),
});

/** Records what has been paid. Money is tracked here, not collected. */
export async function updatePaymentStatus(scope: TenantScope, id: string, raw: z.input<typeof paymentSchema>): Promise<BookingRow> {
  const input = parse(paymentSchema, raw);
  const row = await findBooking(scope, id, true);
  const defaults: Record<PaymentStatus, number> = { unpaid: 0, paid: row.totalAmount, deposit_paid: row.amountPaid, refunded: row.amountPaid };
  const amountPaid = input.amountPaid ?? defaults[input.paymentStatus];

  const fail = (message: string) => new ValidationError(undefined, { amountPaid: [message] });
  if (amountPaid > row.totalAmount) throw fail("The amount paid cannot be more than the booking total.");
  if (input.paymentStatus === "unpaid" && amountPaid !== 0) throw fail("An unpaid booking has no amount paid.");
  if (input.paymentStatus === "paid" && amountPaid !== row.totalAmount) throw fail("A paid booking is paid in full; use deposit paid for part payments.");
  if (input.paymentStatus === "deposit_paid" && amountPaid === 0) throw fail("Enter the deposit received.");

  const updated = await save(scope, id, { paymentStatus: input.paymentStatus, amountPaid });
  const label = input.paymentStatus.replace("_", " ");
  await record(
    scope,
    updated,
    "payment",
    `Payment marked ${label}: ${minorToDecimal(amountPaid, row.currency)} of ${minorToDecimal(row.totalAmount, row.currency)} ${row.currency} received.`,
    "booking.payment_updated",
    { paymentStatus: input.paymentStatus, amountPaid, previousStatus: row.paymentStatus, previousAmountPaid: row.amountPaid },
  );
  return view(updated);
}

export const bookingNoteSchema = z.object({ body: z.string().trim().min(1, "Write a note first.").max(2000) });

/** Internal note on the booking's timeline. Never shown to the customer. */
export async function addBookingNote(scope: TenantScope, id: string, body: string): Promise<BookingEvent> {
  const input = parse(bookingNoteSchema, { body });
  const row = await findBooking(scope, id);
  const [event] = (await scope.tx
    .insert(bookingEvents)
    .values({ tenantId: scope.tenantId, bookingId: row.id, kind: "note", message: input.body, actorId: scope.userId })
    .returning()) as [typeof bookingEvents.$inferSelect];
  // The note text may hold personal details, so only its id is audited.
  await recordAudit(scope, { action: "booking.note_added", targetType: "booking", targetId: row.id, metadata: { reference: row.reference, eventId: event.id } });
  return { id: event.id, kind: event.kind, message: event.message, actorId: event.actorId, actorName: null, createdAt: event.createdAt };
}

/**
 * Cancels pending requests whose hold has run out. Their seats were already
 * free (an expired hold never counts), so this only tidies the status and
 * tells the customer. Safe to run from a scheduled job as often as wanted.
 */
export async function expireStaleHolds(scope: TenantScope, now: Date = new Date()): Promise<number> {
  const expired = (await scope.tx
    .update(bookings)
    .set({ status: "cancelled", cancelKind: "expired", cancelReason: "The hold expired before the request was confirmed.", cancelledAt: now })
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.status, "pending"), lte(bookings.holdExpiresAt, now)))
    .returning()) as BookingRow[];
  if (expired.length === 0) return 0;

  const tenant = await loadTenantInfo(scope);
  for (const row of expired) {
    await record(scope, row, "status", "Hold expired; request cancelled automatically.", "booking.expired", { kind: "expired" });
    await enqueueNotification(scope, bookingCancelledMessage(tenant, row, "expired", null));
  }
  return expired.length;
}

/* ------------------------------------------------------------ stats & export */

export const bookingStatsSchema = z.object({
  /** Tour start date range, inclusive. */
  from: isoDateSchema,
  to: isoDateSchema,
  /** Start of "upcoming". Defaults to today in the tenant's timezone. */
  today: isoDateSchema.optional(),
  upcomingLimit: z.number().int().min(1).max(50).default(5),
});

export interface UpcomingBooking {
  id: string;
  reference: string;
  tourTitle: string;
  contactName: string;
  startDate: string;
  endDate: string;
  slotTime: string | null;
  guests: number;
}

export interface BookingStats {
  from: string;
  to: string;
  currency: string;
  counts: Record<BookingStatus | "all", number>;
  /** Sum of the totals of confirmed and completed bookings in the range, minor units. */
  revenue: number;
  /** Confirmed bookings still ahead, soonest first. */
  upcoming: UpcomingBooking[];
}

export const bookingSeriesSchema = z.object({
  /** First and last calendar day of the range, inclusive. */
  from: isoDateSchema,
  to: isoDateSchema,
  bucket: z.enum(["month", "day"]),
  /** `created`: when the request came in, in the tenant's timezone. `start`: the tour's start date. */
  by: z.enum(["created", "start"]),
});

export interface BookingSeriesPoint {
  /** `YYYY-MM` for months, `YYYY-MM-DD` for days. */
  bucket: string;
  /** Every booking in the bucket, whatever its status now. */
  requests: number;
  /** Accepted: confirmed or completed. */
  confirmed: number;
  cancelled: number;
  /** Sum of totals of confirmed and completed bookings, minor units. */
  revenue: number;
}

/** Most buckets one call may return. */
export const MAX_SERIES_BUCKETS = 400;

/** Every bucket key from `from` to `to`, so empty periods show as zeros. */
function seriesBuckets(from: string, to: string, bucket: "month" | "day"): string[] {
  if (bucket === "day") return eachDate(from, to);
  const keys: string[] = [];
  let [year, month] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const last = to.slice(0, 7);
  for (let key = from.slice(0, 7); key <= last; key = `${year}-${String(month).padStart(2, "0")}`) {
    keys.push(key);
    month += 1;
    if (month > 12) [year, month] = [year + 1, 1];
  }
  return keys;
}

/**
 * Booking counts and revenue per month or day, for the overview chart, in one
 * aggregate query. Buckets by request time use the tenant's own timezone, so
 * a request made at 01:00 on the 1st in Baku counts for that month, not the
 * previous one as it would in UTC.
 */
export async function bookingSeries(scope: TenantScope, raw: z.input<typeof bookingSeriesSchema>): Promise<BookingSeriesPoint[]> {
  const input = parse(bookingSeriesSchema, raw);
  if (input.to < input.from) throw new ValidationError("The end date must not be before the start date.");
  const keys = seriesBuckets(input.from, input.to, input.bucket);
  if (keys.length > MAX_SERIES_BUCKETS) throw new ValidationError(`Ask for at most ${MAX_SERIES_BUCKETS} ${input.bucket}s at a time.`);

  const { timezone } = await loadTenantInfo(scope);
  const zone = isValidTimezone(timezone) ? timezone : "UTC";
  const format = input.bucket === "month" ? "YYYY-MM" : "YYYY-MM-DD";
  const after = addDays(input.to, 1);
  const key =
    input.by === "created" ? sql<string>`to_char(${bookings.createdAt} at time zone ${zone}, ${format})` : sql<string>`to_char(${bookings.startDate}, ${format})`;
  const inRange =
    input.by === "created"
      ? and(
          sql`${bookings.createdAt} >= (${input.from}::timestamp at time zone ${zone})`,
          sql`${bookings.createdAt} < (${after}::timestamp at time zone ${zone})`,
        )
      : and(gte(bookings.startDate, input.from), lte(bookings.startDate, input.to));

  const rows = await scope.tx
    .select({
      bucket: key,
      requests: sql<number>`count(*)`.mapWith(Number),
      confirmed: sql<number>`count(*) filter (where ${bookings.status} in ('confirmed', 'completed'))`.mapWith(Number),
      cancelled: sql<number>`count(*) filter (where ${bookings.status} = 'cancelled')`.mapWith(Number),
      revenue: sql<number>`coalesce(sum(${bookings.totalAmount}) filter (where ${bookings.status} in ('confirmed', 'completed')), 0)`.mapWith(Number),
    })
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), inRange))
    .groupBy(sql`1`);

  const found = new Map(rows.map((row) => [row.bucket, row]));
  return keys.map((bucket) => {
    const row = found.get(bucket);
    return { bucket, requests: row?.requests ?? 0, confirmed: row?.confirmed ?? 0, cancelled: row?.cancelled ?? 0, revenue: row?.revenue ?? 0 };
  });
}

/** Figures for the overview page. Counts and revenue are for tours starting in [from, to]. */
export async function bookingStats(scope: TenantScope, raw: z.input<typeof bookingStatsSchema>): Promise<BookingStats> {
  const input = parse(bookingStatsSchema, raw);
  if (input.to < input.from) throw new ValidationError("The end date must not be before the start date.");
  const tenant = await loadTenantInfo(scope);
  const today = input.today ?? todayIn(isValidTimezone(tenant.timezone) ? tenant.timezone : "UTC");

  const groups = await scope.tx
    .select({
      status: bookings.status,
      n: sql<number>`count(*)`.mapWith(Number),
      amount: sql<number>`coalesce(sum(${bookings.totalAmount}), 0)`.mapWith(Number),
    })
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), gte(bookings.startDate, input.from), lte(bookings.startDate, input.to)))
    .groupBy(bookings.status);

  const counts: BookingStats["counts"] = { all: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
  let revenue = 0;
  for (const group of groups) {
    counts[group.status] = group.n;
    counts.all += group.n;
    if (group.status === "confirmed" || group.status === "completed") revenue += group.amount;
  }

  const upcoming = await scope.tx
    .select({
      id: bookings.id,
      reference: bookings.reference,
      tourTitle: bookings.tourTitle,
      contactName: bookings.contactName,
      startDate: bookings.startDate,
      endDate: bookings.endDate,
      slotTime: bookings.slotTime,
      adults: bookings.adults,
      children: bookings.children,
    })
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.status, "confirmed"), gte(bookings.endDate, today)))
    .orderBy(asc(bookings.startDate), asc(bookings.slotTime), asc(bookings.id))
    .limit(input.upcomingLimit);

  return {
    from: input.from,
    to: input.to,
    currency: tenant.currency,
    counts,
    revenue,
    upcoming: upcoming.map(({ adults, children, slotTime, ...rest }) => ({
      ...rest,
      slotTime: slotTime ? normaliseTime(slotTime) : null,
      guests: adults + children,
    })),
  };
}

/** Rows one export may contain; larger books are exported in filtered parts. */
export const MAX_EXPORT_ROWS = 10_000;

/** The bookings matching `filters` as CSV, oldest tour date first. Customer text is neutralised against formula injection. */
export async function exportBookingsCsv(scope: TenantScope, raw: BookingFilters = {}, options: { now?: Date } = {}): Promise<string> {
  const filters = parse(bookingFiltersSchema, raw);
  const clashIds = filters.clashOnly ? (await findClashes(scope, options)).map((entry) => entry.bookingId) : null;
  const rows = await scope.tx
    .select()
    .from(bookings)
    .where(
      and(
        ...filterConditions(scope, filters),
        filters.status ? eq(bookings.status, filters.status) : undefined,
        clashIds ? inArray(bookings.id, clashIds) : undefined,
      ),
    )
    .orderBy(...SORTS.date_asc)
    .limit(MAX_EXPORT_ROWS);

  await recordAudit(scope, { action: "booking.exported", targetType: "booking", metadata: { rows: rows.length } });

  return toCsv(
    [
      "Reference",
      "Status",
      "Tour",
      "Start date",
      "End date",
      "Start time",
      "Adults",
      "Children",
      "Guest name",
      "Email",
      "Phone",
      "Country",
      "Language",
      "Pickup",
      "Contact via",
      "Currency",
      "Base",
      "Discount",
      "Total",
      "Discount applied",
      "Payment status",
      "Amount paid",
      "Guest notes",
      "Requested at",
    ],
    rows.map((row) => [
      row.reference,
      row.status,
      row.tourTitle,
      row.startDate,
      row.endDate,
      row.slotTime ? normaliseTime(row.slotTime) : "",
      row.adults,
      row.children,
      row.contactName,
      row.contactEmail,
      row.contactPhone,
      row.country,
      row.language,
      row.pickup,
      row.contactMethod,
      row.currency,
      // Amounts are generated here, never typed by a customer, so they are written as numbers.
      Number(minorToDecimal(row.baseAmount, row.currency)),
      Number(minorToDecimal(row.discountAmount, row.currency)),
      Number(minorToDecimal(row.totalAmount, row.currency)),
      row.discountLabel,
      row.paymentStatus,
      Number(minorToDecimal(row.amountPaid, row.currency)),
      row.customerNotes,
      row.createdAt,
    ]),
  );
}
