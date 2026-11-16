import type { DayInfo, OfferRef, Tone, TourKind } from "@/lib/booking-form";

/** What the storefront's booking UI needs to know about a published tour. */
export interface BookableTour {
  id: string;
  slug: string;
  title: string;
  kind: TourKind;
  durationDays: number;
  durationLabel: string;
  /** Adult list price, minor units. */
  priceAdult: number;
  childPricePercent: number;
  /** 0 when unknown (lists do not carry it). */
  childMaxAge: number;
  minGroupSize: number;
  maxGroupSize: number;
  categoryName: string | null;
  coverUrl: string | null;
  coverAlt: string | null;
}

/** Best unconditional public offer per tour id; null when the list price stands. */
export type TourOffers = Record<string, OfferRef | null>;

export interface CalendarLimits {
  /** Today in the business's timezone. */
  today: string;
  /** Last date the booking horizon reaches. */
  maxDate: string;
}

/** Shape of `GET /api/availability`. */
export interface AvailabilityResponse {
  tourId: string;
  kind: TourKind;
  durationDays: number;
  maxGroupSize: number;
  days: DayInfo[];
}

export interface SiteContact {
  /** Business name. */
  name: string;
  /** `https://wa.me/...`, or null when the business has no WhatsApp number. */
  whatsapp: string | null;
}

export const TONE_CLASS: Record<Tone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-destructive",
  muted: "text-muted-foreground",
};
