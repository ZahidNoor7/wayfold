/**
 * Calendar-date helpers. Dates without a time are `YYYY-MM-DD` strings
 * everywhere in Wayfold, which keeps them free of timezone drift.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toUtc(date: string): Date {
  if (!isIsoDate(date)) throw new RangeError(`Not a calendar date: ${date}`);
  return new Date(`${date}T00:00:00Z`);
}

/** Today's calendar date in an IANA timezone, e.g. `Asia/Baku`. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: string, days: number): string {
  const value = toUtc(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = toUtc(date).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Every date from `start` to `end` inclusive. */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let current = start; current <= end; current = addDays(current, 1)) out.push(current);
  return out;
}

/** True when the inclusive ranges [aStart, aEnd] and [bStart, bEnd] share a day. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Formats integer minor units, e.g. `formatMoney(69000, "USD")` → `$690`. */
export function formatMoney(minorUnits: number, currency: string, locale = "en-US"): string {
  const digits = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const amount = minorUnits / 10 ** digits;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(amount);
}
