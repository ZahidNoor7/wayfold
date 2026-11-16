"use client";

import { Check, ChevronLeft, ChevronRight, Clock, Minus, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Spinner } from "@/components/overlays";
import { calendarHint, cellCaption, isBookable, monthSummary, STATE_LABELS, type DayInfo, type DayState, type TourKind } from "@/lib/booking-form";
import { addMonths, formatDate, formatMonth, monthGrid, monthOf, moveFocus } from "@/lib/calendar";
import { cn } from "@/lib/utils";

const CELL = "relative flex w-full flex-col items-center justify-center gap-0.5 rounded-md text-sm transition-colors";
const CELL_SIZE = { regular: "h-12 sm:h-14", compact: "h-12" } as const;

/** One look per state. Each also carries a caption or a pattern: colour is never the only signal. */
const CELL_STATE: Record<DayState | "selected" | "unknown", string> = {
  open: "cursor-pointer border border-emerald-600/40 bg-emerald-50 font-bold text-emerald-900 hover:border-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:hover:bg-emerald-500/25",
  limited:
    "cursor-pointer border border-amber-500/60 bg-amber-50 font-bold text-amber-900 hover:border-amber-600 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25",
  full: "cursor-not-allowed border border-rose-300 bg-rose-50 text-rose-800/70 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300/70",
  hold: "cursor-not-allowed border border-dashed border-violet-400 bg-violet-50 text-violet-900/80 dark:bg-violet-500/15 dark:text-violet-200/80",
  closed: "cursor-default text-muted-foreground/40",
  past: "cursor-default text-muted-foreground/25",
  selected: "cursor-pointer bg-primary font-bold text-primary-foreground shadow-lg ring-2 ring-primary ring-offset-2 ring-offset-background",
  unknown: "cursor-default animate-pulse bg-muted/60 text-muted-foreground/60",
};

const CAPTION = "text-[9px] leading-none sm:text-[10px]";
const CAPTION_STATE: Partial<Record<DayState | "selected", string>> = {
  open: "font-semibold text-emerald-700 dark:text-emerald-300",
  limited: "font-bold text-amber-700 dark:text-amber-300",
  full: "font-bold text-rose-700 dark:text-rose-300",
  hold: "font-bold text-violet-700 dark:text-violet-300",
  selected: "font-bold text-primary-foreground",
};

const WEEKDAYS = [
  ["Mo", "Monday"],
  ["Tu", "Tuesday"],
  ["We", "Wednesday"],
  ["Th", "Thursday"],
  ["Fr", "Friday"],
  ["Sa", "Saturday"],
  ["Su", "Sunday"],
] as const;

function weeks(cells: Array<string | null>): Array<Array<string | null>> {
  const rows: Array<Array<string | null>> = [];
  for (let index = 0; index < cells.length; index += 7) {
    const row = cells.slice(index, index + 7);
    while (row.length < 7) row.push(null);
    rows.push(row);
  }
  return rows;
}

interface AvailabilityCalendarProps {
  month: string;
  minMonth: string;
  maxMonth: string;
  onMonthChange: (month: string) => void;
  days: Record<string, DayInfo>;
  status: "loading" | "ready" | "error";
  onRetry: () => void;
  /** The chosen start date, or an empty string. */
  selected: string;
  /** First and last date keyboard focus may reach. */
  bounds: { min: string; max: string };
  kind: TourKind;
  durationDays: number;
  /** Called for any date with data: the parent selects it or explains why it cannot be chosen. */
  onPick: (day: DayInfo) => void;
  /** "Jump to the next available date". Hidden when not given. */
  onJumpNext?: () => void;
  jumping?: boolean;
  /** Shorter cells, for the narrow booking card on the tour page. */
  compact?: boolean;
  className?: string;
}

/**
 * Month calendar of a tour's availability. Dates are buttons in a grid:
 * arrow keys move by day and week, Home and End by week, Page Up and Page Down
 * by month; one date is in the tab order at a time. Dates that cannot be
 * booked stay focusable and are marked `aria-disabled`, so a screen-reader
 * user can still hear why.
 */
export function AvailabilityCalendar({
  month,
  minMonth,
  maxMonth,
  onMonthChange,
  days,
  status,
  onRetry,
  selected,
  bounds,
  kind,
  durationDays,
  onPick,
  onJumpNext,
  jumping,
  compact,
  className,
}: AvailabilityCalendarProps) {
  const grid = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [focusDate, setFocusDate] = useState<string | null>(null);

  const cells = monthGrid(month);
  const dates = cells.filter((cell): cell is string => cell !== null);
  const monthDays = dates.map((date) => days[date]).filter((day): day is DayInfo => day !== undefined);
  const label = formatMonth(month);

  // Exactly one date is tabbable: the one last focused, else the selection,
  // else the first date that can be booked, else the first reachable date.
  const tabDate =
    (focusDate && dates.includes(focusDate) ? focusDate : null) ??
    (selected && dates.includes(selected) ? selected : null) ??
    monthDays.find((day) => isBookable(day.state))?.date ??
    dates.find((date) => date >= bounds.min && date <= bounds.max) ??
    dates[0]!;

  // After an arrow key crosses into another month, focus follows once that month is drawn.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const cell = grid.current?.querySelector<HTMLButtonElement>(`[data-date="${target}"]`);
    if (cell) {
      cell.focus();
      pendingFocus.current = null;
    }
  });

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const from = (event.target as HTMLElement).closest<HTMLElement>("[data-date]")?.dataset.date;
    if (!from) return;
    const target = moveFocus(from, event.key, bounds);
    if (!target) return;
    event.preventDefault();
    setFocusDate(target);
    pendingFocus.current = target;
    const targetMonth = monthOf(target);
    if (targetMonth !== month) onMonthChange(targetMonth);
  }

  return (
    <div className={cn("rounded-xl border p-2", !compact && "sm:p-4", className)}>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="btn btn-outline btn-icon"
          aria-label="Previous month"
          disabled={month <= minMonth}
          onClick={() => onMonthChange(addMonths(month, -1))}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <p className="font-semibold" aria-live="polite">
          {label}
        </p>
        <button type="button" className="btn btn-outline btn-icon" aria-label="Next month" disabled={month >= maxMonth} onClick={() => onMonthChange(addMonths(month, 1))}>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>

      <div className="mb-3 rounded-md bg-muted/60 px-3 py-2 text-[13px]" aria-live="polite">
        {status === "ready" ? (
          <p>
            <strong>{monthSummary(monthDays, label)}</strong> {calendarHint(kind, durationDays)}
          </p>
        ) : status === "loading" ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="size-4" />
            Checking availability for {label}…
          </p>
        ) : (
          <p role="alert" className="flex flex-wrap items-center justify-between gap-2">
            <span>We could not load availability for {label}.</span>
            <button type="button" className="btn btn-outline btn-sm bg-background" onClick={onRetry}>
              Try again
            </button>
          </p>
        )}
      </div>

      <div ref={grid} role="grid" aria-label={`Availability, ${label}`} aria-busy={status === "loading" || undefined} onKeyDown={onKeyDown}>
        <div role="row" className="mb-1 grid grid-cols-7 text-center text-xs font-semibold text-muted-foreground">
          {WEEKDAYS.map(([short, long]) => (
            <span key={short} role="columnheader" aria-label={long}>
              {short}
            </span>
          ))}
        </div>
        <div role="rowgroup" className="flex flex-col gap-1">
          {weeks(cells).map((row, rowIndex) => (
            <div key={rowIndex} role="row" className="grid grid-cols-7 gap-1">
              {row.map((date, columnIndex) => {
                if (!date) return <span key={`blank-${columnIndex}`} role="gridcell" aria-hidden="true" />;
                const day = days[date];
                const isSelected = date === selected && day !== undefined && isBookable(day.state);
                const state: DayState | "unknown" = day ? day.state : status === "ready" ? (date < bounds.min ? "past" : "closed") : "unknown";
                const look = isSelected ? "selected" : state;
                const caption = isSelected ? "Selected" : day ? cellCaption(day) : null;
                const spoken = state === "unknown" ? "checking availability" : STATE_LABELS[state];
                const bookable = day !== undefined && isBookable(day.state);
                return (
                  <div key={date} role="gridcell" aria-selected={isSelected}>
                    <button
                      type="button"
                      data-date={date}
                      tabIndex={date === tabDate ? 0 : -1}
                      aria-label={`${formatDate(date, "long")}, ${isSelected ? "selected, " : ""}${spoken}`}
                      aria-disabled={!bookable}
                      aria-pressed={isSelected}
                      className={cn(CELL, CELL_SIZE[compact ? "compact" : "regular"], CELL_STATE[look])}
                      onFocus={() => setFocusDate(date)}
                      onClick={() => {
                        if (day) onPick(day);
                      }}
                    >
                      <span className={cn(state === "full" && !isSelected && "line-through decoration-rose-500/60")}>{Number(date.slice(8, 10))}</span>
                      {caption ? <span className={cn(CAPTION, CAPTION_STATE[look as DayState | "selected"])}>{caption}</span> : null}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <ul aria-label="Legend" className={cn("mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-xs font-medium", !compact && "sm:grid-cols-3")}>
        <li className="flex items-center gap-2">
          <span className="flex size-4 items-center justify-center rounded border border-emerald-600/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
            <Check aria-hidden="true" className="size-3" />
          </span>
          Available
        </li>
        <li className="flex items-center gap-2">
          <span className="flex size-4 items-center justify-center rounded border border-amber-500/60 bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
            <TriangleAlert aria-hidden="true" className="size-3" />
          </span>
          Few spots left
        </li>
        <li className="flex items-center gap-2">
          <span className="flex size-4 items-center justify-center rounded border border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            <X aria-hidden="true" className="size-3" />
          </span>
          Fully booked
        </li>
        <li className="flex items-center gap-2">
          <span className="flex size-4 items-center justify-center rounded border border-dashed border-violet-400 bg-violet-50 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200">
            <Clock aria-hidden="true" className="size-3" />
          </span>
          On hold (pending)
        </li>
        <li className="flex items-center gap-2">
          <span className="flex size-4 items-center justify-center rounded bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1 ring-offset-background">
            <Check aria-hidden="true" className="size-3" />
          </span>
          Your selection
        </li>
        <li className="flex items-center gap-2 text-muted-foreground">
          <span className="flex size-4 items-center justify-center text-muted-foreground/50">
            <Minus aria-hidden="true" className="size-3" />
          </span>
          Not running
        </li>
      </ul>

      {onJumpNext ? (
        <button type="button" className="btn btn-link mt-2 h-auto px-0 py-1" onClick={onJumpNext} disabled={jumping} aria-busy={jumping || undefined}>
          {jumping ? <Spinner /> : null}
          Jump to the next available date
        </button>
      ) : null}
    </div>
  );
}
