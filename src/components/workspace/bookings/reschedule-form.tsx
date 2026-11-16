"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { loadAvailabilityAction, rescheduleBookingAction, type AvailabilityDay, type AvailabilityMonth } from "@/app/workspace/bookings/actions";
import { firstError } from "@/components/form";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { formatDate, monthGrid, monthTitle, shiftMonth } from "@/lib/booking-display";
import { cn } from "@/lib/utils";
import { ClashList } from "./booking-actions";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const CELL = "relative flex h-11 w-full items-center justify-center rounded-md text-sm transition-colors";

/** Same colour language as the public booking calendar. The state is also spoken and listed in the legend. */
const STATE_CLASSES: Record<AvailabilityDay["state"], string> = {
  open: "border border-emerald-600/40 bg-emerald-50 font-bold text-emerald-900 hover:border-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:hover:bg-emerald-500/25",
  limited: "border border-amber-500/60 bg-amber-50 font-bold text-amber-900 hover:border-amber-600 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25",
  full: "border border-rose-300 bg-rose-50 text-rose-800/80 hover:border-rose-500 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300/80",
  hold: "border border-dashed border-violet-400 bg-violet-50 text-violet-900/80 hover:border-violet-600 dark:bg-violet-500/15 dark:text-violet-200/80",
  closed: "border border-transparent text-muted-foreground hover:border-border",
  past: "cursor-default text-muted-foreground/40",
};

const STATE_WORDS: Record<AvailabilityDay["state"], string> = {
  open: "available",
  limited: "few seats left",
  full: "fully booked",
  hold: "on hold for another request",
  closed: "not offered",
  past: "in the past",
};

const LEGEND: { label: string; swatch: string }[] = [
  { label: "Available", swatch: "border border-emerald-600/40 bg-emerald-50 dark:bg-emerald-500/15" },
  { label: "Few left", swatch: "border border-amber-500/60 bg-amber-50 dark:bg-amber-500/15" },
  { label: "Full", swatch: "border border-rose-300 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10" },
  { label: "On hold", swatch: "border border-dashed border-violet-400 bg-violet-50 dark:bg-violet-500/15" },
];

interface Loaded {
  key: string;
  data: AvailabilityMonth | null;
  error: string | null;
}

interface RescheduleFormProps {
  booking: { id: string; tourId: string; startDate: string; slotTime: string | null };
  onDone: () => void;
}

/**
 * Moves a booking to another date. The tour's own calendar shows which days
 * are open; staff may still choose a full or closed day, in which case the
 * server lists what collides and the save has to be repeated deliberately.
 */
export function RescheduleForm({ booking, onDone }: RescheduleFormProps) {
  const [month, setMonth] = useState(booking.startDate.slice(0, 7));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(booking.slotTime);
  const [clashes, setClashes] = useState<string[] | null>(null);
  const { run, pending, fieldErrors, reset } = useAction(rescheduleBookingAction);

  const key = `${booking.tourId}:${month}:${attempt}`;
  useEffect(() => {
    let active = true;
    loadAvailabilityAction({ tourId: booking.tourId, month }).then(
      (result) => {
        if (active) setLoaded({ key, data: result.ok ? result.data : null, error: result.ok ? null : result.error });
      },
      () => {
        if (active) setLoaded({ key, data: null, error: "We could not load this month. Check your connection and try again." });
      },
    );
    return () => {
      active = false;
    };
  }, [booking.tourId, month, key]);

  const current = loaded?.key === key ? loaded : null;
  const days = new Map((current?.data?.days ?? []).map((day) => [day.date, day]));
  const grid = monthGrid(month);
  const selected = date ? days.get(date) : undefined;
  const slots = selected?.slots ?? null;
  const isDayTour = current?.data?.kind === "day" || booking.slotTime !== null;

  function choose(day: string) {
    setDate(day);
    setClashes(null);
    reset();
    const options = days.get(day)?.slots;
    // Keep the booking's own start time when that day offers it; otherwise the first open one.
    if (options && !options.some((option) => option.time === slot)) {
      setSlot((options.find((option) => option.state !== "full") ?? options[0])?.time ?? null);
    }
  }

  async function save() {
    if (!date) return;
    const result = await run({ id: booking.id, date, slotTime: isDayTour ? slot : undefined, force: clashes !== null });
    if (!result.ok) return;
    if (result.data.outcome === "clash") {
      setClashes(result.data.clashes);
      return;
    }
    toast.success(`Tour date updated to ${formatDate(date)}`);
    onDone();
  }

  const dateError = firstError(fieldErrors, "date");
  const slotError = firstError(fieldErrors, "slotTime");

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <p className="text-sm font-bold" aria-live="polite">
          {monthTitle(month)}
        </p>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>

      {current?.error ? (
        <div role="alert" className="alert alert-destructive flex flex-wrap items-center justify-between gap-3">
          <span>{current.error}</span>
          <button type="button" className="btn btn-outline btn-sm bg-background text-foreground" onClick={() => setAttempt(attempt + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <div aria-busy={!current || undefined}>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground" aria-hidden="true">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday} className="py-1">
                {weekday}
              </span>
            ))}
          </div>
          <div role="group" aria-label={`Choose a date in ${monthTitle(month)}`} className="grid grid-cols-7 gap-1">
            {grid.cells.map((day, index) => {
              if (!day) return <span key={`blank-${index}`} />;
              if (!current) return <span key={day} className="skeleton h-11" />;
              const info = days.get(day);
              const state = info?.state ?? "closed";
              const isSelected = day === date;
              const isCurrent = day === booking.startDate;
              const seats = info && (state === "open" || state === "limited") ? `, ${info.seatsLeft} ${info.seatsLeft === 1 ? "seat" : "seats"} left` : "";
              return (
                <button
                  key={day}
                  type="button"
                  disabled={state === "past"}
                  aria-pressed={isSelected}
                  aria-label={`${formatDate(day, "long")}, ${STATE_WORDS[state]}${seats}${isCurrent ? ", the current date" : ""}`}
                  className={cn(
                    CELL,
                    isSelected ? "bg-primary font-bold text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background" : STATE_CLASSES[state],
                  )}
                  onClick={() => choose(day)}
                >
                  {Number(day.slice(8, 10))}
                  {isCurrent ? <span aria-hidden="true" className={cn("absolute bottom-1 h-1 w-1 rounded-full", isSelected ? "bg-primary-foreground" : "bg-foreground")} /> : null}
                </button>
              );
            })}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {LEGEND.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={cn("h-3 w-3 rounded-sm", item.swatch)} />
                {item.label}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-foreground" />
              Current date
            </li>
          </ul>
        </div>
      )}

      {date ? (
        <p className="text-sm">
          <span className="font-semibold">{formatDate(date, "long")}</span>
          <span className="text-muted-foreground">
            {" · "}
            {selected && (selected.state === "open" || selected.state === "limited")
              ? `${selected.seatsLeft} ${selected.seatsLeft === 1 ? "seat" : "seats"} left`
              : `${STATE_WORDS[selected?.state ?? "closed"]}; saving will ask you to confirm`}
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Choose the new date. Days in colour are open on this tour’s calendar.</p>
      )}
      {dateError ? (
        <p role="alert" className="field-error">
          {dateError}
        </p>
      ) : null}

      {date && isDayTour ? (
        slots && slots.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="label" id="reschedule-slot">
              Start time
            </p>
            <div role="radiogroup" aria-labelledby="reschedule-slot" className="flex flex-wrap gap-2">
              {slots.map((option) => (
                <button
                  key={option.time}
                  type="button"
                  role="radio"
                  aria-checked={slot === option.time}
                  className="chip"
                  onClick={() => {
                    setSlot(option.time);
                    setClashes(null);
                    reset();
                  }}
                >
                  {option.time}
                  <span className="text-xs opacity-80">{option.state === "full" ? "full" : `${option.seatsLeft} left`}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This day has no open start times{booking.slotTime ? `, so the booking keeps its ${booking.slotTime} start` : ""}.
          </p>
        )
      ) : null}
      {slotError ? (
        <p role="alert" className="field-error">
          {slotError}
        </p>
      ) : null}

      {clashes ? (
        <div role="alert" className="alert alert-destructive text-[13px]">
          <p className="font-bold">This date would cause a clash</p>
          <ClashList clashes={clashes} className="mt-1" />
          <p className="mt-2">Choose “Save anyway” only if you’ve agreed it with everyone affected.</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={cn("btn", clashes ? "btn-destructive" : "btn-default")} disabled={!date || pending} aria-busy={pending || undefined} onClick={save}>
          {pending ? <Spinner /> : null}
          {clashes ? "Save anyway" : "Update date"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone} disabled={pending}>
          Keep current date
        </button>
      </div>
    </div>
  );
}
