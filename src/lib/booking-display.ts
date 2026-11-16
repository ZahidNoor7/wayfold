/**
 * Pure display helpers for the workspace's bookings, customers and enquiries
 * screens: labels, dates, money input, calendar maths and URL parameters.
 * Nothing here reads the clock, the database or the request, so the same
 * functions run on the server and in the browser and are unit-tested.
 */
import { addDays, diffDays, isIsoDate, isoWeekday, todayIn } from "./dates";

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type PaymentStatus = "unpaid" | "deposit_paid" | "paid" | "refunded";
export type CancelKind = "declined" | "by_customer" | "by_business" | "expired";
export type ContactMethod = "email" | "whatsapp" | "phone";

/** Dates read day-first everywhere in the dashboard: `18 Apr 2027`. */
export const DISPLAY_LOCALE = "en-GB";

export const BOOKING_STATUSES: readonly BookingStatus[] = ["pending", "confirmed", "completed", "cancelled"];
export const PAYMENT_STATUSES: readonly PaymentStatus[] = ["unpaid", "deposit_paid", "paid", "refunded"];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const BOOKING_STATUS_BADGES: Record<BookingStatus, string> = {
  pending: "badge badge-pending",
  confirmed: "badge badge-confirmed",
  completed: "badge badge-completed",
  cancelled: "badge badge-cancelled",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  deposit_paid: "Deposit paid",
  paid: "Paid",
  refunded: "Refunded",
};

export const PAYMENT_STATUS_BADGES: Record<PaymentStatus, string> = {
  unpaid: "badge badge-outline",
  deposit_paid: "badge badge-pending",
  paid: "badge badge-confirmed",
  refunded: "badge badge-completed",
};

export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  phone: "Phone",
};

/**
 * Declined, expired and cancelled bookings share one stored status; the
 * cancel kind says which it was, and the badge should too.
 */
export function bookingStatusLabel(booking: { status: BookingStatus; cancelKind?: CancelKind | null }): string {
  if (booking.status !== "cancelled") return BOOKING_STATUS_LABELS[booking.status];
  if (booking.cancelKind === "declined") return "Declined";
  if (booking.cancelKind === "expired") return "Expired";
  if (booking.cancelKind === "by_customer") return "Cancelled by guest";
  if (booking.cancelKind === "by_business") return "Cancelled by you";
  return "Cancelled";
}

/** What the status machine allows from `status`. `completed` is terminal. */
export interface BookingActions {
  confirm: boolean;
  decline: boolean;
  cancel: boolean;
  complete: boolean;
  reopen: boolean;
  reschedule: boolean;
}

export function availableActions(status: BookingStatus): BookingActions {
  return {
    confirm: status === "pending",
    decline: status === "pending",
    cancel: status === "confirmed",
    complete: status === "confirmed",
    reopen: status === "cancelled",
    reschedule: status !== "completed",
  };
}

/* -------------------------------------------------------------------- people */

/** `2 adults, 3 children`, `1 adult`, `2 adults, 1 child`. */
export function formatGuests(adults: number, children = 0): string {
  const parts = [`${adults} ${adults === 1 ? "adult" : "adults"}`];
  if (children > 0) parts.push(`${children} ${children === 1 ? "child" : "children"}`);
  return parts.join(", ");
}

/** `4 guests`, `1 guest`. */
export function formatGuestCount(guests: number): string {
  return `${guests} ${guests === 1 ? "guest" : "guests"}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** Up to two letters for an avatar; `?` when the name is blank. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "");
  return letters.toUpperCase() || "?";
}

/* --------------------------------------------------------------------- dates */

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/**
 * Formats a `YYYY-MM-DD` calendar date. Calendar dates have no timezone, so
 * they are always formatted in UTC and can never drift by a day.
 * `medium` → `18 Apr 2027`, `long` → `Sat, 18 Apr 2027`, `short` → `18 Apr`.
 */
export function formatDate(iso: string | null | undefined, style: "short" | "medium" | "long" = "medium", locale = DISPLAY_LOCALE): string {
  if (!iso || !isIsoDate(iso)) return "—";
  const options: Intl.DateTimeFormatOptions =
    style === "short"
      ? { day: "numeric", month: "short" }
      : style === "long"
        ? { weekday: "short", day: "numeric", month: "short", year: "numeric" }
        : { day: "numeric", month: "short", year: "numeric" };
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(utcDate(iso));
}

/** `14 – 21 Jun 2027` when the tour spans several days, a single date otherwise. */
export function formatDateRange(start: string, end: string | null | undefined, locale = DISPLAY_LOCALE): string {
  if (!end || end === start || !isIsoDate(end) || !isIsoDate(start)) return formatDate(start, "medium", locale);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const from = sameMonth
    ? String(Number(start.slice(8, 10)))
    : sameYear
      ? formatDate(start, "short", locale)
      : formatDate(start, "medium", locale);
  return `${from} – ${formatDate(end, "medium", locale)}`;
}

/** The date tile on the overview: `{ month: "Nov", day: "18" }`. */
export function dateTileParts(iso: string, locale = DISPLAY_LOCALE): { month: string; day: string } {
  if (!isIsoDate(iso)) return { month: "", day: "" };
  return {
    month: new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(utcDate(iso)),
    day: iso.slice(8, 10),
  };
}

/** An instant in the workspace's timezone: `3 Nov 2026, 10:12`. */
export function formatDateTime(value: Date | string, timezone: string, locale = DISPLAY_LOCALE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(date);
}

/** The heading line of the overview: `Saturday, 14 November 2026`. */
export function formatLongDate(iso: string, locale = DISPLAY_LOCALE): string {
  if (!isIsoDate(iso)) return "";
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(utcDate(iso));
}

/**
 * How long ago something arrived, the way the design writes it:
 * `Just now`, `12 min ago`, `5 h ago`, `Yesterday`, `12 Nov`, `12 Nov 2025`.
 * Days are counted on the workspace's calendar, not in blocks of 24 hours.
 */
export function formatRelative(value: Date | string, now: Date, timezone: string, locale = DISPLAY_LOCALE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const day = todayIn(timezone, date);
  const today = todayIn(timezone, now);
  if (diffDays(day, today) === 1) return "Yesterday";
  return formatDate(day, day.slice(0, 4) === today.slice(0, 4) ? "short" : "medium", locale);
}

/** Hour of the day (0–23) in a timezone, for the greeting. */
export function hourIn(timezone: string, now: Date): number {
  const hour = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: timezone }).format(now);
  return Number(hour) % 24;
}

export function greeting(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/* ------------------------------------------------------------------- months */

export interface MonthBucket {
  /** `YYYY-MM`. */
  key: string;
  /** First and last day, inclusive. */
  from: string;
  to: string;
  /** `Nov` */
  short: string;
  /** `November` */
  long: string;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM` moved by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export function monthBucket(month: string, locale = DISPLAY_LOCALE): MonthBucket {
  const from = `${month}-01`;
  const to = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const date = utcDate(from);
  return {
    key: month,
    from,
    to,
    short: new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date),
    long: new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(date),
  };
}

/** The `count` months ending with the month of `today`, oldest first. */
export function lastMonths(today: string, count: number, locale = DISPLAY_LOCALE): MonthBucket[] {
  const current = today.slice(0, 7);
  return Array.from({ length: count }, (_, i) => monthBucket(shiftMonth(current, i - (count - 1)), locale));
}

/** `November 2026` */
export function monthTitle(month: string, locale = DISPLAY_LOCALE): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(utcDate(`${month}-01`));
}

export interface MonthGrid {
  from: string;
  to: string;
  /** Monday-first cells; `null` pads the first week. */
  cells: (string | null)[];
}

/** The days of a month laid out for a Monday-first calendar. */
export function monthGrid(month: string): MonthGrid {
  const { from, to } = monthBucket(month);
  const cells: (string | null)[] = Array.from({ length: isoWeekday(from) - 1 }, () => null);
  for (let day = from; day <= to; day = addDays(day, 1)) cells.push(day);
  return { from, to, cells };
}

/* -------------------------------------------------------------------- money */

/** Decimal places of a currency: 2 for USD, 0 for JPY, 3 for KWD. */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Reads an amount typed by staff (`120`, `120.5`, `1,200.50`) as integer
 * minor units. Returns null for anything that is not a non-negative amount
 * with at most the currency's decimal places.
 */
export function toMinorUnits(input: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const cleaned = input.replace(/[\s,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  if (fraction.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units as a plain decimal string for an input: `12050` → `120.50`. */
export function fromMinorUnits(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

/** Headline figure for a KPI card: `$41.6K`, `$950`. */
export function formatCompactMoney(minor: number, currency: string, locale = "en-US"): string {
  const amount = minor / 10 ** currencyDigits(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: "compact",
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.abs(amount) >= 1000 ? 1 : 0,
    }).format(amount);
  } catch {
    return String(Math.round(amount));
  }
}

export function formatCount(value: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Media storage for the usage meter: `0 MB`, `120 MB`, `1.5 GB`. */
export function formatStorage(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${Math.round((mb / 1024) * 10) / 10} GB`;
  return `${mb > 0 && mb < 1 ? "<1" : Math.round(mb)} MB`;
}

/* ------------------------------------------------------------------- trends */

export type TrendTone = "up" | "warn" | "neutral";

export interface Trend {
  text: string;
  tone: TrendTone;
}

/** Compares a figure with the previous period: `↑ 18% vs October`. */
export function trend(current: number, previous: number, versus: string): Trend {
  if (previous === 0) {
    return current === 0 ? { text: `None yet, as in ${versus}`, tone: "neutral" } : { text: `↑ from none in ${versus}`, tone: "up" };
  }
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent > 0) return { text: `↑ ${percent}% vs ${versus}`, tone: "up" };
  if (percent < 0) return { text: `↓ ${Math.abs(percent)}% vs ${versus}`, tone: "warn" };
  return { text: `Same as ${versus}`, tone: "neutral" };
}

export const TREND_CLASSES: Record<TrendTone, string> = {
  up: "text-xs font-semibold text-emerald-700 dark:text-emerald-400",
  warn: "text-xs font-semibold text-amber-700 dark:text-amber-400",
  neutral: "text-xs font-semibold text-muted-foreground",
};

/* -------------------------------------------------------------------- chart */

export interface ChartPoint {
  /** `Nov` */
  label: string;
  /** `November` */
  longLabel: string;
  requests: number;
  confirmed: number;
}

/** Bar height as a percentage of the plot. The tallest bar leaves a little headroom. */
export function barHeight(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(2, Math.round((value / (max * 1.08)) * 1000) / 10);
}

export function chartMax(points: ChartPoint[]): number {
  return points.reduce((max, point) => Math.max(max, point.requests, point.confirmed), 0);
}

/** One sentence for screen readers, standing in for the picture. */
export function chartSummary(points: ChartPoint[]): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "No bookings to chart yet.";
  if (chartMax(points) === 0) return `No bookings for tours between ${first.longLabel} and ${last.longLabel}.`;
  return `Booking requests went from ${first.requests} in ${first.longLabel} to ${last.requests} in ${last.longLabel}; confirmed bookings from ${first.confirmed} to ${last.confirmed}.`;
}

/* --------------------------------------------------------------------- lists */

/** `1 scheduling conflict needs` / `3 scheduling conflicts need` (your attention). */
export function clashHeadline(count: number): string {
  return `${count} scheduling ${count === 1 ? "conflict needs" : "conflicts need"} your attention`;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** `1–25 of 80`, `0 of 0`. */
export function pageSummary(page: number, pageSize: number, total: number): string {
  if (total === 0) return "0 of 0";
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return `${from}–${to} of ${formatCount(total)}`;
}

/* ---------------------------------------------------------------- URL params */

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a search parameter, trimmed; undefined when absent or blank. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}

/** A 1-based page number from the URL; anything else is page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const raw = firstParam(value);
  if (!raw || !/^\d{1,6}$/.test(raw)) return 1;
  return Math.max(1, Number(raw));
}

/** One of `allowed`, or undefined. Keeps hand-edited URLs from reaching a service as bad input. */
export function enumParam<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  const raw = firstParam(value);
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

export function dateParam(value: string | string[] | undefined): string | undefined {
  const raw = firstParam(value);
  return raw && isIsoDate(raw) ? raw : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuidParam(value: string | string[] | undefined): string | undefined {
  const raw = firstParam(value);
  return raw && UUID.test(raw) ? raw : undefined;
}

/**
 * Builds `path?query` from the parameters that are set. Empty strings,
 * undefined, null and false are left out, so default views get clean URLs.
 */
export function hrefWith(path: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === false || value === "") continue;
    query.set(key, value === true ? "1" : String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** Deep link to one booking's detail panel. */
export function bookingHref(id: string): string {
  return hrefWith("/workspace/bookings", { booking: id });
}

/** `mailto:` link with an encoded subject. */
export function mailtoLink(email: string, subject?: string): string {
  const address = encodeURIComponent(email).replace(/%40/g, "@");
  return subject ? `mailto:${address}?subject=${encodeURIComponent(subject)}` : `mailto:${address}`;
}

/** A dated file name for an export: `bookings-2026-11-14.csv`. */
export function exportFileName(kind: string, today: string): string {
  return `${kind}-${today}.csv`;
}
