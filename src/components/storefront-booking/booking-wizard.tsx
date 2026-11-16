"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useForm, useWatch } from "react-hook-form";
import { quoteBookingAction, submitBookingAction } from "@/app/s/[site]/book/actions";
import { SwapIn } from "@/components/motion";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import {
  clampParty,
  contactMethodLabel,
  defaultParty,
  discountLabel,
  discountSourceLabel,
  DRAFT_STORAGE_KEY,
  emptyDraft,
  firstName,
  fullPhone,
  isBookable,
  isEmail,
  parseStoredDraft,
  partyLimits,
  partySummary,
  quoteParty,
  releaseSelection,
  restoreDraft,
  seatLine,
  serialiseDraft,
  splitDiscountLabel,
  stepOfServerErrors,
  toBookingPayload,
  validateDateStep,
  validateDetails,
  validateReview,
  withTour,
  type BookingDraft,
  type DateStepErrors,
  type DraftPrefill,
  type ServerQuote,
} from "@/lib/booking-form";
import { clampMonth, formatDate, formatDateRange, monthOf } from "@/lib/calendar";
import { formatMoney } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { BookingStepDate, type Conflict } from "./booking-step-date";
import { BookingStepDetails } from "./booking-step-details";
import { BookingStepReview, BookingSuccess, BookingSummary, type CompletedBooking, type ReviewRow } from "./booking-views";
import type { BookableTour, CalendarLimits, SiteContact, TourOffers } from "./types";
import { useAvailability } from "./use-availability";

export interface BookingWizardProps {
  /** Published tours; never empty (the page shows an empty state instead). */
  tours: BookableTour[];
  offers: TourOffers;
  currency: string;
  timezone: string;
  calendar: CalendarLimits;
  /** How long a request holds its seats. */
  holdHours: number;
  contact: SiteContact;
  languages: string[];
  /** Hand-over from the tour page (tour, date, time, party) read from the URL. */
  prefill: DraftPrefill;
  /** Whether personal discount requests are open. */
  requestsEnabled: boolean;
}

type Step = 1 | 2 | 3;

const STEPS = ["Tour & date", "Your details", "Review", "Confirmation"] as const;
const STEP_TITLES: Record<Step, string> = {
  1: "Choose your tour, date & guests",
  2: "Your details",
  3: "Review your request",
};
const NEXT_LABELS: Record<Step, string> = { 1: "Continue to your details", 2: "Continue to review", 3: "Send booking request" };

const NEUTRAL_UNAVAILABLE = "Online booking is unavailable right now — please contact us.";
const SEND_FAILED = "We couldn’t send your request just now. Please try again, or contact us.";

const noop = () => () => {};
/** False on the server and while hydrating, true afterwards: lets the form start from what this tab stored. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

function readStorage(): string | null {
  try {
    return window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    else window.sessionStorage.setItem(DRAFT_STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable (private mode, quota). The form still works; it just will not survive a refresh.
  }
}

function freshDraft(tours: BookableTour[]): BookingDraft {
  const first = tours[0]!;
  return emptyDraft(first.slug, defaultParty(partyLimits(first)));
}

function initialState({ tours, prefill }: Pick<BookingWizardProps, "tours" | "prefill">): { draft: BookingDraft; step: Step } {
  const restored = restoreDraft(
    freshDraft(tours),
    parseStoredDraft(readStorage()),
    prefill,
    tours.map((tour) => tour.slug),
  );
  const tour = tours.find((candidate) => candidate.slug === restored.draft.tour) ?? tours[0]!;
  const party = clampParty({ adults: restored.draft.adults, children: restored.draft.children }, partyLimits(tour));
  return { draft: { ...restored.draft, ...party }, step: restored.step as Step };
}

function Header() {
  return (
    <>
      <p className="eyebrow mb-3">Booking request</p>
      <h1 className="mb-8 font-display text-5xl font-medium leading-none text-primary lg:text-6xl">Reserve your journey</h1>
    </>
  );
}

/**
 * The booking request form. Rendered after hydration so it can pick up what
 * the visitor already typed in this tab; until then the page keeps its shape.
 */
export function BookingWizard(props: BookingWizardProps) {
  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <div className="container-x pb-28 pt-10 lg:pt-14">
        <Header />
        <div role="status" aria-label="Loading the booking form" className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
          <div className="card flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-9">
            <div className="skeleton h-8 w-2/3" />
            <div className="skeleton h-11" />
            <div className="skeleton h-80" />
          </div>
          <div className="skeleton h-80 w-full lg:w-[380px] lg:shrink-0" />
        </div>
      </div>
    );
  }
  return <Wizard {...props} />;
}

function Wizard({ tours, offers, currency, timezone, calendar, holdHours, contact, languages, prefill, requestsEnabled }: BookingWizardProps) {
  const [initial] = useState(() => initialState({ tours, prefill }));
  const form = useForm<BookingDraft>({ defaultValues: initial.draft });
  const watched = useWatch({ control: form.control });
  const draft: BookingDraft = { ...initial.draft, ...watched };

  const [step, setStep] = useState<Step>(initial.step);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedBooking | null>(null);
  const { run, pending } = useAction(submitBookingAction, { toastError: false });

  const tour = tours.find((candidate) => candidate.slug === draft.tour) ?? tours[0]!;
  const limits = partyLimits(tour);
  const minMonth = monthOf(calendar.today);
  const maxMonth = monthOf(calendar.maxDate);
  const [month, setMonth] = useState(() => clampMonth(initial.draft.date ? monthOf(initial.draft.date) : minMonth, minMonth, maxMonth));
  const availability = useAvailability(tour.slug, month, { minMonth, maxMonth });

  const known = draft.date ? availability.days[draft.date] : undefined;
  const day = known && isBookable(known.state) ? known : undefined;
  /** A date is set but its availability has not arrived yet. */
  const checking = Boolean(draft.date) && !known && availability.status === "loading";

  /* --------------------------------------------------------------- price */

  const localOffer = offers[tour.id] ?? null;
  const email = isEmail(draft.email) ? draft.email.trim().toLowerCase() : "";
  const quoteDate = day?.date ?? "";
  const quoteKey = [tour.slug, quoteDate, draft.adults, draft.children, email].join("|");
  const [served, setServed] = useState<{ key: string; quote: ServerQuote } | null>(null);
  const latestKey = useRef(quoteKey);

  useEffect(() => {
    latestKey.current = quoteKey;
    if (completed) return;
    // A short pause, so a run of stepper presses or keystrokes asks once.
    const timer = window.setTimeout(async () => {
      const result = await quoteBookingAction({ tourSlug: tour.slug, date: quoteDate, adults: draft.adults, children: draft.children, email });
      if (result.ok && latestKey.current === quoteKey) setServed({ key: quoteKey, quote: result.data });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [quoteKey, completed, tour.slug, quoteDate, draft.adults, draft.children, email]);

  const serverQuote = served?.key === quoteKey ? served.quote : null;
  // Until the server answers, show the list price with the offer every visitor gets.
  const local = quoteParty(tour, { adults: draft.adults, children: draft.children }, localOffer);
  const figures: ServerQuote = serverQuote ?? {
    ...local,
    currency,
    discount: localOffer && local.discountAmount > 0 ? { source: "campaign", label: `${localOffer.name} — ${discountLabel(localOffer.type, localOffer.value, currency)}` } : null,
    otherMatches: 0,
  };
  const applied = figures.discount && figures.discountAmount > 0 ? splitDiscountLabel(figures.discount.label) : null;
  const emailNote =
    serverQuote?.discount && serverQuote.discount.source !== "campaign" && applied
      ? `${discountSourceLabel(serverQuote.discount.source)} found for this email${applied.value ? `: ${applied.value}` : ""}`
      : null;

  /* --------------------------------------------------------- persistence */

  const serialised = serialiseDraft(draft, step);
  useEffect(() => {
    if (!completed) writeStorage(serialised);
  }, [serialised, completed]);

  // The hand-over has been read into the form; a refresh should restore what
  // the visitor did since, not replay the link they arrived with.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  /* ------------------------------------------------------------- editing */

  function clearTransient() {
    setConflict(null);
    setFailure(null);
    setServerErrors({});
  }

  function change(patch: Partial<BookingDraft>) {
    for (const [key, value] of Object.entries(patch)) form.setValue(key as keyof BookingDraft, value as never, { shouldDirty: true });
    clearTransient();
  }

  function changeTour(slug: string) {
    const next = tours.find((candidate) => candidate.slug === slug);
    if (!next) return;
    form.reset(withTour(draft, slug, clampParty({ adults: draft.adults, children: draft.children }, partyLimits(next))));
    clearTransient();
    setTouched({});
    setMonth(minMonth);
  }

  /* ---------------------------------------------------------- validation */

  const dateErrors: DateStepErrors =
    draft.date && !known && availability.status !== "ready"
      ? availability.status === "loading"
        ? {}
        : { date: "We could not check availability for that date. Try again in a moment." }
      : validateDateStep(draft, tour.kind, known, limits);
  const detailErrors = validateDetails(draft);
  const reviewErrors = validateReview(draft);

  const show = (key: string, local: string | undefined): string | undefined => serverErrors[key] ?? (touched[key] ? local : undefined);

  const root = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  // On a step change, bring the new step to the top and put focus on its heading.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    root.current?.scrollIntoView({ block: "start" });
    root.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus({ preventScroll: true });
  }, [step, completed]);

  function go(next: Step) {
    moved.current = true;
    setStep(next);
  }

  function focusFirstError() {
    window.requestAnimationFrame(() => {
      const scope = root.current;
      if (!scope) return;
      const field = scope.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (field) {
        field.focus();
        return;
      }
      scope.querySelector<HTMLElement>("[data-field-error]")?.scrollIntoView({ block: "center" });
    });
  }

  function touch(keys: string[]) {
    setTouched((previous) => ({ ...previous, ...Object.fromEntries(keys.map((key) => [key, true])) }));
  }

  async function next() {
    if (pending || checking) return;
    if (step === 1) {
      touch(["date", "slot", "seats"]);
      if (Object.keys(dateErrors).length > 0) return focusFirstError();
      return go(2);
    }
    if (step === 2) {
      touch(["name", "email", "phone"]);
      if (Object.keys(detailErrors).length > 0) return focusFirstError();
      return go(3);
    }
    touch(["agree"]);
    if (Object.keys(reviewErrors).length > 0) return focusFirstError();
    // Anything that became invalid since its step (a date that filled up) sends the visitor back there.
    if (Object.keys(dateErrors).length > 0) {
      touch(["date", "slot", "seats"]);
      return go(1);
    }
    if (Object.keys(detailErrors).length > 0) {
      touch(["name", "email", "phone"]);
      return go(2);
    }
    await send();
  }

  async function send() {
    setFailure(null);
    setServerErrors({});
    const rows = reviewRows();
    const payload = toBookingPayload(draft, tour.kind);
    // `next()` has already checked the acknowledgement; the server checks it again.
    if (!payload.agree) return;
    const result = await run({ ...payload, agree: true });

    if (result.ok) {
      writeStorage(null);
      moved.current = true;
      setCompleted({
        reference: result.data.reference,
        holdExpiresAt: result.data.holdExpiresAt,
        firstName: firstName(draft.name),
        contactMethod: contactMethodLabel(draft.contactMethod),
        // The stored totals replace the estimate: this is what the booking says.
        rows: [
          ...rows.filter(([label]) => label !== "Discount" && label !== "Estimated total"),
          [
            "Discount",
            result.data.totals.discountLabel && result.data.totals.discountAmount > 0
              ? `${result.data.totals.discountLabel} (−${formatMoney(result.data.totals.discountAmount, result.data.totals.currency)})`
              : "None",
          ],
          ["Estimated total", formatMoney(result.data.totals.totalAmount, result.data.totals.currency)],
        ],
      });
      return;
    }

    if (result.code === "slot_taken" || result.code === "tour_changed") {
      const what = `${formatDate(draft.date, "long")}${tour.kind === "day" && draft.slot ? ` at ${draft.slot}` : ""}`;
      // Everything else the visitor entered is kept; only the selection is released.
      form.reset(releaseSelection(draft));
      setTouched({});
      setConflict(
        result.code === "tour_changed"
          ? { title: "This tour’s schedule has just changed.", body: "Please choose your date again below — nothing else you entered has been lost." }
          : {
              // The service says so when seats remain but too few for the party.
              title: result.error.startsWith("Only") ? `${what}: ${result.error}` : `Sorry — ${what} was just booked by another guest.`,
              body: "To avoid a double booking we’ve released your selection. Please choose another date or time below — nothing else you entered has been lost.",
            },
      );
      availability.reload();
      go(1);
      return;
    }

    if (result.code === "plan_limit") {
      setFailure(NEUTRAL_UNAVAILABLE);
    } else if (result.fieldErrors) {
      const mapped: Record<string, string> = {};
      const rename: Record<string, string> = { slotTime: "slot", alternativeDate: "alt", adults: "seats", children: "seats", participants: "seats", tourId: "date", tourSlug: "date" };
      for (const [key, messages] of Object.entries(result.fieldErrors)) {
        if (messages[0]) mapped[rename[key] ?? key] ??= messages[0];
      }
      setServerErrors(mapped);
      const target = stepOfServerErrors(result.fieldErrors);
      if (target && target !== step) go(target);
      else if (!target) setFailure(result.error);
    } else {
      setFailure(result.code === "rate_limited" || result.code === "not_found" || result.code === "conflict" ? result.error : SEND_FAILED);
    }
    focusFirstError();
  }

  /* --------------------------------------------------------------- views */

  function reviewRows(): ReviewRow[] {
    const date = draft.date
      ? `${tour.durationDays > 1 && day ? formatDateRange(day.date, day.endDate) : formatDate(draft.date, "long")}${tour.kind === "day" && draft.slot ? ` at ${draft.slot}` : ""}`
      : "—";
    const rows: ReviewRow[] = [
      ["Tour", tour.title],
      ["Date", date],
      ["Back-up date", draft.alt ? formatDate(draft.alt, "long") : "None"],
      ["Lead traveller", draft.name.trim()],
      ["Email", draft.email.trim()],
      ["Phone", fullPhone(draft)],
      ["Travellers", partySummary({ adults: draft.adults, children: draft.children })],
    ];
    if (draft.country) rows.push(["Country", draft.country]);
    if (draft.language) rows.push(["Language", draft.language]);
    rows.push(
      ["Pickup", draft.pickup.trim() || "To be arranged"],
      ["Contact via", contactMethodLabel(draft.contactMethod)],
      ["Notes", draft.notes.trim() || "None"],
      ["Discount", applied ? `${applied.name} (−${formatMoney(figures.discountAmount, figures.currency)})` : "None"],
      ["Estimated total", formatMoney(figures.totalAmount, figures.currency)],
    );
    return rows;
  }

  function restart() {
    form.reset(freshDraft(tours));
    setTouched({});
    clearTransient();
    setMonth(minMonth);
    setStep(1);
    moved.current = true;
    setCompleted(null);
  }

  if (completed) {
    return (
      <div ref={root} className="container-x scroll-mt-24 pb-28 pt-10 lg:pt-14">
        <BookingSuccess booking={completed} holdHours={holdHours} timezone={timezone} contact={contact} onRestart={restart} />
      </div>
    );
  }

  const line = day ? seatLine(day, tour.kind) : null;
  const availabilityText = checking ? "Checking…" : line ? (tour.kind === "private" ? "Private · available" : line.text) : "Choose a date";

  return (
    <div ref={root} className="container-x scroll-mt-24 pb-28 pt-10 lg:pt-14">
      <Header />
      <div className="mb-8">
        <div className="progress mb-4 sm:hidden" role="progressbar" aria-label="Booking progress" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step} aria-valuetext={`Step ${step} of 4: ${STEPS[step - 1]}`}>
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${((step - 1) / 3) * 100}%` }} />
        </div>
        <ol aria-label="Progress" className="flex items-center gap-2">
          {STEPS.map((label, index) => {
            const number = index + 1;
            const current = number === step;
            const done = number < step;
            return (
              <li key={label} className="flex flex-1 items-center gap-2">
                <span
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all",
                    current ? "bg-primary text-primary-foreground" : done ? "bg-highlight text-highlight-foreground" : "border text-muted-foreground",
                  )}
                >
                  <span className="sr-only">
                    Step {number}: {label}
                    {done ? " (done)" : ""}
                  </span>
                  <span aria-hidden="true">{done ? "✓" : number}</span>
                </span>
                <span aria-hidden="true" className={cn("hidden whitespace-nowrap text-sm sm:inline", current ? "font-bold text-primary" : "font-medium text-muted-foreground")}>
                  {label}
                </span>
                <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" />
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
        <form
          noValidate
          className="card min-w-0 flex-1 p-4 sm:p-9"
          onSubmit={(event) => {
            event.preventDefault();
            void next();
          }}
        >
          <SwapIn key={step} className={cn("flex flex-col", step === 1 ? "gap-6" : "gap-5")}>
            <h2 tabIndex={-1} data-step-heading className="font-display text-3xl font-medium text-primary outline-none">
              {step} · {STEP_TITLES[step]}
            </h2>
            {step === 1 ? (
              <BookingStepDate
                key={tour.slug}
                tours={tours}
                tour={tour}
                draft={draft}
                day={day}
                currency={currency}
                calendar={calendar}
                availability={availability}
                month={month}
                onMonthChange={setMonth}
                errors={{ date: show("date", dateErrors.date), slot: show("slot", dateErrors.slot), seats: show("seats", dateErrors.seats), alt: serverErrors.alt }}
                conflict={conflict}
                onTourChange={changeTour}
                onChange={change}
              />
            ) : step === 2 ? (
              <BookingStepDetails
                draft={draft}
                register={form.register}
                onEdit={clearTransient}
                onChange={change}
                errors={{
                  name: show("name", detailErrors.name),
                  email: show("email", detailErrors.email),
                  phone: show("phone", detailErrors.phone),
                  country: serverErrors.country,
                  language: serverErrors.language,
                  pickup: serverErrors.pickup,
                  notes: serverErrors.notes,
                  contactMethod: serverErrors.contactMethod,
                }}
                languages={languages}
                emailNote={emailNote}
              />
            ) : (
              <BookingStepReview
                rows={reviewRows()}
                draft={draft}
                tour={tour}
                figures={figures}
                agreeError={show("agree", reviewErrors.agree)}
                failure={failure}
                canRequestDiscount={requestsEnabled}
                contact={contact}
                onEdit={() => go(2)}
                onAgree={(agree) => change({ agree })}
              />
            )}
            {step !== 3 && failure ? (
              <div role="alert" data-field-error className="alert alert-destructive">
                {failure}
              </div>
            ) : null}
          </SwapIn>

          <div className="safe-b sticky bottom-0 z-20 -mx-4 -mb-4 mt-8 flex flex-col gap-2 rounded-b-xl border-t bg-card/95 px-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:mb-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-none sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-6 sm:backdrop-blur-none">
            <div className="flex items-baseline justify-between text-sm sm:hidden">
              <span className="text-muted-foreground">
                Estimated total
                {applied?.value ? <span className="font-semibold text-emerald-700 dark:text-emerald-400"> · {applied.value}</span> : null}
              </span>
              <span className="font-display text-xl font-semibold text-primary">{formatMoney(figures.totalAmount, figures.currency)}</span>
            </div>
            <div className="flex gap-3 sm:contents">
              {step > 1 ? (
                <button type="button" className="btn btn-outline btn-lg rounded-full" disabled={pending} onClick={() => go((step - 1) as Step)}>
                  Back
                </button>
              ) : (
                <span />
              )}
              <button type="submit" className="btn btn-default btn-lg flex-1 rounded-full px-8 sm:flex-none" disabled={pending || checking} aria-busy={pending || checking || undefined}>
                {pending || checking ? <Spinner /> : null}
                {pending || checking ? "Checking availability…" : NEXT_LABELS[step]}
              </button>
            </div>
          </div>
        </form>

        <BookingSummary
          tour={tour}
          draft={draft}
          day={day}
          availabilityText={availabilityText}
          figures={figures}
          estimating={!serverQuote}
          contactName={contact.name}
        />
      </div>
    </div>
  );
}
