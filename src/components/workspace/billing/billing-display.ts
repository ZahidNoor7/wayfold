/**
 * Wording and thresholds for the Plan & billing screen. Pure, so the rules
 * (when a meter turns amber, how a limit reads) are tested once.
 */
import { formatCount } from "@/lib/booking-display";
import { formatMoney } from "@/lib/dates";

export type LimitKey = "maxTeamMembers" | "maxPublishedTours" | "maxStorageMb" | "maxBookingsPerMonth";
export const LIMIT_KEYS: readonly LimitKey[] = ["maxTeamMembers", "maxPublishedTours", "maxStorageMb", "maxBookingsPerMonth"];

export interface Meter {
  used: number;
  limit: number | null;
  percent: number | null;
}

export type MeterTone = "normal" | "warning" | "full";

/** Above 80% a meter warns; at or over the allowance it is full. */
export const METER_WARNING_PERCENT = 80;

export const METER_LABELS: Record<LimitKey, string> = {
  maxTeamMembers: "Team seats",
  maxPublishedTours: "Published tours",
  maxStorageMb: "Media storage",
  maxBookingsPerMonth: "Bookings this month",
};

export function meterTone(percent: number | null): MeterTone {
  if (percent === null) return "normal";
  if (percent >= 100) return "full";
  if (percent > METER_WARNING_PERCENT) return "warning";
  return "normal";
}

/** Megabytes as people read them: `0 MB`, `<1 MB`, `120 MB`, `1.5 GB`. */
export function formatMegabytes(mb: number): string {
  if (mb >= 1024) return `${Math.round((mb / 1024) * 10) / 10} GB`;
  if (mb > 0 && mb < 1) return "<1 MB";
  return `${formatCount(Math.round(mb))} MB`;
}

function amount(key: LimitKey, value: number): string {
  return key === "maxStorageMb" ? formatMegabytes(value) : formatCount(value);
}

export interface MeterView {
  label: string;
  /** `4 of 5`, `120 MB of 1 GB`, `12 · unlimited`. */
  value: string;
  /** `80%`, or null when unlimited. */
  percentText: string | null;
  /** Width of the bar, clamped to 0–100. */
  barPercent: number;
  tone: MeterTone;
  /** Plain-language warning for amber and full meters. */
  note: string | null;
}

const NOTES: Record<LimitKey, { warning: string; full: string }> = {
  maxTeamMembers: {
    warning: "Almost every seat is taken, counting pending invitations.",
    full: "Every seat is taken. New invitations will be refused until a seat is free or the plan changes.",
  },
  maxPublishedTours: {
    warning: "You are close to the number of tours you can publish.",
    full: "You cannot publish more tours until you unpublish one or change plan.",
  },
  maxStorageMb: {
    warning: "Your media storage is nearly full.",
    full: "Your media storage is full. New uploads will be refused until you delete files or change plan.",
  },
  maxBookingsPerMonth: {
    warning: "You are close to this month's booking allowance.",
    full: "This month's booking allowance is used up. New requests will be refused until next month or a plan change.",
  },
};

export function meterView(key: LimitKey, meter: Meter): MeterView {
  const tone = meterTone(meter.percent);
  const unlimited = meter.limit === null;
  return {
    label: METER_LABELS[key],
    value: unlimited ? `${amount(key, meter.used)} · unlimited` : `${amount(key, meter.used)} of ${amount(key, meter.limit!)}`,
    percentText: meter.percent === null ? null : `${Math.round(meter.percent)}%`,
    barPercent: meter.percent === null ? 0 : Math.max(0, Math.min(100, meter.percent)),
    tone,
    note: tone === "normal" ? null : NOTES[key][tone],
  };
}

const LIMIT_PHRASES: Record<LimitKey, [string, string]> = {
  maxTeamMembers: ["team member", "team members"],
  maxPublishedTours: ["published tour", "published tours"],
  maxStorageMb: ["of media storage", "of media storage"],
  maxBookingsPerMonth: ["booking a month", "bookings a month"],
};

/** `Up to 5 team members`, `Unlimited published tours`, `2 GB of media storage`. */
export function limitLine(key: LimitKey, value: number | null): string {
  const [one, many] = LIMIT_PHRASES[key];
  if (value === null) return key === "maxStorageMb" ? "Unlimited media storage" : `Unlimited ${many}`;
  if (key === "maxStorageMb") return `${formatMegabytes(value)} ${one}`;
  return `Up to ${formatCount(value)} ${value === 1 ? one : many}`;
}

export interface Features {
  customDomain: boolean;
  integrations: string[];
  platformStorage: boolean;
  promotions: boolean;
  removeBranding: boolean;
}

const INTEGRATION_NAMES: Record<string, string> = {
  media: "media storage",
  email: "e-mail",
  payments: "payments",
  maps: "maps",
  messaging: "messaging",
};

/** What the plan includes, as short lines. Absent features are simply not listed. */
export function featureLines(features: Features): string[] {
  const lines: string[] = [];
  if (features.customDomain) lines.push("Your own domain name");
  if (features.promotions) lines.push("Discount campaigns and personal offers");
  if (features.removeBranding) lines.push("No Wayfold branding on your website");
  if (features.platformStorage) lines.push("Media storage hosted by Wayfold");
  if (features.integrations.length > 0) {
    const names = features.integrations.map((name) => INTEGRATION_NAMES[name] ?? name);
    lines.push(`Connect your own ${joinList(names)}`);
  }
  return lines;
}

/** `a`, `a and b`, `a, b and c`. */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled";

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; badge: string }> = {
  trialing: { label: "Trial", badge: "badge badge-highlight" },
  active: { label: "Active", badge: "badge badge-confirmed" },
  past_due: { label: "Payment overdue", badge: "badge badge-pending" },
  cancelled: { label: "Cancelled", badge: "badge badge-cancelled" },
};

export type InvoiceStatus = "open" | "paid" | "void";

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; badge: string }> = {
  open: { label: "Due", badge: "badge badge-pending" },
  paid: { label: "Paid", badge: "badge badge-confirmed" },
  void: { label: "Void", badge: "badge badge-secondary" },
};

export const CYCLE_LABELS: Record<"monthly" | "yearly", string> = { monthly: "Monthly", yearly: "Yearly" };

/** `$49 / month`, `$490 / year`, `Free`. */
export function priceLine(minor: number, currency: string, cycle: "monthly" | "yearly"): string {
  if (minor === 0) return "Free";
  return `${formatMoney(minor, currency)} / ${cycle === "monthly" ? "month" : "year"}`;
}

/** What a yearly price saves against twelve monthly payments, or null when it does not. */
export function yearlySaving(monthly: number, yearly: number, currency: string): string | null {
  const saving = monthly * 12 - yearly;
  if (monthly <= 0 || yearly <= 0 || saving <= 0) return null;
  return `Save ${formatMoney(saving, currency)} a year`;
}

/** What happens at the end of the current period, in one sentence. */
export function renewalSentence(subscription: { status: SubscriptionStatus; cancelAtPeriodEnd: boolean }, endDate: string): string {
  if (subscription.status === "cancelled") return `The subscription has been cancelled. Access continues until ${endDate}.`;
  if (subscription.cancelAtPeriodEnd) return `The subscription ends on ${endDate} and will not renew.`;
  if (subscription.status === "trialing") return `The trial ends on ${endDate}.`;
  if (subscription.status === "past_due") return `A payment is overdue for the period ending ${endDate}.`;
  return `Renews on ${endDate}.`;
}

/** Invoice periods are calendar dates, stored as UTC midnight: read them back as `YYYY-MM-DD`. */
export function invoiceDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function invoiceHref(id: string): string {
  return `/workspace/billing/invoices/${encodeURIComponent(id)}`;
}
