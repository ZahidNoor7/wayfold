import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { addDays, isIsoDate, isValidTimezone } from "../../lib/dates";
import { recordAudit } from "../audit";
import { assertWithinLimit, getEntitlements } from "../billing/limits";
import { customerEmailSchema, upsertCustomerForBooking } from "../customers/service";
import type { TenantScope } from "../db/context";
import { bookingEvents, bookings, tourDepartures, tours } from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { enqueueNotification } from "../notifications";
import { consumeDiscount, findBestDiscount } from "../promotions/engine";
import { computeDayState, loadAvailabilityData, spanEnd, type DayAvailability } from "./availability";
import { bookingReceivedMessage, staffAlertMessage } from "./messages";
import { priceBooking } from "./pricing";
import {
  assertId,
  bookableUnit,
  isoDateSchema,
  loadTenantInfo,
  lockDepartureRow,
  lockTourRow,
  lockUnit,
  parse,
  QUOTA_UNIT,
  slotTimeSchema,
  TourChangedError,
} from "./shared";

const CONTACT_METHODS = ["email", "whatsapp", "phone"] as const;

/**
 * What a storefront may send. Unknown keys are dropped by Zod, so a price,
 * status, discount or tenant id smuggled into the payload never reaches the
 * booking: those are all decided here, on the server.
 */
export const bookingRequestSchema = z
  .object({
    tourId: z.string().optional(),
    tourSlug: z.string().trim().min(1).max(200).optional(),
    date: isoDateSchema,
    slotTime: slotTimeSchema.nullish(),
    alternativeDate: isoDateSchema.nullish(),
    adults: z.number().int().min(1, "At least one adult is needed.").max(100),
    children: z.number().int().min(0).max(100).default(0),
    participants: z
      .array(z.object({ name: z.string().trim().min(1).max(120), age: z.number().int().min(0).max(120).nullish() }))
      .max(200)
      .optional(),
    name: z.string().trim().min(2, "Please enter your full name.").max(120),
    email: customerEmailSchema,
    phone: z
      .string()
      .trim()
      .max(40)
      .refine((value) => value.replace(/\D/g, "").length >= 7, "Enter a phone number with at least 7 digits."),
    country: z.string().trim().max(80).optional(),
    language: z.string().trim().max(40).optional(),
    pickup: z.string().trim().max(200).optional(),
    contactMethod: z.enum(CONTACT_METHODS),
    notes: z.string().trim().max(2000).optional(),
    agree: z.literal(true, "Please confirm you understand this is a request."),
  })
  .refine((value) => Boolean(value.tourId) || Boolean(value.tourSlug), { path: ["tourId"], message: "Choose a tour." });
export type BookingRequestInput = z.input<typeof bookingRequestSchema>;

export interface BookingRequestOptions {
  /** `YYYY-MM-DD` in the tenant's timezone. */
  today: string;
  /** Server clock: start of the hold and the booking's creation time. */
  now: Date;
  /** Integer in [min, max). Replaced in tests to force reference collisions. */
  random?: (min: number, max: number) => number;
}

export interface BookingTotals {
  currency: string;
  unitPriceAdult: number;
  unitPriceChild: number;
  baseAmount: number;
  discountAmount: number;
  totalAmount: number;
  discountLabel: string | null;
}

export interface BookingRequestResult {
  bookingId: string;
  reference: string;
  status: "pending";
  totals: BookingTotals;
  holdExpiresAt: Date;
}

/** The unit was taken (or has too few seats) between showing the calendar and submitting. */
export class SlotTakenError extends ConflictError {
  constructor(readonly seatsLeft: number) {
    super(
      seatsLeft > 0
        ? `Only ${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} left — reduce your group or choose another date or time.`
        : "Sorry — that date was just booked by someone else. Please choose another date or time.",
      "slot_taken",
    );
  }
}

const dateUnavailable = () => new ValidationError(undefined, { date: ["That date is no longer available — please choose another."] });

/** Decides whether `seats` can be sold on `day`; throws the error the storefront should show. */
export function assertRequestFits(day: DayAvailability, kind: "day" | "departure" | "private", slotTime: string | null, seats: number): void {
  if (day.state === "past" || day.state === "closed") throw dateUnavailable();
  if (kind === "day") {
    const slot = day.slots?.find((candidate) => candidate.time === slotTime);
    if (!slot) throw new ValidationError(undefined, { slotTime: ["Choose a start time."] });
    if (slot.seatsLeft < seats) throw new SlotTakenError(slot.seatsLeft);
    return;
  }
  if (day.state === "full" || day.state === "hold") throw new SlotTakenError(0);
  if (kind === "departure" && day.seatsLeft < seats) throw new SlotTakenError(day.seatsLeft);
}

/** `AJ-SHE-4821`: tenant prefix, first three letters of the tour slug, random digits. */
export function makeReference(prefix: string, slug: string, digits: number, random: (min: number, max: number) => number): string {
  const code = slug.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  return `${prefix}-${code}-${random(10 ** (digits - 1), 10 ** digits)}`;
}

/** Tries at four digits before the reference grows, so a busy tour never runs out. */
const SHORT_REFERENCE_ATTEMPTS = 12;
const MAX_REFERENCE_ATTEMPTS = 24;

async function countBookingsThisMonth(scope: TenantScope, today: string, timezone: string): Promise<number> {
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonthStart = `${addDays(monthStart, 32).slice(0, 7)}-01`;
  const zone = isValidTimezone(timezone) ? timezone : "UTC";
  const [row] = await scope.tx
    .select({ used: sql<number>`count(*)`.mapWith(Number) })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, scope.tenantId),
        sql`${bookings.createdAt} >= (${monthStart}::timestamp at time zone ${zone})`,
        sql`${bookings.createdAt} < (${nextMonthStart}::timestamp at time zone ${zone})`,
      ),
    );
  return row?.used ?? 0;
}

/**
 * Public entry point: turns a storefront request into a pending booking that
 * holds its seats. Everything happens in the caller's transaction, so either
 * the booking, its hold, its discount and its messages all exist, or none do.
 */
export async function createBookingRequest(scope: TenantScope, raw: unknown, options: BookingRequestOptions): Promise<BookingRequestResult> {
  const input = parse(bookingRequestSchema, raw);
  const { today, now } = options;
  if (!isIsoDate(today)) throw new RangeError("today must be a calendar date");
  const random = options.random ?? randomInt;

  if (input.tourId) assertId(input.tourId, "Tour");
  const [listed] = await scope.tx
    .select({ id: tours.id, kind: tours.kind })
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
  if (!listed) throw new NotFoundError("Tour");

  const seats = input.adults + input.children;
  const slotTime = listed.kind === "day" ? (input.slotTime ?? null) : null;
  if (listed.kind === "day" && !slotTime) throw new ValidationError(undefined, { slotTime: ["Choose a start time."] });
  if (input.participants && input.participants.length > seats) {
    throw new ValidationError(undefined, { participants: ["There are more named travellers than guests."] });
  }
  const alternativeDate = input.alternativeDate ?? null;
  if (alternativeDate && (alternativeDate === input.date || alternativeDate < today)) {
    throw new ValidationError(undefined, { alternativeDate: ["Choose a different back-up date."] });
  }

  // Only to name the unit to lock; the departure is read again under the lock.
  let departureId: string | null = null;
  if (listed.kind === "departure") {
    const [departure] = await scope.tx
      .select({ id: tourDepartures.id })
      .from(tourDepartures)
      .where(and(eq(tourDepartures.tenantId, scope.tenantId), eq(tourDepartures.tourId, listed.id), eq(tourDepartures.startDate, input.date)))
      .limit(1);
    if (!departure) throw dateUnavailable();
    departureId = departure.id;
  }

  const tenant = await loadTenantInfo(scope);
  const { limits } = await getEntitlements(scope);
  // With a monthly cap, requests for different dates still race for the last
  // allowed booking, so they queue on one tenant-wide key first.
  if (limits.maxBookingsPerMonth !== null) await lockUnit(scope, QUOTA_UNIT);
  await lockUnit(scope, bookableUnit(listed, { startDate: input.date, slotTime, departureId }));

  // From here on only rows read under the locks are trusted: the tour (and
  // departure) as they are now, not as they were before this request waited.
  const tour = await lockTourRow(scope, listed.id);
  if (!tour || tour.status !== "published") throw new NotFoundError("Tour");
  if (tour.kind !== listed.kind) throw new TourChangedError();
  if (departureId) {
    const departure = await lockDepartureRow(scope, departureId);
    if (!departure || departure.tourId !== tour.id || departure.startDate !== input.date || !departure.isOpen) throw dateUnavailable();
  }
  // A private or day booking is one party; shared departures are limited by seats instead.
  if (tour.kind !== "departure" && seats > tour.maxGroupSize) {
    throw new ValidationError(undefined, { adults: [`This tour takes up to ${tour.maxGroupSize} guests per booking.`] });
  }
  if (seats < tour.minGroupSize) {
    throw new ValidationError(undefined, { adults: [`This tour runs for groups of at least ${tour.minGroupSize}.`] });
  }

  // Each statement sees what earlier holders of these locks committed, so
  // two requests cannot both take the last seats.
  const data = await loadAvailabilityData(scope, tour, { from: input.date, to: input.date }, { now });
  const day = computeDayState({ tour, ...data, today }, input.date);
  assertRequestFits(day, tour.kind, slotTime, seats);

  const usedThisMonth = await countBookingsThisMonth(scope, today, tenant.timezone);
  await assertWithinLimit(scope, "maxBookingsPerMonth", usedThisMonth);

  const customer = await upsertCustomerForBooking(scope, {
    name: input.name,
    email: input.email,
    phone: input.phone,
    country: input.country ?? "",
    language: input.language ?? "",
    preferredContact: input.contactMethod,
  });

  const price = priceBooking({ priceAdult: tour.priceAdult, childPricePercent: tour.childPricePercent, adults: input.adults, children: input.children });
  const found = await findBestDiscount(scope, {
    tourId: tour.id,
    email: input.email,
    adults: input.adults,
    children: input.children,
    baseAmount: price.baseAmount,
    travelDate: input.date,
    today,
  });
  // The engine caps the amount already; clamping again keeps a bad value from
  // ever producing a negative total.
  const discountAmount = found && Number.isFinite(found.amount) ? Math.min(Math.max(0, Math.trunc(found.amount)), price.baseAmount) : 0;
  const applied = found && discountAmount > 0 ? { ...found, amount: discountAmount } : null;

  const holdExpiresAt = new Date(now.getTime() + data.settings.holdHours * 3_600_000);
  const values = {
    tenantId: scope.tenantId,
    tourId: tour.id,
    customerId: customer.id,
    departureId,
    startDate: input.date,
    endDate: spanEnd(input.date, tour.durationDays),
    slotTime,
    alternativeDate,
    adults: input.adults,
    children: input.children,
    participants: (input.participants ?? []).map((person) => ({ name: person.name, age: person.age ?? null })),
    status: "pending" as const,
    holdExpiresAt,
    currency: tenant.currency,
    unitPriceAdult: price.unitPriceAdult,
    unitPriceChild: price.unitPriceChild,
    baseAmount: price.baseAmount,
    discountAmount,
    totalAmount: price.baseAmount - discountAmount,
    discountSource: applied?.source ?? null,
    discountRefId: applied?.refId ?? null,
    discountLabel: applied?.label ?? null,
    contactName: input.name,
    contactEmail: input.email,
    contactPhone: input.phone,
    country: input.country ?? "",
    language: input.language ?? "",
    pickup: input.pickup ?? "",
    contactMethod: input.contactMethod,
    customerNotes: input.notes ?? "",
    tourTitle: tour.title,
    createdAt: now,
  };

  let booking: typeof bookings.$inferSelect | undefined;
  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS && !booking; attempt += 1) {
    const reference = makeReference(data.settings.referencePrefix, tour.slug, attempt < SHORT_REFERENCE_ATTEMPTS ? 4 : 6, random);
    // "Do nothing" on a taken reference returns no row instead of raising,
    // which would abort the whole transaction; we just draw again.
    [booking] = await scope.tx
      .insert(bookings)
      .values({ ...values, reference })
      .onConflictDoNothing({ target: [bookings.tenantId, bookings.reference] })
      .returning();
  }
  if (!booking) throw new ConflictError("We could not issue a booking reference. Please try again.", "reference_unavailable");

  if (applied) await consumeDiscount(scope, applied, booking.id);

  await scope.tx.insert(bookingEvents).values({
    tenantId: scope.tenantId,
    bookingId: booking.id,
    kind: "created",
    message: `Request received for ${seats} guest${seats === 1 ? "" : "s"}. Seats held until ${holdExpiresAt.toISOString()}.`,
    actorId: scope.userId,
  });
  await recordAudit(scope, {
    action: "booking.created",
    targetType: "booking",
    targetId: booking.id,
    metadata: { reference: booking.reference, tourId: tour.id, startDate: booking.startDate, seats, discountSource: applied?.source ?? null },
  });

  await enqueueNotification(scope, bookingReceivedMessage(tenant, booking, data.settings.holdHours));
  // The business address is free text in settings. A missing or malformed one
  // must never cost the business a booking, so the alert is simply skipped.
  const staffEmail = z.email().safeParse(tenant.email.trim());
  if (staffEmail.success) await enqueueNotification(scope, staffAlertMessage(tenant, staffEmail.data, booking));

  return {
    bookingId: booking.id,
    reference: booking.reference,
    status: "pending",
    totals: {
      currency: booking.currency,
      unitPriceAdult: booking.unitPriceAdult,
      unitPriceChild: booking.unitPriceChild,
      baseAmount: booking.baseAmount,
      discountAmount: booking.discountAmount,
      totalAmount: booking.totalAmount,
      discountLabel: booking.discountLabel,
    },
    holdExpiresAt,
  };
}
