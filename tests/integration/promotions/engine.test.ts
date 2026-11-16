import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { bookings, campaigns, discountRequests, personalDiscounts } from "@/server/db/schema";
import type { TenantScope } from "@/server/db/context";
import { ConflictError } from "@/server/errors";
import { createCampaign, deleteCampaign, setCampaignActive } from "@/server/promotions/campaigns";
import { consumeDiscount, findBestDiscount, findEligibleDiscounts, type DiscountContext } from "@/server/promotions/engine";
import { assignPersonalDiscount, revokePersonalDiscount } from "@/server/promotions/personal-discounts";
import { approveDiscountRequest, listDiscountRequests, rejectDiscountRequest, submitDiscountRequest } from "@/server/promotions/requests";
import { createTenant, randomId, type TenantFixture } from "../../helpers/fixtures";
import { asOwner, auditActions, campaignInput, createTour, errorOf, insertBooking, TODAY, type TourFixture } from "../../helpers/promotions";

vi.mock("@/server/notifications", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

const EMAIL = "ada@example.test";

/** Two adults on a 690.00 tour travelling in April: base 1,380.00. */
function context(tour: TourFixture, overrides: Partial<DiscountContext> = {}): DiscountContext {
  return { tourId: tour.id, email: EMAIL, adults: 2, children: 0, baseAmount: 138_000, travelDate: "2027-04-17", today: TODAY, ...overrides };
}

async function setup(): Promise<{ tenant: TenantFixture; tour: TourFixture }> {
  const tenant = await createTenant();
  return { tenant, tour: await createTour(tenant) };
}

/** Submits and approves a discount request for `EMAIL`, returning its id. */
async function approvedRequest(scope: TenantScope, tour: TourFixture, decision: { type: "percent" | "fixed"; value: number }): Promise<string> {
  await submitDiscountRequest(scope, { tourId: tour.id, name: "Ada", email: EMAIL, adults: 2, type: "percent", value: 30 }, TODAY);
  const [request] = await listDiscountRequests(scope, { status: "pending" });
  await approveDiscountRequest(scope, request!.id, decision);
  return request!.id;
}

describe("findBestDiscount", () => {
  it("returns null when nothing applies", async () => {
    const { tenant, tour } = await setup();
    expect(await asOwner(tenant, (scope) => findBestDiscount(scope, context(tour)))).toBeNull();
  });

  it("applies a live public campaign to anyone, with a customer-facing label", async () => {
    const { tenant, tour } = await setup();
    const { campaign, best } = await asOwner(tenant, async (scope) => {
      const campaign = await createCampaign(scope, campaignInput(), TODAY);
      return { campaign, best: await findBestDiscount(scope, context(tour, { email: "" })) };
    });
    expect(best).toEqual({ source: "campaign", refId: campaign.id, label: "Autumn harvest — 15% off", amount: 20_700 });
  });

  it("words a fixed campaign in the tenant's currency and caps it at the price", async () => {
    const { tenant, tour } = await setup();
    const results = await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ name: "Early bird", type: "fixed", value: 30_000 }), TODAY);
      return {
        normal: await findBestDiscount(scope, context(tour)),
        cheap: await findBestDiscount(scope, context(tour, { baseAmount: 12_000 })),
        free: await findBestDiscount(scope, context(tour, { baseAmount: 0 })),
      };
    });
    expect(results.normal).toMatchObject({ label: "Early bird — $300 off", amount: 30_000 });
    expect(results.cheap).toMatchObject({ amount: 12_000 });
    // A discount worth nothing is not applied, so it cannot be consumed for nothing either.
    expect(results.free).toBeNull();
  });

  it.each([
    ["paused", { isActive: false }],
    ["not started yet", { startsOn: "2026-11-16", endsOn: "2026-12-15" }],
    ["already over", { startsOn: "2026-10-01", endsOn: "2026-11-14" }],
    ["private for someone else", { visibility: "private" as const, assignedEmails: ["bob@example.test"] }],
    ["for bigger groups", { minGuests: 3 }],
    ["for families", { minChildren: 1 }],
    ["for bookings further ahead", { bookAheadDays: 200 }],
  ])("skips a campaign that is %s", async (_name, overrides) => {
    const { tenant, tour } = await setup();
    const best = await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput(overrides), TODAY);
      return findBestDiscount(scope, context(tour));
    });
    expect(best).toBeNull();
  });

  it("applies conditional campaigns once the party meets the condition", async () => {
    const { tenant, tour } = await setup();
    const results = await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ name: "Groups", value: 8, minGuests: 4 }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Families", value: 12, minChildren: 2 }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Early", value: 20, bookAheadDays: 153 }), TODAY);
      const label = async (overrides: Partial<DiscountContext>) => (await findBestDiscount(scope, context(tour, overrides)))?.label ?? null;
      return {
        // 2026-11-15 → 2027-04-17 is exactly 153 days.
        farAhead: await label({}),
        oneDayShort: await label({ travelDate: "2027-04-16" }),
        group: await label({ travelDate: "2026-12-01", adults: 4 }),
        family: await label({ travelDate: "2026-12-01", adults: 2, children: 2 }),
      };
    });
    expect(results).toEqual({
      farAhead: "Early — 20% off",
      oneDayShort: null,
      group: "Groups — 8% off",
      family: "Families — 12% off",
    });
  });

  it("applies a private campaign only to its assigned e-mails, whatever their letter case", async () => {
    const { tenant, tour } = await setup();
    const results = await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ name: "Welcome back", visibility: "private", assignedEmails: [EMAIL] }), TODAY);
      return {
        assigned: await findBestDiscount(scope, context(tour, { email: " ADA@example.test " })),
        stranger: await findBestDiscount(scope, context(tour, { email: "eve@example.test" })),
        anonymous: await findBestDiscount(scope, context(tour, { email: "" })),
      };
    });
    expect(results.assigned).toMatchObject({ source: "campaign", label: "Welcome back — 15% off" });
    expect(results.stranger).toBeNull();
    expect(results.anonymous).toBeNull();
  });

  it("limits a tour-scoped campaign to its tours", async () => {
    const { tenant, tour } = await setup();
    const other = await createTour(tenant);
    const results = await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ appliesToAllTours: false, tourIds: [tour.id] }), TODAY);
      return { covered: await findBestDiscount(scope, context(tour)), notCovered: await findBestDiscount(scope, context(other)) };
    });
    expect(results.covered).toMatchObject({ source: "campaign" });
    expect(results.notCovered).toBeNull();
  });

  it("stops applying a campaign the moment it is paused or deleted", async () => {
    const { tenant, tour } = await setup();
    const results = await asOwner(tenant, async (scope) => {
      const paused = await createCampaign(scope, campaignInput(), TODAY);
      const before = await findBestDiscount(scope, context(tour));
      await setCampaignActive(scope, paused.id, false, TODAY);
      const afterPause = await findBestDiscount(scope, context(tour));
      await setCampaignActive(scope, paused.id, true, TODAY);
      await deleteCampaign(scope, paused.id);
      return { before, afterPause, afterDelete: await findBestDiscount(scope, context(tour)) };
    });
    expect(results.before).not.toBeNull();
    expect(results.afterPause).toBeNull();
    expect(results.afterDelete).toBeNull();
  });

  describe("personal discounts", () => {
    it("applies one with no expiry date, today and far in the future", async () => {
      const { tenant, tour } = await setup();
      const results = await asOwner(tenant, async (scope) => {
        const { discount } = await assignPersonalDiscount(scope, { customerName: "Ada", email: EMAIL, type: "percent", value: 10 }, TODAY);
        return {
          id: discount.id,
          now: await findBestDiscount(scope, context(tour)),
          inTenYears: await findBestDiscount(scope, context(tour, { today: "2036-11-15", travelDate: "2037-04-17" })),
        };
      });
      expect(results.now).toEqual({ source: "personal", refId: results.id, label: "Personal discount — 10% off", amount: 13_800 });
      expect(results.inTenYears).toMatchObject({ source: "personal", refId: results.id });
    });

    it("applies one up to and including its expiry day, and not after", async () => {
      const { tenant, tour } = await setup();
      const results = await asOwner(tenant, async (scope) => {
        await assignPersonalDiscount(scope, { customerName: "Ada", email: EMAIL, type: "percent", value: 10, expiresOn: "2026-11-30" }, TODAY);
        return {
          onTheDay: await findBestDiscount(scope, context(tour, { today: "2026-11-30" })),
          dayAfter: await findBestDiscount(scope, context(tour, { today: "2026-12-01" })),
        };
      });
      expect(results.onTheDay).toMatchObject({ source: "personal" });
      expect(results.dayAfter).toBeNull();
    });

    it("never applies a revoked one", async () => {
      const { tenant, tour } = await setup();
      const best = await asOwner(tenant, async (scope) => {
        const { discount } = await assignPersonalDiscount(scope, { customerName: "Ada", email: EMAIL, type: "percent", value: 10 }, TODAY);
        await revokePersonalDiscount(scope, discount.id);
        return findBestDiscount(scope, context(tour));
      });
      expect(best).toBeNull();
    });

    it("never applies a used one", async () => {
      const { tenant, tour } = await setup();
      const best = await asOwner(tenant, async (scope) => {
        const { discount } = await assignPersonalDiscount(scope, { customerName: "Ada", email: EMAIL, type: "percent", value: 10 }, TODAY);
        await consumeDiscount(scope, { source: "personal", refId: discount.id, label: "x", amount: 1 }, await insertBooking(scope, tour));
        return findBestDiscount(scope, context(tour));
      });
      expect(best).toBeNull();
    });

    it("belongs to one e-mail and, when scoped, to one tour", async () => {
      const { tenant, tour } = await setup();
      const other = await createTour(tenant);
      const results = await asOwner(tenant, async (scope) => {
        await assignPersonalDiscount(scope, { customerName: "Ada", email: EMAIL, tourId: tour.id, type: "percent", value: 10 }, TODAY);
        return {
          rightTour: await findBestDiscount(scope, context(tour)),
          otherTour: await findBestDiscount(scope, context(other)),
          otherEmail: await findBestDiscount(scope, context(tour, { email: "eve@example.test" })),
          noEmail: await findBestDiscount(scope, context(tour, { email: "" })),
        };
      });
      expect(results.rightTour).toMatchObject({ source: "personal" });
      expect(results.otherTour).toBeNull();
      expect(results.otherEmail).toBeNull();
      expect(results.noEmail).toBeNull();
    });
  });

  describe("approved requests", () => {
    it("applies what was approved, not what was asked, to the same e-mail and tour only", async () => {
      const { tenant, tour } = await setup();
      const other = await createTour(tenant);
      const results = await asOwner(tenant, async (scope) => {
        const id = await approvedRequest(scope, tour, { type: "percent", value: 8 });
        return {
          id,
          match: await findBestDiscount(scope, context(tour)),
          otherTour: await findBestDiscount(scope, context(other)),
          otherEmail: await findBestDiscount(scope, context(tour, { email: "eve@example.test" })),
        };
      });
      expect(results.match).toEqual({ source: "request", refId: results.id, label: "Approved request DR-1001 — 8% off", amount: 11_040 });
      expect(results.otherTour).toBeNull();
      expect(results.otherEmail).toBeNull();
    });

    it("ignores requests that are pending, rejected or already used", async () => {
      const { tenant, tour } = await setup();
      const results = await asOwner(tenant, async (scope) => {
        await submitDiscountRequest(scope, { tourId: tour.id, name: "Ada", email: EMAIL, adults: 2, type: "percent", value: 10 }, TODAY);
        const pending = await findBestDiscount(scope, context(tour));
        const [request] = await listDiscountRequests(scope);
        await rejectDiscountRequest(scope, request!.id, { reason: "Peak dates" });
        const rejected = await findBestDiscount(scope, context(tour));

        const approvedId = await approvedRequest(scope, tour, { type: "percent", value: 5 });
        await consumeDiscount(scope, { source: "request", refId: approvedId, label: "x", amount: 1 }, await insertBooking(scope, tour));
        return { pending, rejected, used: await findBestDiscount(scope, context(tour)) };
      });
      expect(results).toEqual({ pending: null, rejected: null, used: null });
    });
  });

  describe("choosing between candidates", () => {
    it("returns only the best of several, by amount", async () => {
      const { tenant, tour } = await setup();
      const { all, best } = await asOwner(tenant, async (scope) => {
        await createCampaign(scope, campaignInput({ name: "Small", value: 5 }), TODAY);
        await createCampaign(scope, campaignInput({ name: "Fixed", type: "fixed", value: 25_000 }), TODAY);
        await assignPersonalDiscount(scope, { customerName: "Ada", email: EMAIL, type: "percent", value: 12 }, TODAY);
        await approvedRequest(scope, tour, { type: "percent", value: 20 });
        return { all: await findEligibleDiscounts(scope, context(tour)), best: await findBestDiscount(scope, context(tour)) };
      });

      expect(all.map((d) => [d.source, d.amount])).toEqual([
        ["request", 27_600],
        ["campaign", 25_000],
        ["personal", 16_560],
        ["campaign", 6_900],
      ]);
      expect(best).toEqual(all[0]);
    });

    it("on a tie prefers the campaign, so a single-use discount is not spent for nothing", async () => {
      const { tenant, tour } = await setup();
      const all = await asOwner(tenant, async (scope) => {
        await approvedRequest(scope, tour, { type: "percent", value: 10 });
        await assignPersonalDiscount(scope, { customerName: "Ada", email: EMAIL, type: "fixed", value: 13_800 }, TODAY);
        await createCampaign(scope, campaignInput({ value: 10 }), TODAY);
        return findEligibleDiscounts(scope, context(tour));
      });
      expect(all.map((d) => [d.source, d.amount])).toEqual([
        ["campaign", 13_800],
        ["personal", 13_800],
        ["request", 13_800],
      ]);
    });

    it("on a tie between single-use discounts prefers the personal one", async () => {
      const { tenant, tour } = await setup();
      const best = await asOwner(tenant, async (scope) => {
        await approvedRequest(scope, tour, { type: "percent", value: 10 });
        await assignPersonalDiscount(scope, { customerName: "Ada", email: EMAIL, type: "percent", value: 10 }, TODAY);
        return findBestDiscount(scope, context(tour));
      });
      expect(best).toMatchObject({ source: "personal", amount: 13_800 });
    });

    it("lets a fixed amount beat a percentage on a cheap booking and lose on a dear one", async () => {
      const { tenant, tour } = await setup();
      const results = await asOwner(tenant, async (scope) => {
        await createCampaign(scope, campaignInput({ name: "Ten percent", value: 10 }), TODAY);
        await createCampaign(scope, campaignInput({ name: "Fifty off", type: "fixed", value: 5_000 }), TODAY);
        return {
          cheap: await findBestDiscount(scope, context(tour, { baseAmount: 20_000 })),
          dear: await findBestDiscount(scope, context(tour, { baseAmount: 200_000 })),
        };
      });
      expect(results.cheap).toMatchObject({ label: "Fifty off — $50 off", amount: 5_000 });
      expect(results.dear).toMatchObject({ label: "Ten percent — 10% off", amount: 20_000 });
    });
  });
});

describe("consumeDiscount", () => {
  it("counts a campaign use without making it single-use", async () => {
    const { tenant, tour } = await setup();
    const { uses, stillApplies, id } = await asOwner(tenant, async (scope) => {
      const campaign = await createCampaign(scope, campaignInput(), TODAY);
      const applied = (await findBestDiscount(scope, context(tour)))!;
      await consumeDiscount(scope, applied, await insertBooking(scope, tour));
      await consumeDiscount(scope, applied, await insertBooking(scope, tour));
      const [row] = await scope.tx.select({ uses: campaigns.uses }).from(campaigns).where(eq(campaigns.id, campaign.id));
      return { uses: row?.uses, stillApplies: await findBestDiscount(scope, context(tour)), id: campaign.id };
    });
    expect(uses).toBe(2);
    expect(stillApplies).toMatchObject({ source: "campaign", refId: id });
  });

  it("refuses a campaign that no longer exists", async () => {
    const { tenant } = await setup();
    const error = await errorOf(() =>
      asOwner(tenant, (scope) => consumeDiscount(scope, { source: "campaign", refId: randomId(), label: "gone", amount: 100 }, randomId())),
    );
    expect(error).toBeInstanceOf(ConflictError);
  });

  it("locks a personal discount to the booking and records the redemption", async () => {
    const { tenant, tour } = await setup();
    const { row, bookingId, id } = await asOwner(tenant, async (scope) => {
      await assignPersonalDiscount(scope, { customerName: "Ada", email: EMAIL, type: "percent", value: 10 }, TODAY);
      const applied = (await findBestDiscount(scope, context(tour)))!;
      const bookingId = await insertBooking(scope, tour, EMAIL);
      await consumeDiscount(scope, applied, bookingId);
      const [row] = await scope.tx.select().from(personalDiscounts).where(eq(personalDiscounts.id, applied.refId));
      return { row, bookingId, id: applied.refId };
    });
    expect(row?.usedByBookingId).toBe(bookingId);
    expect(await auditActions(tenant, id)).toContain("promotions.discount_redeemed");
  });

  it("locks an approved request to the booking", async () => {
    const { tenant, tour } = await setup();
    const { row, bookingId } = await asOwner(tenant, async (scope) => {
      const id = await approvedRequest(scope, tour, { type: "percent", value: 10 });
      const bookingId = await insertBooking(scope, tour, EMAIL);
      await consumeDiscount(scope, (await findBestDiscount(scope, context(tour)))!, bookingId);
      const [row] = await scope.tx.select().from(discountRequests).where(eq(discountRequests.id, id));
      return { row, bookingId };
    });
    expect(row?.usedByBookingId).toBe(bookingId);
  });

  it.each(["personal", "request"] as const)("refuses to spend a %s discount twice", async (source) => {
    const { tenant, tour } = await setup();
    const error = await asOwner(tenant, async (scope) => {
      if (source === "personal") await assignPersonalDiscount(scope, { customerName: "Ada", email: EMAIL, type: "percent", value: 10 }, TODAY);
      else await approvedRequest(scope, tour, { type: "percent", value: 10 });
      const applied = (await findBestDiscount(scope, context(tour)))!;
      expect(applied.source).toBe(source);
      await consumeDiscount(scope, applied, await insertBooking(scope, tour));
      const second = await insertBooking(scope, tour);
      return errorOf(() => consumeDiscount(scope, applied, second));
    });
    expect(error).toBeInstanceOf(ConflictError);
  });

  it("refuses a personal discount revoked after the quote, and a request that was never approved", async () => {
    const { tenant, tour } = await setup();
    const errors = await asOwner(tenant, async (scope) => {
      const { discount } = await assignPersonalDiscount(scope, { customerName: "Ada", email: EMAIL, type: "percent", value: 10 }, TODAY);
      const quoted = (await findBestDiscount(scope, context(tour)))!;
      await revokePersonalDiscount(scope, discount.id);

      await submitDiscountRequest(scope, { tourId: tour.id, name: "Ada", email: EMAIL, adults: 2, type: "percent", value: 10 }, TODAY);
      const [pending] = await listDiscountRequests(scope, { status: "pending" });
      const bookingId = await insertBooking(scope, tour);
      return {
        revoked: await errorOf(() => consumeDiscount(scope, quoted, bookingId)),
        pending: await errorOf(() => consumeDiscount(scope, { source: "request", refId: pending!.id, label: "x", amount: 1 }, bookingId)),
      };
    });
    expect(errors.revoked).toBeInstanceOf(ConflictError);
    expect(errors.pending).toBeInstanceOf(ConflictError);
  });

  it("lets exactly one of two concurrent bookings spend the same personal discount", async () => {
    const { tenant, tour } = await setup();
    const { discount } = await asOwner(tenant, (scope) =>
      assignPersonalDiscount(scope, { customerName: "Ada", email: EMAIL, type: "percent", value: 10 }, TODAY),
    );

    // Each booking runs in its own transaction, as two requests would: quote,
    // create the booking, then consume. Both quote before either commits.
    const bothQuoted = barrier(2);
    const book = () =>
      asOwner(tenant, async (scope) => {
        const applied = await findBestDiscount(scope, context(tour));
        await bothQuoted();
        const bookingId = await insertBooking(scope, tour);
        await consumeDiscount(scope, applied!, bookingId);
        return bookingId;
      });

    const outcomes = await Promise.allSettled([book(), book()]);
    const won = outcomes.filter((o): o is PromiseFulfilledResult<string> => o.status === "fulfilled");
    const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]!.reason).toBeInstanceOf(ConflictError);

    const after = await asOwner(tenant, async (scope) => ({
      discount: await scope.tx.select().from(personalDiscounts).where(eq(personalDiscounts.id, discount.id)),
      bookings: await scope.tx.select({ id: bookings.id }).from(bookings),
    }));
    // The loser's booking rolled back with its transaction; the winner owns the discount.
    expect(after.bookings).toEqual([{ id: won[0]!.value }]);
    expect(after.discount[0]?.usedByBookingId).toBe(won[0]!.value);
    expect((await auditActions(tenant, discount.id)).filter((a) => a === "promotions.discount_redeemed")).toHaveLength(1);
  });

  it("lets exactly one of two concurrent bookings spend the same approved request", async () => {
    const { tenant, tour } = await setup();
    const id = await asOwner(tenant, (scope) => approvedRequest(scope, tour, { type: "percent", value: 10 }));

    const book = () =>
      asOwner(tenant, async (scope) => {
        const bookingId = await insertBooking(scope, tour);
        await consumeDiscount(scope, { source: "request", refId: id, label: "x", amount: 1 }, bookingId);
        return bookingId;
      });
    const outcomes = await Promise.allSettled([book(), book(), book()]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(rejected).toHaveLength(2);
    for (const outcome of rejected) expect(outcome.reason).toBeInstanceOf(ConflictError);
  });
});

/** Resolves for every caller once `parties` callers are waiting. */
function barrier(parties: number): () => Promise<void> {
  let waiting = 0;
  let release!: () => void;
  const opened = new Promise<void>((resolve) => (release = resolve));
  return () => {
    waiting += 1;
    if (waiting >= parties) release();
    return opened;
  };
}
