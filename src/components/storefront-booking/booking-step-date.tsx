"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  childNote,
  clampParty,
  isBookable,
  partyLimits,
  priceParty,
  reasonText,
  seatLine,
  unavailableTitle,
  type BookingDraft,
  type DateStepErrors,
  type DayInfo,
  type SlotInfo,
} from "@/lib/booking-form";
import { formatDate, formatDateRange, monthOf } from "@/lib/calendar";
import { addDays, formatMoney } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { AvailabilityCalendar } from "./availability-calendar";
import { SlotPicker } from "./choice";
import { PartySteppers } from "./party-steppers";
import { TONE_CLASS, type BookableTour, type CalendarLimits } from "./types";
import type { Availability } from "./use-availability";
import { WaitlistForm } from "./waitlist-form";

/** Why the visitor was sent back to this step after sending the request. */
export interface Conflict {
  title: string;
  body: string;
}

interface BookingStepDateProps {
  tours: BookableTour[];
  tour: BookableTour;
  draft: BookingDraft;
  /** The chosen date, when it can be booked. */
  day: DayInfo | undefined;
  currency: string;
  calendar: CalendarLimits;
  availability: Availability;
  month: string;
  onMonthChange: (month: string) => void;
  errors: DateStepErrors & { alt?: string };
  conflict: Conflict | null;
  onTourChange: (slug: string) => void;
  onChange: (patch: Partial<BookingDraft>) => void;
}

interface Info {
  day: DayInfo;
  slot?: SlotInfo;
}

function tourRule(tour: BookableTour): string {
  const limits = partyLimits(tour);
  if (tour.kind === "departure") return `Scheduled small-group departures · up to ${limits.maxGuests} guests per booking · availability updates live`;
  if (tour.kind === "private") {
    return tour.durationDays > 1
      ? `Private tour — once a date is booked or on hold, all ${tour.durationDays} days are unavailable to others`
      : "Private tour — the date you choose is yours alone";
  }
  return `Choose a date, then a start time · up to ${limits.maxGuests} guests per booking`;
}

/** Step 1: tour, date (and start time), party, and an optional back-up date. */
export function BookingStepDate({
  tours,
  tour,
  draft,
  day,
  currency,
  calendar,
  availability,
  month,
  onMonthChange,
  errors,
  conflict,
  onTourChange,
  onChange,
}: BookingStepDateProps) {
  const ids = useId();
  const limits = partyLimits(tour);
  const party = { adults: draft.adults, children: draft.children };
  const guests = party.adults + party.children;
  const price = priceParty(tour, party);
  const { findNext } = availability;

  const [info, setInfo] = useState<Info | null>(null);
  const [suggestions, setSuggestions] = useState<{ after: string; dates: string[] } | null>(null);
  const [backups, setBackups] = useState<{ after: string; dates: string[] } | null>(null);
  const [jumping, setJumping] = useState(false);

  const minMonth = monthOf(calendar.today);
  const maxMonth = monthOf(calendar.maxDate);
  const selectedDate = day?.date ?? "";
  const infoDate = info?.day.date ?? "";

  // Back-up dates: the next few dates that can still be booked after the chosen one.
  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    void findNext(selectedDate, 6, selectedDate).then((dates) => {
      if (!cancelled) setBackups({ after: selectedDate, dates });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, findNext]);

  // "Next available" beside the explanation of a date that cannot be chosen.
  useEffect(() => {
    if (!infoDate) return;
    let cancelled = false;
    void findNext(infoDate, 3).then((dates) => {
      if (!cancelled) setSuggestions({ after: infoDate, dates });
    });
    return () => {
      cancelled = true;
    };
  }, [infoDate, findNext]);

  const backupDates = backups && backups.after === selectedDate ? backups.dates : [];
  const nextDates = suggestions && suggestions.after === infoDate ? suggestions.dates : [];
  // A back-up chosen earlier stays listed even while the options reload.
  const backupOptions = draft.alt && !backupDates.includes(draft.alt) ? [draft.alt, ...backupDates] : backupDates;

  function select(date: string) {
    setInfo(null);
    onMonthChange(monthOf(date));
    onChange({ date, slot: "", alt: draft.alt === date ? "" : draft.alt });
  }

  function pick(picked: DayInfo) {
    if (isBookable(picked.state)) select(picked.date);
    else if (picked.state !== "past") setInfo({ day: picked });
  }

  async function jumpNext() {
    setJumping(true);
    const [next] = await findNext(selectedDate || addDays(calendar.today, -1), 1);
    setJumping(false);
    if (next) select(next);
  }

  const line = day ? seatLine(day, tour.kind) : null;
  const infoLabel = info ? formatDate(info.day.date, "long") : "";
  const infoFull = info ? info.slot !== undefined || info.day.state === "full" : false;
  const waitable = info ? info.slot !== undefined || info.day.state === "full" || info.day.state === "hold" : false;

  return (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${ids}-tour`} className="label">
          Selected tour
        </label>
        <select id={`${ids}-tour`} className="select" value={tour.slug} aria-describedby={`${ids}-tour-hint`} onChange={(event) => onTourChange(event.target.value)}>
          {tours.map((option) => (
            <option key={option.slug} value={option.slug}>
              {[option.title, option.durationLabel, formatMoney(option.priceAdult, currency)].filter(Boolean).join(" · ")}
            </option>
          ))}
        </select>
        <span id={`${ids}-tour-hint`} className="field-hint">
          {tourRule(tour)}
        </span>
      </div>

      {conflict ? (
        <div role="alert" className="alert alert-destructive flex gap-3">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-bold">{conflict.title}</p>
            <p className="mt-1">{conflict.body}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <AvailabilityCalendar
          month={month}
          minMonth={minMonth}
          maxMonth={maxMonth}
          onMonthChange={onMonthChange}
          days={availability.days}
          status={availability.status}
          onRetry={availability.retry}
          selected={selectedDate}
          bounds={{ min: calendar.today, max: calendar.maxDate }}
          kind={tour.kind}
          durationDays={tour.durationDays}
          onPick={pick}
          onJumpNext={() => void jumpNext()}
          jumping={jumping}
        />

        <div className="flex flex-col gap-4">
          {info ? (
            <div role="alert" className={cn("alert", infoFull ? "alert-destructive" : "alert-warning")}>
              <p className="font-bold">{info.slot ? "That time is fully booked" : unavailableTitle(infoLabel, info.day.state)}</p>
              <p className="mt-1">
                {info.slot
                  ? `${info.slot.time} on ${infoLabel} is fully booked (${info.slot.capacity} of ${info.slot.capacity} seats taken). Choose another time or date.`
                  : reasonText(info.day, tour.kind)}
              </p>
              {nextDates.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Next available</p>
                  {nextDates.map((date) => {
                    const next = availability.days[date];
                    return (
                      <button key={date} type="button" className="btn btn-outline btn-sm justify-between bg-background text-foreground" onClick={() => select(date)}>
                        {formatDate(date, "long")}
                        <span className="text-xs text-muted-foreground">{next?.state === "limited" ? "Few spots left" : "Available"}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {waitable ? (
                <WaitlistForm
                  key={`${info.day.date}-${info.slot?.time ?? ""}`}
                  className="mt-3"
                  tourSlug={tour.slug}
                  date={info.day.date}
                  slotTime={info.slot?.time ?? null}
                  partySize={guests}
                  dateLabel={info.slot ? `${infoLabel} at ${info.slot.time}` : infoLabel}
                  defaults={{ name: draft.name, email: draft.email }}
                />
              ) : null}
            </div>
          ) : null}

          {day && line ? (
            <div className="rounded-xl border bg-secondary/40 p-4" aria-live="polite">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Selected</p>
              <p className="font-display text-2xl font-semibold text-primary">{formatDate(day.date, "long")}</p>
              <p className="text-sm text-muted-foreground">
                {tour.kind === "day"
                  ? [tour.categoryName, tour.durationLabel].filter(Boolean).join(" · ")
                  : tour.durationDays > 1
                    ? `${formatDateRange(day.date, day.endDate)} · ${tour.durationDays} days`
                    : tour.durationLabel}
              </p>
              <p className={cn("mt-2 text-sm font-semibold", TONE_CLASS[line.tone])}>{line.text}</p>
            </div>
          ) : !info ? (
            <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Pick a date in the calendar to see live availability.</div>
          ) : null}

          {tour.kind === "day" && day?.slots && day.slots.length > 0 ? (
            <SlotPicker
              name={`${ids}-slot`}
              slots={day.slots}
              selected={draft.slot}
              guests={guests}
              error={errors.slot}
              onSelect={(time) => {
                setInfo(null);
                onChange({ slot: time });
              }}
              onFull={(slot) => setInfo({ day, slot })}
            />
          ) : null}

          {errors.date ? (
            <span role="alert" data-field-error className="field-error">
              {errors.date}
            </span>
          ) : null}
          {tour.kind === "day" && errors.slot && !(day?.slots && day.slots.length > 0) ? (
            <span role="alert" data-field-error className="field-error">
              {errors.slot}
            </span>
          ) : null}

          <PartySteppers
            party={party}
            limits={limits}
            onChange={(next) => onChange(clampParty(next, limits))}
            adultNote={`${formatMoney(price.unitPriceAdult, currency)} each`}
            childNote={childNote(tour.childMaxAge, tour.childPricePercent, price.unitPriceChild, currency)}
          />
          {errors.seats ? (
            <span role="alert" data-field-error className="field-error">
              {errors.seats}
            </span>
          ) : null}

          <div className="flex flex-col gap-2">
            <label htmlFor={`${ids}-alt`} className="label">
              Back-up date <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <select
              id={`${ids}-alt`}
              className="select"
              value={draft.alt}
              disabled={!selectedDate}
              aria-invalid={Boolean(errors.alt)}
              aria-describedby={`${ids}-alt-hint`}
              onChange={(event) => onChange({ alt: event.target.value })}
            >
              <option value="">No back-up date</option>
              {backupOptions.map((date) => (
                <option key={date} value={date}>
                  {formatDate(date, "long")}
                </option>
              ))}
            </select>
            {errors.alt ? (
              <span role="alert" className="field-error">
                {errors.alt}
              </span>
            ) : null}
            <span id={`${ids}-alt-hint`} className="field-hint">
              {selectedDate ? "Only dates that are still available are listed." : "Choose your date first."}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
