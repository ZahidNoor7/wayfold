/**
 * Display rules and client-side checks for the "Discounts & offers" area.
 * Pure functions only: the server re-checks everything, these give the form
 * immediate feedback and keep wording identical across tabs.
 */
import { formatDateRange, fromMinorUnits, toMinorUnits } from "./booking-display";
import { formatMoney } from "./dates";

export type DiscountType = "percent" | "fixed";
export type CampaignStatus = "inactive" | "scheduled" | "active" | "expired";
export type PersonalDiscountStatus = "revoked" | "used" | "expired" | "active";
export type RequestStatus = "pending" | "approved" | "rejected";

/** Mirrors the server: a percentage stops at 90, a fixed amount at this many minor units. */
export const MAX_PERCENT = 90;
export const MAX_FIXED_MINOR_UNITS = 100_000_000;

/* ------------------------------------------------------------------- tabs */

export const PROMOTION_TABS = ["campaigns", "personal", "requests", "activity", "settings"] as const;
export type PromotionTab = (typeof PROMOTION_TABS)[number];

export const PROMOTION_TAB_LABELS: Record<PromotionTab, string> = {
  campaigns: "Campaigns",
  personal: "Personal discounts",
  requests: "Requests",
  activity: "Activity",
  settings: "Settings",
};

/** Arrow keys, Home and End move between tabs; anything else is ignored. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/* ---------------------------------------------------------------- statuses */

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  active: "Active",
  scheduled: "Scheduled",
  expired: "Expired",
  inactive: "Inactive",
};

export const CAMPAIGN_STATUS_BADGES: Record<CampaignStatus, string> = {
  active: "badge badge-confirmed",
  scheduled: "badge badge-completed",
  expired: "badge badge-secondary",
  inactive: "badge badge-outline text-muted-foreground",
};

export const PERSONAL_STATUS_LABELS: Record<PersonalDiscountStatus, string> = {
  active: "Active",
  used: "Used",
  expired: "Expired",
  revoked: "Revoked",
};

export const PERSONAL_STATUS_BADGES: Record<PersonalDiscountStatus, string> = {
  active: "badge badge-confirmed",
  used: "badge badge-completed",
  expired: "badge badge-secondary",
  revoked: "badge badge-cancelled",
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export const REQUEST_STATUS_BADGES: Record<RequestStatus, string> = {
  pending: "badge badge-pending",
  approved: "badge badge-confirmed",
  rejected: "badge badge-cancelled",
};

export const CAMPAIGN_FILTERS = ["all", "active", "scheduled", "expired", "inactive"] as const;
export type CampaignFilter = (typeof CAMPAIGN_FILTERS)[number];

export const REQUEST_FILTERS = ["pending", "approved", "rejected", "all"] as const;
export type RequestFilter = (typeof REQUEST_FILTERS)[number];

export const FILTER_LABELS: Record<CampaignFilter | RequestFilter, string> = {
  all: "All",
  ...CAMPAIGN_STATUS_LABELS,
  ...REQUEST_STATUS_LABELS,
};

/** How many items sit under each filter chip; `all` counts everything. */
export function countBy<F extends string>(items: readonly { status: string }[], filters: readonly F[]): Record<F, number> {
  const counts = {} as Record<F, number>;
  for (const filter of filters) {
    counts[filter] = filter === "all" ? items.length : items.filter((item) => item.status === filter).length;
  }
  return counts;
}

export function filterByStatus<T extends { status: string }>(items: readonly T[], filter: string): T[] {
  return filter === "all" ? [...items] : items.filter((item) => item.status === filter);
}

/* ----------------------------------------------------------------- wording */

/** `15% off` or `$300 off`. Fixed values are minor units. */
export function formatDiscountLabel(type: DiscountType, value: number, currency: string): string {
  return type === "percent" ? `${value}% off` : `${formatMoney(value, currency)} off`;
}

/** Label for the value field, which follows the discount type. */
export function valueFieldLabel(type: DiscountType, currency: string): string {
  return type === "percent" ? "Percentage off (%)" : `Amount off (${currency})`;
}

/** What a discount takes off a price, exactly as the booking engine computes it. */
export function discountAmount(type: DiscountType, value: number, base: number): number {
  if (base <= 0 || value <= 0) return 0;
  return Math.min(base, type === "percent" ? Math.round((base * value) / 100) : value);
}

export function priceAfter(type: DiscountType, value: number, base: number): number {
  return Math.max(0, base - discountAmount(type, value, base));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `A`, `A and B`, `A, B and C`. */
export function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export interface EligibilityRules {
  minGuests: number;
  minChildren: number;
  bookAheadDays: number;
  visibility: "public" | "private";
}

/** The design's compact eligibility column: `6+ guests · booked 90+ days ahead`, or `Everyone`. */
export function eligibilityText(rules: EligibilityRules): string {
  const parts: string[] = [];
  if (rules.minGuests > 0) parts.push(`${rules.minGuests}+ guests`);
  if (rules.minChildren > 0) parts.push(`at least ${plural(rules.minChildren, "child", "children")}`);
  if (rules.bookAheadDays > 0) parts.push(`booked ${rules.bookAheadDays}+ days ahead`);
  if (rules.visibility === "private") parts.push("invited customers only");
  return parts.length > 0 ? parts.join(" · ") : "Everyone";
}

/** `All tours` or the covered tour names. */
export function scopeText(appliesToAllTours: boolean, tours: readonly { title: string }[]): string {
  if (appliesToAllTours) return "All tours";
  if (tours.length === 0) return "No tours";
  return tours.map((tour) => tour.title).join(", ");
}

/** `1 Nov – 15 Dec 2026`. */
export function campaignWindow(startsOn: string, endsOn: string): string {
  return formatDateRange(startsOn, endsOn);
}

export interface CampaignDraftSummary extends EligibilityRules {
  type: DiscountType;
  /** Whole percent or minor units; null while the field is not valid yet. */
  value: number | null;
  appliesToAllTours: boolean;
  tourTitles: readonly string[];
  assignedCount: number;
  startsOn: string;
  endsOn: string;
}

/**
 * Plain-language description of who gets what, e.g.
 * "15% off every tour for bookings made at least 60 days ahead, 1 Mar – 31 May 2027."
 * Null until the discount, tours and dates are complete enough to describe.
 */
export function campaignSummary(draft: CampaignDraftSummary, currency: string): string | null {
  if (draft.value === null || draft.value <= 0) return null;
  if (!draft.startsOn || !draft.endsOn || draft.endsOn < draft.startsOn) return null;
  if (!draft.appliesToAllTours && draft.tourTitles.length === 0) return null;

  const discount = draft.type === "percent" ? `${draft.value}% off` : `${formatMoney(draft.value, currency)} off each booking`;
  const scope = draft.appliesToAllTours
    ? "every tour"
    : draft.tourTitles.length <= 3
      ? joinAnd(draft.tourTitles)
      : `${draft.tourTitles.slice(0, 2).join(", ")} and ${draft.tourTitles.length - 2} more tours`;

  const conditions: string[] = [];
  if (draft.visibility === "private") {
    conditions.push(draft.assignedCount > 0 ? `for ${plural(draft.assignedCount, "invited customer", "invited customers")}` : "for invited customers");
  }
  if (draft.minGuests > 0) conditions.push(`for groups of ${draft.minGuests} or more`);
  if (draft.minChildren > 0) conditions.push(`when ${draft.minChildren === 1 ? "at least 1 child travels" : `at least ${draft.minChildren} children travel`}`);
  if (draft.bookAheadDays > 0) conditions.push(`for bookings made at least ${plural(draft.bookAheadDays, "day", "days")} ahead`);

  const who = conditions.length > 0 ? ` ${joinAnd(conditions)}` : "";
  return `${discount} ${scope}${who}, ${campaignWindow(draft.startsOn, draft.endsOn)}.`;
}

/* -------------------------------------------------------------- form input */

export type ParsedValue = { ok: true; value: number } | { ok: false; error: string };

/**
 * Reads the discount typed by staff. Percentages are whole numbers from 1 to
 * 90; fixed amounts are decimals in the workspace currency, stored as minor units.
 */
export function parseDiscountValue(type: DiscountType, raw: string, currency: string): ParsedValue {
  const text = raw.trim();
  if (text === "") return { ok: false, error: "Enter a discount above 0." };
  if (type === "percent") {
    if (!/^\d+$/.test(text)) return { ok: false, error: "Enter a whole number." };
    const value = Number(text);
    if (value <= 0) return { ok: false, error: "Enter a discount above 0." };
    if (value > MAX_PERCENT) return { ok: false, error: `Percentages can’t exceed ${MAX_PERCENT}%.` };
    return { ok: true, value };
  }
  const minor = toMinorUnits(text, currency);
  if (minor === null) return { ok: false, error: `Enter an amount like ${fromMinorUnits(2500, currency)}.` };
  if (minor <= 0) return { ok: false, error: "Enter a discount above 0." };
  if (minor > MAX_FIXED_MINOR_UNITS) return { ok: false, error: "That amount is too large." };
  return { ok: true, value: minor };
}

/** The stored value as the text an input should show when editing. */
export function discountInputValue(type: DiscountType, value: number, currency: string): string {
  return type === "percent" ? String(value) : fromMinorUnits(value, currency);
}

/** A whole number from 0 to `max` typed into a rule field; blank counts as 0. */
export function parseRuleNumber(raw: string, max: number): number | null {
  const text = raw.trim();
  if (text === "") return 0;
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value <= max ? value : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trimmed and lower-cased, or null when it is not an e-mail address. */
export function normaliseEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return value.length <= 254 && EMAIL.test(value) ? value : null;
}

/**
 * Splits pasted or typed text into addresses. Valid ones are de-duplicated
 * against `existing`; invalid ones come back as typed so the input can keep them.
 */
export function splitEmails(text: string, existing: readonly string[] = []): { added: string[]; invalid: string[] } {
  const seen = new Set(existing);
  const added: string[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,;]+/)) {
    if (token === "") continue;
    const email = normaliseEmail(token);
    if (!email) invalid.push(token);
    else if (!seen.has(email)) {
      seen.add(email);
      added.push(email);
    }
  }
  return { added, invalid };
}

/* ------------------------------------------------------- personal discounts */

export interface PersonalScope {
  id: string;
  email: string;
  tourId: string | null;
  status: PersonalDiscountStatus;
}

/**
 * Active discounts the server will revoke when this one is assigned: same
 * e-mail, and either side covers any tour or both name the same tour.
 */
export function replaceableDiscounts<T extends PersonalScope>(list: readonly T[], email: string, tourId: string | null): T[] {
  const target = normaliseEmail(email);
  if (!target) return [];
  return list.filter(
    (discount) => discount.status === "active" && discount.email === target && (tourId === null || discount.tourId === null || discount.tourId === tourId),
  );
}

/* ---------------------------------------------------------------- requests */

export interface ApprovalLimits {
  base: number;
  asked: { percent: number; fixed: number };
  cap: { percent: number; fixed: number };
  maxPercent: number;
  maxFixed: number;
}

/** The server's decision rules, so the form can say what is wrong before sending. */
export function approvalError(type: DiscountType, value: number, limits: ApprovalLimits): string | null {
  if (!Number.isInteger(value) || value <= 0) return "Enter the discount you’re approving.";
  const key = type === "percent" ? "percent" : "fixed";
  if (value > limits.asked[key]) return "You can’t approve more than the customer asked for.";
  if (value > limits.cap[key]) {
    return `That’s above your maximum of ${limits.cap.percent}%. Approve ${limits.cap.percent}% or less, or reject.`;
  }
  return null;
}

/** Whether the request is over the current private maximum. */
export function isOverMaximum(limits: ApprovalLimits): boolean {
  return limits.asked.percent > limits.cap.percent || limits.asked.fixed > limits.cap.fixed;
}

/**
 * Starting point for "approve lower": the most allowed when the request is
 * over the maximum, otherwise half of what was asked (at least 1%).
 */
export function defaultLowerApproval(limits: ApprovalLimits): { type: DiscountType; value: number } {
  if (isOverMaximum(limits)) return { type: "percent", value: Math.max(1, limits.maxPercent) };
  return { type: "percent", value: Math.max(1, Math.floor(limits.asked.percent / 2)) };
}

/** "You can approve up to 15% (…)" with the rule that sets the ceiling. */
export function approvalHint(limits: ApprovalLimits, currency: string, customerFirstName: string): string {
  const upTo = `You can approve up to ${limits.maxPercent}% or ${formatMoney(limits.maxFixed, currency)}`;
  const why = limits.asked.percent <= limits.cap.percent ? `what ${customerFirstName || "the customer"} asked for` : "your private maximum";
  return `${upTo} — ${why}.`;
}

/* ---------------------------------------------------------------- activity */

export const ACTIVITY_AREAS = ["all", "campaigns", "personal", "requests", "redeemed", "settings"] as const;
/** Entries per page of the Activity tab. */
export const ACTIVITY_PAGE_SIZE = 50;
export type ActivityArea = (typeof ACTIVITY_AREAS)[number];

export const ACTIVITY_AREA_LABELS: Record<ActivityArea, string> = {
  all: "All",
  campaigns: "Campaigns",
  personal: "Personal",
  requests: "Requests",
  redeemed: "Redeemed",
  settings: "Settings",
};

/** Audit action prefix each filter reads. */
export const ACTIVITY_AREA_PREFIX: Record<ActivityArea, string> = {
  all: "promotions.",
  campaigns: "promotions.campaign_",
  personal: "promotions.personal_discount_",
  requests: "promotions.request_",
  redeemed: "promotions.discount_",
  settings: "promotions.settings_",
};

/** Type badge for an audit entry, by action. */
export function activityKind(action: string): { label: string; badge: string } {
  if (action.startsWith("promotions.campaign_")) return { label: "Campaign", badge: "badge badge-secondary" };
  if (action === "promotions.personal_discount_assigned") return { label: "Personal", badge: "badge badge-outline" };
  if (action === "promotions.personal_discount_revoked") return { label: "Revoked", badge: "badge badge-cancelled" };
  if (action === "promotions.request_submitted") return { label: "Request", badge: "badge badge-pending" };
  if (action === "promotions.request_approved") return { label: "Approved", badge: "badge badge-confirmed" };
  if (action === "promotions.request_rejected") return { label: "Rejected", badge: "badge badge-cancelled" };
  if (action === "promotions.discount_redeemed") return { label: "Redeemed", badge: "badge badge-completed" };
  if (action === "promotions.settings_changed") return { label: "Settings", badge: "badge badge-outline" };
  return { label: "Other", badge: "badge badge-outline" };
}

export interface ActivityEntry {
  action: string;
  actorName: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
}

export interface ActivityLookups {
  currency: string;
  /** Personal discount id → customer name. */
  personalNames: Readonly<Record<string, string>>;
  /** Discount request id → requester and reference. */
  requests: Readonly<Record<string, { name: string; reference: string }>>;
}

const SETTING_LABELS: Record<string, string> = {
  requestsEnabled: "whether customers can send requests",
  maxRequestPercent: "the private maximum",
  responseDays: "the promised response time",
};

function text(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function count(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function discountFrom(metadata: Record<string, unknown>, currency: string, typeKey = "type", valueKey = "value"): string | null {
  const type = metadata[typeKey];
  const value = count(metadata, valueKey);
  if ((type !== "percent" && type !== "fixed") || value === null) return null;
  return formatDiscountLabel(type, value, currency);
}

/** One plain sentence for an audit entry of this area. */
export function describeActivity(entry: ActivityEntry, lookups: ActivityLookups): string {
  const { metadata, targetId } = entry;
  const name = text(metadata, "name");
  const quoted = name ? `“${name}”` : "a campaign";
  const discount = discountFrom(metadata, lookups.currency);
  const person = (targetId && lookups.personalNames[targetId]) || null;
  const request = (targetId && lookups.requests[targetId]) || null;
  const reference = text(metadata, "reference") ?? request?.reference ?? "a request";

  switch (entry.action) {
    case "promotions.campaign_created":
      return `Created campaign ${quoted}${discount ? ` (${discount})` : ""}`;
    case "promotions.campaign_updated":
      return `Edited campaign ${quoted}${discount ? ` (${discount})` : ""}`;
    case "promotions.campaign_activated":
      return `Activated campaign ${quoted}`;
    case "promotions.campaign_deactivated":
      return `Deactivated campaign ${quoted}`;
    case "promotions.campaign_deleted":
      return `Deleted campaign ${quoted}`;
    case "promotions.personal_discount_assigned": {
      const replaced = count(metadata, "replaced") ?? 0;
      return `Assigned ${discount ? `a ${discount} ` : "a "}personal discount${person ? ` to ${person}` : ""}${replaced > 0 ? " — replaced the previous one" : ""}`;
    }
    case "promotions.personal_discount_revoked":
      return `Revoked the personal discount${person ? ` for ${person}` : ""}${text(metadata, "reason") === "replaced" ? " (replaced by a new one)" : ""}`;
    case "promotions.request_submitted":
      return `Requested ${discount ?? "a discount"} (${reference})`;
    case "promotions.request_approved": {
      const asked = discountFrom(metadata, lookups.currency, "requestedType", "requestedValue");
      const partial = metadata.partial === true;
      return `Approved ${reference}${discount ? ` at ${discount}` : ""}${partial && asked ? ` (requested ${asked})` : partial ? "" : " in full"}${request ? ` for ${request.name}` : ""}`;
    }
    case "promotions.request_rejected":
      return `Rejected ${reference}${request ? ` for ${request.name}` : ""}`;
    case "promotions.discount_redeemed": {
      const amount = count(metadata, "amount");
      const what = person ? `Personal discount for ${person}` : request ? `Approved request ${request.reference}` : "A single-use discount";
      return `${what} used on a booking${amount !== null ? ` (${formatMoney(amount, lookups.currency)} off)` : ""}`;
    }
    case "promotions.settings_changed": {
      const changed = Array.isArray(metadata.changed) ? metadata.changed.filter((key): key is string => typeof key === "string") : [];
      const labels = changed.map((key) => SETTING_LABELS[key] ?? key);
      return labels.length > 0 ? `Changed ${joinAnd(labels)}` : "Changed discount request settings";
    }
    default:
      return entry.action;
  }
}

/** Who to show: the customer for a request they sent, otherwise the recorded actor. */
export function activityActor(entry: ActivityEntry, lookups: ActivityLookups): string {
  if (entry.action === "promotions.request_submitted") {
    const request = entry.targetId ? lookups.requests[entry.targetId] : undefined;
    return request ? `${request.name} (customer)` : "Customer";
  }
  return entry.actorName;
}

/** Pending requests first, then newest first. */
export function sortRequests<T extends { status: RequestStatus; createdAt: Date | string }>(requests: readonly T[]): T[] {
  const time = (value: Date | string) => new Date(value).getTime();
  return [...requests].sort((a, b) => {
    const pendingFirst = Number(b.status === "pending") - Number(a.status === "pending");
    return pendingFirst || time(b.createdAt) - time(a.createdAt);
  });
}
