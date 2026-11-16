import { describe, expect, it } from "vitest";
import { createCampaign } from "@/server/promotions/campaigns";
import { findBestDiscount, findEligibleDiscounts } from "@/server/promotions/engine";
import { bestPublicPriceFor, countPublicOffers, listPublicOffers } from "@/server/promotions/offers";
import { withPlatform } from "@/server/platform/db";
import { tenants } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { createTenant } from "../../helpers/fixtures";
import { asOwner, asVisitor, campaignInput, createTour, TODAY } from "../../helpers/promotions";

/** Overrides the plan feature for one tenant, as the platform owner would. */
async function setPromotionsFeature(tenantId: string, enabled: boolean): Promise<void> {
  await withPlatform(async (tx) => {
    const { plans } = await import("@/server/db/schema");
    const [tenant] = await tx.select({ planId: tenants.planId }).from(tenants).where(eq(tenants.id, tenantId));
    const [plan] = await tx.select({ features: plans.features }).from(plans).where(eq(plans.id, tenant!.planId));
    await tx.update(plans).set({ features: { ...plan!.features, promotions: enabled } }).where(eq(plans.id, tenant!.planId));
  });
}

describe("promotions follow the plan", () => {
  it("offers, shows and applies nothing when the plan excludes promotions, and resumes when it returns", async () => {
    const tenant = await createTenant();
    const tour = await createTour(tenant);
    await asOwner(tenant, (scope) => createCampaign(scope, campaignInput({ type: "percent", value: 20 }), TODAY));

    const context = { tourId: tour.id, email: "guest@example.test", adults: 2, children: 0, baseAmount: 138_000, travelDate: "2027-04-17", today: TODAY };

    expect(await asVisitor(tenant, (scope) => countPublicOffers(scope, TODAY))).toBe(1);
    expect(await asVisitor(tenant, (scope) => findBestDiscount(scope, context))).not.toBeNull();

    await setPromotionsFeature(tenant.tenantId, false);

    expect(await asVisitor(tenant, (scope) => listPublicOffers(scope, TODAY))).toEqual([]);
    expect(await asVisitor(tenant, (scope) => countPublicOffers(scope, TODAY))).toBe(0);
    expect(await asVisitor(tenant, (scope) => findEligibleDiscounts(scope, context))).toEqual([]);
    expect(await asVisitor(tenant, (scope) => findBestDiscount(scope, context))).toBeNull();
    const prices = await asVisitor(tenant, (scope) => bestPublicPriceFor(scope, [tour.id], TODAY));
    expect(prices[tour.id]).toMatchObject({ priceAdult: tour.priceAdult, discountedPriceAdult: null, offer: null });

    await setPromotionsFeature(tenant.tenantId, true);
    expect(await asVisitor(tenant, (scope) => countPublicOffers(scope, TODAY))).toBe(1);
  });
});
