/**
 * Display and form logic for the storefront's conversion path: the live price
 * on the tour page, the booking request wizard, the offers page. Everything
 * here is a preview for the visitor. Prices, discounts, availability and every
 * validation rule are decided again on the server when a request is sent, so
 * nothing computed in the browser is ever trusted.
 */
import { z } from "zod";
import { formatDate } from "./calendar";
import { diffDays, formatMoney, isIsoDate } from "./dates";

/* ------------------------------------------------------------------ types */

export type TourKind = "day" | "departure" | "private";
export type DiscountType = "percent" | "fixed";
export type DayState = "open" | "limited" | "full" | "hold" | "closed" | "past";
export type ContactMethod = "whatsapp" | "email" | "phone";

/** One slot of a day tour, as the availability endpoint returns it. */
export interface SlotInfo {
  time: string;
  capacity: number;
  seatsLeft: number;
  state: "open" | "limited" | "full";
}

/** One start date, as the availability endpoint returns it. */
export interface DayInfo {
  date: string;
  endDate: string;
  state: DayState;
  reason: string | null;
  seatsLeft: number;
  capacity: number | null;
  slots: SlotInfo[] | null;
}

export interface Party {
  adults: number;
  children: number;
}

export interface TourPricing {
  /** Adult list price, minor units. */
  priceAdult: number;
  /** Child price as a percentage of the adult price (0–100). */
  childPricePercent: number;
}

/* ---------------------------------------------------------------- pricing */

const count = (value: number) => (Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0);

export interface PartyPrice {
  unitPriceAdult: number;
  unitPriceChild: number;
  adultsTotal: number;
  childrenTotal: number;
  baseAmount: number;
}

/**
 * Mirror of the server's `priceBooking`: the child unit price is rounded
 * half-up once and then multiplied, so the total equals the sum of the unit
 * prices on screen. Bad input prices as zero rather than throwing in a render.
 */
export function priceParty(pricing: TourPricing, party: Party): PartyPrice {
  const unitPriceAdult = count(pricing.priceAdult);
  const percent = Number.isFinite(pricing.childPricePercent) ? Math.min(100, Math.max(0, pricing.childPricePercent)) : 0;
  const unitPriceChild = Math.round((unitPriceAdult * percent) / 100);
  const adultsTotal = count(party.adults) * unitPriceAdult;
  const childrenTotal = count(party.children) * unitPriceChild;
  return { unitPriceAdult, unitPriceChild, adultsTotal, childrenTotal, baseAmount: adultsTotal + childrenTotal };
}

/**
 * Mirror of the promotion engine: a percentage is rounded to a whole minor
 * unit; a fixed amount applies once per booking and never exceeds the price.
 */
export function discountAmount(type: DiscountType, value: number, base: number): number {
  if (!(base > 0) || !(value > 0)) return 0;
  return Math.min(base, type === "percent" ? Math.round((base * value) / 100) : value);
}

export interface OfferRef {
  id: string;
  name: string;
  type: DiscountType;
  value: number;
  endsOn: string;
}

export interface PartyQuote extends PartyPrice {
  discountAmount: number;
  totalAmount: number;
}

/** Price of a party with one discount taken off the whole booking. */
export function quoteParty(pricing: TourPricing, party: Party, offer: Pick<OfferRef, "type" | "value"> | null): PartyQuote {
  const price = priceParty(pricing, party);
  const off = offer ? discountAmount(offer.type, offer.value, price.baseAmount) : 0;
  return { ...price, discountAmount: off, totalAmount: price.baseAmount - off };
}

/** `15% off` or `$300 off`. Same wording as the server's discount labels. */
export function discountLabel(type: DiscountType, value: number, currency: string): string {
  return type === "percent" ? `${value}% off` : `${formatMoney(value, currency)} off`;
}

/** The short tag beside a "from" price: `−15%`, or `$300 off per booking` for a fixed amount. */
export function offerBadge(type: DiscountType, value: number, currency: string): string {
  return type === "percent" ? `−${value}%` : `${formatMoney(value, currency)} off per booking`;
}

/** The large figure on an offer card: `15%` or `$300`. */
export function offerValue(type: DiscountType, value: number, currency: string): string {
  return type === "percent" ? `${value}%` : formatMoney(value, currency);
}

export interface FromPrice {
  /** What one adult pays, minor units. */
  now: number;
  /** The list price to strike through, or null when the list price stands. */
  original: number | null;
}

/**
 * The per-adult "from" price. Only a percentage offer changes it: a fixed
 * amount comes off the booking once, so it is never shown as a per-person price.
 */
export function fromPrice(priceAdult: number, offer: Pick<OfferRef, "type" | "value"> | null): FromPrice {
  if (!offer || offer.type !== "percent") return { now: priceAdult, original: null };
  const off = discountAmount("percent", offer.value, priceAdult);
  return off > 0 ? { now: priceAdult - off, original: priceAdult } : { now: priceAdult, original: null };
}

/** What the server says a party pays, once it has looked for discounts. */
export interface ServerQuote extends PartyQuote {
  currency: string;
  discount: { source: "campaign" | "personal" | "request"; label: string } | null;
  /** Other discounts that matched and lost to the one applied. */
  otherMatches: number;
}

const SOURCE_LABELS: Record<NonNullable<ServerQuote["discount"]>["source"], string> = {
  campaign: "Offer",
  personal: "Personal discount",
  request: "Approved request",
};

export function discountSourceLabel(source: NonNullable<ServerQuote["discount"]>["source"]): string {
  return SOURCE_LABELS[source];
}

/** The engine labels a discount "Name — 15% off"; screens show the two halves apart. */
export function splitDiscountLabel(label: string): { name: string; value: string } {
  const at = label.lastIndexOf(" — ");
  return at === -1 ? { name: label, value: "" } : { name: label.slice(0, at), value: label.slice(at + 3) };
}

export function otherMatchesNote(others: number): string | null {
  if (!(others > 0)) return null;
  return `${others} other offer${others === 1 ? "" : "s"} also matched — discounts don’t combine, so the best one is applied.`;
}

/* ------------------------------------------------------------------ party */

export interface PartyLimits {
  minGuests: number;
  maxGuests: number;
}

/** Guest limits of a tour, tolerant of a tour saved with a minimum above its maximum. */
export function partyLimits(tour: { minGroupSize: number; maxGroupSize: number }): PartyLimits {
  const maxGuests = Math.max(1, count(tour.maxGroupSize));
  const minGuests = Math.min(maxGuests, Math.max(1, count(tour.minGroupSize)));
  return { minGuests, maxGuests };
}

/** Pulls a party inside the limits: at least one adult, never above the maximum, topped up to the minimum with adults. */
export function clampParty(party: Party, limits: PartyLimits): Party {
  let adults = Math.min(limits.maxGuests, Math.max(1, count(party.adults)));
  const children = Math.min(limits.maxGuests - adults, count(party.children));
  if (adults + children < limits.minGuests) adults = limits.minGuests - children;
  return { adults, children };
}

/** Two adults when the tour allows it, otherwise the nearest allowed party. */
export function defaultParty(limits: PartyLimits): Party {
  return clampParty({ adults: 2, children: 0 }, limits);
}

export interface StepperState {
  canAddAdult: boolean;
  canRemoveAdult: boolean;
  canAddChild: boolean;
  canRemoveChild: boolean;
}

export function stepperState(party: Party, limits: PartyLimits): StepperState {
  const total = party.adults + party.children;
  return {
    canAddAdult: total < limits.maxGuests,
    canRemoveAdult: party.adults > 1 && total > limits.minGuests,
    canAddChild: total < limits.maxGuests,
    canRemoveChild: party.children > 0 && total > limits.minGuests,
  };
}

/** Applies one press of a stepper button; a press that would break a limit changes nothing. */
export function stepParty(party: Party, field: keyof Party, delta: 1 | -1, limits: PartyLimits): Party {
  const state = stepperState(party, limits);
  const allowed =
    field === "adults" ? (delta === 1 ? state.canAddAdult : state.canRemoveAdult) : delta === 1 ? state.canAddChild : state.canRemoveChild;
  return allowed ? { ...party, [field]: party[field] + delta } : party;
}

export function guestRange(limits: PartyLimits): string {
  if (limits.minGuests === limits.maxGuests) return `${limits.maxGuests} guest${limits.maxGuests === 1 ? "" : "s"}`;
  return `${limits.minGuests} – ${limits.maxGuests} guests`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 adults, 1 child". Children are left out when there are none. */
export function partySummary(party: Party): string {
  const adults = plural(party.adults, "adult", "adults");
  return party.children > 0 ? `${adults}, ${plural(party.children, "child", "children")}` : adults;
}

export function childNote(childMaxAge: number, childPricePercent: number, unitPriceChild: number, currency: string): string {
  const age = childMaxAge > 0 ? `Aged ${childMaxAge} or under` : "Children";
  if (childPricePercent >= 100) return `${age} · same price`;
  if (childPricePercent <= 0) return `${age} · free`;
  return `${age} · ${formatMoney(unitPriceChild, currency)}`;
}

/* ----------------------------------------------------------- availability */

export function isBookable(state: DayState | undefined): boolean {
  return state === "open" || state === "limited";
}

/** How a date's state is announced; never by colour alone. */
export const STATE_LABELS: Record<DayState, string> = {
  open: "available",
  limited: "few spots left",
  full: "fully booked",
  hold: "on hold",
  closed: "not available",
  past: "not available",
};

/** The small caption inside a calendar cell. */
export function cellCaption(day: Pick<DayInfo, "state" | "seatsLeft" | "capacity">): string | null {
  const counted = day.capacity !== null && day.capacity > 1;
  switch (day.state) {
    case "open":
      return counted ? `${day.seatsLeft} left` : "Free";
    case "limited":
      return counted ? `${day.seatsLeft} left` : "Few left";
    case "full":
      return "Booked";
    case "hold":
      return "On hold";
    default:
      return null;
  }
}

/** Why a date cannot be chosen, in the visitor's words. */
export function reasonText(day: Pick<DayInfo, "state" | "reason" | "capacity">, kind: TourKind): string {
  switch (day.reason) {
    case "past":
      return "This date has passed.";
    case "min_notice":
      return "This date is too close to book online. Contact us and we will see what is possible.";
    case "beyond_horizon":
      return "Dates this far ahead are not open for booking yet.";
    case "day_off":
      return "Nothing runs on this day of the week.";
    case "blocked":
      return "We are not running tours on this date.";
    case "not_scheduled":
      return "This tour does not run on this day of the week.";
    case "no_departure":
      return "There is no scheduled departure on this date.";
    case "departure_closed":
      return "This departure is closed for booking.";
    case "sold_out":
      return kind === "day" ? "Every start time is fully booked." : day.capacity ? `All ${day.capacity} seats are booked.` : "Every seat is booked.";
    case "booked":
      return "Already booked by another guest.";
    case "on_hold":
      return "On hold for another guest’s pending request. It may open again if that request is not confirmed.";
    default:
      return day.state === "full" ? "This date is fully booked." : "This date is not available.";
  }
}

export function unavailableTitle(dateLabel: string, state: DayState): string {
  if (state === "full") return `${dateLabel} is fully booked`;
  if (state === "hold") return `${dateLabel} is on hold`;
  return `${dateLabel} isn’t available`;
}

export type Tone = "good" | "warn" | "bad" | "muted";

/** The seat line under a selected date. */
export function seatLine(day: DayInfo, kind: TourKind): { text: string; tone: Tone } {
  if (kind === "private") return { text: "Exclusively yours — no other guests", tone: "good" };
  if (kind === "day") {
    const open = (day.slots ?? []).filter((slot) => slot.seatsLeft > 0).length;
    return {
      text: `${plural(day.seatsLeft, "seat", "seats")} left across ${plural(open, "start time", "start times")}`,
      tone: day.state === "limited" ? "warn" : "good",
    };
  }
  const of = day.capacity ? ` of ${day.capacity}` : "";
  return { text: `${day.seatsLeft}${of} ${day.seatsLeft === 1 ? "seat" : "seats"} left`, tone: day.state === "limited" ? "warn" : "good" };
}

/** Status text of one start time for a party of `guests`. */
export function slotStatus(slot: SlotInfo, guests: number): { text: string; tone: Tone; full: boolean } {
  if (slot.seatsLeft <= 0) return { text: "Fully booked", tone: "bad", full: true };
  const fits = guests <= slot.seatsLeft;
  const base = `${slot.seatsLeft} of ${slot.capacity} seats left`;
  return {
    text: fits ? base : `${base} · too few for your group`,
    tone: !fits || slot.state === "limited" ? "warn" : "muted",
    full: false,
  };
}

/** "5 dates available · 3 booked or on hold in November 2026." */
export function monthSummary(days: readonly Pick<DayInfo, "state">[], monthLabel: string): string {
  const available = days.filter((day) => isBookable(day.state)).length;
  const taken = days.filter((day) => day.state === "full" || day.state === "hold").length;
  const head = available === 0 ? "No dates available" : `${plural(available, "date", "dates")} available`;
  return `${head}${taken > 0 ? ` · ${taken} booked or on hold` : ""} in ${monthLabel}.`;
}

/** Hint under the month summary, by how the tour is sold. */
export function calendarHint(kind: TourKind, durationDays: number): string {
  if (kind === "departure") return "This tour runs on scheduled departures only — marked dates are departures.";
  if (kind === "private") {
    return durationDays > 1 ? `Each date is the start of your private ${durationDays}-day tour.` : "Each date is yours alone: one party per day.";
  }
  return "Pick an available date, then choose a start time.";
}

/** Bookable dates strictly after `after`, in order. `days` must be sorted by date. */
export function nextAvailable(days: readonly Pick<DayInfo, "date" | "state">[], after: string, limit: number, exclude?: string): string[] {
  const found: string[] = [];
  for (const day of days) {
    if (found.length >= limit) break;
    if (day.date > after && day.date !== exclude && isBookable(day.state)) found.push(day.date);
  }
  return found;
}

/* ------------------------------------------------------------- the draft */

export interface BookingDraft {
  /** Tour slug. */
  tour: string;
  date: string;
  /** `HH:MM`, day tours only. */
  slot: string;
  /** Optional back-up date. */
  alt: string;
  adults: number;
  children: number;
  name: string;
  email: string;
  phoneCode: string;
  phone: string;
  country: string;
  language: string;
  pickup: string;
  contactMethod: ContactMethod;
  notes: string;
  agree: boolean;
}

export const CONTACT_METHODS: ReadonlyArray<{ value: ContactMethod; label: string }> = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone call" },
];

export function contactMethodLabel(method: ContactMethod): string {
  return CONTACT_METHODS.find((entry) => entry.value === method)?.label ?? "Email";
}

export function emptyDraft(tour: string, party: Party): BookingDraft {
  return {
    tour,
    date: "",
    slot: "",
    alt: "",
    adults: party.adults,
    children: party.children,
    name: "",
    email: "",
    phoneCode: "",
    phone: "",
    country: "",
    language: "",
    pickup: "",
    contactMethod: "whatsapp",
    notes: "",
    agree: false,
  };
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLOT = /^([01]\d|2[0-3]):[0-5]\d$/;

type Query = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? "")).trim();

function wholeNumber(raw: string, min: number, max: number): number | undefined {
  if (!/^\d{1,3}$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= min && value <= max ? value : undefined;
}

export type DraftPrefill = Partial<Pick<BookingDraft, "tour" | "date" | "slot" | "adults" | "children">>;

/**
 * Reads the hand-over from the tour page out of the query string. Anything
 * malformed is dropped; nothing here is trusted beyond pre-filling the form.
 */
export function prefillFromQuery(query: Query): DraftPrefill {
  const prefill: DraftPrefill = {};
  const tour = first(query.tour).toLowerCase();
  if (tour.length <= 200 && SLUG.test(tour)) prefill.tour = tour;
  const date = first(query.date);
  if (isIsoDate(date)) prefill.date = date;
  const slot = first(query.slot);
  if (prefill.date && SLOT.test(slot)) prefill.slot = slot;
  const adults = wholeNumber(first(query.adults), 1, 100);
  if (adults !== undefined) prefill.adults = adults;
  const children = wholeNumber(first(query.children), 0, 100);
  if (children !== undefined) prefill.children = children;
  return prefill;
}

/** Link to the booking form carrying a selection. Only tour, date, slot and party: never personal data. */
export function bookHref(selection: { tour: string; date?: string; slot?: string; adults?: number; children?: number }): string {
  const params = new URLSearchParams({ tour: selection.tour });
  if (selection.date) params.set("date", selection.date);
  if (selection.date && selection.slot) params.set("slot", selection.slot);
  if (selection.adults !== undefined) params.set("adults", String(selection.adults));
  if (selection.children !== undefined && selection.children > 0) params.set("children", String(selection.children));
  return `/book?${params.toString()}`;
}

export const DRAFT_STORAGE_KEY = "wayfold.booking-draft.v1";

const storedDraftSchema = z.object({
  step: z.number().int().min(1).max(3),
  draft: z.object({
    tour: z.string().max(200),
    date: z.string().max(10),
    slot: z.string().max(5),
    alt: z.string().max(10),
    adults: z.number().int().min(1).max(100),
    children: z.number().int().min(0).max(100),
    name: z.string().max(120),
    email: z.string().max(254),
    phoneCode: z.string().max(6),
    phone: z.string().max(40),
    country: z.string().max(80),
    language: z.string().max(40),
    pickup: z.string().max(200),
    contactMethod: z.enum(["whatsapp", "email", "phone"]),
    notes: z.string().max(2000),
    agree: z.boolean(),
  }),
});

export function serialiseDraft(draft: BookingDraft, step: number): string {
  return JSON.stringify({ step: Math.min(3, Math.max(1, Math.trunc(step))), draft });
}

/** Reads a stored draft back. Anything that is not exactly a draft is ignored. */
export function parseStoredDraft(raw: string | null | undefined): { draft: BookingDraft; step: number } | null {
  if (!raw) return null;
  try {
    const parsed = storedDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const { draft } = parsed.data;
    return {
      step: parsed.data.step,
      draft: { ...draft, date: isIsoDate(draft.date) ? draft.date : "", slot: SLOT.test(draft.slot) ? draft.slot : "", alt: isIsoDate(draft.alt) ? draft.alt : "" },
    };
  } catch {
    return null;
  }
}

/**
 * The draft a visitor starts from: what they typed before (this tab), with a
 * fresh hand-over from the tour page on top. A hand-over for a different tour
 * or date starts the date step again, but keeps their contact details.
 */
export function restoreDraft(
  base: BookingDraft,
  stored: { draft: BookingDraft; step: number } | null,
  prefill: DraftPrefill,
  knownTours: readonly string[],
): { draft: BookingDraft; step: number } {
  let draft = stored ? { ...base, ...stored.draft } : base;
  let step = stored?.step ?? 1;
  if (!knownTours.includes(draft.tour)) {
    draft = { ...draft, tour: base.tour, date: "", slot: "", alt: "" };
    step = 1;
  }
  const tour = prefill.tour && knownTours.includes(prefill.tour) ? prefill.tour : undefined;
  if (Object.keys(prefill).length > 0) {
    const tourChanged = tour !== undefined && tour !== draft.tour;
    draft = {
      ...draft,
      tour: tour ?? draft.tour,
      date: prefill.date ?? (tourChanged ? "" : draft.date),
      slot: prefill.date ? (prefill.slot ?? "") : tourChanged ? "" : draft.slot,
      alt: tourChanged || prefill.date ? "" : draft.alt,
      adults: prefill.adults ?? draft.adults,
      children: prefill.children ?? draft.children,
    };
    step = 1;
  }
  return { draft, step };
}

/** What changing the tour resets: the date, the time and the back-up date; everything else stays. */
export function withTour(draft: BookingDraft, tour: string, party: Party): BookingDraft {
  return { ...draft, tour, date: "", slot: "", alt: "", adults: party.adults, children: party.children };
}

/** After "just booked by someone else": the date and time go, everything else is kept. */
export function releaseSelection(draft: BookingDraft): BookingDraft {
  return { ...draft, date: "", slot: "" };
}

export function fullPhone(draft: Pick<BookingDraft, "phoneCode" | "phone">): string {
  return [draft.phoneCode.trim(), draft.phone.trim()].filter(Boolean).join(" ");
}

/** The request body. It carries no price, discount or tenant: the server decides those. */
export function toBookingPayload(draft: BookingDraft, kind: TourKind) {
  return {
    tourSlug: draft.tour,
    date: draft.date,
    slotTime: kind === "day" && draft.slot ? draft.slot : null,
    alternativeDate: draft.alt || null,
    adults: draft.adults,
    children: draft.children,
    name: draft.name.trim(),
    email: draft.email.trim(),
    phone: fullPhone(draft),
    country: draft.country,
    language: draft.language,
    pickup: draft.pickup.trim(),
    contactMethod: draft.contactMethod,
    notes: draft.notes.trim(),
    agree: draft.agree,
  };
}

/* ------------------------------------------------------------- validation */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

const seats = (n: number) => `${n} seat${n === 1 ? "" : "s"}`;

export type DateStepErrors = Partial<Record<"date" | "slot" | "seats", string>>;

/**
 * Step 1: a bookable date, a start time for day tours, and a party that fits.
 * `day` is the live availability of the chosen date, when it is known.
 */
export function validateDateStep(draft: BookingDraft, kind: TourKind, day: DayInfo | undefined, limits: PartyLimits): DateStepErrors {
  const errors: DateStepErrors = {};
  const guests = draft.adults + draft.children;

  if (guests < limits.minGuests) errors.seats = `This tour needs at least ${limits.minGuests} guests.`;
  else if (guests > limits.maxGuests) errors.seats = `This tour takes up to ${limits.maxGuests} guests per booking.`;

  if (!draft.date) {
    errors.date = "Choose an available date in the calendar.";
    return errors;
  }
  if (!day || !isBookable(day.state)) {
    errors.date = "That date is no longer available — please choose another.";
    return errors;
  }

  if (kind === "day") {
    const slot = (day.slots ?? []).find((candidate) => candidate.time === draft.slot);
    if (!draft.slot || !slot) errors.slot = "Choose a start time.";
    else if (slot.seatsLeft <= 0) errors.slot = "That time is fully booked — choose another.";
    else if (guests > slot.seatsLeft && !errors.seats) {
      errors.seats = `Only ${seats(slot.seatsLeft)} left at ${slot.time} — reduce your group or pick another time.`;
    }
  } else if (kind === "departure" && guests > day.seatsLeft && !errors.seats) {
    errors.seats = `Only ${seats(day.seatsLeft)} left on this departure — reduce your group or pick another date.`;
  }
  return errors;
}

/** A softer warning for the tour page, where the visitor has not committed yet. */
export function seatWarning(kind: TourKind, day: DayInfo | undefined, slotTime: string, party: Party): string | null {
  if (!day || !isBookable(day.state)) return null;
  const guests = party.adults + party.children;
  if (kind === "day") {
    const slot = (day.slots ?? []).find((candidate) => candidate.time === slotTime);
    return slot && slot.seatsLeft > 0 && guests > slot.seatsLeft
      ? `Only ${seats(slot.seatsLeft)} left at ${slot.time} — reduce your group or pick another time.`
      : null;
  }
  if (kind === "departure" && guests > day.seatsLeft) {
    return `Only ${seats(day.seatsLeft)} left on this departure — reduce your group or choose another date.`;
  }
  return null;
}

export type DetailsErrors = Partial<Record<"name" | "email" | "phone", string>>;

/** Step 2. Same rules and wording as the server, so the two never disagree. */
export function validateDetails(draft: Pick<BookingDraft, "name" | "email" | "phoneCode" | "phone">): DetailsErrors {
  const errors: DetailsErrors = {};
  const name = draft.name.trim();
  if (name.length < 2) errors.name = "Please enter your full name.";
  else if (name.length > 120) errors.name = "Please shorten your name to 120 characters.";
  if (!isEmail(draft.email)) errors.email = "Enter a valid email, e.g. name@example.com.";
  if (draft.phone.replace(/\D/g, "").length < 7) errors.phone = "Enter a phone number with at least 7 digits.";
  else if (fullPhone(draft).length > 40) errors.phone = "That phone number is too long.";
  return errors;
}

/** Step 3. */
export function validateReview(draft: Pick<BookingDraft, "agree">): { agree?: string } {
  return draft.agree ? {} : { agree: "Please confirm you understand this is a request." };
}

/** Maps the server's field names onto the wizard's, and says which step each belongs to. */
export function stepOfServerErrors(fieldErrors: Record<string, string[]> | undefined): 1 | 2 | 3 | null {
  if (!fieldErrors) return null;
  const keys = Object.keys(fieldErrors);
  if (keys.some((key) => ["tourId", "tourSlug", "date", "slotTime", "alternativeDate", "adults", "children", "participants"].includes(key))) return 1;
  if (keys.some((key) => ["name", "email", "phone", "country", "language", "pickup", "contactMethod", "notes"].includes(key))) return 2;
  if (keys.includes("agree")) return 3;
  return null;
}

export const waitlistSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(120, "Please shorten your name to 120 characters."),
  email: z.string().trim().max(254, "Enter a valid email, e.g. name@example.com.").regex(EMAIL_PATTERN, "Enter a valid email, e.g. name@example.com."),
});
export type WaitlistValues = z.infer<typeof waitlistSchema>;

/* ----------------------------------------------------------------- offers */

export interface OfferConditions {
  minGuests: number;
  minChildren: number;
  bookAheadDays: number;
}

/** Who an offer is for, in plain words. "Everyone" when it has no conditions. */
export function offerAudience(offer: OfferConditions): string {
  const parts: string[] = [];
  if (offer.minGuests > 1) parts.push(`groups of ${offer.minGuests} or more`);
  if (offer.minChildren > 0) parts.push(`travelling with at least ${plural(offer.minChildren, "child", "children")}`);
  if (offer.bookAheadDays > 0) parts.push(`booked ${plural(offer.bookAheadDays, "day", "days")} or more before the trip`);
  if (parts.length === 0) return "Everyone";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Valid 1 Nov – 15 Dec"; the year is added when the window ends in another year than today. */
export function offerValidity(startsOn: string, endsOn: string, today: string): string {
  const style = endsOn.slice(0, 4) === today.slice(0, 4) && startsOn.slice(0, 4) === today.slice(0, 4) ? "dayMonth" : "short";
  return `Valid ${formatDate(startsOn, style)} – ${formatDate(endsOn, style)}`;
}

/** "12 days left · ends 15 Dec", or "Ends today". */
export function offerCountdown(endsOn: string, today: string): string {
  if (!isIsoDate(endsOn) || !isIsoDate(today)) return "";
  const left = diffDays(today, endsOn);
  if (left <= 0) return "Ends today";
  return `${plural(left, "day", "days")} left · ends ${formatDate(endsOn, "dayMonth")}`;
}

/** Digits after the decimal point in a currency's amounts (0 for JPY, 2 for USD). */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Turns what a visitor typed into the value the server stores: a whole
 * percentage, or a fixed amount in minor units. Null when it is not a usable
 * number, so the form can say so before anything is sent.
 */
export function parseDiscountValue(type: DiscountType, raw: string, currency: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (type === "percent") return Number.isInteger(amount) && amount <= 100 ? amount : null;
  const minor = Math.round(amount * 10 ** currencyDigits(currency));
  return minor > 0 && minor <= 100_000_000 ? minor : null;
}

export const discountRequestFormSchema = z.object({
  tourId: z.string().min(1, "Choose a tour."),
  name: z.string().trim().min(1, "Tell us your name.").max(120, "Please shorten your name to 120 characters."),
  email: z.string().trim().max(254, "Add a valid email so we can reply.").regex(EMAIL_PATTERN, "Add a valid email so we can reply."),
  phone: z.string().trim().max(40, "That phone number is too long."),
  adults: z.number().int().min(1, "At least one adult is needed.").max(100),
  children: z.number().int().min(0).max(100),
  type: z.enum(["percent", "fixed"]),
  value: z.string().trim().min(1, "Please enter a valid discount."),
  reason: z.string().trim().max(1000, "Please keep the reason under 1,000 characters."),
});
export type DiscountRequestFormValues = z.infer<typeof discountRequestFormSchema>;

export const trackerSchema = z.object({
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^DR-\d{1,9}$/, "Enter the reference exactly as shown, e.g. DR-1043."),
  accessCode: z.string().trim().min(1, "Enter the access code you saved when you sent the request.").max(200),
});
export type TrackerValues = z.infer<typeof trackerSchema>;

export type RequestStatus = "pending" | "approved" | "rejected";

export interface TimelineStep {
  key: "submitted" | "review" | "decision";
  title: string;
  detail: string;
  state: "done" | "current" | "upcoming" | "approved" | "rejected";
}

export interface TrackedRequest {
  status: RequestStatus;
  /** "8% off" — what was granted, when approved. */
  approvedLabel: string | null;
  rejectionReason: string | null;
  used: boolean;
  responseDays: number;
}

/**
 * The three stops of a discount request. Nothing about the requester appears
 * in any of them: no e-mail, name or phone.
 */
export function requestTimeline(request: TrackedRequest): TimelineStep[] {
  const decided = request.status !== "pending";
  const review: TimelineStep = {
    key: "review",
    title: "In review",
    detail: decided
      ? "Your dates and group details were checked."
      : `We usually reply within ${plural(request.responseDays, "day", "days")}.`,
    state: decided ? "done" : "current",
  };
  let decision: TimelineStep;
  if (request.status === "approved") {
    decision = {
      key: "decision",
      title: "Approved",
      detail: request.used
        ? `${request.approvedLabel ?? "Your discount"} has been used on a booking.`
        : `${request.approvedLabel ?? "Your discount"} applies automatically when you book with the same email address.`,
      state: "approved",
    };
  } else if (request.status === "rejected") {
    decision = { key: "decision", title: "Not approved", detail: request.rejectionReason?.trim() || "We could not offer a discount this time.", state: "rejected" };
  } else {
    decision = { key: "decision", title: "Decision", detail: "You will get an email as soon as there is an answer.", state: "upcoming" };
  }
  return [{ key: "submitted", title: "Submitted", detail: "We received your request.", state: "done" }, review, decision];
}

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = { pending: "In review", approved: "Approved", rejected: "Not approved" };

/* ------------------------------------------------------------ small text */

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0]}${words.at(-1)![0]}`;
  return letters.toUpperCase();
}

/** `1 day`, `3 days · 2 nights`, or the tour's own label ("6 hours") when it has one. */
export function durationText(durationDays: number, durationLabel: string): string {
  const days = Math.max(1, count(durationDays));
  const generic = days === 1 ? "1 day" : `${days} days`;
  if (durationLabel && durationLabel !== generic) return durationLabel;
  return days > 1 ? `${generic} · ${plural(days - 1, "night", "nights")}` : generic;
}

/** A click-to-chat link: WhatsApp wants the international number as digits only. Null when there is no number. */
export function whatsappHref(number: string | null | undefined, text?: string): string | null {
  const digits = (number ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  const message = text?.trim();
  return message ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/${digits}`;
}

/**
 * A link that opens the meeting point in Google Maps (Maps URLs search action;
 * its documentation writes the comma between the coordinates encoded). No map
 * script is loaded on the page.
 */
export function mapsHref(latitude: number | null, longitude: number | null): string | null {
  if (latitude === null || longitude === null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

/** "How long a hold lasts", for the confirmation: `24 hours`, `2 days`. */
export function holdText(hours: number): string {
  const whole = Math.max(1, Math.round(hours));
  return whole % 24 === 0 && whole >= 48 ? `${whole / 24} days` : plural(whole, "hour", "hours");
}

/* -------------------------------------------------------------- countries */

/** ISO 3166 region code and its international calling code (ITU E.164). */
const DIALLING =
  "AF:93,AL:355,DZ:213,AR:54,AM:374,AU:61,AT:43,AZ:994,BH:973,BD:880,BY:375,BE:32,BR:55,BG:359,CA:1,CL:56,CN:86,CO:57,HR:385,CY:357,CZ:420,DK:45,EG:20,EE:372,FI:358,FR:33,GE:995,DE:49,GR:30,HK:852,HU:36,IS:354,IN:91,ID:62,IR:98,IQ:964,IE:353,IL:972,IT:39,JP:81,JO:962,KZ:7,KE:254,KW:965,KG:996,LV:371,LB:961,LT:370,LU:352,MY:60,MT:356,MX:52,MD:373,MA:212,NL:31,NZ:64,NG:234,NO:47,OM:968,PK:92,PH:63,PL:48,PT:351,QA:974,RO:40,RU:7,SA:966,RS:381,SG:65,SK:421,SI:386,ZA:27,KR:82,ES:34,LK:94,SE:46,CH:41,TW:886,TJ:992,TH:66,TN:216,TR:90,TM:993,UA:380,AE:971,GB:44,US:1,UZ:998,VN:84";

export interface Country {
  code: string;
  name: string;
  /** With the plus sign, e.g. `+44`. */
  dial: string;
}

function regionName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function collator(locale: string): Intl.Collator {
  try {
    return new Intl.Collator(locale);
  } catch {
    return new Intl.Collator("en");
  }
}

/** Countries for the booking form, sorted by name. */
export function countries(locale = "en"): Country[] {
  const order = collator(locale);
  return DIALLING.split(",")
    .map((pair) => {
      const [code, dial] = pair.split(":") as [string, string];
      return { code, name: regionName(code, locale), dial: `+${dial}` };
    })
    .sort((a, b) => order.compare(a.name, b.name));
}

/** Distinct calling codes, smallest first, for the phone prefix select. */
export function diallingCodes(list: readonly Country[]): string[] {
  return [...new Set(list.map((country) => country.dial))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

export function dialCodeOf(list: readonly Country[], countryName: string): string | null {
  return list.find((country) => country.name === countryName)?.dial ?? null;
}
