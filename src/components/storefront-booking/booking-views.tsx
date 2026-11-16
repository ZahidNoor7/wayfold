"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { SiteImage } from "@/components/storefront/site-image";
import {
  discountSourceLabel,
  holdText,
  otherMatchesNote,
  splitDiscountLabel,
  type BookingDraft,
  type DayInfo,
  type ServerQuote,
} from "@/lib/booking-form";
import { formatDate, formatDateTime } from "@/lib/calendar";
import { formatMoney } from "@/lib/dates";
import type { BookableTour, SiteContact } from "./types";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export type ReviewRow = readonly [label: string, value: string];

/* ---------------------------------------------------------------- summary */

interface BookingSummaryProps {
  tour: BookableTour;
  draft: BookingDraft;
  day: DayInfo | undefined;
  /** One-line availability of the selection, e.g. "4 of 8 seats left". */
  availabilityText: string;
  figures: ServerQuote;
  /** True while the server is still working out the price for the current selection. */
  estimating: boolean;
  contactName: string;
}

/** The dark summary beside the form (below it on phones). */
export function BookingSummary({ tour, draft, day, availabilityText, figures, estimating, contactName }: BookingSummaryProps) {
  const { currency } = figures;
  const discount = figures.discount ? splitDiscountLabel(figures.discount.label) : null;
  const others = otherMatchesNote(figures.otherMatches);

  return (
    <aside aria-label="Booking summary" className="w-full overflow-hidden rounded-xl bg-hero text-hero-foreground lg:sticky lg:top-28 lg:w-[380px] lg:shrink-0">
      <div className="relative hidden h-44 w-full sm:block">
        <SiteImage src={tour.coverUrl} alt="" sizes="(min-width: 1024px) 380px, 100vw" tone="dark" />
      </div>
      <div className="p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-highlight">{[tour.categoryName, tour.durationLabel].filter(Boolean).join(" · ")}</p>
        <p className="mb-5 font-display text-[28px] leading-tight">{tour.title}</p>
        <dl className="flex flex-col gap-2.5 border-y border-highlight/25 py-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="opacity-80">Date</dt>
            <dd className="text-right">{day ? formatDate(day.date, "long") : "—"}</dd>
          </div>
          {day && draft.slot ? (
            <div className="flex justify-between gap-4">
              <dt className="opacity-80">Start time</dt>
              <dd>{draft.slot}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="opacity-80">Availability</dt>
            <dd className="text-right">{availabilityText}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="opacity-80">
              {plural(draft.adults, "adult", "adults")} × {formatMoney(figures.unitPriceAdult, currency)}
            </dt>
            <dd>{formatMoney(figures.adultsTotal, currency)}</dd>
          </div>
          {draft.children > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="opacity-80">
                {plural(draft.children, "child", "children")} × {formatMoney(figures.unitPriceChild, currency)}
              </dt>
              <dd>{formatMoney(figures.childrenTotal, currency)}</dd>
            </div>
          ) : null}
        </dl>

        <div aria-live="polite">
          {figures.discount && discount && figures.discountAmount > 0 ? (
            <div className="mt-4 flex items-start justify-between gap-3 rounded-lg bg-highlight/15 p-3 text-sm">
              <span>
                <span className="block font-semibold text-highlight">{discount.name}</span>
                <span className="text-xs opacity-80">{[discountSourceLabel(figures.discount.source), discount.value].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="whitespace-nowrap font-semibold text-highlight">−{formatMoney(figures.discountAmount, currency)}</span>
            </div>
          ) : null}
          <div className="mt-4 flex items-baseline justify-between gap-3">
            <span>Estimated total</span>
            <span className="flex items-baseline gap-2">
              {figures.discountAmount > 0 ? (
                <span className="text-sm line-through opacity-60">
                  <span className="sr-only">Before discount </span>
                  {formatMoney(figures.baseAmount, currency)}
                </span>
              ) : null}
              <span className="font-display text-[34px] leading-none text-highlight">{formatMoney(figures.totalAmount, currency)}</span>
            </span>
          </div>
          {others ? <p className="mt-1 text-xs opacity-75">{others}</p> : null}
          {estimating ? <p className="mt-1 text-xs opacity-75">Checking for offers…</p> : null}
        </div>
        <p className="mt-3 text-[13px] leading-relaxed opacity-80">No payment is taken now. The final price is confirmed by {contactName} with availability.</p>
      </div>
    </aside>
  );
}

/* ----------------------------------------------------------------- review */

interface BookingStepReviewProps {
  rows: ReviewRow[];
  draft: BookingDraft;
  tour: BookableTour;
  figures: ServerQuote;
  agreeError?: string;
  /** Form-level failure of the last attempt to send. */
  failure: string | null;
  /** Show the link to ask for a personal discount. */
  canRequestDiscount: boolean;
  contact: SiteContact;
  onEdit: () => void;
  onAgree: (agree: boolean) => void;
}

/** Step 3: everything on one screen before it is sent. */
export function BookingStepReview({ rows, draft, tour, figures, agreeError, failure, canRequestDiscount, contact, onEdit, onAgree }: BookingStepReviewProps) {
  const { currency } = figures;
  const discount = figures.discount ? splitDiscountLabel(figures.discount.label) : null;
  const hasDiscount = Boolean(figures.discount) && figures.discountAmount > 0;
  const requestHref = `/offers?${new URLSearchParams({ tour: tour.slug, adults: String(draft.adults), children: String(draft.children) }).toString()}#request`;

  return (
    <>
      <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-6 gap-y-3 text-[15px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 whitespace-pre-line break-words font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="btn btn-link self-start px-0" onClick={onEdit}>
        Edit details
      </button>

      <div className="rounded-xl border p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Price breakdown</p>
        <div className="flex flex-col gap-2 text-[15px]">
          <div className="flex justify-between gap-4">
            <span>
              {plural(draft.adults, "adult", "adults")} × {formatMoney(figures.unitPriceAdult, currency)}
            </span>
            <span>{formatMoney(figures.adultsTotal, currency)}</span>
          </div>
          {draft.children > 0 ? (
            <div className="flex justify-between gap-4">
              <span>
                {plural(draft.children, "child", "children")} × {formatMoney(figures.unitPriceChild, currency)}
              </span>
              <span>{formatMoney(figures.childrenTotal, currency)}</span>
            </div>
          ) : null}
          {hasDiscount && discount ? (
            <div className="flex justify-between gap-4 font-semibold text-emerald-700 dark:text-emerald-400">
              <span>
                {discount.name}
                {discount.value ? ` (${discount.value})` : ""}
              </span>
              <span className="whitespace-nowrap">−{formatMoney(figures.discountAmount, currency)}</span>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t pt-2 text-lg font-bold">
            <span>Estimated total</span>
            <span>{formatMoney(figures.totalAmount, currency)}</span>
          </div>
        </div>
        {hasDiscount ? <p className="mt-2 text-xs text-muted-foreground">One discount per booking — the best one is applied automatically.</p> : null}
      </div>

      {!hasDiscount && canRequestDiscount ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-5">
          <div>
            <p className="font-bold">No offer applies to this trip</p>
            <p className="text-sm text-muted-foreground">
              Celebrating, a student, or a returning guest? Ask {contact.name} for a personal discount. Your booking request is separate and is sent either way.
            </p>
          </div>
          <Link href={requestHref} className="btn btn-outline">
            Request a discount
          </Link>
        </div>
      ) : null}

      <div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-secondary/60 p-4 text-sm leading-relaxed">
          <input
            type="checkbox"
            className="checkbox mt-0.5 h-5 w-5"
            checked={draft.agree}
            aria-invalid={Boolean(agreeError)}
            aria-describedby={agreeError ? "booking-agree-error" : undefined}
            onChange={(event) => onAgree(event.target.checked)}
          />
          <span>
            I understand this is a <strong>booking request</strong>, not a confirmed reservation, and I agree to the{" "}
            <Link href="/terms" target="_blank" className="underline underline-offset-4">
              Terms &amp; Conditions
              <span className="sr-only"> (opens in a new tab)</span>
            </Link>
            .
          </span>
        </label>
        {agreeError ? (
          <span id="booking-agree-error" role="alert" className="field-error mt-2 block">
            {agreeError}
          </span>
        ) : null}
      </div>

      {failure ? (
        <div role="alert" data-field-error className="alert alert-destructive">
          <p>{failure}</p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-semibold">
            <Link href="/contact" className="underline underline-offset-4">
              Contact {contact.name}
            </Link>
            {contact.whatsapp ? (
              <a href={contact.whatsapp} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                Message on WhatsApp
              </a>
            ) : null}
          </p>
        </div>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- success */

export interface CompletedBooking {
  reference: string;
  /** ISO timestamp. */
  holdExpiresAt: string;
  firstName: string;
  /** "WhatsApp", "Email" or "Phone call". */
  contactMethod: string;
  rows: ReviewRow[];
}

interface BookingSuccessProps {
  booking: CompletedBooking;
  holdHours: number;
  timezone: string;
  contact: SiteContact;
  onRestart: () => void;
}

/** Step 4: the request was received. Says what was stored and what happens next. */
export function BookingSuccess({ booking, holdHours, timezone, contact, onRestart }: BookingSuccessProps) {
  const heldUntil = formatDateTime(booking.holdExpiresAt, timezone);
  return (
    <div className="mx-auto max-w-3xl text-center">
      <span className="inline-flex h-20 w-20 animate-pop items-center justify-center rounded-full bg-primary text-highlight">
        <Check aria-hidden="true" className="size-9" strokeWidth={2} />
      </span>
      <p className="eyebrow mb-3 mt-7">Request received</p>
      <h1 role="status" tabIndex={-1} data-step-heading className="font-display text-5xl font-medium text-primary outline-none">
        Thank you{booking.firstName ? `, ${booking.firstName}` : ""}.
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-foreground/85">
        Your date is now <strong>held for {holdText(holdHours)}</strong> so no one else can take it. {contact.name} will check the details and contact you by{" "}
        <strong>{booking.contactMethod}</strong> to confirm your journey.
      </p>

      <div className="card mt-9 p-6 text-left sm:p-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-5">
          <span className="text-sm text-muted-foreground">Booking reference</span>
          <span className="font-display text-3xl tracking-wider text-primary">{booking.reference}</span>
          <span className="badge badge-pending uppercase tracking-wider">Pending confirmation</span>
        </div>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">What happens next</h2>
        <ol className="mb-6 flex list-decimal flex-col gap-2 pl-5 text-[15px] leading-relaxed">
          <li>
            We hold your place until <strong>{heldUntil}</strong>
            {heldUntil ? " (local time)" : ""}. Keep your reference to hand in case you need to contact us.
          </li>
          <li>
            {contact.name} checks availability and replies by {booking.contactMethod}.
          </li>
          <li>No payment is taken now. The final price is confirmed together with availability.</li>
        </ol>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your request</h2>
        <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-6 gap-y-3 text-[15px]">
          {booking.rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 whitespace-pre-line break-words font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        {contact.whatsapp ? (
          <a href={contact.whatsapp} target="_blank" rel="noopener noreferrer" className="btn btn-default btn-xl rounded-full">
            Message {contact.name} on WhatsApp
          </a>
        ) : (
          <Link href="/contact" className="btn btn-default btn-xl rounded-full">
            Contact {contact.name}
          </Link>
        )}
        <Link href="/experiences" className="btn btn-outline btn-xl rounded-full">
          Browse more experiences
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-x-6">
        <button type="button" className="btn btn-link" onClick={onRestart}>
          Make another request
        </button>
        {contact.whatsapp ? (
          <Link href="/contact" className="btn btn-link">
            Contact us
          </Link>
        ) : null}
      </div>
    </div>
  );
}
