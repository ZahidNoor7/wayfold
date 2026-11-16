import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isIsoDate } from "../../lib/dates";
import { recordAudit } from "../audit";
import { customerEmailSchema } from "../customers/service";
import type { TenantScope } from "../db/context";
import { tours, waitlistEntries } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { computeDayState, isBookable, loadAvailabilityData } from "./availability";
import { assertId, isoDateSchema, parse, slotTimeSchema } from "./shared";

/**
 * What a storefront may send to join a waitlist. As with booking requests,
 * unknown keys are dropped, so a tenant id in the payload never reaches a row.
 */
export const joinWaitlistSchema = z
  .object({
    tourId: z.string().optional(),
    tourSlug: z.string().trim().min(1).max(200).optional(),
    date: isoDateSchema,
    slotTime: slotTimeSchema.nullish(),
    name: z.string().trim().min(2, "Please enter your name.").max(120),
    email: customerEmailSchema,
    partySize: z.number().int().min(1).max(100).default(1),
  })
  .refine((value) => Boolean(value.tourId) || Boolean(value.tourSlug), { path: ["tourId"], message: "Choose a tour." });
export type JoinWaitlistInput = z.input<typeof joinWaitlistSchema>;

export interface WaitlistOptions {
  /** `YYYY-MM-DD` in the tenant's timezone. */
  today: string;
  /** Server clock: decides which holds are still alive. */
  now: Date;
}

export interface WaitlistResult {
  date: string;
  /** `HH:MM` for a day tour's start time; null when the whole date is waited for. */
  slotTime: string | null;
}

/**
 * Public entry point: puts a visitor on the waitlist of a date that cannot be
 * booked right now. Only sold-out and on-hold dates (or a sold-out start time
 * of a day tour) take a waitlist: a date with space should simply be booked,
 * and a date the tour does not run on will never open.
 *
 * Joining twice with the same e-mail updates the entry instead of adding one,
 * and answers exactly the same, so the response never tells a caller whether
 * an address was already listed.
 */
export async function joinWaitlist(scope: TenantScope, raw: unknown, options: WaitlistOptions): Promise<WaitlistResult> {
  const input = parse(joinWaitlistSchema, raw);
  const { today, now } = options;
  if (!isIsoDate(today)) throw new RangeError("today must be a calendar date");

  if (input.tourId) assertId(input.tourId, "Tour");
  const [tour] = await scope.tx
    .select({ id: tours.id, kind: tours.kind, durationDays: tours.durationDays, schedule: tours.schedule })
    .from(tours)
    .where(
      and(
        eq(tours.tenantId, scope.tenantId),
        input.tourId ? eq(tours.id, input.tourId) : eq(tours.slug, input.tourSlug!),
        eq(tours.status, "published"),
      ),
    )
    .limit(1);
  // Drafts, archived tours and other tenants' tours all look the same from outside.
  if (!tour) throw new NotFoundError("Tour");

  const data = await loadAvailabilityData(scope, tour, { from: input.date, to: input.date }, { now });
  const day = computeDayState({ tour, ...data, today }, input.date);
  if (day.state === "past" || day.state === "closed") {
    throw new ValidationError(undefined, { date: ["That date is not running, so it has no waitlist. Please choose another date."] });
  }

  let slotTime: string | null = null;
  if (tour.kind === "day" && input.slotTime) {
    const slot = day.slots?.find((candidate) => candidate.time === input.slotTime);
    if (!slot) throw new ValidationError(undefined, { slotTime: ["Choose a start time."] });
    if (slot.seatsLeft >= input.partySize) {
      throw new ValidationError(undefined, { slotTime: ["That time still has space — you can book it now."] });
    }
    slotTime = slot.time;
  } else if (isBookable(day.state) && day.seatsLeft >= input.partySize) {
    throw new ValidationError(undefined, { date: ["That date still has space — you can book it now."] });
  }

  const [entry] = await scope.tx
    .insert(waitlistEntries)
    .values({ tenantId: scope.tenantId, tourId: tour.id, date: input.date, slotTime, name: input.name, email: input.email, partySize: input.partySize })
    .onConflictDoUpdate({
      target: [waitlistEntries.tenantId, waitlistEntries.tourId, waitlistEntries.date, waitlistEntries.email],
      set: { name: input.name, slotTime, partySize: input.partySize },
    })
    .returning({ id: waitlistEntries.id });

  // Field names only: the address itself stays out of the audit log.
  await recordAudit(scope, {
    action: "booking.waitlist_joined",
    targetType: "waitlist_entry",
    targetId: entry!.id,
    metadata: { tourId: tour.id, date: input.date, slotTime, partySize: input.partySize },
    actorType: "system",
  });

  return { date: input.date, slotTime };
}
