"use client";

import Link from "next/link";
import { createContext, use, useState, type ReactNode } from "react";
import { BottomSheet } from "@/components/overlays";
import {
  bookHref,
  childNote,
  discountLabel,
  fromPrice,
  isBookable,
  offerBadge,
  partyLimits,
  partySummary,
  quoteParty,
  reasonText,
  seatLine,
  seatWarning,
  defaultParty,
  unavailableTitle,
  type DayInfo,
  type OfferRef,
  type Party,
  type SlotInfo,
} from "@/lib/booking-form";
import { formatDate, formatDateRange, monthOf } from "@/lib/calendar";
import { addDays, formatMoney } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { AvailabilityCalendar } from "./availability-calendar";
import { CHOICE_IDLE, CHOICE_ROW, CHOICE_SELECTED, CHOICE_UNAVAILABLE, SlotPicker } from "./choice";
import { PartySteppers } from "./party-steppers";
import { TONE_CLASS, type BookableTour, type CalendarLimits, type SiteContact } from "./types";
import { useAvailability } from "./use-availability";
import { WaitlistForm } from "./waitlist-form";

interface TourBookingProps {
  tour: BookableTour;
  /** Best unconditional public offer for this tour, if any. */
  offer: OfferRef | null;
  currency: string;
  calendar: CalendarLimits;
  /** Departure tours: every upcoming departure with its live state. Null for other kinds. */
  departures: DayInfo[] | null;
  contact: SiteContact;
  /** Whether the business takes personal discount requests. */
  requestsEnabled: boolean;
  children: ReactNode;
}

/** A date or start time the visitor chose that cannot be booked. */
interface Blocked {
  day: DayInfo;
  slot?: SlotInfo;
}

interface BookingContext {
  tour: BookableTour;
  offer: OfferRef | null;
  currency: string;
  contact: SiteContact;
  requestsEnabled: boolean;
  party: Party;
  setParty: (party: Party) => void;
  /** The chosen date, when it can be booked. */
  day: DayInfo | undefined;
  slot: string;
  /** Date (and time) controls. `scope` keeps radio groups apart when two copies exist. */
  renderDates: (scope: string) => ReactNode;
}

const Context = createContext<BookingContext | null>(null);

function useBooking(): BookingContext {
  const value = use(Context);
  if (!value) throw new Error("Booking controls must be rendered inside <TourBooking>.");
  return value;
}

/**
 * Holds the tour page's selection (date, time, party) so the desktop card and
 * the phone's bottom bar and sheet always show the same thing.
 */
export function TourBooking(props: TourBookingProps) {
  return props.departures ? <DepartureBooking {...props} departures={props.departures} /> : <CalendarBooking {...props} />;
}

function BlockedNote({ blocked, tour, party, className }: { blocked: Blocked; tour: BookableTour; party: Party; className?: string }) {
  const { day, slot } = blocked;
  const dateLabel = formatDate(day.date, "long");
  const waitable = slot !== undefined || day.state === "full" || day.state === "hold";
  return (
    <div role="status" className={cn("rounded-md bg-muted p-2.5 text-[13px] leading-relaxed", className)}>
      <p>
        <strong>{slot ? `${slot.time} on ${dateLabel} is fully booked.` : `${unavailableTitle(dateLabel, day.state)}.`}</strong>{" "}
        {slot ? "Choose another time or date." : reasonText(day, tour.kind)}
      </p>
      {waitable ? (
        <WaitlistForm
          key={`${day.date}-${slot?.time ?? ""}`}
          className="mt-2"
          tourSlug={tour.slug}
          date={day.date}
          slotTime={slot?.time ?? null}
          partySize={party.adults + party.children}
          dateLabel={slot ? `${dateLabel} at ${slot.time}` : dateLabel}
        />
      ) : null}
    </div>
  );
}

function DepartureBooking({ tour, offer, currency, departures, contact, requestsEnabled, children }: TourBookingProps & { departures: DayInfo[] }) {
  const limits = partyLimits(tour);
  const [party, setParty] = useState<Party>(() => defaultParty(limits));
  const [date, setDate] = useState(() => departures.find((departure) => isBookable(departure.state))?.date ?? "");
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const day = departures.find((departure) => departure.date === date && isBookable(departure.state));

  function choose(departure: DayInfo) {
    if (isBookable(departure.state)) {
      setDate(departure.date);
      setBlocked(null);
    } else {
      setBlocked({ day: departure });
    }
  }

  const renderDates = (scope: string) => (
    <fieldset className="mb-4">
      <legend className="label mb-2">Departures</legend>
      {departures.length === 0 ? (
        <p className="rounded-md bg-muted p-3 text-[13px] leading-relaxed">
          No departures are scheduled right now.{" "}
          <Link href="/contact" className="font-semibold text-primary underline underline-offset-4">
            Ask about dates
          </Link>
        </p>
      ) : (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto p-0.5 pr-1">
          {departures.map((departure) => {
            const bookable = isBookable(departure.state);
            const checked = bookable && departure.date === date;
            const soldOut = departure.state === "full";
            const line = bookable ? seatLine(departure, "departure") : null;
            return (
              <label key={departure.date} className={cn(CHOICE_ROW, "p-3", !bookable ? CHOICE_UNAVAILABLE : checked ? CHOICE_SELECTED : CHOICE_IDLE)}>
                <input
                  type="radio"
                  name={`${scope}-departure`}
                  value={departure.date}
                  className="sr-only"
                  checked={checked}
                  aria-disabled={!bookable || undefined}
                  onChange={() => choose(departure)}
                  onClick={() => {
                    if (!bookable) choose(departure);
                  }}
                />
                <span className="min-w-0">
                  <span className={cn("block text-sm font-bold", soldOut && "line-through decoration-destructive/50")}>
                    {formatDateRange(departure.date, departure.endDate)}
                  </span>
                  {line ? (
                    <span className={cn("text-[13px]", line.tone === "warn" && "font-semibold", TONE_CLASS[line.tone])}>{line.text}</span>
                  ) : (
                    <span className="text-[13px]">{soldOut ? "Fully booked — join the waitlist" : reasonText(departure, "departure")}</span>
                  )}
                </span>
                {soldOut ? <span className="badge badge-cancelled">Sold out</span> : null}
                {departure.state === "limited" && !checked ? <span className="badge badge-pending">{departure.seatsLeft} left</span> : null}
              </label>
            );
          })}
        </div>
      )}
      {blocked ? <BlockedNote blocked={blocked} tour={tour} party={party} className="mt-2" /> : null}
    </fieldset>
  );

  return <Context value={{ tour, offer, currency, contact, requestsEnabled, party, setParty, day, slot: "", renderDates }}>{children}</Context>;
}

function CalendarBooking({ tour, offer, currency, calendar, contact, requestsEnabled, children }: TourBookingProps) {
  const limits = partyLimits(tour);
  const minMonth = monthOf(calendar.today);
  const maxMonth = monthOf(calendar.maxDate);
  const [party, setParty] = useState<Party>(() => defaultParty(limits));
  const [month, setMonth] = useState(minMonth);
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [jumping, setJumping] = useState(false);
  const availability = useAvailability(tour.slug, month, { minMonth, maxMonth });

  const chosen = date ? availability.days[date] : undefined;
  const day = chosen && isBookable(chosen.state) ? chosen : undefined;

  function pick(picked: DayInfo) {
    if (isBookable(picked.state)) {
      setDate(picked.date);
      setSlot("");
      setBlocked(null);
    } else if (picked.state !== "past") {
      setBlocked({ day: picked });
    }
  }

  async function jumpNext() {
    setJumping(true);
    const [next] = await availability.findNext(date || addDays(calendar.today, -1), 1);
    setJumping(false);
    if (!next) {
      setBlocked(null);
      return;
    }
    setMonth(monthOf(next));
    setDate(next);
    setSlot("");
    setBlocked(null);
  }

  const renderDates = (scope: string) => {
    const line = day ? seatLine(day, tour.kind) : null;
    return (
      <div className="mb-4 flex flex-col gap-3">
        <p className="label">{tour.kind === "private" ? "Choose your start date" : "Choose a date"}</p>
        <AvailabilityCalendar
          compact
          month={month}
          minMonth={minMonth}
          maxMonth={maxMonth}
          onMonthChange={setMonth}
          days={availability.days}
          status={availability.status}
          onRetry={availability.retry}
          selected={day?.date ?? ""}
          bounds={{ min: calendar.today, max: calendar.maxDate }}
          kind={tour.kind}
          durationDays={tour.durationDays}
          onPick={pick}
          onJumpNext={() => void jumpNext()}
          jumping={jumping}
        />
        {blocked ? <BlockedNote blocked={blocked} tour={tour} party={party} /> : null}
        {day && line ? (
          <p className="text-sm" aria-live="polite">
            <span className="font-bold">{tour.durationDays > 1 ? formatDateRange(day.date, day.endDate) : formatDate(day.date, "long")}</span>
            <span className={cn("block font-semibold", TONE_CLASS[line.tone])}>{line.text}</span>
          </p>
        ) : null}
        {tour.kind === "day" && day?.slots && day.slots.length > 0 ? (
          <SlotPicker
            name={`${scope}-slot`}
            slots={day.slots}
            selected={slot}
            guests={party.adults + party.children}
            onSelect={(time) => {
              setSlot(time);
              setBlocked(null);
            }}
            onFull={(full) => setBlocked({ day, slot: full })}
          />
        ) : null}
      </div>
    );
  };

  return <Context value={{ tour, offer, currency, contact, requestsEnabled, party, setParty, day, slot, renderDates }}>{children}</Context>;
}

/** Figures both surfaces show, from the same selection. */
function useFigures() {
  const booking = useBooking();
  const { tour, offer, party, day, slot } = booking;
  const quote = quoteParty(tour, party, offer);
  return {
    ...booking,
    limits: partyLimits(tour),
    quote,
    from: fromPrice(tour.priceAdult, offer),
    warning: seatWarning(tour.kind, day, slot, party),
    href: bookHref({ tour: tour.slug, date: day?.date, slot: slot || undefined, adults: party.adults, children: party.children }),
    hasDiscount: offer !== null && quote.discountAmount > 0,
  };
}

function DiscountRow({ className }: { className?: string }) {
  const { offer, quote, currency, hasDiscount } = useFigures();
  if (!offer || !hasDiscount) return null;
  return (
    <div className={cn("flex justify-between gap-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400", className)}>
      <span>
        {offer.name} ({discountLabel(offer.type, offer.value, currency)})
      </span>
      <span className="whitespace-nowrap">−{formatMoney(quote.discountAmount, currency)}</span>
    </div>
  );
}

/** The sticky price card beside the tour description on wide screens. */
export function TourBookingAside() {
  const { tour, offer, currency, contact, requestsEnabled, party, setParty, renderDates, limits, quote, from, warning, href, hasDiscount } = useFigures();

  return (
    <aside aria-label="Book this experience" className="hidden w-[380px] shrink-0 lg:sticky lg:top-28 lg:block">
      <div className="card p-7 shadow-xl lg:max-h-[calc(100dvh-8.5rem)] lg:overflow-y-auto">
        <p className="text-[13px] text-muted-foreground">From</p>
        <p className="mb-1 flex flex-wrap items-baseline gap-2">
          {from.original !== null ? (
            <span className="text-lg text-muted-foreground line-through">
              <span className="sr-only">Was </span>
              {formatMoney(from.original, currency)}
            </span>
          ) : null}
          <span className="font-display text-[44px] font-semibold leading-none text-primary">{formatMoney(from.now, currency)}</span>{" "}
          <span className="text-sm text-muted-foreground">per adult</span>
        </p>
        {offer ? (
          <p className="mb-5 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="badge badge-highlight">{offerBadge(offer.type, offer.value, currency)}</span>
            <Link href="/offers" className="font-semibold text-eyebrow underline-offset-4 hover:underline">
              {offer.name}
            </Link>
            <span className="text-muted-foreground">· Ends {formatDate(offer.endsOn, "dayMonth")}</span>
          </p>
        ) : requestsEnabled ? (
          <p className="mb-5 text-[13px] text-muted-foreground">
            No current offer —{" "}
            <Link href={`/offers?tour=${encodeURIComponent(tour.slug)}#request`} className="font-semibold underline underline-offset-4">
              request a discount
            </Link>
            .
          </p>
        ) : (
          <div className="mb-5" />
        )}

        {renderDates("card")}

        <PartySteppers
          variant="rows"
          party={party}
          limits={limits}
          onChange={setParty}
          adultNote={`${formatMoney(quote.unitPriceAdult, currency)} each`}
          childNote={childNote(tour.childMaxAge, tour.childPricePercent, quote.unitPriceChild, currency)}
        />
        {warning ? (
          <p role="alert" className="field-error mt-3">
            {warning}
          </p>
        ) : null}

        <DiscountRow className="mt-4" />
        <div className="my-5 flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">Estimated total</span>
          <span className="flex items-baseline gap-2" aria-live="polite">
            {hasDiscount ? (
              <span className="text-sm text-muted-foreground line-through">
                <span className="sr-only">Before discount </span>
                {formatMoney(quote.baseAmount, currency)}
              </span>
            ) : null}
            <strong className="font-display text-[28px] text-primary">{formatMoney(quote.totalAmount, currency)}</strong>
          </span>
        </div>

        <Link href={href} className="btn btn-default btn-xl w-full rounded-full">
          Request to book
        </Link>
        <p className="mt-3 text-center text-[13px] leading-relaxed text-muted-foreground">No payment now. {contact.name} confirms availability personally.</p>
        {contact.whatsapp ? (
          <a href={contact.whatsapp} target="_blank" rel="noopener noreferrer" className="btn btn-link mt-2 w-full">
            Ask a question on WhatsApp
          </a>
        ) : null}
      </div>
    </aside>
  );
}

/** Phones and tablets: a bar pinned to the bottom, opening a sheet with the same controls. */
export function TourBookingBar() {
  const [open, setOpen] = useState(false);
  const { tour, offer, currency, contact, party, setParty, renderDates, limits, quote, warning, href, hasDiscount } = useFigures();

  return (
    <>
      <div className="safe-b sticky bottom-0 z-30 flex items-center justify-between gap-4 border-t bg-background/95 px-5 pt-3 shadow-[0_-12px_30px_-18px_rgba(0,0,0,.4)] backdrop-blur lg:hidden">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {partySummary(party)} · est.
            {offer && hasDiscount ? (
              <span className="font-semibold text-emerald-700 dark:text-emerald-400"> ({discountLabel(offer.type, offer.value, currency)})</span>
            ) : null}
          </p>
          <p className="font-display text-2xl font-semibold text-primary" aria-live="polite">
            {formatMoney(quote.totalAmount, currency)}
          </p>
        </div>
        <button type="button" className="btn btn-default btn-lg rounded-full px-6" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          Check dates
        </button>
      </div>

      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title={tour.kind === "departure" ? "Choose your departure" : "Choose your date"}
        description="Pick a date and tell us who is travelling."
        className="lg:hidden"
        footer={
          <>
            <DiscountRow />
            <div className="my-2 flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground">Estimated total</span>
              <span className="flex items-baseline gap-2">
                {hasDiscount ? (
                  <span className="text-sm text-muted-foreground line-through">
                    <span className="sr-only">Before discount </span>
                    {formatMoney(quote.baseAmount, currency)}
                  </span>
                ) : null}
                <strong className="font-display text-2xl text-primary">{formatMoney(quote.totalAmount, currency)}</strong>
              </span>
            </div>
            <Link href={href} className="btn btn-default btn-xl w-full rounded-full">
              Request to book
            </Link>
            <p className="mt-2 text-center text-xs text-muted-foreground">No payment now · {contact.name} confirms availability</p>
          </>
        }
      >
        {renderDates("sheet")}
        <PartySteppers
          party={party}
          limits={limits}
          onChange={setParty}
          adultNote={`${formatMoney(quote.unitPriceAdult, currency)} each`}
          childNote={childNote(tour.childMaxAge, tour.childPricePercent, quote.unitPriceChild, currency)}
        />
        {warning ? (
          <p role="alert" className="field-error mt-2">
            {warning}
          </p>
        ) : null}
      </BottomSheet>
    </>
  );
}
