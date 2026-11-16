/**
 * Month-grid maths for the storefront availability calendar. Everything works
 * on `YYYY-MM-DD` and `YYYY-MM` strings, so nothing here can drift across a
 * timezone boundary. Pure and dependency-free apart from the date helpers.
 */
import { addDays, isIsoDate, isoWeekday } from "./dates";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH.test(value);
}

/** `2027-04-17` → `2027-04`. */
export function monthOf(date: string): string {
  if (!isIsoDate(date)) throw new RangeError(`Not a calendar date: ${date}`);
  return date.slice(0, 7);
}

/** Moves a `YYYY-MM` month forwards or backwards by whole months. */
export function addMonths(month: string, count: number): string {
  if (!isMonth(month)) throw new RangeError(`Not a month: ${month}`);
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + Math.trunc(count);
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String(index - year * 12 + 1).padStart(2, "0")}`;
}

export function monthStart(month: string): string {
  if (!isMonth(month)) throw new RangeError(`Not a month: ${month}`);
  return `${month}-01`;
}

export function monthEnd(month: string): string {
  return addDays(monthStart(addMonths(month, 1)), -1);
}

/** Keeps a month inside [min, max]; both bounds are inclusive. */
export function clampMonth(month: string, min: string, max: string): string {
  if (month < min) return min;
  if (month > max) return max;
  return month;
}

/** Whole months from `from` to `to` (positive when `to` is later). */
export function monthsBetween(from: string, to: string): number {
  if (!isMonth(from) || !isMonth(to)) throw new RangeError("Not a month");
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
}

/**
 * Cells of a Monday-first month grid: `null` for the blanks before the first
 * day, then every date of the month in order.
 */
export function monthGrid(month: string): Array<string | null> {
  const first = monthStart(month);
  const last = monthEnd(month);
  const cells: Array<string | null> = Array.from({ length: isoWeekday(first) - 1 }, () => null);
  for (let date = first; date <= last; date = addDays(date, 1)) cells.push(date);
  return cells;
}

/** Longest window the availability endpoint answers in one call. */
export const MAX_WINDOW_DAYS = 92;

/**
 * The three calendar months starting at `month`, as one request window. Any
 * three consecutive months span at most 92 days, which is the endpoint's cap.
 */
export function quarterWindow(month: string): { from: string; to: string; months: string[] } {
  const months = [month, addMonths(month, 1), addMonths(month, 2)];
  return { from: monthStart(month), to: monthEnd(months[2]!), months };
}

export interface DateBounds {
  /** First date focus may land on. */
  min: string;
  /** Last date focus may land on. */
  max: string;
}

/** Same day of the month `count` months away, pulled back to that month's last day when it is shorter. */
export function shiftMonth(date: string, count: number): string {
  const target = addMonths(monthOf(date), count);
  const day = Number(date.slice(8, 10));
  const lastDay = Number(monthEnd(target).slice(8, 10));
  return `${target}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/**
 * Where keyboard focus goes from `date` for a key press in the grid, following
 * the WAI-ARIA date-grid pattern: arrows move a day or a week, Home and End go
 * to the ends of the week, Page Up and Page Down change month. The result is
 * kept inside `bounds`. Returns null for keys the grid does not handle.
 */
export function moveFocus(date: string, key: string, bounds: DateBounds): string | null {
  let target: string;
  switch (key) {
    case "ArrowLeft":
      target = addDays(date, -1);
      break;
    case "ArrowRight":
      target = addDays(date, 1);
      break;
    case "ArrowUp":
      target = addDays(date, -7);
      break;
    case "ArrowDown":
      target = addDays(date, 7);
      break;
    case "Home":
      target = addDays(date, 1 - isoWeekday(date));
      break;
    case "End":
      target = addDays(date, 7 - isoWeekday(date));
      break;
    case "PageUp":
      target = shiftMonth(date, -1);
      break;
    case "PageDown":
      target = shiftMonth(date, 1);
      break;
    default:
      return null;
  }
  if (target < bounds.min) return bounds.min;
  if (target > bounds.max) return bounds.max;
  return target;
}

export type DateStyle = "short" | "long" | "dayMonth" | "weekday";

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  /** 17 Apr 2027 */
  short: { day: "numeric", month: "short", year: "numeric" },
  /** Sat, 17 Apr 2027 */
  long: { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  /** 15 Dec */
  dayMonth: { day: "numeric", month: "short" },
  /** Saturday, 17 April 2027 */
  weekday: { weekday: "long", day: "numeric", month: "long", year: "numeric" },
};

/**
 * Formats a calendar date for display. The value has no time, so it is read
 * and printed in UTC: the day shown is always the day stored.
 */
export function formatDate(date: string, style: DateStyle = "short", locale = "en-GB"): string {
  if (!isIsoDate(date)) return "";
  return new Intl.DateTimeFormat(locale, { ...DATE_OPTIONS[style], timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** `2026-11` → "November 2026". */
export function formatMonth(month: string, locale = "en-GB"): string {
  if (!isMonth(month)) return "";
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

/** "17 Apr 2027 – 19 Apr 2027"; a single date when the range is one day. */
export function formatDateRange(start: string, end: string, locale = "en-GB"): string {
  if (start === end) return formatDate(start, "short", locale);
  return `${formatDate(start, "short", locale)} – ${formatDate(end, "short", locale)}`;
}

/** A timestamp in the business's own timezone, e.g. "Sat, 17 Apr 2027, 14:30". */
export function formatDateTime(value: Date | string, timezone: string, locale = "en-GB"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone }).format(date);
  } catch {
    // An unknown timezone must not break a confirmation screen.
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
  }
}
