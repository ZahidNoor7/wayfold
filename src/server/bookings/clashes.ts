import "server-only";
import { rangesOverlap } from "../../lib/dates";
import type { TourKind } from "./shared";

/** A booking that currently occupies seats: confirmed, or pending with a live hold. */
export interface LiveBooking {
  id: string;
  reference: string;
  contactName: string;
  tourId: string;
  tourKind: TourKind;
  departureId: string | null;
  startDate: string;
  endDate: string;
  /** `HH:MM`, day tours only. */
  slotTime: string | null;
  seats: number;
  status: "pending" | "confirmed";
}

export interface ClashParty {
  id: string;
  reference: string;
  name: string;
  status: "pending" | "confirmed";
  seats: number;
  startDate: string;
  endDate: string;
}

export interface Clash {
  type: "overlap" | "over_capacity";
  /** Ready to show to staff. */
  message: string;
  with: ClashParty[];
  /** Seats requested on the unit including the target; over-capacity clashes only. */
  seats?: number;
  capacity?: number;
}

const party = (b: LiveBooking): ClashParty => ({
  id: b.id,
  reference: b.reference,
  name: b.contactName,
  status: b.status,
  seats: b.seats,
  startDate: b.startDate,
  endDate: b.endDate,
});

/** True when `other` sells seats from the same slot or departure as `target`. */
function sameSharedUnit(target: LiveBooking, other: LiveBooking): boolean {
  if (other.tourId !== target.tourId) return false;
  if (target.tourKind === "day") return other.startDate === target.startDate && other.slotTime === target.slotTime;
  if (target.departureId && other.departureId) return other.departureId === target.departureId;
  return other.startDate === target.startDate;
}

/**
 * Scheduling conflicts for `target` against the other live bookings.
 *
 * - private: the guide can be in one place, so any overlap with another
 *   private booking of ANY tour is a clash;
 * - day / departure: the seats on the same slot or departure, including the
 *   target's, must fit the capacity. `capacity` null means the unit no longer
 *   exists in the schedule, so there is nothing to compare against.
 */
export function detectClashes(target: LiveBooking, others: LiveBooking[], capacity: number | null): Clash[] {
  const rest = others.filter((other) => other.id !== target.id);

  if (target.tourKind === "private") {
    return rest
      .filter((other) => other.tourKind === "private" && rangesOverlap(target.startDate, target.endDate, other.startDate, other.endDate))
      .map((other) => ({
        type: "overlap" as const,
        message: `Overlaps ${other.contactName}’s private tour (${other.startDate} – ${other.endDate}, ${other.status})`,
        with: [party(other)],
      }));
  }

  if (capacity === null) return [];
  const sharing = rest.filter((other) => sameSharedUnit(target, other));
  const seats = target.seats + sharing.reduce((sum, other) => sum + other.seats, 0);
  if (seats <= capacity) return [];

  const when = target.slotTime ? `${target.startDate} at ${target.slotTime}` : target.startDate;
  const withText = sharing.length > 0 ? ` with ${sharing.map((o) => `${o.contactName} (${o.status}, ${o.seats})`).join(", ")}` : "";
  return [
    {
      type: "over_capacity",
      message: `Over capacity: ${seats} of ${capacity} seats on ${when}${withText}`,
      with: sharing.map(party),
      seats,
      capacity,
    },
  ];
}
