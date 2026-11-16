import { beforeAll, describe, expect, it, vi } from "vitest";
import { campaigns, campaignTours, discountRequests, personalDiscounts } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createCampaign, deleteCampaign, getCampaign, listCampaigns, setCampaignActive, updateCampaign } from "@/server/promotions/campaigns";
import { consumeDiscount, findBestDiscount, findEligibleDiscounts, type DiscountContext } from "@/server/promotions/engine";
import { bestPublicPriceFor, countPublicOffers, listPublicOffers } from "@/server/promotions/offers";
import { assignPersonalDiscount, getPersonalDiscount, listPersonalDiscounts, revokePersonalDiscount } from "@/server/promotions/personal-discounts";
import {
  approveDiscountRequest,
  countPendingDiscountRequests,
  getDiscountRequest,
  getDiscountRequestStatus,
  listDiscountRequests,
  rejectDiscountRequest,
  submitDiscountRequest,
} from "@/server/promotions/requests";
import { changePromotionSettings } from "@/server/promotions/settings";
import { getPromotionSettings } from "@/server/settings/tenant-settings";
import { createTenant, type TenantFixture } from "../helpers/fixtures";
import { asOwner, asVisitor, auditActions, campaignInput, createTour, errorOf, insertBooking, TODAY, type TourFixture } from "../helpers/promotions";

vi.mock("@/server/notifications", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

/** The same customer books with both businesses. */
const EMAIL = "shared.customer@example.test";

interface World {
  a: TenantFixture;
  b: TenantFixture;
  tourA: TourFixture;
  tourB: TourFixture;
  /** Everything below belongs to tenant A. */
  campaignId: string;
  privateCampaignId: string;
  personalId: string;
  pendingRequestId: string;
  pending: { reference: string; accessToken: string };
  approvedRequestId: string;
  approved: { reference: string; accessToken: string };
}

let world: World;

const contextFor = (tour: TourFixture): DiscountContext => ({
  tourId: tour.id,
  email: EMAIL,
  adults: 2,
  children: 0,
  baseAmount: 138_000,
  travelDate: "2027-04-17",
  today: TODAY,
});

beforeAll(async () => {
  const [a, b] = [await createTenant({ name: "Tenant A" }), await createTenant({ name: "Tenant B" })];
  const [tourA, tourB] = [await createTour(a, { title: "A's tour" }), await createTour(b, { title: "B's tour" })];

  // Tenant A has one of everything, all of it aimed at the shared customer.
  const seeded = await asOwner(a, async (scope) => {
    const campaign = await createCampaign(scope, campaignInput({ name: "A public offer", value: 15, appliesToAllTours: false, tourIds: [tourA.id] }), TODAY);
    const privateCampaign = await createCampaign(
      scope,
      campaignInput({ name: "A private offer", value: 40, visibility: "private", assignedEmails: [EMAIL], code: "AONLY" }),
      TODAY,
    );
    const personal = await assignPersonalDiscount(scope, { customerName: "Shared Customer", email: EMAIL, type: "percent", value: 50, note: "A's internal note" }, TODAY);

    const approved = await submitDiscountRequest(scope, { tourId: tourA.id, name: "Shared Customer", email: EMAIL, adults: 2, type: "percent", value: 30 }, TODAY);
    const [approvedRow] = await listDiscountRequests(scope, { status: "pending" });
    await approveDiscountRequest(scope, approvedRow!.id, { type: "percent", value: 30 });

    const pending = await submitDiscountRequest(scope, { tourId: tourA.id, name: "Shared Customer", email: EMAIL, adults: 2, type: "percent", value: 20 }, TODAY);
    const [pendingRow] = await listDiscountRequests(scope, { status: "pending" });
    return {
      campaignId: campaign.id,
      privateCampaignId: privateCampaign.id,
      personalId: personal.discount.id,
      approvedRequestId: approvedRow!.id,
      approved,
      pendingRequestId: pendingRow!.id,
      pending,
    };
  });
  world = { a, b, tourA, tourB, ...seeded };
});

describe("tenant isolation: campaigns", () => {
  it("B cannot list or read A's campaigns", async () => {
    const { a, b, campaignId, privateCampaignId } = world;
    expect(await asOwner(b, (scope) => listCampaigns(scope, TODAY))).toEqual([]);
    for (const id of [campaignId, privateCampaignId]) {
      expect(await errorOf(() => asOwner(b, (scope) => getCampaign(scope, id, TODAY)))).toBeInstanceOf(NotFoundError);
    }
    expect(await asOwner(a, (scope) => listCampaigns(scope, TODAY))).toHaveLength(2);
  });

  it("B cannot update, pause or delete A's campaigns", async () => {
    const { a, b, campaignId } = world;
    for (const run of [
      () => asOwner(b, (scope) => updateCampaign(scope, campaignId, campaignInput({ name: "Hijacked", value: 90 }), TODAY)),
      () => asOwner(b, (scope) => setCampaignActive(scope, campaignId, false, TODAY)),
      () => asOwner(b, (scope) => deleteCampaign(scope, campaignId)),
    ]) {
      expect(await errorOf(run)).toBeInstanceOf(NotFoundError);
    }

    expect(await asOwner(a, (scope) => getCampaign(scope, campaignId, TODAY))).toMatchObject({ name: "A public offer", value: 15, isActive: true, status: "active" });
    expect((await auditActions(b)).filter((action) => action.startsWith("promotions.campaign"))).toEqual([]);
  });

  it("B cannot create or retarget a campaign at A's tours", async () => {
    const { a, b, tourA, tourB } = world;
    const onCreate = await errorOf(() =>
      asOwner(b, (scope) => createCampaign(scope, campaignInput({ appliesToAllTours: false, tourIds: [tourB.id, tourA.id] }), TODAY)),
    );
    expect(onCreate).toBeInstanceOf(ValidationError);
    expect((onCreate as ValidationError).fieldErrors).toEqual({ tourIds: ["Choose tours from your own catalogue."] });
    // The whole write rolled back: not even the campaign row was kept.
    expect(await asOwner(b, (scope) => listCampaigns(scope, TODAY))).toEqual([]);

    const own = await asOwner(b, (scope) => createCampaign(scope, campaignInput({ name: "B's own", appliesToAllTours: false, tourIds: [tourB.id] }), TODAY));
    const onUpdate = await errorOf(() =>
      asOwner(b, (scope) => updateCampaign(scope, own.id, campaignInput({ name: "B's own", appliesToAllTours: false, tourIds: [tourA.id] }), TODAY)),
    );
    expect(onUpdate).toBeInstanceOf(ValidationError);
    expect(await asOwner(b, (scope) => getCampaign(scope, own.id, TODAY))).toMatchObject({ tours: [{ id: tourB.id, title: "B's tour" }] });
    await asOwner(b, (scope) => deleteCampaign(scope, own.id));

    // Nothing of B's is attached to A's tour.
    const links = await asOwner(a, ({ tx }) => tx.select({ tenantId: campaignTours.tenantId }).from(campaignTours));
    expect(links.every((link) => link.tenantId === a.tenantId)).toBe(true);
  });

  it("B's campaign use counter cannot be driven through A's campaign id", async () => {
    const { a, b, campaignId } = world;
    const error = await errorOf(() => asOwner(b, (scope) => consumeDiscount(scope, { source: "campaign", refId: campaignId, label: "x", amount: 1 }, world.tourB.id)));
    expect(error).toBeInstanceOf(ConflictError);
    expect(await asOwner(a, (scope) => getCampaign(scope, campaignId, TODAY))).toMatchObject({ uses: 0 });
  });
});

describe("tenant isolation: personal discounts", () => {
  it("B cannot list or read A's personal discounts", async () => {
    const { a, b, personalId } = world;
    expect(await asOwner(b, (scope) => listPersonalDiscounts(scope, TODAY))).toEqual([]);
    expect(await errorOf(() => asOwner(b, (scope) => getPersonalDiscount(scope, personalId, TODAY)))).toBeInstanceOf(NotFoundError);
    expect(await asOwner(a, (scope) => listPersonalDiscounts(scope, TODAY))).toHaveLength(1);
  });

  it("B cannot revoke A's personal discount", async () => {
    const { a, b, personalId } = world;
    expect(await errorOf(() => asOwner(b, (scope) => revokePersonalDiscount(scope, personalId)))).toBeInstanceOf(NotFoundError);
    expect(await asOwner(a, (scope) => getPersonalDiscount(scope, personalId, TODAY))).toMatchObject({ status: "active", revokedAt: null });
  });

  it("assigning to the same e-mail in B does not replace A's discount", async () => {
    const { a, b, personalId } = world;
    const assigned = await asOwner(b, (scope) => assignPersonalDiscount(scope, { customerName: "Shared Customer", email: EMAIL, type: "percent", value: 5 }, TODAY));
    expect(assigned.replacedIds).toEqual([]);
    expect(await asOwner(a, (scope) => getPersonalDiscount(scope, personalId, TODAY))).toMatchObject({ status: "active", value: 50 });
    await asOwner(b, (scope) => revokePersonalDiscount(scope, assigned.discount.id));
  });

  it("B cannot scope a personal discount to A's tour", async () => {
    const { b, tourA } = world;
    const error = await errorOf(() =>
      asOwner(b, (scope) => assignPersonalDiscount(scope, { customerName: "X", email: "x@example.test", tourId: tourA.id, type: "percent", value: 5 }, TODAY)),
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors).toEqual({ tourId: ["Choose one of your own tours."] });
    expect((await asOwner(b, (scope) => listPersonalDiscounts(scope, TODAY))).filter((d) => d.email === "x@example.test")).toEqual([]);
  });

  it("B cannot spend A's personal discount on one of its own bookings", async () => {
    const { a, b, tourB, personalId } = world;
    const error = await errorOf(() =>
      asOwner(b, async (scope) => consumeDiscount(scope, { source: "personal", refId: personalId, label: "x", amount: 1 }, await insertBooking(scope, tourB))),
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect(await asOwner(a, (scope) => getPersonalDiscount(scope, personalId, TODAY))).toMatchObject({ status: "active", usedByBookingId: null });
  });
});

describe("tenant isolation: discount requests", () => {
  it("B cannot list, count or read A's requests", async () => {
    const { a, b, pendingRequestId, approvedRequestId } = world;
    expect(await asOwner(b, (scope) => listDiscountRequests(scope))).toEqual([]);
    expect(await asOwner(b, (scope) => listDiscountRequests(scope, { status: "pending" }))).toEqual([]);
    expect(await asOwner(b, (scope) => countPendingDiscountRequests(scope))).toBe(0);
    for (const id of [pendingRequestId, approvedRequestId]) {
      expect(await errorOf(() => asOwner(b, (scope) => getDiscountRequest(scope, id)))).toBeInstanceOf(NotFoundError);
    }
    expect(await asOwner(a, (scope) => countPendingDiscountRequests(scope))).toBe(1);
  });

  it("B cannot approve or reject A's pending request", async () => {
    const { a, b, pendingRequestId } = world;
    expect(await errorOf(() => asOwner(b, (scope) => approveDiscountRequest(scope, pendingRequestId, { type: "percent", value: 1 })))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(() => asOwner(b, (scope) => rejectDiscountRequest(scope, pendingRequestId, { reason: "Not yours" })))).toBeInstanceOf(NotFoundError);

    expect(await asOwner(a, (scope) => getDiscountRequest(scope, pendingRequestId))).toMatchObject({ status: "pending", decidedBy: null, decisionNote: null });
  });

  it("a reference and token issued by A are not found on B's storefront", async () => {
    const { a, b, pending, approved } = world;
    for (const issued of [pending, approved]) {
      const error = await errorOf(() => asVisitor(b, (scope) => getDiscountRequestStatus(scope, issued)));
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).message).toBe("Discount request not found.");
      // The very same pair works where it was issued.
      expect(await asVisitor(a, (scope) => getDiscountRequestStatus(scope, issued))).toMatchObject({ reference: issued.reference });
    }
  });

  it("A's token does not open B's request that happens to share the reference", async () => {
    const { b, tourB, pending, approved } = world;
    // B's first request gets DR-1001 too: references are per tenant.
    const own = await asVisitor(b, (scope) => submitDiscountRequest(scope, { tourId: tourB.id, name: "Someone", email: "someone@example.test", adults: 1, type: "percent", value: 5 }, TODAY));
    expect([pending.reference, approved.reference]).toContain(own.reference);

    for (const issued of [pending, approved]) {
      const error = await errorOf(() => asVisitor(b, (scope) => getDiscountRequestStatus(scope, { reference: own.reference, accessToken: issued.accessToken })));
      expect(error).toBeInstanceOf(NotFoundError);
    }
    expect(await asVisitor(b, (scope) => getDiscountRequestStatus(scope, own))).toMatchObject({ status: "pending", tourTitle: "B's tour" });
  });

  it("B's storefront cannot file a request against A's tour", async () => {
    const { a, b, tourA } = world;
    const before = (await asOwner(a, (scope) => listDiscountRequests(scope))).length;
    const error = await errorOf(() =>
      asVisitor(b, (scope) => submitDiscountRequest(scope, { tourId: tourA.id, name: "X", email: "x@example.test", adults: 2, type: "percent", value: 5 }, TODAY)),
    );
    expect(error).toBeInstanceOf(NotFoundError);
    expect((await asOwner(a, (scope) => listDiscountRequests(scope))).length).toBe(before);
  });

  it("B cannot spend A's approved request on one of its own bookings", async () => {
    const { a, b, tourB, approvedRequestId } = world;
    const error = await errorOf(() =>
      asOwner(b, async (scope) => consumeDiscount(scope, { source: "request", refId: approvedRequestId, label: "x", amount: 1 }, await insertBooking(scope, tourB))),
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect(await asOwner(a, (scope) => getDiscountRequest(scope, approvedRequestId))).toMatchObject({ status: "approved", usedByBookingId: null });
  });
});

describe("tenant isolation: the discount engine and public offers", () => {
  it("B's engine returns none of A's discounts for the same e-mail", async () => {
    const { a, b, tourA, tourB } = world;
    // In A, the shared customer qualifies for a campaign, a private offer, a personal discount and an approved request.
    const inA = await asVisitor(a, (scope) => findEligibleDiscounts(scope, contextFor(tourA)));
    expect(inA.map((d) => d.source).sort()).toEqual(["campaign", "campaign", "personal", "request"]);

    // In B, the same e-mail gets nothing: for B's own tour, and for A's tour id passed in by mistake or malice.
    for (const tour of [tourB, tourA]) {
      expect(await asVisitor(b, (scope) => findEligibleDiscounts(scope, contextFor(tour)))).toEqual([]);
      expect(await asVisitor(b, (scope) => findBestDiscount(scope, contextFor(tour)))).toBeNull();
    }
  });

  it("each tenant's engine only ever returns its own ids", async () => {
    const { a, b, tourB } = world;
    const own = await asOwner(b, (scope) => createCampaign(scope, campaignInput({ name: "B's offer", value: 5 }), TODAY));
    const best = await asVisitor(b, (scope) => findBestDiscount(scope, contextFor(tourB)));
    // A's 50% personal discount would win easily if it could be seen.
    expect(best).toEqual({ source: "campaign", refId: own.id, label: "B's offer — 5% off", amount: 6_900 });
    await asOwner(b, (scope) => deleteCampaign(scope, own.id));

    const inA = await asVisitor(a, (scope) => findEligibleDiscounts(scope, contextFor(world.tourA)));
    expect(inA.map((d) => d.refId)).not.toContain(own.id);
  });

  it("B's storefront shows none of A's offers or prices", async () => {
    const { a, b, tourA, tourB } = world;
    expect(await asVisitor(b, (scope) => listPublicOffers(scope, TODAY))).toEqual([]);
    expect(await asVisitor(b, (scope) => countPublicOffers(scope, TODAY))).toBe(0);
    // A's tour id asked for on B's site is simply absent; B's own tour has no offer.
    expect(await asVisitor(b, (scope) => bestPublicPriceFor(scope, [tourA.id, tourB.id], TODAY))).toEqual({
      [tourB.id]: { tourId: tourB.id, priceAdult: 69_000, discountedPriceAdult: null, offer: null },
    });

    const offersA = await asVisitor(a, (scope) => listPublicOffers(scope, TODAY));
    expect(offersA.map((offer) => offer.name)).toEqual(["A public offer"]);
    expect(JSON.stringify(offersA)).not.toMatch(/A private offer|AONLY|shared\.customer/);
  });

  it("settings are per tenant", async () => {
    const { a, b } = world;
    await asOwner(b, (scope) => changePromotionSettings(scope, { requestsEnabled: false, maxRequestPercent: 5 }));
    expect(await asOwner(a, (scope) => getPromotionSettings(scope))).toEqual({ requestsEnabled: true, maxRequestPercent: 30, responseDays: 2 });
    await asOwner(b, (scope) => changePromotionSettings(scope, { requestsEnabled: true, maxRequestPercent: 30 }));
  });
});

describe("tenant isolation: the database itself", () => {
  it("returns none of A's promotion rows to B even without a service in between", async () => {
    const { b } = world;
    const seen = await asOwner(b, async ({ tx }) => ({
      campaigns: (await tx.select().from(campaigns)).filter((row) => row.tenantId !== b.tenantId),
      links: (await tx.select().from(campaignTours)).filter((row) => row.tenantId !== b.tenantId),
      personal: (await tx.select().from(personalDiscounts)).filter((row) => row.tenantId !== b.tenantId),
      requests: (await tx.select().from(discountRequests)).filter((row) => row.tenantId !== b.tenantId),
    }));
    expect(seen).toEqual({ campaigns: [], links: [], personal: [], requests: [] });
  });

  it("leaves everything of A's exactly as it was seeded", async () => {
    const { a, campaignId, privateCampaignId, personalId, pendingRequestId, approvedRequestId } = world;
    const state = await asOwner(a, async (scope) => ({
      campaigns: (await listCampaigns(scope, TODAY)).map((c) => [c.id, c.status, c.uses]),
      personal: (await listPersonalDiscounts(scope, TODAY)).map((d) => [d.id, d.status]),
      requests: (await listDiscountRequests(scope)).map((r) => [r.id, r.status, r.usedByBookingId]),
    }));

    expect(state.campaigns).toHaveLength(2);
    expect(state.campaigns).toEqual(expect.arrayContaining([[campaignId, "active", 0], [privateCampaignId, "active", 0]]));
    expect(state.personal).toEqual([[personalId, "active"]]);
    expect(state.requests).toHaveLength(2);
    expect(state.requests).toEqual(expect.arrayContaining([[pendingRequestId, "pending", null], [approvedRequestId, "approved", null]]));
  });
});
