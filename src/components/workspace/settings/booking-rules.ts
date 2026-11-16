/** Display helpers for the Booking rules tab. Limits mirror `bookingSettingsSchema`. */

export const BOOKING_LIMITS = {
  holdHours: { min: 1, max: 168 },
  horizonDays: { min: 7, max: 730 },
  minNoticeDays: { min: 0, max: 60 },
  /** At least one day of the week must stay open. */
  maxDaysOff: 6,
} as const;

/** ISO weekdays: 1 = Monday … 7 = Sunday. */
export const WEEKDAYS: readonly { value: number; short: string; long: string }[] = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
];

/** Adds or removes a day, keeping the list in week order. */
export function toggleWeekday(days: readonly number[], day: number): number[] {
  const next = days.includes(day) ? days.filter((value) => value !== day) : [...days, day];
  return [...new Set(next)].sort((a, b) => a - b);
}

/** "Saturday and Sunday", "Monday, Wednesday and Friday", or "None". */
export function describeDaysOff(days: readonly number[]): string {
  const names = WEEKDAYS.filter((day) => days.includes(day.value)).map((day) => day.long);
  if (names.length === 0) return "None";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Letters only, upper case, at most four: what the prefix field keeps as you type. */
export function cleanPrefix(raw: string): string {
  return raw.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 4);
}

/**
 * A sample reference in the same format bookings get: the prefix, the first
 * three letters of the tour's name, and a number. Null while the prefix is
 * not yet valid.
 */
export function referenceExample(prefix: string, tourLetters = "TOU", number = 4821): string | null {
  const clean = prefix.trim().toUpperCase();
  if (!/^[A-Z]{2,4}$/.test(clean)) return null;
  return `${clean}-${tourLetters}-${number}`;
}

/** "1 hour", "36 hours", "3 days" for whole days past 48 hours. */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "";
  if (hours > 48 && hours % 24 === 0) return `${hours / 24} days`;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** "1 day", "12 days", "about 3 months", "about 1 year". */
export function formatDays(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "";
  if (days === 0) return "the same day";
  if (days < 60) return days === 1 ? "1 day" : `${days} days`;
  if (days < 360) return `about ${Math.round(days / 30)} months`;
  const years = Math.round(days / 365);
  return years === 1 ? "about 1 year" : `about ${years} years`;
}

/** Hint under the hold field, following what is typed. */
export function holdText(hours: number): string {
  const text = formatHours(hours);
  return text ? `Seats stay reserved for ${text} while you decide.` : "How long seats stay reserved while you decide.";
}

/** Hint under the minimum notice field. */
export function noticeText(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "The earliest day someone can book, counted from today.";
  return days === 0 ? "People can book a tour for today." : `The earliest tour date is ${formatDays(days)} from today.`;
}

/** Hint under the booking window field. */
export function horizonText(days: number): string {
  const text = formatDays(days);
  return text ? `People can book ${text} ahead.` : "How far ahead people can book.";
}
