import { describe, expect, it } from "vitest";
import { auditLogs } from "@/server/db/schema";
import { LimitExceededError, ValidationError } from "@/server/errors";
import { createCampaign, setCampaignActive } from "@/server/promotions/campaigns";
import { bestPublicPriceFor, countPublicOffers, getPublicRequestSettings, listPublicOffers } from "@/server/promotions/offers";
import { changePromotionSettings } from "@/server/promotions/settings";
import { getPromotionSettings } from "@/server/settings/tenant-settings";
import { createTenant, randomId } from "../../helpers/fixtures";
import { asOwner, asVisitor, auditActions, campaignInput, createTour, errorOf, TODAY } from "../../helpers/promotions";

describe("listPublicOffers", () => {
  it("is empty when nothing is running", async () => {
    const tenant = await createTenant();
    await createTour(tenant);
    expect(await asVisitor(tenant, (scope) => listPublicOffers(scope, TODAY))).toEqual([]);
    expect(await asVisitor(tenant, (scope) => countPublicOffers(scope, TODAY))).toBe(0);
  });

  it("lists only campaigns that are public and live today", async () => {
    const tenant = await createTenant();
    await createTour(tenant);
    await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ name: "Live" }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Private", visibility: "private", assignedEmails: ["ada@example.test"] }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Scheduled", startsOn: "2026-12-01", endsOn: "2026-12-31" }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Expired", startsOn: "2026-10-01", endsOn: "2026-10-31" }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Paused", isActive: false }), TODAY);
    });

    const names = async (today: string) => (await asVisitor(tenant, (scope) => listPublicOffers(scope, today))).map((offer) => offer.name).sort();
    expect(await names(TODAY)).toEqual(["Live"]);
    // Only the day changed: one campaign's window has opened, the other is still running.
    expect(await names("2026-12-10")).toEqual(["Live", "Scheduled"]);
    expect(await asVisitor(tenant, (scope) => countPublicOffers(scope, TODAY))).toBe(1);
  });

  it("never exposes a campaign's audience, code or use count", async () => {
    const tenant = await createTenant();
    await createTour(tenant);
    await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ name: "Live", code: "SECRETCODE", blurb: "Golden season" }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Hidden", visibility: "private", assignedEmails: ["vip@example.test"] }), TODAY);
    });

    const offers = await asVisitor(tenant, (scope) => listPublicOffers(scope, TODAY));
    expect(offers).toHaveLength(1);
    expect(Object.keys(offers[0]!).sort()).toEqual(
      ["appliesToAllTours", "blurb", "bookAheadDays", "endsOn", "id", "isConditional", "minChildren", "minGuests", "name", "startsOn", "tours", "type", "value"].sort(),
    );
    expect(JSON.stringify(offers)).not.toMatch(/SECRETCODE|vip@example\.test|Hidden|assignedEmails|uses/);
  });

  it("shows the published tours an offer covers, with a per-adult price for unconditional percentages", async () => {
    const tenant = await createTenant();
    const sheki = await createTour(tenant, { title: "Sheki", priceAdult: 69_000, sortOrder: 1 });
    await createTour(tenant, { title: "Baku", priceAdult: 12_000, sortOrder: 2 });
    await createTour(tenant, { title: "Draft tour", status: "draft" });
    await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ name: "Everything", value: 15 }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Sheki only", value: 10, appliesToAllTours: false, tourIds: [sheki.id] }), TODAY);
    });

    const offers = Object.fromEntries((await asVisitor(tenant, (scope) => listPublicOffers(scope, TODAY))).map((offer) => [offer.name, offer]));
    expect(offers["Everything"]).toMatchObject({ appliesToAllTours: true, isConditional: false, type: "percent", value: 15 });
    expect(offers["Everything"]!.tours.map((tour) => [tour.title, tour.priceAdult, tour.discountedPriceAdult])).toEqual([
      ["Sheki", 69_000, 58_650],
      ["Baku", 12_000, 10_200],
    ]);
    expect(offers["Sheki only"]!.tours).toEqual([
      { id: sheki.id, slug: expect.any(String), title: "Sheki", priceAdult: 69_000, discountedPriceAdult: 62_100 },
    ]);
    expect(JSON.stringify(offers)).not.toContain("Draft tour");
  });

  it("gives no per-adult price for fixed or conditional offers", async () => {
    const tenant = await createTenant();
    await createTour(tenant, { priceAdult: 69_000 });
    await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ name: "Fixed", type: "fixed", value: 30_000 }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Groups", value: 8, minGuests: 6 }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Families", value: 12, minChildren: 1 }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Early bird", value: 20, bookAheadDays: 60 }), TODAY);
    });

    const offers = await asVisitor(tenant, (scope) => listPublicOffers(scope, TODAY));
    expect(Object.fromEntries(offers.map((offer) => [offer.name, [offer.isConditional, offer.tours[0]!.discountedPriceAdult]]))).toEqual({
      Fixed: [false, null],
      Groups: [true, null],
      Families: [true, null],
      "Early bird": [true, null],
    });
    expect(offers.find((offer) => offer.name === "Groups")).toMatchObject({ minGuests: 6, minChildren: 0, bookAheadDays: 0 });
  });

  it("leaves out an offer none of whose tours is published, and counts the same way", async () => {
    const tenant = await createTenant();
    const draft = await createTour(tenant, { status: "draft" });
    await asOwner(tenant, (scope) => createCampaign(scope, campaignInput({ appliesToAllTours: false, tourIds: [draft.id] }), TODAY));

    expect(await asVisitor(tenant, (scope) => listPublicOffers(scope, TODAY))).toEqual([]);
    expect(await asVisitor(tenant, (scope) => countPublicOffers(scope, TODAY))).toBe(0);
  });
});

describe("bestPublicPriceFor", () => {
  it("returns list prices when there is no offer", async () => {
    const tenant = await createTenant();
    const tour = await createTour(tenant, { priceAdult: 69_000 });
    expect(await asVisitor(tenant, (scope) => bestPublicPriceFor(scope, [tour.id], TODAY))).toEqual({
      [tour.id]: { tourId: tour.id, priceAdult: 69_000, discountedPriceAdult: null, offer: null },
    });
  });

  it("returns nothing for no ids, unknown ids and unpublished tours", async () => {
    const tenant = await createTenant();
    const draft = await createTour(tenant, { status: "draft" });
    await asOwner(tenant, (scope) => createCampaign(scope, campaignInput(), TODAY));

    expect(await asVisitor(tenant, (scope) => bestPublicPriceFor(scope, [], TODAY))).toEqual({});
    expect(await asVisitor(tenant, (scope) => bestPublicPriceFor(scope, [randomId(), draft.id], TODAY))).toEqual({});
  });

  it("shows the best unconditional percentage as a discounted from-price", async () => {
    const tenant = await createTenant();
    const tour = await createTour(tenant, { priceAdult: 69_000 });
    const best = await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ name: "Small", value: 5 }), TODAY);
      return createCampaign(scope, campaignInput({ name: "Autumn", value: 15, endsOn: "2026-12-15" }), TODAY);
    });

    const prices = await asVisitor(tenant, (scope) => bestPublicPriceFor(scope, [tour.id, tour.id], TODAY));
    expect(prices[tour.id]).toEqual({
      tourId: tour.id,
      priceAdult: 69_000,
      discountedPriceAdult: 58_650,
      offer: { id: best.id, name: "Autumn", type: "percent", value: 15, endsOn: "2026-12-15" },
    });
  });

  it("ignores every conditional campaign, including book-ahead ones", async () => {
    const tenant = await createTenant();
    const tour = await createTour(tenant, { priceAdult: 69_000 });
    await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ name: "Groups", value: 40, minGuests: 6 }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Families", value: 40, minChildren: 1 }), TODAY);
      // The design's card pricing showed this one as if anyone could have it.
      await createCampaign(scope, campaignInput({ name: "Early bird", type: "fixed", value: 30_000, bookAheadDays: 60 }), TODAY);
    });

    const conditionalOnly = await asVisitor(tenant, (scope) => bestPublicPriceFor(scope, [tour.id], TODAY));
    expect(conditionalOnly[tour.id]).toMatchObject({ discountedPriceAdult: null, offer: null });

    await asOwner(tenant, (scope) => createCampaign(scope, campaignInput({ name: "Everyone", value: 5 }), TODAY));
    const withOpenOffer = await asVisitor(tenant, (scope) => bestPublicPriceFor(scope, [tour.id], TODAY));
    expect(withOpenOffer[tour.id]).toMatchObject({ discountedPriceAdult: 65_550, offer: { name: "Everyone" } });
  });

  it("ignores private, paused, scheduled and expired campaigns", async () => {
    const tenant = await createTenant();
    const tour = await createTour(tenant);
    await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ visibility: "private", assignedEmails: ["ada@example.test"], value: 50 }), TODAY);
      await createCampaign(scope, campaignInput({ startsOn: "2026-12-01", endsOn: "2026-12-31", value: 50 }), TODAY);
      await createCampaign(scope, campaignInput({ startsOn: "2026-10-01", endsOn: "2026-10-31", value: 50 }), TODAY);
      const paused = await createCampaign(scope, campaignInput({ value: 50 }), TODAY);
      await setCampaignActive(scope, paused.id, false, TODAY);
    });
    const prices = await asVisitor(tenant, (scope) => bestPublicPriceFor(scope, [tour.id], TODAY));
    expect(prices[tour.id]).toMatchObject({ discountedPriceAdult: null, offer: null });
  });

  it("keeps the list price for a fixed offer, which comes off the booking rather than each adult", async () => {
    const tenant = await createTenant();
    const tour = await createTour(tenant, { priceAdult: 245_000 });
    await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ name: "Ten percent", value: 10 }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Three hundred off", type: "fixed", value: 30_000 }), TODAY);
    });
    const prices = await asVisitor(tenant, (scope) => bestPublicPriceFor(scope, [tour.id], TODAY));
    // 300.00 beats 10% of 2,450.00 = 245.00, so the fixed offer is the badge.
    expect(prices[tour.id]).toMatchObject({ priceAdult: 245_000, discountedPriceAdult: null, offer: { name: "Three hundred off", type: "fixed", value: 30_000 } });
  });

  it("respects each campaign's tour scope across several tours", async () => {
    const tenant = await createTenant();
    const [covered, other] = [await createTour(tenant, { priceAdult: 10_000 }), await createTour(tenant, { priceAdult: 20_000 })];
    await asOwner(tenant, (scope) => createCampaign(scope, campaignInput({ value: 20, appliesToAllTours: false, tourIds: [covered.id] }), TODAY));

    const prices = await asVisitor(tenant, (scope) => bestPublicPriceFor(scope, [covered.id, other.id], TODAY));
    expect(prices[covered.id]).toMatchObject({ discountedPriceAdult: 8_000 });
    expect(prices[other.id]).toMatchObject({ discountedPriceAdult: null, offer: null });
  });
});

describe("promotion settings", () => {
  it("exposes only what a storefront may know", async () => {
    const tenant = await createTenant();
    const settings = await asVisitor(tenant, (scope) => getPublicRequestSettings(scope));
    expect(settings).toEqual({ requestsEnabled: true, responseDays: 2 });
  });

  it("changes only the fields supplied and audits which ones changed, not their values", async () => {
    const tenant = await createTenant();
    const { first, second, stored } = await asOwner(tenant, async (scope) => {
      const first = await changePromotionSettings(scope, { maxRequestPercent: 45 });
      const second = await changePromotionSettings(scope, { requestsEnabled: false, responseDays: 3, maxRequestPercent: undefined });
      return { first, second, stored: await getPromotionSettings(scope) };
    });

    expect(first).toEqual({ requestsEnabled: true, maxRequestPercent: 45, responseDays: 2 });
    // The maximum survived a later patch that did not mention it.
    expect(second).toEqual({ requestsEnabled: false, maxRequestPercent: 45, responseDays: 3 });
    expect(stored).toEqual(second);

    const entries = await asOwner(tenant, ({ tx }) => tx.select({ action: auditLogs.action, metadata: auditLogs.metadata }).from(auditLogs));
    const changes = entries.filter((entry) => entry.action === "promotions.settings_changed").map((entry) => (entry.metadata.changed as string[]).sort());
    expect(changes).toHaveLength(2);
    expect(changes).toEqual(expect.arrayContaining([["maxRequestPercent"], ["requestsEnabled", "responseDays"]]));
    expect(JSON.stringify(entries)).not.toContain("45");
  });

  it("writes no audit entry when nothing changed", async () => {
    const tenant = await createTenant();
    await asOwner(tenant, (scope) => changePromotionSettings(scope, { responseDays: 2 }));
    expect(await auditActions(tenant)).not.toContain("promotions.settings_changed");
  });

  it.each([
    ["a maximum of zero", { maxRequestPercent: 0 }, "maxRequestPercent"],
    ["a maximum above 90", { maxRequestPercent: 91 }, "maxRequestPercent"],
    ["a fractional maximum", { maxRequestPercent: 12.5 }, "maxRequestPercent"],
    ["a response time of four days", { responseDays: 4 }, "responseDays"],
    ["a switch that is not a boolean", { requestsEnabled: "yes" as never }, "requestsEnabled"],
  ])("rejects %s", async (_name, patch, field) => {
    const tenant = await createTenant();
    const error = await errorOf(() => asOwner(tenant, (scope) => changePromotionSettings(scope, patch)));
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors ?? {})).toEqual([field]);
    expect(await asOwner(tenant, (scope) => getPromotionSettings(scope))).toEqual({ requestsEnabled: true, maxRequestPercent: 30, responseDays: 2 });
  });

  it("rejects settings it does not know", async () => {
    const tenant = await createTenant();
    const error = await errorOf(() => asOwner(tenant, (scope) => changePromotionSettings(scope, { stacking: "all" } as never)));
    expect(error).toBeInstanceOf(ValidationError);
  });

  it("requires the promotions feature", async () => {
    const tenant = await createTenant({ plan: { features: { promotions: false } } });
    expect(await errorOf(() => asOwner(tenant, (scope) => changePromotionSettings(scope, { responseDays: 1 })))).toBeInstanceOf(LimitExceededError);
  });
});
