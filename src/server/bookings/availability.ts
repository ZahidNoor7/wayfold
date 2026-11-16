import "server-only";
import { and, eq, gt, gte, isNull, lte, ne, or, type SQL } from "drizzle-orm";
import { addDays, diffDays, eachDate, isIsoDate, isoWeekday, rangesOverlap } from "../../lib/dates";
import type { TenantScope } from "../db/context";
import { availabilityBlocks, bookings, tourDepartures, tours, type TourSchedule } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { getBookingSettings, type BookingSettings } from "../settings/tenant-settings";
import { assertId, normaliseTime, type TourKind } from "./shared";

export type DayState = "open" | "limited" | "full" | "hold" | "closed" | "past";

/** Why a date is not simply open; null for open and limited dates. */
export type AvailabilityReason =
  | "past"
  | "min_notice"
  | "beyond_horizon"
  | "day_off"
  | "blocked"
  | "not_scheduled"
  | "no_departure"
  | "departure_closed"
  | "sold_out"
  | "booked"
  | "on_hold";

export interface AvailabilityTour {
  id: string;
  kind: TourKind;
  durationDays: number;
  schedule: TourSchedule;
}

export interface AvailabilitySettings {
  horizonDays: number;
  minNoticeDays: number;
  weeklyDaysOff: number[];
}

export interface AvailabilityDeparture {
  id: string;
  tourId: string;
  startDate: string;
  capacity: number;
  isOpen: boolean;
}

export interface AvailabilityBlock {
  /** null = the whole business is closed. */
  tourId: string | null;
  startDate: string;
  endDate: string;
}

/** A booking that occupies seats right now. */
export interface ActiveBooking {
  id: string;
  tourId: string;
  tourKind: TourKind;
  departureId: string | null;
  startDate: string;
  endDate: string;
  /** `HH:MM`, day tours only. */
  slotTime: string | null;
  seats: number;
  /** True for a pending request holding its seats; false once confirmed. */
  held: boolean;
}

export interface SlotAvailability {
  time: string;
  capacity: number;
  seatsLeft: number;
  state: "open" | "limited" | "full";
}

export interface DayAvailability {
  date: string;
  /** Last day of the tour when it starts on `date`. */
  endDate: string;
  state: DayState;
  reason: AvailabilityReason | null;
  /** Day tours: sum over slots. Departures: seats on the departure. Private: 1 when free. */
  seatsLeft: number;
  capacity: number | null;
  departureId: string | null;
  /** Day tours only. */
  slots: SlotAvailability[] | null;
}

export interface AvailabilityInput {
  tour: AvailabilityTour;
  settings: AvailabilitySettings;
  departures: AvailabilityDeparture[];
  blocks: AvailabilityBlock[];
  /** Only bookings that hold seats: see `isHoldingSeats`. */
  bookings: ActiveBooking[];
  /** `YYYY-MM-DD` in the tenant's timezone. */
  today: string;
}

/** Seats are consumed by confirmed bookings and by pending ones whose hold has not run out. */
export function isHoldingSeats(booking: { status: string; holdExpiresAt: Date | null }, now: Date): boolean {
  if (booking.status === "confirmed") return true;
  return booking.status === "pending" && booking.holdExpiresAt !== null && booking.holdExpiresAt.getTime() > now.getTime();
}

/** Inclusive last day of a tour of `durationDays` starting on `date`. */
export function spanEnd(date: string, durationDays: number): string {
  return addDays(date, Math.max(1, durationDays) - 1);
}

export function isBookable(state: DayState): boolean {
  return state === "open" || state === "limited";
}

const seatsOf = (list: ActiveBooking[]) => list.reduce((sum, booking) => sum + booking.seats, 0);

/**
 * State of one start date. Pure: everything it needs is passed in, so the
 * same function answers the public calendar and the last-second check inside
 * the booking transaction.
 */
export function computeDayState(input: AvailabilityInput, date: string): DayAvailability {
  const { tour, settings, today } = input;
  const endDate = spanEnd(date, tour.durationDays);
  const unavailable = (state: DayState, reason: AvailabilityReason): DayAvailability => ({
    date,
    endDate,
    state,
    reason,
    seatsLeft: 0,
    capacity: null,
    departureId: null,
    slots: null,
  });

  if (date < today) return unavailable("past", "past");
  if (date < addDays(today, settings.minNoticeDays)) return unavailable("closed", "min_notice");
  if (date > addDays(today, settings.horizonDays)) return unavailable("closed", "beyond_horizon");
  // The weekly day off applies to the start day only: a multi-day tour
  // inevitably runs across it.
  if (settings.weeklyDaysOff.includes(isoWeekday(date))) return unavailable("closed", "day_off");
  const blocked = input.blocks.some(
    (block) => (block.tourId === null || block.tourId === tour.id) && rangesOverlap(date, endDate, block.startDate, block.endDate),
  );
  if (blocked) return unavailable("closed", "blocked");

  if (tour.kind === "day") {
    const slots = tour.schedule.slots ?? [];
    if (!(tour.schedule.weekdays ?? []).includes(isoWeekday(date)) || slots.length === 0) return unavailable("closed", "not_scheduled");

    const slotStates: SlotAvailability[] = slots
      .map((slot) => {
        const time = normaliseTime(slot.time);
        const taken = seatsOf(input.bookings.filter((b) => b.tourId === tour.id && b.startDate === date && b.slotTime === time));
        const seatsLeft = Math.max(0, slot.capacity - taken);
        const state: SlotAvailability["state"] = seatsLeft === 0 ? "full" : seatsLeft <= 2 ? "limited" : "open";
        return { time, capacity: slot.capacity, seatsLeft, state };
      })
      .sort((a, b) => a.time.localeCompare(b.time));

    const seatsLeft = slotStates.reduce((sum, slot) => sum + slot.seatsLeft, 0);
    const capacity = slotStates.reduce((sum, slot) => sum + slot.capacity, 0);
    const few = slotStates.some((slot) => slot.state === "limited") || seatsLeft <= 4;
    const state: DayState = seatsLeft === 0 ? "full" : few ? "limited" : "open";
    return { date, endDate, state, reason: state === "full" ? "sold_out" : null, seatsLeft, capacity, departureId: null, slots: slotStates };
  }

  if (tour.kind === "departure") {
    const departure = input.departures.find((d) => d.tourId === tour.id && d.startDate === date);
    if (!departure) return unavailable("closed", "no_departure");
    if (!departure.isOpen) return unavailable("closed", "departure_closed");

    const taken = seatsOf(
      input.bookings.filter((b) => b.departureId === departure.id || (b.departureId === null && b.tourId === tour.id && b.startDate === date)),
    );
    const seatsLeft = Math.max(0, departure.capacity - taken);
    const state: DayState = seatsLeft === 0 ? "full" : seatsLeft <= 3 ? "limited" : "open";
    return {
      date,
      endDate,
      state,
      reason: state === "full" ? "sold_out" : null,
      seatsLeft,
      capacity: departure.capacity,
      departureId: departure.id,
      slots: null,
    };
  }

  // Private: the guide can only be in one place, so every private booking of
  // the tenant counts, whichever tour it is for.
  const overlapping = input.bookings.filter((b) => b.tourKind === "private" && rangesOverlap(date, endDate, b.startDate, b.endDate));
  if (overlapping.some((b) => !b.held)) return { ...unavailable("full", "booked"), capacity: 1 };
  if (overlapping.length > 0) return { ...unavailable("hold", "on_hold"), capacity: 1 };
  return { date, endDate, state: "open", reason: null, seatsLeft: 1, capacity: 1, departureId: null, slots: null };
}

/** One entry per date from `from` to `to` inclusive. */
export function computeCalendar(input: AvailabilityInput, from: string, to: string): DayAvailability[] {
  return eachDate(from, to).map((date) => computeDayState(input, date));
}

/** SQL twin of `isHoldingSeats`. */
export function holdingSeats(now: Date): SQL {
  return or(eq(bookings.status, "confirmed"), and(eq(bookings.status, "pending"), gt(bookings.holdExpiresAt, now)))!;
}

export interface LoadOptions {
  now: Date;
  /** Leave this booking out, when re-checking a booking against everyone else. */
  excludeBookingId?: string;
}

export interface AvailabilityData {
  /** The tenant's full booking settings, so callers need not read them twice. */
  settings: BookingSettings;
  departures: AvailabilityDeparture[];
  blocks: AvailabilityBlock[];
  bookings: ActiveBooking[];
}

/**
 * Loads what `computeDayState` needs for start dates in [from, to]. Every
 * query names the tenant explicitly; row-level security is the second fence.
 */
export async function loadAvailabilityData(
  scope: TenantScope,
  tour: AvailabilityTour,
  range: { from: string; to: string },
  options: LoadOptions,
): Promise<AvailabilityData> {
  const lastDay = spanEnd(range.to, tour.durationDays);
  const settings = await getBookingSettings(scope);

  const departures =
    tour.kind === "departure"
      ? await scope.tx
          .select({
            id: tourDepartures.id,
            tourId: tourDepartures.tourId,
            startDate: tourDepartures.startDate,
            capacity: tourDepartures.capacity,
            isOpen: tourDepartures.isOpen,
          })
          .from(tourDepartures)
          .where(
            and(
              eq(tourDepartures.tenantId, scope.tenantId),
              eq(tourDepartures.tourId, tour.id),
              gte(tourDepartures.startDate, range.from),
              lte(tourDepartures.startDate, range.to),
            ),
          )
      : [];

  const blocks = await scope.tx
    .select({ tourId: availabilityBlocks.tourId, startDate: availabilityBlocks.startDate, endDate: availabilityBlocks.endDate })
    .from(availabilityBlocks)
    .where(
      and(
        eq(availabilityBlocks.tenantId, scope.tenantId),
        or(isNull(availabilityBlocks.tourId), eq(availabilityBlocks.tourId, tour.id)),
        lte(availabilityBlocks.startDate, lastDay),
        gte(availabilityBlocks.endDate, range.from),
      ),
    );

  const rows = await scope.tx
    .select({
      id: bookings.id,
      tourId: bookings.tourId,
      tourKind: tours.kind,
      departureId: bookings.departureId,
      startDate: bookings.startDate,
      endDate: bookings.endDate,
      slotTime: bookings.slotTime,
      adults: bookings.adults,
      children: bookings.children,
      status: bookings.status,
    })
    .from(bookings)
    .innerJoin(tours, and(eq(tours.tenantId, bookings.tenantId), eq(tours.id, bookings.tourId)))
    .where(
      and(
        eq(bookings.tenantId, scope.tenantId),
        holdingSeats(options.now),
        lte(bookings.startDate, lastDay),
        gte(bookings.endDate, range.from),
        // Private tours compete with every private booking of the tenant;
        // seat-based tours only with their own bookings.
        tour.kind === "private" ? eq(tours.kind, "private") : eq(bookings.tourId, tour.id),
        options.excludeBookingId ? ne(bookings.id, options.excludeBookingId) : undefined,
      ),
    );

  return {
    settings,
    departures,
    blocks,
    bookings: rows.map((row) => ({
      id: row.id,
      tourId: row.tourId,
      tourKind: row.tourKind,
      departureId: row.departureId,
      startDate: row.startDate,
      endDate: row.endDate,
      slotTime: row.slotTime ? normaliseTime(row.slotTime) : null,
      seats: row.adults + row.children,
      held: row.status === "pending",
    })),
  };
}

/** Longest calendar window one call may ask for. */
export const MAX_AVAILABILITY_DAYS = 400;

export interface TourAvailabilityOptions {
  from: string;
  to: string;
  /** `YYYY-MM-DD` in the tenant's timezone. */
  today: string;
  /** Clock used to decide which holds are still alive. Defaults to the server clock. */
  now?: Date;
  /** Dashboard use: also answer for draft and archived tours. */
  includeUnpublished?: boolean;
}

export interface TourAvailability {
  tourId: string;
  kind: TourKind;
  durationDays: number;
  maxGroupSize: number;
  days: DayAvailability[];
}

/**
 * Availability calendar of one tour. Public callers get published tours
 * only; anything else, including another tenant's tour, is "not found".
 */
export async function getTourAvailability(scope: TenantScope, tourId: string, options: TourAvailabilityOptions): Promise<TourAvailability> {
  const { from, to, today } = options;
  assertId(tourId, "Tour");
  if (!isIsoDate(from) || !isIsoDate(to) || !isIsoDate(today)) throw new ValidationError("Enter valid dates.");
  if (to < from) throw new ValidationError("The end date must not be before the start date.");
  if (diffDays(from, to) >= MAX_AVAILABILITY_DAYS) throw new ValidationError(`Ask for at most ${MAX_AVAILABILITY_DAYS} days at a time.`);

  const [tour] = await scope.tx
    .select({
      id: tours.id,
      kind: tours.kind,
      durationDays: tours.durationDays,
      maxGroupSize: tours.maxGroupSize,
      schedule: tours.schedule,
      status: tours.status,
    })
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.id, tourId)))
    .limit(1);
  if (!tour || (!options.includeUnpublished && tour.status !== "published")) throw new NotFoundError("Tour");

  const data = await loadAvailabilityData(scope, tour, { from, to }, { now: options.now ?? new Date() });
  return {
    tourId: tour.id,
    kind: tour.kind,
    durationDays: tour.durationDays,
    maxGroupSize: tour.maxGroupSize,
    days: computeCalendar({ tour, ...data, today }, from, to),
  };
}
