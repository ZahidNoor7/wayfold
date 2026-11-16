import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { assertFeature, assertIntegrationCategory, assertWithinLimit, getEntitlements, type LimitKey } from "@/server/billing/limits";
import { withTenant } from "@/server/db/context";
import { subscriptions, tenants, type TenantLimitOverrides } from "@/server/db/schema";
import { ForbiddenError, LimitExceededError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { createTenant, randomId, type PlanOverrides } from "../../helpers/fixtures";
import { pgCode, rejection } from "./support";

const entitlements = (tenantId: string) => withTenant(tenantId, (scope) => getEntitlements(scope));

function override(tenantId: string, limitOverrides: TenantLimitOverrides) {
  return withPlatform((tx) => tx.update(tenants).set({ limitOverrides }).where(eq(tenants.id, tenantId)));
}

const within = (tenantId: string, key: LimitKey, used: number, adding?: number) =>
  withTenant(tenantId, (scope) => assertWithinLimit(scope, key, used, adding));

describe("getEntitlements", () => {
  it("returns the plan, its limits, features and subscription status", async () => {
    const plan: PlanOverrides = {
      maxTeamMembers: 3,
      maxPublishedTours: 10,
      maxStorageMb: 500,
      maxBookingsPerMonth: 200,
      features: { customDomain: false, integrations: ["media", "email"] },
    };
    const a = await createTenant({ plan });

    const result = await entitlements(a.tenantId);
    expect(result.plan.id).toBe(a.planId);
    expect(result.plan.code).toMatch(/^plan-/);
    expect(result.plan.name).toBe(result.plan.code);
    expect(result.subscriptionStatus).toBe("active");
    expect(result.limits).toEqual({ maxTeamMembers: 3, maxPublishedTours: 10, maxStorageMb: 500, maxBookingsPerMonth: 200 });
    expect(result.features).toEqual({
      customDomain: false,
      integrations: ["media", "email"],
      platformStorage: true,
      promotions: true,
      removeBranding: true,
    });
  });

  it("treats a null plan limit as unlimited", async () => {
    const a = await createTenant({ plan: { maxTeamMembers: null, maxPublishedTours: 5 } });
    expect((await entitlements(a.tenantId)).limits).toEqual({
      maxTeamMembers: null,
      maxPublishedTours: 5,
      maxStorageMb: null,
      maxBookingsPerMonth: null,
    });
  });

  it("applies platform overrides on top of the plan, key by key", async () => {
    const a = await createTenant({ plan: { maxTeamMembers: 3, maxPublishedTours: 10, maxStorageMb: 500, maxBookingsPerMonth: 200 } });
    await override(a.tenantId, { maxPublishedTours: 50, maxStorageMb: 100 });

    expect((await entitlements(a.tenantId)).limits).toEqual({
      maxTeamMembers: 3,
      maxPublishedTours: 50,
      maxStorageMb: 100,
      maxBookingsPerMonth: 200,
    });
  });

  it("treats an explicit null override as unlimited, unlike a missing one", async () => {
    const a = await createTenant({ plan: { maxTeamMembers: 3, maxPublishedTours: 10 } });
    await override(a.tenantId, { maxPublishedTours: null });

    const { limits } = await entitlements(a.tenantId);
    expect(limits.maxPublishedTours).toBeNull();
    expect(limits.maxTeamMembers).toBe(3);
  });

  it("lets an override restrict an otherwise unlimited plan, including to zero", async () => {
    const a = await createTenant();
    await override(a.tenantId, { maxBookingsPerMonth: 0, maxTeamMembers: 2 });
    expect((await entitlements(a.tenantId)).limits).toMatchObject({ maxBookingsPerMonth: 0, maxTeamMembers: 2, maxPublishedTours: null });
  });

  it("reports the subscription status, or none when there is no subscription", async () => {
    const a = await createTenant();
    await withPlatform((tx) => tx.update(subscriptions).set({ status: "past_due" }).where(eq(subscriptions.tenantId, a.tenantId)));
    expect((await entitlements(a.tenantId)).subscriptionStatus).toBe("past_due");

    await withPlatform((tx) => tx.delete(subscriptions).where(eq(subscriptions.tenantId, a.tenantId)));
    expect((await entitlements(a.tenantId)).subscriptionStatus).toBe("none");
  });

  it("reads each tenant's own entitlements", async () => {
    const a = await createTenant({ plan: { maxPublishedTours: 1 } });
    const b = await createTenant({ plan: { maxPublishedTours: 99 } });
    await override(b.tenantId, { maxTeamMembers: 7 });

    const forA = await entitlements(a.tenantId);
    expect(forA.plan.id).toBe(a.planId);
    expect(forA.limits).toMatchObject({ maxPublishedTours: 1, maxTeamMembers: null });
    expect((await entitlements(b.tenantId)).limits).toMatchObject({ maxPublishedTours: 99, maxTeamMembers: 7 });
  });

  it("fails closed when the scope's tenant does not exist", async () => {
    const error = await rejection(withTenant(randomId(), (scope) => getEntitlements(scope)));
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toBe("This workspace is not available.");
  });

  it("cannot be raised by the tenant itself", async () => {
    const a = await createTenant({ plan: { maxPublishedTours: 1 } });
    const code = await pgCode(() =>
      withTenant(a.tenantId, ({ tx }) => tx.update(tenants).set({ limitOverrides: { maxPublishedTours: null } }).where(eq(tenants.id, a.tenantId))),
    );
    expect(code).toBe("42501");
    expect((await entitlements(a.tenantId)).limits.maxPublishedTours).toBe(1);
  });
});

describe("assertWithinLimit", () => {
  it("allows usage up to and including the limit", async () => {
    const a = await createTenant({ plan: { maxPublishedTours: 3 } });
    await expect(within(a.tenantId, "maxPublishedTours", 0)).resolves.toBeUndefined();
    await expect(within(a.tenantId, "maxPublishedTours", 2)).resolves.toBeUndefined();
    await expect(within(a.tenantId, "maxPublishedTours", 0, 3)).resolves.toBeUndefined();
    await expect(within(a.tenantId, "maxPublishedTours", 3, 0)).resolves.toBeUndefined();
  });

  it("refuses the first unit past the limit", async () => {
    const a = await createTenant({ plan: { maxPublishedTours: 3 } });

    const error = (await rejection(within(a.tenantId, "maxPublishedTours", 3))) as LimitExceededError;
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error).toMatchObject({ code: "plan_limit", status: 402, limit: "maxPublishedTours" });
    expect(error.message).toMatch(/^Your plan-\w+ plan includes 3 published tours\. Upgrade to add more\.$/);

    await expect(within(a.tenantId, "maxPublishedTours", 2, 2)).rejects.toBeInstanceOf(LimitExceededError);
    await expect(within(a.tenantId, "maxPublishedTours", 0, 4)).rejects.toBeInstanceOf(LimitExceededError);
    await expect(within(a.tenantId, "maxPublishedTours", 10)).rejects.toBeInstanceOf(LimitExceededError);
  });

  it("never refuses when the limit is unlimited", async () => {
    const a = await createTenant({ plan: { maxBookingsPerMonth: null } });
    await expect(within(a.tenantId, "maxBookingsPerMonth", 1_000_000, 1_000)).resolves.toBeUndefined();
  });

  it("refuses everything when the limit is zero", async () => {
    const a = await createTenant({ plan: { maxTeamMembers: 0 } });
    await expect(within(a.tenantId, "maxTeamMembers", 0)).rejects.toBeInstanceOf(LimitExceededError);
    await expect(within(a.tenantId, "maxTeamMembers", 0, 0)).resolves.toBeUndefined();
  });

  it("uses the platform override instead of the plan", async () => {
    const a = await createTenant({ plan: { maxTeamMembers: 2 } });
    await expect(within(a.tenantId, "maxTeamMembers", 2)).rejects.toBeInstanceOf(LimitExceededError);

    await override(a.tenantId, { maxTeamMembers: 5 });
    await expect(within(a.tenantId, "maxTeamMembers", 4)).resolves.toBeUndefined();
    const error = await rejection(within(a.tenantId, "maxTeamMembers", 5));
    expect(error.message).toContain("includes 5 team members");

    await override(a.tenantId, { maxTeamMembers: null });
    await expect(within(a.tenantId, "maxTeamMembers", 5_000)).resolves.toBeUndefined();
  });

  it.each([
    ["maxTeamMembers", "team members"],
    ["maxPublishedTours", "published tours"],
    ["maxStorageMb", "MB of media storage"],
    ["maxBookingsPerMonth", "bookings this month"],
  ] as const)("names %s in plain words", async (key, label) => {
    const a = await createTenant({ plan: { [key]: 1 } });
    const error = (await rejection(within(a.tenantId, key, 1))) as LimitExceededError;
    expect(error.limit).toBe(key);
    expect(error.message).toContain(`includes 1 ${label}.`);
  });
});

describe("assertFeature", () => {
  it("passes for a feature the plan includes", async () => {
    const a = await createTenant();
    for (const feature of ["customDomain", "platformStorage", "promotions", "removeBranding"] as const) {
      await expect(withTenant(a.tenantId, (scope) => assertFeature(scope, feature))).resolves.toBeUndefined();
    }
  });

  it.each([
    ["customDomain", "Custom domains"],
    ["platformStorage", "Wayfold-managed media storage"],
    ["promotions", "Promotions"],
    ["removeBranding", "Removing Wayfold branding"],
  ] as const)("refuses %s when the plan lacks it", async (feature, label) => {
    const a = await createTenant({ plan: { features: { [feature]: false } } });
    const error = (await rejection(withTenant(a.tenantId, (scope) => assertFeature(scope, feature)))) as LimitExceededError;
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error.limit).toBe(feature);
    expect(error.code).toBe("plan_limit");
    expect(error.message).toMatch(new RegExp(`^${label} are not included in your plan-\\w+ plan\\.$`));
  });
});

describe("assertIntegrationCategory", () => {
  it("passes for categories on the plan and refuses the rest", async () => {
    const a = await createTenant({ plan: { features: { integrations: ["media", "email"] } } });

    await expect(withTenant(a.tenantId, (scope) => assertIntegrationCategory(scope, "media"))).resolves.toBeUndefined();
    await expect(withTenant(a.tenantId, (scope) => assertIntegrationCategory(scope, "email"))).resolves.toBeUndefined();

    const error = (await rejection(withTenant(a.tenantId, (scope) => assertIntegrationCategory(scope, "payments")))) as LimitExceededError;
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error.limit).toBe("integration:payments");
    expect(error.message).toMatch(/^This integration is not included in your plan-\w+ plan\.$/);
  });

  it("refuses every category on a plan with none, and unknown categories always", async () => {
    const none = await createTenant({ plan: { features: { integrations: [] } } });
    const all = await createTenant();
    await expect(withTenant(none.tenantId, (scope) => assertIntegrationCategory(scope, "media"))).rejects.toBeInstanceOf(LimitExceededError);
    await expect(withTenant(all.tenantId, (scope) => assertIntegrationCategory(scope, "telepathy"))).rejects.toBeInstanceOf(LimitExceededError);
    await expect(withTenant(all.tenantId, (scope) => assertIntegrationCategory(scope, "maps"))).resolves.toBeUndefined();
  });
});
