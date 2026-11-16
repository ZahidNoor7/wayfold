import "server-only";
import { eq } from "drizzle-orm";
import type { TenantScope } from "../db/context";
import { plans, subscriptions, tenants, type PlanFeatures } from "../db/schema";
import { ForbiddenError, LimitExceededError } from "../errors";

export type LimitKey = "maxTeamMembers" | "maxPublishedTours" | "maxStorageMb" | "maxBookingsPerMonth";

export interface Entitlements {
  plan: { id: string; code: string; name: string };
  subscriptionStatus: "trialing" | "active" | "past_due" | "cancelled" | "none";
  /** `null` = unlimited. Platform-set overrides already applied. */
  limits: Record<LimitKey, number | null>;
  features: PlanFeatures;
}

const LIMIT_LABELS: Record<LimitKey, string> = {
  maxTeamMembers: "team members",
  maxPublishedTours: "published tours",
  maxStorageMb: "MB of media storage",
  maxBookingsPerMonth: "bookings this month",
};

/**
 * What the current tenant is entitled to. Read inside the tenant's own
 * transaction; the plan, overrides and subscription are all columns the
 * runtime role cannot modify, so a tenant cannot edit its way past a limit.
 */
export async function getEntitlements(scope: TenantScope): Promise<Entitlements> {
  const [row] = await scope.tx
    .select({
      overrides: tenants.limitOverrides,
      planId: plans.id,
      code: plans.code,
      name: plans.name,
      maxTeamMembers: plans.maxTeamMembers,
      maxPublishedTours: plans.maxPublishedTours,
      maxStorageMb: plans.maxStorageMb,
      maxBookingsPerMonth: plans.maxBookingsPerMonth,
      features: plans.features,
      subscriptionStatus: subscriptions.status,
    })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .where(eq(tenants.id, scope.tenantId))
    .limit(1);
  if (!row) throw new ForbiddenError("This workspace is not available.");

  const pick = (key: LimitKey): number | null => {
    const override = row.overrides[key];
    return override !== undefined ? override : row[key];
  };

  return {
    plan: { id: row.planId, code: row.code, name: row.name },
    subscriptionStatus: row.subscriptionStatus ?? "none",
    limits: {
      maxTeamMembers: pick("maxTeamMembers"),
      maxPublishedTours: pick("maxPublishedTours"),
      maxStorageMb: pick("maxStorageMb"),
      maxBookingsPerMonth: pick("maxBookingsPerMonth"),
    },
    features: row.features,
  };
}

/**
 * Throws when `used + adding` would exceed the plan. Call it inside the same
 * transaction as the write it protects, after counting current usage.
 */
export async function assertWithinLimit(scope: TenantScope, key: LimitKey, used: number, adding = 1): Promise<void> {
  const { limits, plan } = await getEntitlements(scope);
  const limit = limits[key];
  if (limit !== null && used + adding > limit) {
    throw new LimitExceededError(key, `Your ${plan.name} plan includes ${limit} ${LIMIT_LABELS[key]}. Upgrade to add more.`);
  }
}

export type BooleanFeature = { [K in keyof PlanFeatures]: PlanFeatures[K] extends boolean ? K : never }[keyof PlanFeatures];

const FEATURE_LABELS: Record<BooleanFeature, string> = {
  customDomain: "Custom domains",
  platformStorage: "Wayfold-managed media storage",
  promotions: "Promotions",
  removeBranding: "Removing Wayfold branding",
};

export async function assertFeature(scope: TenantScope, feature: BooleanFeature): Promise<void> {
  const { features, plan } = await getEntitlements(scope);
  if (!features[feature]) {
    throw new LimitExceededError(feature, `${FEATURE_LABELS[feature]} are not included in your ${plan.name} plan.`);
  }
}

export async function assertIntegrationCategory(scope: TenantScope, category: string): Promise<void> {
  const { features, plan } = await getEntitlements(scope);
  if (!features.integrations.includes(category)) {
    throw new LimitExceededError(`integration:${category}`, `This integration is not included in your ${plan.name} plan.`);
  }
}
