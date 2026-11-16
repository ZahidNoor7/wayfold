import "server-only";
import { isoWeekday } from "@/lib/dates";
import type { TourSchedule } from "../db/schema";

export type FieldErrors = Record<string, string[]>;

/** The parts of a tour the consistency rules look at. */
export interface TourShape {
  kind: "day" | "departure" | "private";
  durationDays: number;
  minGroupSize: number;
  maxGroupSize: number;
  schedule: TourSchedule;
  meetingLatitude: number | null;
  meetingLongitude: number | null;
}

/** The parts of a tour that must be filled in before it can be public. */
export interface PublishableTour extends TourShape {
  title: string;
  summary: string;
  priceAdult: number;
  durationLabel: string;
}

function add(errors: FieldErrors, field: string, message: string): void {
  (errors[field] ??= []).push(message);
}

/**
 * Rules that span several fields, checked on the tour as it would be stored
 * (existing values merged with the change), so a partial update cannot leave
 * the row inconsistent.
 */
export function consistencyErrors(tour: TourShape): FieldErrors {
  const errors: FieldErrors = {};
  if (tour.minGroupSize > tour.maxGroupSize) {
    add(errors, "maxGroupSize", "The largest group cannot be smaller than the smallest group.");
  }
  if ((tour.meetingLatitude === null) !== (tour.meetingLongitude === null)) {
    add(errors, tour.meetingLatitude === null ? "meetingLatitude" : "meetingLongitude", "Give both a latitude and a longitude, or neither.");
  }
  if (tour.kind !== "day" && tour.schedule.slots.length > 0) {
    add(errors, "schedule", "Only day tours have start times. Remove the start times or sell this as a day tour.");
  }
  if (tour.kind === "day" && tour.durationDays !== 1) {
    add(errors, "durationDays", "A day tour lasts one day. Describe its length in hours in the duration label.");
  }
  return errors;
}

/**
 * What is missing before a tour can go public. `futureDepartures` is only
 * known when publishing; edits to an already published tour leave it out.
 */
export function completenessErrors(tour: PublishableTour, context: { futureDepartures?: number } = {}): FieldErrors {
  const errors: FieldErrors = {};
  if (tour.title.trim().length < 3) add(errors, "title", "Add a title (3+ characters).");
  if (tour.summary.trim().length === 0) add(errors, "summary", "Add a short summary for tour cards.");
  if (tour.priceAdult <= 0) add(errors, "priceAdult", "Enter a price above 0.");
  if (tour.durationDays < 1 && tour.durationLabel.trim().length === 0) add(errors, "durationLabel", "Add a duration.");
  if (tour.kind === "day") {
    if (tour.schedule.slots.length === 0) add(errors, "schedule", "Add at least one start time.");
    if (tour.schedule.weekdays.length === 0) add(errors, "schedule", "Choose at least one day of the week.");
  }
  if (tour.kind === "departure" && context.futureDepartures !== undefined && context.futureDepartures < 1) {
    add(errors, "departures", "Add at least one upcoming departure date.");
  }
  return errors;
}

/** Seats already taken on one start date (and start time, for day tours). */
export interface BookedSeats {
  startDate: string;
  /** `HH:MM`; null when the booking has no start time. */
  slotTime: string | null;
  seats: number;
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MAX_CONFLICTS = 5;

/**
 * Why a day tour's new schedule cannot hold the bookings it already has: a
 * booked weekday or start time would disappear, or a start time would get
 * fewer seats than are taken. One message per date and time, earliest first.
 */
export function scheduleConflicts(schedule: TourSchedule, active: BookedSeats[]): string[] {
  const taken = new Map<string, BookedSeats>();
  for (const booking of active) {
    if (booking.slotTime === null) continue;
    const key = `${booking.startDate} ${booking.slotTime}`;
    const group = taken.get(key);
    if (group) group.seats += booking.seats;
    else taken.set(key, { ...booking });
  }

  const conflicts: string[] = [];
  for (const key of [...taken.keys()].sort()) {
    const { startDate, slotTime, seats } = taken.get(key)!;
    const weekday = isoWeekday(startDate);
    const slot = schedule.slots.find((candidate) => candidate.time === slotTime);
    if (!schedule.weekdays.includes(weekday)) {
      conflicts.push(`There are bookings on ${startDate}, a ${WEEKDAY_NAMES[weekday - 1]}. Keep that day, or move those bookings first.`);
    } else if (!slot) {
      conflicts.push(`The ${slotTime} start time has bookings on ${startDate}. Keep it, or move those bookings first.`);
    } else if (slot.capacity < seats) {
      conflicts.push(`${seats} ${seats === 1 ? "seat is" : "seats are"} already booked at ${slotTime} on ${startDate}.`);
    }
  }
  return conflicts.length > MAX_CONFLICTS
    ? [...conflicts.slice(0, MAX_CONFLICTS), `…and ${conflicts.length - MAX_CONFLICTS} more.`]
    : conflicts;
}

/**
 * Why a change to a tour's length, schedule or party size cannot be applied
 * while it has active bookings. `before` is the stored tour, `after` the tour
 * as it would be saved; `scheduleGiven` says whether the edit touches the
 * schedule at all, so an unrelated edit is never blocked by old bookings.
 */
export function bookingConflictErrors(before: TourShape, after: TourShape, active: BookedSeats[], scheduleGiven: boolean): FieldErrors {
  const errors: FieldErrors = {};
  const first = active[0];
  if (!first) return errors;

  if (after.durationDays !== before.durationDays) {
    // Each booking's last day was fixed from the length it was sold with.
    add(errors, "durationDays", `A booking on ${first.startDate} was made for the current length. Move or cancel active bookings first, or duplicate the tour.`);
  }
  if (after.kind === "day" && scheduleGiven) {
    for (const conflict of scheduleConflicts(after.schedule, active)) add(errors, "schedule", conflict);
  }
  if (after.kind !== "departure" && after.maxGroupSize < before.maxGroupSize) {
    const largest = active.reduce((most, booking) => (booking.seats > most.seats ? booking : most), first);
    if (largest.seats > after.maxGroupSize) {
      add(errors, "maxGroupSize", `A booking on ${largest.startDate} has ${largest.seats} guests. Move or cancel it before going below ${largest.seats}.`);
    }
  }
  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
