"use server";

import { z } from "zod";
import type { ServerQuote } from "@/lib/booking-form";
import { isIsoDate } from "@/lib/dates";
import { siteAction } from "@/server/actions";
import { priceBooking } from "@/server/bookings/pricing";
import { bookingRequestSchema, createBookingRequest } from "@/server/bookings/request";
import { joinWaitlist, joinWaitlistSchema } from "@/server/bookings/waitlist";
import { getPublishedTourBySlug } from "@/server/catalog/storefront";
import { AppError, LimitExceededError } from "@/server/errors";
import { findEligibleDiscounts } from "@/server/promotions/engine";
import { RATE_LIMITS, type RateLimitRule } from "@/server/rate-limit";
import { siteToday } from "@/server/storefront/context";

/** The price preview is asked for on every change of party, date or e-mail. */
const QUOTE_RATE_LIMIT: RateLimitRule = { name: "booking-quote", limit: 120, windowSeconds: 600 };
const WAITLIST_RATE_LIMIT: RateLimitRule = { name: "waitlist", limit: 10, windowSeconds: 3600 };

const quoteSchema = z.object({
  tourSlug: z.string().trim().toLowerCase().min(1).max(200),
  /** The chosen start date; empty until the visitor picks one. */
  date: z
    .string()
    .refine((value) => value === "" || isIsoDate(value), "Enter a valid date.")
    .default(""),
  adults: z.number().int().min(1).max(100),
  children: z.number().int().min(0).max(100).default(0),
  /** Only sent once it is a complete address; unlocks e-mail-bound discounts. */
  email: z.string().trim().toLowerCase().max(254).default(""),
});

/**
 * What a party would pay right now, with the single best discount it
 * qualifies for. A preview only: the booking request recomputes all of it.
 */
export const quoteBookingAction = siteAction(QUOTE_RATE_LIMIT, quoteSchema, async ({ tenant, scope, input }): Promise<ServerQuote> => {
  const today = siteToday(tenant);
  const tour = await getPublishedTourBySlug(scope, input.tourSlug, { today });
  const price = priceBooking({ priceAdult: tour.priceAdult, childPricePercent: tour.childPricePercent, adults: input.adults, children: input.children });
  const eligible = await findEligibleDiscounts(scope, {
    tourId: tour.id,
    // Deliberately not the visitor's e-mail: a live preview that reacted to
    // any address typed in would tell strangers who holds a personal
    // discount. Those are matched, and shown, when the request is submitted.
    email: "",
    adults: input.adults,
    children: input.children,
    baseAmount: price.baseAmount,
    // Without a date nothing that depends on booking ahead can apply yet.
    travelDate: input.date || today,
    today,
  });
  const best = eligible[0] ?? null;
  const discountAmount = best && Number.isFinite(best.amount) ? Math.min(Math.max(0, Math.trunc(best.amount)), price.baseAmount) : 0;

  return {
    currency: tenant.currency,
    unitPriceAdult: price.unitPriceAdult,
    unitPriceChild: price.unitPriceChild,
    adultsTotal: input.adults * price.unitPriceAdult,
    childrenTotal: input.children * price.unitPriceChild,
    baseAmount: price.baseAmount,
    discountAmount,
    totalAmount: price.baseAmount - discountAmount,
    discount: best && discountAmount > 0 ? { source: best.source, label: best.label } : null,
    otherMatches: Math.max(0, eligible.length - 1),
  };
});

export interface SubmittedBooking {
  reference: string;
  /** ISO timestamp: when the hold on the seats runs out. */
  holdExpiresAt: string;
  totals: {
    currency: string;
    unitPriceAdult: number;
    unitPriceChild: number;
    baseAmount: number;
    discountAmount: number;
    totalAmount: number;
    discountLabel: string | null;
  };
}

/**
 * Sends the booking request. The payload carries no price, discount or
 * tenant; all of that is decided by the service inside one transaction.
 */
export const submitBookingAction = siteAction(RATE_LIMITS.bookingRequest, bookingRequestSchema, async ({ tenant, scope, input }): Promise<SubmittedBooking> => {
  try {
    const booking = await createBookingRequest(scope, input, { today: siteToday(tenant), now: new Date() });
    return { reference: booking.reference, holdExpiresAt: booking.holdExpiresAt.toISOString(), totals: booking.totals };
  } catch (error) {
    // The plan's wording is for the business, never for its customers.
    if (error instanceof LimitExceededError) {
      throw new AppError("plan_limit", "Online booking is unavailable right now — please contact us.", 402);
    }
    throw error;
  }
});

/** Adds a visitor to the waitlist of a date that cannot be booked right now. */
export const joinWaitlistAction = siteAction(WAITLIST_RATE_LIMIT, joinWaitlistSchema, ({ tenant, scope, input }) =>
  joinWaitlist(scope, input, { today: siteToday(tenant), now: new Date() }),
);
