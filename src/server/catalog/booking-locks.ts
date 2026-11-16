import "server-only";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { bookableUnit, lockUnit, normaliseTime } from "../bookings/shared";
import type { TenantScope } from "../db/context";
import { bookings, tours } from "../db/schema";
import { NotFoundError } from "../errors";
import type { TourRow } from "./shared";

/**
 * Catalogue edits that shrink what can be booked (a departure's seats, a day
 * tour's slots, a tour's kind, length or party size) race with booking
 * requests. Both sides must decide under the same lock, so these helpers take
 * the booking module's own unit locks before the catalogue reads seat usage.
 *
 * Lock order for a catalogue transaction: catalogue lock, then unit keys in
 * sorted order, then the tour row. A booking transaction takes one unit key
 * and only then touches the tour row (the foreign-key check of its insert),
 * so the two orders never cross.
 */

/** A booking that still occupies seats: pending or confirmed. */
export interface ActiveBooking {
  id: string;
  startDate: string;
  /** `HH:MM`, day tours only. */
  slotTime: string | null;
  departureId: string | null;
  seats: number;
}

/** Active bookings of a tour; with `from`, only those still running on or after that date. */
export async function loadActiveBookings(scope: TenantScope, tourId: string, from?: string): Promise<ActiveBooking[]> {
  const rows = await scope.tx
    .select({
      id: bookings.id,
      startDate: bookings.startDate,
      slotTime: bookings.slotTime,
      departureId: bookings.departureId,
      adults: bookings.adults,
      children: bookings.children,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, scope.tenantId),
        eq(bookings.tourId, tourId),
        inArray(bookings.status, ["pending", "confirmed"]),
        from ? gte(bookings.endDate, from) : undefined,
      ),
    )
    .orderBy(asc(bookings.startDate), asc(bookings.slotTime), asc(bookings.id));
  return rows.map((row) => ({
    id: row.id,
    startDate: row.startDate,
    slotTime: row.slotTime ? normaliseTime(row.slotTime) : null,
    departureId: row.departureId,
    seats: row.adults + row.children,
  }));
}

/** Takes the lock a booking request takes for this departure's seats. */
export async function lockDeparture(scope: TenantScope, departure: { id: string; tourId: string; startDate: string }): Promise<void> {
  await lockUnit(scope, bookableUnit({ id: departure.tourId, kind: "departure" }, { startDate: departure.startDate, slotTime: null, departureId: departure.id }));
}

/**
 * Prepares a tour for a change to its kind, schedule, length or party size.
 *
 * A day tour's units are one per date and start time, too many to list, so
 * this locks every unit that already has an active booking and then the tour
 * row itself. `FOR UPDATE` on the row waits for any booking that is being
 * inserted right now (its foreign-key check holds a share lock on the row),
 * so the bookings read afterwards are complete and the caller can validate
 * the new values against them before writing.
 */
export async function lockTourForCapacityChange(
  scope: TenantScope,
  tour: Pick<TourRow, "id" | "kind">,
  from?: string,
): Promise<{ tour: TourRow; active: ActiveBooking[] }> {
  const known = await loadActiveBookings(scope, tour.id, from);
  const units = [...new Set(known.map((booking) => bookableUnit(tour, booking)))].sort();
  for (const unit of units) await lockUnit(scope, unit);

  const [fresh] = await scope.tx
    .select()
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.id, tour.id)))
    .limit(1)
    .for("update");
  if (!fresh) throw new NotFoundError("Tour");
  return { tour: fresh, active: await loadActiveBookings(scope, tour.id, from) };
}
