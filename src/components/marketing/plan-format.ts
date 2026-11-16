import { formatMoney } from "@/lib/dates";

/**
 * Turns a plan row into the words shown on pricing cards. Pure, so the same
 * wording is used on the marketing site and in the workspace creation form.
 */
export interface PlanLike {
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  limits: {
    maxTeamMembers: number | null;
    maxPublishedTours: number | null;
    maxStorageMb: number | null;
    maxBookingsPerMonth: number | null;
  };
  features: {
    customDomain: boolean;
    integrations: string[];
    platformStorage: boolean;
    promotions: boolean;
    removeBranding: boolean;
  };
}

export function isFreePlan(plan: Pick<PlanLike, "priceMonthly" | "priceYearly">): boolean {
  return plan.priceMonthly === 0 && plan.priceYearly === 0;
}

export interface PlanPrice {
  /** "Free", or the monthly price such as "$29". */
  amount: string;
  /** "per month", or empty for a free plan. */
  period: string;
  /** Yearly alternative, e.g. "or $290 billed yearly". Null when there is none. */
  yearly: string | null;
}

export function planPrice(plan: Pick<PlanLike, "priceMonthly" | "priceYearly" | "currency">): PlanPrice {
  if (isFreePlan(plan)) return { amount: "Free", period: "", yearly: null };
  if (plan.priceMonthly === 0) {
    return { amount: formatMoney(plan.priceYearly, plan.currency), period: "per year", yearly: null };
  }
  return {
    amount: formatMoney(plan.priceMonthly, plan.currency),
    period: "per month",
    yearly: plan.priceYearly > 0 ? `or ${formatMoney(plan.priceYearly, plan.currency)} billed yearly` : null,
  };
}

const NUMBER = new Intl.NumberFormat("en-US");

function counted(limit: number | null, one: string, many: string): string {
  if (limit === null) return `Unlimited ${many}`;
  return `${NUMBER.format(limit)} ${limit === 1 ? one : many}`;
}

/** Storage allowances are sold in round decimal units: 2,000 MB reads as 2 GB. */
export function storageLabel(megabytes: number | null): string {
  if (megabytes === null) return "Unlimited media storage";
  if (megabytes >= 1000) {
    const gigabytes = Math.round((megabytes / 1000) * 10) / 10;
    return `${NUMBER.format(gigabytes)} GB of media storage`;
  }
  return `${NUMBER.format(megabytes)} MB of media storage`;
}

/** The four allowances every plan has, in the order people compare them. */
export function planLimits(plan: Pick<PlanLike, "limits">): string[] {
  const { limits } = plan;
  return [
    counted(limits.maxPublishedTours, "published tour", "published tours"),
    limits.maxBookingsPerMonth === null ? "Unlimited bookings" : `${NUMBER.format(limits.maxBookingsPerMonth)} ${limits.maxBookingsPerMonth === 1 ? "booking" : "bookings"} a month`,
    counted(limits.maxTeamMembers, "team member", "team members"),
    storageLabel(limits.maxStorageMb),
  ];
}

const INTEGRATION_LABELS: Record<string, string> = {
  media: "Cloudinary",
  email: "your own e-mail server",
  payments: "Stripe",
  maps: "Google Maps",
  messaging: "WhatsApp",
};

/** What the plan switches on beyond its allowances. Unknown categories are left out. */
export function planFeatures(plan: Pick<PlanLike, "features">): string[] {
  const { features } = plan;
  const lines: string[] = [];
  if (features.customDomain) lines.push("Your own domain name");
  if (features.promotions) lines.push("Discount campaigns and offers");
  if (features.platformStorage) lines.push("Media storage included, no extra account");
  if (features.removeBranding) lines.push("No Wayfold credit on your website");
  const connections = features.integrations.map((category) => INTEGRATION_LABELS[category]).filter((label): label is string => Boolean(label));
  if (connections.length > 0) lines.push(`Connects to ${joinList(connections)}`);
  return lines;
}

/** "a", "a and b", "a, b and c". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
