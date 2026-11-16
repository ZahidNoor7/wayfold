/**
 * The tour editor's form model: what the form holds (text, exactly as typed),
 * how a stored tour becomes form values, how form values become the payload
 * the server expects, and where a server-side field error belongs on screen.
 * Pure functions only, so they can be tested without a browser.
 */
import { z } from "zod";
import type { MediaKind } from "@/lib/media-upload";

export type TourKind = "day" | "departure" | "private";
export type TourStatus = "draft" | "published" | "archived";

export interface TextRow {
  value: string;
}

export interface TourFormValues {
  title: string;
  slug: string;
  summary: string;
  description: string;
  categoryId: string;
  destinationId: string;
  place: string;
  kind: TourKind;
  durationDays: string;
  durationLabel: string;
  /** Decimal amount in the tenant currency, as typed ("1,250.50"). */
  priceAdult: string;
  childPricePercent: string;
  childMaxAge: string;
  minGroupSize: string;
  maxGroupSize: string;
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
  weekdays: number[];
  slots: { time: string; capacity: string }[];
  itinerary: { title: string; location: string; description: string; meta: string }[];
  highlights: TextRow[];
  inclusions: TextRow[];
  exclusions: TextRow[];
  goodToKnow: TextRow[];
  faq: { question: string; answer: string }[];
  languages: TextRow[];
  meetingPoint: string;
  meetingLatitude: string;
  meetingLongitude: string;
  cancellationPolicy: string;
  /** Gallery in display order; the first file is the cover. */
  media: { mediaId: string; url: string; alt: string; resourceType: MediaKind }[];
  isFeatured: boolean;
  isPopular: boolean;
}

/* ------------------------------------------------------------------ money */

/** Decimal places the currency is written with: 2 for USD, 0 for JPY. */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Minor units → what goes in the price box: `69000` USD → `"690"`, `69050` → `"690.50"`. */
export function minorToInput(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  if (digits === 0) return String(minor);
  const factor = 10 ** digits;
  const whole = Math.trunc(minor / factor);
  const fraction = Math.abs(minor % factor);
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(digits, "0")}`;
}

export type MoneyResult = { ok: true; minor: number } | { ok: false; message: string };

const MAX_PRICE_MINOR = 100_000_000;

/**
 * Reads a typed amount into minor units without floating-point drift.
 * Thousands separators and spaces are ignored; an empty box means 0.
 */
export function parseMoney(input: string, currency: string): MoneyResult {
  const digits = currencyDigits(currency);
  const cleaned = input.replace(/[\s,]/g, "");
  if (cleaned === "") return { ok: true, minor: 0 };
  if (cleaned.startsWith("-")) return { ok: false, message: "The price cannot be negative." };
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return { ok: false, message: "Enter the price as a number, for example 120 or 120.50." };
  const fraction = match[2] ?? "";
  if (fraction.length > digits) {
    return { ok: false, message: digits === 0 ? `${currency} prices have no decimals.` : `Use at most ${digits} decimal places.` };
  }
  const minor = Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  if (!Number.isSafeInteger(minor) || minor > MAX_PRICE_MINOR) return { ok: false, message: "That price is too high." };
  return { ok: true, minor };
}

/* ---------------------------------------------------------------- helpers */

const WHOLE = /^\d+$/;
const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** A whole number typed into a box, or null when it is not one. */
export function parseWhole(input: string): number | null {
  const cleaned = input.trim();
  return WHOLE.test(cleaned) ? Number(cleaned) : null;
}

/** A decimal coordinate typed into a box: null when empty, NaN when not a number. */
export function parseCoordinate(input: string): number | null {
  const cleaned = input.trim().replace(",", ".");
  if (cleaned === "") return null;
  return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

export const SLUG_MAX = 80;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The web address the server would derive from a title (same rules), for the live preview. */
export function slugFromTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** A copy of `list` with the item at `from` moved to `to`. Out-of-range moves change nothing. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list];
  if (from === to || from < 0 || to < 0 || from >= copy.length || to >= copy.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
}

const rows = (values: readonly string[]): TextRow[] => values.map((value) => ({ value }));
const lines = (list: readonly TextRow[]): string[] => list.map((row) => row.value.trim()).filter((value) => value !== "");

export const WEEKDAYS: { value: number; short: string; long: string }[] = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
];

export const KIND_OPTIONS: { value: TourKind; label: string; explanation: string }[] = [
  { value: "day", label: "Day tour", explanation: "Runs on set weekdays at fixed start times. Guests book seats on a time slot." },
  { value: "departure", label: "Scheduled departures", explanation: "Leaves on specific dates you add. Guests book seats on a departure." },
  { value: "private", label: "Private tour", explanation: "One group at a time, on any open date the guest asks for." },
];

/* ---------------------------------------------------------- stored → form */

/** The parts of a stored tour the form is built from. */
export interface StoredTour {
  title: string;
  slug: string;
  summary: string;
  description: string;
  categoryId: string | null;
  destinationId: string | null;
  place: string;
  kind: TourKind;
  durationDays: number;
  durationLabel: string;
  priceAdult: number;
  childPricePercent: number;
  childMaxAge: number;
  minGroupSize: number;
  maxGroupSize: number;
  schedule: { weekdays: number[]; slots: { time: string; capacity: number }[] };
  languages: string[];
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  goodToKnow: string[];
  faq: { question: string; answer: string }[];
  meetingPoint: string;
  meetingLatitude: number | null;
  meetingLongitude: number | null;
  cancellationPolicy: string;
  isFeatured: boolean;
  isPopular: boolean;
  itinerary: { title: string; location: string; description: string; meta: string }[];
  media: { mediaId: string; url: string; alt: string; resourceType: MediaKind }[];
}

/** A blank form: the same defaults the database gives a new tour. */
export function emptyTourValues(): TourFormValues {
  return {
    title: "",
    slug: "",
    summary: "",
    description: "",
    categoryId: "",
    destinationId: "",
    place: "",
    kind: "private",
    durationDays: "1",
    durationLabel: "",
    priceAdult: "",
    childPricePercent: "50",
    childMaxAge: "11",
    minGroupSize: "1",
    maxGroupSize: "8",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    slots: [],
    itinerary: [],
    highlights: [],
    inclusions: [],
    exclusions: [],
    goodToKnow: [],
    faq: [],
    languages: [],
    meetingPoint: "",
    meetingLatitude: "",
    meetingLongitude: "",
    cancellationPolicy: "",
    media: [],
    isFeatured: false,
    isPopular: false,
  };
}

export function tourToValues(tour: StoredTour, currency: string): TourFormValues {
  return {
    title: tour.title,
    slug: tour.slug,
    summary: tour.summary,
    description: tour.description,
    categoryId: tour.categoryId ?? "",
    destinationId: tour.destinationId ?? "",
    place: tour.place,
    kind: tour.kind,
    durationDays: String(tour.durationDays),
    durationLabel: tour.durationLabel,
    priceAdult: tour.priceAdult > 0 ? minorToInput(tour.priceAdult, currency) : "",
    childPricePercent: String(tour.childPricePercent),
    childMaxAge: String(tour.childMaxAge),
    minGroupSize: String(tour.minGroupSize),
    maxGroupSize: String(tour.maxGroupSize),
    weekdays: [...tour.schedule.weekdays].sort((a, b) => a - b),
    slots: tour.schedule.slots.map((slot) => ({ time: slot.time.slice(0, 5), capacity: String(slot.capacity) })),
    itinerary: tour.itinerary.map((day) => ({ title: day.title, location: day.location, description: day.description, meta: day.meta })),
    highlights: rows(tour.highlights),
    inclusions: rows(tour.inclusions),
    exclusions: rows(tour.exclusions),
    goodToKnow: rows(tour.goodToKnow),
    faq: tour.faq.map((item) => ({ question: item.question, answer: item.answer })),
    languages: rows(tour.languages),
    meetingPoint: tour.meetingPoint,
    meetingLatitude: tour.meetingLatitude === null ? "" : String(tour.meetingLatitude),
    meetingLongitude: tour.meetingLongitude === null ? "" : String(tour.meetingLongitude),
    cancellationPolicy: tour.cancellationPolicy,
    media: tour.media.map((item) => ({ mediaId: item.mediaId, url: item.url, alt: item.alt, resourceType: item.resourceType })),
    isFeatured: tour.isFeatured,
    isPopular: tour.isPopular,
  };
}

/* ------------------------------------------------------- client checks */

const whole = (min: number, max: number, message: string) =>
  z.string().refine((value) => {
    const parsed = parseWhole(value);
    return parsed !== null && parsed >= min && parsed <= max;
  }, message);

const textRow = z.object({ value: z.string().max(300, "Keep this under 300 characters.") });

const coordinate = (limit: number, name: string) =>
  z.string().refine((value) => {
    const parsed = parseCoordinate(value);
    return parsed === null || (!Number.isNaN(parsed) && Math.abs(parsed) <= limit);
  }, `${name} is a number between -${limit} and ${limit}.`);

/**
 * Immediate feedback only: is everything typed in a form the server could
 * read? What a tour needs before it can be published is the server's call,
 * so a half-finished draft passes here. The server validates again.
 */
export function tourFormSchema(currency: string, options: { requireSlug: boolean }) {
  return z
    .object({
      title: z.string().trim().min(3, "Add a title (3+ characters).").max(160, "Keep the title under 160 characters."),
      slug: z
        .string()
        .max(SLUG_MAX, `Keep the web address under ${SLUG_MAX} characters.`)
        .refine((value) => (value.trim() === "" ? !options.requireSlug : SLUG.test(value.trim())), options.requireSlug ? "Add a web address using lowercase letters, numbers and single hyphens." : "Use lowercase letters, numbers and single hyphens only."),
      summary: z.string().max(300, "Keep the summary under 300 characters."),
      description: z.string().max(20_000, "Keep the description under 20,000 characters."),
      categoryId: z.string(),
      destinationId: z.string(),
      place: z.string().max(160, "Keep this under 160 characters."),
      kind: z.enum(["day", "departure", "private"]),
      // Checked below, and only for the kinds that show the field.
      durationDays: z.string(),
      durationLabel: z.string().max(60, "Keep this under 60 characters."),
      priceAdult: z.string().superRefine((value, context) => {
        const parsed = parseMoney(value, currency);
        if (!parsed.ok) context.addIssue({ code: "custom", message: parsed.message });
      }),
      childPricePercent: whole(0, 100, "Use a percentage from 0 to 100."),
      childMaxAge: whole(0, 17, "Use an age from 0 to 17."),
      minGroupSize: whole(1, 99, "Use a group size from 1 to 99."),
      maxGroupSize: whole(1, 99, "Use a group size from 1 to 99."),
      weekdays: z.array(z.number()),
      // Checked below, and only for day tours: other kinds neither show nor send start times.
      slots: z.array(z.object({ time: z.string(), capacity: z.string() })),
      itinerary: z
        .array(
          z.object({
            title: z.string().trim().min(1, "Give each day a title.").max(160, "Keep day titles under 160 characters."),
            location: z.string().max(160, "Keep this under 160 characters."),
            description: z.string().max(5000, "Keep this under 5,000 characters."),
            meta: z.string().max(200, "Keep this under 200 characters."),
          }),
        )
        .max(60, "Keep the itinerary to 60 days."),
      highlights: z.array(textRow).max(60, "Keep this list to 60 lines."),
      inclusions: z.array(textRow).max(60, "Keep this list to 60 lines."),
      exclusions: z.array(textRow).max(60, "Keep this list to 60 lines."),
      goodToKnow: z.array(textRow).max(60, "Keep this list to 60 lines."),
      faq: z
        .array(
          z.object({
            question: z.string().trim().min(1, "Add the question.").max(300, "Keep the question under 300 characters."),
            answer: z.string().trim().min(1, "Add the answer.").max(2000, "Keep the answer under 2,000 characters."),
          }),
        )
        .max(40, "Keep this to 40 questions."),
      languages: z.array(z.object({ value: z.string().max(40, "Keep this under 40 characters.") })).max(20, "Keep this to 20 languages."),
      meetingPoint: z.string().max(300, "Keep this under 300 characters."),
      meetingLatitude: coordinate(90, "Latitude"),
      meetingLongitude: coordinate(180, "Longitude"),
      cancellationPolicy: z.string().max(5000, "Keep this under 5,000 characters."),
      media: z
        .array(z.object({ mediaId: z.string(), url: z.string(), alt: z.string(), resourceType: z.enum(["image", "video"]) }))
        .max(60, "A tour can show up to 60 files."),
      isFeatured: z.boolean(),
      isPopular: z.boolean(),
    })
    .superRefine((values, context) => {
      const min = parseWhole(values.minGroupSize);
      const max = parseWhole(values.maxGroupSize);
      if (min !== null && max !== null && min > max) {
        context.addIssue({ code: "custom", path: ["maxGroupSize"], message: "The largest group cannot be smaller than the smallest group." });
      }
      if ((values.meetingLatitude.trim() === "") !== (values.meetingLongitude.trim() === "")) {
        context.addIssue({
          code: "custom",
          path: [values.meetingLatitude.trim() === "" ? "meetingLatitude" : "meetingLongitude"],
          message: "Give both a latitude and a longitude, or neither.",
        });
      }
      if (values.kind === "day") {
        if (values.slots.length > 24) context.addIssue({ code: "custom", path: ["slots"], message: "Keep this to 24 start times." });
        const seen = new Set<string>();
        values.slots.forEach((slot, index) => {
          const capacity = parseWhole(slot.capacity);
          if (!HH_MM.test(slot.time)) context.addIssue({ code: "custom", path: ["slots", index, "time"], message: "Choose a start time." });
          else if (seen.has(slot.time)) context.addIssue({ code: "custom", path: ["slots", index, "time"], message: "Each start time can only be listed once." });
          if (capacity === null || capacity < 1 || capacity > 999) context.addIssue({ code: "custom", path: ["slots", index, "capacity"], message: "Use 1 to 999 seats." });
          seen.add(slot.time);
        });
      } else {
        const days = parseWhole(values.durationDays);
        if (days === null || days < 1 || days > 365) context.addIssue({ code: "custom", path: ["durationDays"], message: "Use a whole number of days from 1 to 365." });
      }
    });
}

/* ----------------------------------------------------------- form → wire */

export interface TourPayload {
  tour: Record<string, unknown>;
  itinerary: { dayNumber: number; title: string; location: string; description: string; meta: string }[];
  mediaIds: string[];
}

/**
 * Turns checked form values into what `saveTourAction` sends. The price
 * becomes minor units, numbers become numbers, blank rows are dropped, and a
 * day tour is always one day long with its slots; other kinds have none.
 * `slug` is left out when blank so the server picks a free one from the title.
 */
export function valuesToPayload(values: TourFormValues, currency: string): TourPayload {
  const money = parseMoney(values.priceAdult, currency);
  const isDay = values.kind === "day";
  const slug = values.slug.trim();

  return {
    tour: {
      title: values.title.trim(),
      ...(slug ? { slug } : {}),
      summary: values.summary.trim(),
      description: values.description.trim(),
      categoryId: values.categoryId || null,
      destinationId: values.destinationId || null,
      place: values.place.trim(),
      kind: values.kind,
      durationDays: isDay ? 1 : (parseWhole(values.durationDays) ?? 1),
      durationLabel: values.durationLabel.trim(),
      priceAdult: money.ok ? money.minor : 0,
      childPricePercent: parseWhole(values.childPricePercent) ?? 50,
      childMaxAge: parseWhole(values.childMaxAge) ?? 11,
      minGroupSize: parseWhole(values.minGroupSize) ?? 1,
      maxGroupSize: parseWhole(values.maxGroupSize) ?? 8,
      schedule: {
        weekdays: [...new Set(values.weekdays)].sort((a, b) => a - b),
        slots: isDay ? values.slots.map((slot) => ({ time: slot.time, capacity: parseWhole(slot.capacity) ?? 1 })) : [],
      },
      languages: [...new Set(lines(values.languages))],
      highlights: lines(values.highlights),
      inclusions: lines(values.inclusions),
      exclusions: lines(values.exclusions),
      goodToKnow: lines(values.goodToKnow),
      faq: values.faq.map((item) => ({ question: item.question.trim(), answer: item.answer.trim() })),
      meetingPoint: values.meetingPoint.trim(),
      meetingLatitude: parseCoordinate(values.meetingLatitude),
      meetingLongitude: parseCoordinate(values.meetingLongitude),
      cancellationPolicy: values.cancellationPolicy.trim(),
      isFeatured: values.isFeatured,
      isPopular: values.isPopular,
    },
    itinerary: values.itinerary.map((day, index) => ({
      dayNumber: index + 1,
      title: day.title.trim(),
      location: day.location.trim(),
      description: day.description.trim(),
      meta: day.meta.trim(),
    })),
    mediaIds: values.media.map((item) => item.mediaId),
  };
}

/* ------------------------------------------------------ errors → sections */

export type SectionId = "basics" | "pricing" | "schedule" | "departures" | "blocks" | "itinerary" | "details" | "media" | "visibility";

export const SECTION_LABELS: Record<SectionId, string> = {
  basics: "Basics",
  pricing: "Pricing & group",
  schedule: "Schedule",
  departures: "Departures",
  blocks: "Availability blocks",
  itinerary: "Itinerary",
  details: "Details",
  media: "Media",
  visibility: "Visibility",
};

/** Sections in page order for a tour of this kind. Departures only exist for departure tours. */
export function sectionsFor(kind: TourKind, options: { saved: boolean }): SectionId[] {
  const all: SectionId[] = ["basics", "pricing", "schedule", "departures", "blocks", "itinerary", "details", "media", "visibility"];
  return all.filter((section) => {
    if (section === "departures") return kind === "departure";
    if (section === "blocks") return options.saved;
    return true;
  });
}

/** Server and form field names → the section that shows the field, and what to call it. */
const FIELD_HOME: Record<string, { section: SectionId; label: string }> = {
  title: { section: "basics", label: "Title" },
  slug: { section: "basics", label: "Web address" },
  summary: { section: "basics", label: "Summary" },
  description: { section: "basics", label: "Description" },
  categoryId: { section: "basics", label: "Category" },
  destinationId: { section: "basics", label: "Destination" },
  place: { section: "basics", label: "Place" },
  kind: { section: "basics", label: "How it is sold" },
  durationDays: { section: "basics", label: "Length in days" },
  durationLabel: { section: "basics", label: "Duration" },
  priceAdult: { section: "pricing", label: "Adult price" },
  childPricePercent: { section: "pricing", label: "Child price" },
  childMaxAge: { section: "pricing", label: "Child age limit" },
  minGroupSize: { section: "pricing", label: "Smallest group" },
  maxGroupSize: { section: "pricing", label: "Largest group" },
  schedule: { section: "schedule", label: "Schedule" },
  weekdays: { section: "schedule", label: "Days of the week" },
  slots: { section: "schedule", label: "Start times" },
  departures: { section: "departures", label: "Departure dates" },
  days: { section: "itinerary", label: "Itinerary" },
  itinerary: { section: "itinerary", label: "Itinerary" },
  highlights: { section: "details", label: "Highlights" },
  inclusions: { section: "details", label: "Included" },
  exclusions: { section: "details", label: "Not included" },
  goodToKnow: { section: "details", label: "Good to know" },
  faq: { section: "details", label: "Questions and answers" },
  languages: { section: "details", label: "Languages" },
  meetingPoint: { section: "details", label: "Meeting point" },
  meetingLatitude: { section: "details", label: "Latitude" },
  meetingLongitude: { section: "details", label: "Longitude" },
  cancellationPolicy: { section: "details", label: "Cancellation policy" },
  mediaIds: { section: "media", label: "Photos and videos" },
  media: { section: "media", label: "Photos and videos" },
  coverMediaId: { section: "media", label: "Cover image" },
  isFeatured: { section: "visibility", label: "Featured" },
  isPopular: { section: "visibility", label: "Popular badge" },
};

export interface LocatedError {
  field: string;
  section: SectionId;
  label: string;
  message: string;
}

/** A field name or path (`"slots.0.time"`) → where it lives. Unknown fields land in Basics. */
export function locateField(field: string): { section: SectionId; label: string } {
  const root = field.split(".")[0] ?? field;
  return FIELD_HOME[root] ?? { section: "basics", label: "This tour" };
}

/**
 * Field errors from the server (save or publish) as a list for the summary
 * at the top of the form: one line per message, each with its section.
 */
export function locateErrors(fieldErrors: Record<string, string[] | undefined> | undefined): LocatedError[] {
  if (!fieldErrors) return [];
  const order = Object.keys(SECTION_LABELS);
  return Object.entries(fieldErrors)
    .flatMap(([field, messages]) => (messages ?? []).map((message) => ({ field, ...locateField(field), message })))
    .sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
}

/** Leaf error messages of a React Hook Form `errors` object, as `{ path: message }`. */
export function flattenFormErrors(errors: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (!errors || typeof errors !== "object") return out;
  for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    // `root` holds array-level messages; report them under the array itself.
    const path = key === "root" ? prefix : prefix ? `${prefix}.${key}` : key;
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message) out[path] ??= message;
    else Object.assign(out, flattenFormErrors(value, path));
  }
  return out;
}

/* ------------------------------------------------------------------ dates */

/**
 * A `YYYY-MM-DD` calendar date for reading: "Mon, 10 May 2027". Formatted in
 * UTC on purpose: the string already is the day in the workspace's timezone,
 * and converting it again could move it to the day before or after.
 */
export function formatCalendarDate(date: string, options: { weekday?: boolean } = {}): string {
  const value = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) return date;
  return new Intl.DateTimeFormat("en-GB", {
    ...(options.weekday === false ? {} : { weekday: "short" }),
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

/** "10 May 2027" for one day, "10 May 2027 – 14 May 2027" for a range. */
export function formatDateRange(start: string, end: string): string {
  const from = formatCalendarDate(start, { weekday: false });
  return start === end ? from : `${from} – ${formatCalendarDate(end, { weekday: false })}`;
}

/* -------------------------------------------------------------- departures */

export interface DepartureDay {
  state: "open" | "limited" | "full" | "hold" | "closed" | "past";
  reason: string | null;
  seatsLeft: number;
  capacity: number | null;
}

export interface DepartureSeats {
  taken: number;
  left: number;
  status: "open" | "limited" | "full" | "closed" | "past" | "blocked" | "outside";
  label: string;
}

/**
 * Seats and bookability of one departure. Seat counts come from the live
 * availability calendar when it covers the date (it knows which holds have
 * lapsed); otherwise from the departure's own booking count.
 */
export function departureSeats(
  departure: { startDate: string; capacity: number; isOpen: boolean; seatsBooked: number },
  day: DepartureDay | undefined,
  today: string,
): DepartureSeats {
  const live = day && day.capacity !== null && (day.state === "open" || day.state === "limited" || day.state === "full");
  const taken = live ? Math.max(0, (day.capacity as number) - day.seatsLeft) : departure.seatsBooked;
  const left = Math.max(0, departure.capacity - taken);

  if (departure.startDate < today) return { taken, left, status: "past", label: "Departed" };
  if (!departure.isOpen) return { taken, left, status: "closed", label: "Closed to new bookings" };
  if (day?.reason === "blocked") return { taken, left, status: "blocked", label: "Blocked by a closure" };
  if (day?.reason === "day_off") return { taken, left, status: "blocked", label: "Falls on a weekly day off" };
  if (day?.reason === "min_notice") return { taken, left, status: "outside", label: "Too soon to book online" };
  if (day?.reason === "beyond_horizon") return { taken, left, status: "outside", label: "Not open for booking yet" };
  if (left === 0) return { taken, left, status: "full", label: "Full" };
  if (left <= 3) return { taken, left, status: "limited", label: `${left} ${left === 1 ? "seat" : "seats"} left` };
  return { taken, left, status: "open", label: "Open" };
}
