import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { TenantScope } from "../db/context";
import { bookings, tourDepartures } from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { lockDeparture } from "./booking-locks";
import { findTourRow, invalid, isoDateSchema, parse, requireId, requireToday, timeSchema, toHourMinute } from "./shared";

/** Bookings that still hold seats. Completed and cancelled ones are history. */
const SEAT_HOLDING = ["pending", "confirmed"] as const;

const departureShape = {
  startDate: isoDateSchema,
  startTime: timeSchema.nullable(),
  capacity: z.int("Use a whole number of seats.").min(1, "A departure needs at least 1 seat.").max(999, "Keep the seat count under 1,000."),
  isOpen: z.boolean(),
};

export const addDepartureSchema = z.object({
  startDate: departureShape.startDate,
  startTime: departureShape.startTime.optional(),
  capacity: departureShape.capacity,
  isOpen: departureShape.isOpen.optional(),
});
export const updateDepartureSchema = z.object(departureShape).partial();
export type AddDepartureInput = z.input<typeof addDepartureSchema>;
export type UpdateDepartureInput = z.input<typeof updateDepartureSchema>;

/** `today` is the current calendar date in the tenant's timezone, supplied by the caller. */
export interface TodayOption {
  today: string;
}

export interface DepartureView {
  id: string;
  tourId: string;
  startDate: string;
  /** `HH:MM`, or null when the departure has no fixed time. */
  startTime: string | null;
  capacity: number;
  isOpen: boolean;
  /** Seats held by pending and confirmed bookings. */
  seatsBooked: number;
  seatsLeft: number;
}

type Row = typeof tourDepartures.$inferSelect;

function toView(row: Pick<Row, "id" | "tourId" | "startDate" | "startTime" | "capacity" | "isOpen">, seatsBooked: number): DepartureView {
  return {
    id: row.id,
    tourId: row.tourId,
    startDate: row.startDate,
    startTime: toHourMinute(row.startTime),
    capacity: row.capacity,
    isOpen: row.isOpen,
    seatsBooked,
    seatsLeft: Math.max(0, row.capacity - seatsBooked),
  };
}

async function findRow(scope: TenantScope, id: string): Promise<Row> {
  requireId(id, "Departure");
  const [row] = await scope.tx
    .select()
    .from(tourDepartures)
    .where(and(eq(tourDepartures.tenantId, scope.tenantId), eq(tourDepartures.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("Departure");
  return row;
}

async function bookingUsage(scope: TenantScope, departureId: string): Promise<{ total: number; active: number; seats: number }> {
  const [row] = await scope.tx
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`(count(*) filter (where ${bookings.status} in ('pending', 'confirmed')))::int`,
      seats: sql<number>`coalesce(sum(${bookings.adults} + ${bookings.children}) filter (where ${bookings.status} in ('pending', 'confirmed')), 0)::int`,
    })
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.departureId, departureId)));
  return row ?? { total: 0, active: 0, seats: 0 };
}

async function dateTaken(scope: TenantScope, tourId: string, startDate: string, exceptId?: string): Promise<boolean> {
  const rows = await scope.tx
    .select({ id: tourDepartures.id })
    .from(tourDepartures)
    .where(
      and(
        eq(tourDepartures.tenantId, scope.tenantId),
        eq(tourDepartures.tourId, tourId),
        eq(tourDepartures.startDate, startDate),
        exceptId ? ne(tourDepartures.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Departures of one tour in date order, with live seat counts. `from` hides earlier dates. */
export async function listDepartures(scope: TenantScope, tourId: string, options: { from?: string; openOnly?: boolean } = {}): Promise<DepartureView[]> {
  const tour = await findTourRow(scope, tourId);
  const seats = scope.tx
    .select({
      departureId: bookings.departureId,
      seats: sql<number>`sum(${bookings.adults} + ${bookings.children})::int`.as("seats"),
    })
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), inArray(bookings.status, SEAT_HOLDING), isNotNull(bookings.departureId)))
    .groupBy(bookings.departureId)
    .as("departure_seats");
  const rows = await scope.tx
    .select({
      id: tourDepartures.id,
      tourId: tourDepartures.tourId,
      startDate: tourDepartures.startDate,
      startTime: tourDepartures.startTime,
      capacity: tourDepartures.capacity,
      isOpen: tourDepartures.isOpen,
      seatsBooked: sql<number>`coalesce(${seats.seats}, 0)`,
    })
    .from(tourDepartures)
    .leftJoin(seats, eq(seats.departureId, tourDepartures.id))
    .where(
      and(
        eq(tourDepartures.tenantId, scope.tenantId),
        eq(tourDepartures.tourId, tour.id),
        options.from ? gte(tourDepartures.startDate, requireToday(options.from)) : undefined,
        options.openOnly ? eq(tourDepartures.isOpen, true) : undefined,
      ),
    )
    .orderBy(asc(tourDepartures.startDate));
  return rows.map((row) => toView(row, row.seatsBooked));
}

/** How many open departures of a tour start on or after `today`. */
export async function countUpcomingDepartures(scope: TenantScope, tourId: string, today: string): Promise<number> {
  const [row] = await scope.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tourDepartures)
    .where(
      and(
        eq(tourDepartures.tenantId, scope.tenantId),
        eq(tourDepartures.tourId, tourId),
        eq(tourDepartures.isOpen, true),
        gte(tourDepartures.startDate, requireToday(today)),
      ),
    );
  return row?.n ?? 0;
}

/** Adds a start date to a `departure` tour. */
export async function addDeparture(scope: TenantScope, tourId: string, input: AddDepartureInput, options: TodayOption): Promise<DepartureView> {
  const today = requireToday(options.today);
  const tour = await findTourRow(scope, tourId);
  const data = parse(addDepartureSchema, input);
  if (tour.kind !== "departure") {
    throw new ValidationError("Only tours sold as scheduled departures have departure dates.", {
      kind: ["Change how this tour is sold to “scheduled departures” before adding dates."],
    });
  }
  if (data.startDate < today) throw invalid("startDate", "Choose a date that is not in the past.");
  if (await dateTaken(scope, tour.id, data.startDate)) throw invalid("startDate", "This tour already departs on that date.");

  const [row] = (await scope.tx
    .insert(tourDepartures)
    .values({
      tenantId: scope.tenantId,
      tourId: tour.id,
      startDate: data.startDate,
      startTime: data.startTime ?? null,
      capacity: data.capacity,
      isOpen: data.isOpen ?? true,
    })
    .returning()) as [Row];
  return toView(row, 0);
}

/**
 * Edits a departure. The date cannot move once seats are held on it, and the
 * capacity cannot drop below the seats already taken.
 *
 * Takes the departure's booking lock before counting seats, so a booking
 * request for the same departure is either already counted here or will see
 * the new capacity, open flag and date when its turn comes.
 */
export async function updateDeparture(scope: TenantScope, departureId: string, input: UpdateDepartureInput, options: TodayOption): Promise<DepartureView> {
  const today = requireToday(options.today);
  const found = await findRow(scope, departureId);
  const patch = parse(updateDepartureSchema, input);
  if (Object.keys(patch).length === 0) throw new ValidationError("Nothing to change.");
  await lockDeparture(scope, found);
  // Read again under the lock: another edit may have gone first.
  const existing = await findRow(scope, found.id);
  const usage = await bookingUsage(scope, existing.id);

  if (patch.startDate !== undefined && patch.startDate !== existing.startDate) {
    if (usage.active > 0) throw new ConflictError("This departure has active bookings, so its date cannot change. Reschedule those bookings first.");
    if (patch.startDate < today) throw invalid("startDate", "Choose a date that is not in the past.");
    if (await dateTaken(scope, existing.tourId, patch.startDate, existing.id)) throw invalid("startDate", "This tour already departs on that date.");
  }
  if (patch.capacity !== undefined && patch.capacity < usage.seats) {
    // Capacity is at least 1, so this can only fire with two or more seats held.
    throw invalid("capacity", `${usage.seats} seats are already booked on this departure.`);
  }

  const [row] = (await scope.tx
    .update(tourDepartures)
    .set(patch)
    .where(and(eq(tourDepartures.tenantId, scope.tenantId), eq(tourDepartures.id, existing.id)))
    .returning()) as [Row];
  return toView(row, usage.seats);
}

/**
 * Removes a departure nobody has ever booked. One with bookings is closed
 * instead of deleted. Holds the departure's booking lock, so a request that
 * is being placed right now is seen before the row goes.
 */
export async function removeDeparture(scope: TenantScope, departureId: string): Promise<void> {
  const found = await findRow(scope, departureId);
  await lockDeparture(scope, found);
  const existing = await findRow(scope, found.id);
  const usage = await bookingUsage(scope, existing.id);
  if (usage.active > 0) {
    throw new ConflictError("This departure has active bookings. Cancel or move them before removing it.");
  }
  if (usage.total > 0) {
    throw new ConflictError("This departure has past bookings, so it is kept for your records. Close it to new bookings instead.");
  }
  await scope.tx.delete(tourDepartures).where(and(eq(tourDepartures.tenantId, scope.tenantId), eq(tourDepartures.id, existing.id)));
}
