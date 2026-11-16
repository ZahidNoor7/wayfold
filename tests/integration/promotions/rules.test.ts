import { describe, expect, it } from "vitest";
import { campaignStatus } from "@/server/promotions/campaigns";
import { campaignApplies, discountAmount, rankDiscounts, type AppliedDiscount, type CampaignRules } from "@/server/promotions/engine";
import { personalDiscountStatus } from "@/server/promotions/personal-discounts";
import { approvalLimits } from "@/server/promotions/requests";
import { childUnitPrice, formatDiscount, partyBaseAmount, pgError } from "@/server/promotions/shared";

const TODAY = "2026-11-15";

describe("discountAmount", () => {
  it.each([
    // type, value, base, expected
    ["percent", 15, 138_000, 20_700],
    ["percent", 90, 100, 90],
    ["percent", 10, 1_005, 101], // 100.5 rounds half up
    ["percent", 10, 1_004, 100],
    ["percent", 33, 1, 0], // rounds to nothing on a tiny price
    ["percent", 50, 0, 0],
    ["percent", 0, 10_000, 0],
    ["percent", 150, 10_000, 10_000], // never more than the price
    ["fixed", 30_000, 138_000, 30_000],
    ["fixed", 30_000, 12_000, 12_000], // capped at the price
    ["fixed", 30_000, 30_000, 30_000],
    ["fixed", 30_000, 0, 0],
    ["fixed", 30_000, -500, 0],
    ["fixed", -5, 10_000, 0],
  ] as const)("%s %i on %i takes off %i", (type, value, base, expected) => {
    expect(discountAmount(type, value, base)).toBe(expected);
  });
});

describe("rankDiscounts", () => {
  const candidate = (source: AppliedDiscount["source"], amount: number, refId = `${source}-${amount}`): AppliedDiscount => ({
    source,
    refId,
    label: refId,
    amount,
  });
  const order = (candidates: AppliedDiscount[]) => rankDiscounts(candidates).map((c) => c.refId);

  it.each([
    ["the largest amount wins whatever its source", [candidate("campaign", 100), candidate("request", 300), candidate("personal", 200)], ["request-300", "personal-200", "campaign-100"]],
    ["a tie prefers the campaign", [candidate("request", 200), candidate("personal", 200), candidate("campaign", 200)], ["campaign-200", "personal-200", "request-200"]],
    ["a tie without a campaign prefers the personal discount", [candidate("request", 200), candidate("personal", 200)], ["personal-200", "request-200"]],
    ["a larger single-use discount still beats a campaign", [candidate("campaign", 200), candidate("personal", 201)], ["personal-201", "campaign-200"]],
    ["equal campaigns keep the order they were given in", [candidate("campaign", 200, "newer"), candidate("campaign", 200, "older")], ["newer", "older"]],
    ["discounts worth nothing are dropped", [candidate("campaign", 0), candidate("personal", -5), candidate("request", 1)], ["request-1"]],
    ["nothing in, nothing out", [], []],
  ])("%s", (_name, candidates, expected) => {
    expect(order(candidates)).toEqual(expected);
  });

  it("does not reorder the caller's array", () => {
    const candidates = [candidate("request", 1), candidate("campaign", 2)];
    rankDiscounts(candidates);
    expect(candidates.map((c) => c.source)).toEqual(["request", "campaign"]);
  });
});

describe("campaignStatus", () => {
  it.each([
    [{ isActive: true, startsOn: "2026-11-01", endsOn: "2026-12-15" }, "active"],
    [{ isActive: true, startsOn: TODAY, endsOn: TODAY }, "active"], // both ends inclusive
    [{ isActive: true, startsOn: "2026-11-16", endsOn: "2026-12-15" }, "scheduled"],
    [{ isActive: true, startsOn: "2026-10-01", endsOn: "2026-11-14" }, "expired"],
    [{ isActive: false, startsOn: "2026-11-01", endsOn: "2026-12-15" }, "inactive"],
    [{ isActive: false, startsOn: "2026-10-01", endsOn: "2026-11-14" }, "inactive"], // switched off wins over expired
    [{ isActive: false, startsOn: "2027-01-01", endsOn: "2027-02-01" }, "inactive"], // and over scheduled
  ] as const)("%o is %s", (campaign, expected) => {
    expect(campaignStatus(campaign, TODAY)).toBe(expected);
  });
});

describe("campaignApplies", () => {
  const open: CampaignRules = {
    isActive: true,
    startsOn: "2026-11-01",
    endsOn: "2026-12-15",
    visibility: "public",
    assignedEmails: [],
    minGuests: 0,
    minChildren: 0,
    bookAheadDays: 0,
  };
  const party = { email: "ada@example.test", adults: 2, children: 0, travelDate: "2026-12-01", today: TODAY };

  it.each([
    ["an open public campaign", {}, {}, true],
    ["a paused campaign", { isActive: false }, {}, false],
    ["an expired campaign", { endsOn: "2026-11-14" }, {}, false],
    ["a scheduled campaign", { startsOn: "2026-11-16" }, {}, false],
    ["a private campaign for this e-mail", { visibility: "private", assignedEmails: ["ada@example.test"] }, {}, true],
    ["a private campaign for someone else", { visibility: "private", assignedEmails: ["bob@example.test"] }, {}, false],
    ["a private campaign with no e-mail known", { visibility: "private", assignedEmails: [""] }, { email: "" }, false],
    ["minGuests met exactly, children counted", { minGuests: 4 }, { adults: 2, children: 2 }, true],
    ["minGuests missed by one", { minGuests: 4 }, { adults: 2, children: 1 }, false],
    ["minChildren met", { minChildren: 1 }, { children: 1 }, true],
    ["minChildren missed", { minChildren: 1 }, {}, false],
    ["booked exactly far enough ahead", { bookAheadDays: 16 }, {}, true],
    ["booked one day too late", { bookAheadDays: 17 }, {}, false],
  ] as const)("%s → %s", (_name, campaign, context, expected) => {
    expect(campaignApplies({ ...open, ...campaign } as CampaignRules, { ...party, ...context })).toBe(expected);
  });
});

describe("personalDiscountStatus", () => {
  const at = new Date("2026-11-01T10:00:00Z");
  it.each([
    [{ revokedAt: null, usedByBookingId: null, expiresOn: null }, "active"], // no expiry never expires
    [{ revokedAt: null, usedByBookingId: null, expiresOn: TODAY }, "active"], // the expiry day itself still counts
    [{ revokedAt: null, usedByBookingId: null, expiresOn: "2026-11-14" }, "expired"],
    [{ revokedAt: null, usedByBookingId: "b1", expiresOn: "2026-11-14" }, "used"], // used wins over expired
    [{ revokedAt: at, usedByBookingId: "b1", expiresOn: "2026-11-14" }, "revoked"], // revoked wins over everything
    [{ revokedAt: at, usedByBookingId: null, expiresOn: null }, "revoked"],
  ] as const)("%o is %s", (discount, expected) => {
    expect(personalDiscountStatus(discount, TODAY)).toBe(expected);
  });
});

describe("approvalLimits", () => {
  // One adult and two children on a 1,000.00 tour with children at 50%: the party pays 2,000.00.
  const base = 200_000;

  it.each([
    [
      "a percentage request within the maximum",
      { type: "percent", value: 20 },
      30,
      { asked: { percent: 20, fixed: 40_000 }, cap: { percent: 30, fixed: 60_000 }, maxPercent: 20, maxFixed: 40_000 },
    ],
    [
      "a percentage request above a maximum that was lowered since",
      { type: "percent", value: 25 },
      10,
      { asked: { percent: 25, fixed: 50_000 }, cap: { percent: 10, fixed: 20_000 }, maxPercent: 10, maxFixed: 20_000 },
    ],
    [
      "a fixed request exactly at the maximum can be approved in full",
      { type: "fixed", value: 60_000 },
      30,
      { asked: { percent: 30, fixed: 60_000 }, cap: { percent: 30, fixed: 60_000 }, maxPercent: 30, maxFixed: 60_000 },
    ],
    [
      "a fixed request above a lowered maximum",
      { type: "fixed", value: 60_000 },
      10,
      { asked: { percent: 30, fixed: 60_000 }, cap: { percent: 10, fixed: 20_000 }, maxPercent: 10, maxFixed: 20_000 },
    ],
    [
      "a fixed request that is not a whole percentage rounds down, never up",
      { type: "fixed", value: 39_999 },
      30,
      { asked: { percent: 19, fixed: 39_999 }, cap: { percent: 30, fixed: 60_000 }, maxPercent: 19, maxFixed: 39_999 },
    ],
    [
      "a fixed request too small to be a whole percent",
      { type: "fixed", value: 500 },
      30,
      { asked: { percent: 0, fixed: 500 }, cap: { percent: 30, fixed: 60_000 }, maxPercent: 0, maxFixed: 500 },
    ],
  ] as const)("%s", (_name, request, cap, expected) => {
    expect(approvalLimits(request, base, cap)).toEqual({ base, ...expected });
  });

  it("rounds a percentage of an awkward price down to a whole minor unit", () => {
    // 15% of 333.33 is 49.9995: 49.99 may be approved, 50.00 would exceed both bounds.
    expect(approvalLimits({ type: "percent", value: 15 }, 33_333, 15)).toMatchObject({ asked: { fixed: 4_999 }, cap: { fixed: 4_999 }, maxFixed: 4_999 });
  });

  it("allows no amount on a party that pays nothing", () => {
    expect(approvalLimits({ type: "fixed", value: 500 }, 0, 30)).toMatchObject({ maxPercent: 0, maxFixed: 0 });
    expect(approvalLimits({ type: "percent", value: 10 }, 0, 30)).toMatchObject({ maxPercent: 10, maxFixed: 0 });
  });
});

describe("price and wording helpers", () => {
  it("prices a child as a rounded share of the adult price", () => {
    expect(childUnitPrice(69_000, 50)).toBe(34_500);
    expect(childUnitPrice(9_999, 50)).toBe(5_000);
    expect(childUnitPrice(69_000, 0)).toBe(0);
  });

  it("prices a party from adults and children separately", () => {
    expect(partyBaseAmount({ priceAdult: 69_000, childPricePercent: 50 }, 2, 1)).toBe(172_500);
    expect(partyBaseAmount({ priceAdult: 69_000, childPricePercent: 50 }, 1, 0)).toBe(69_000);
  });

  it("words a discount for customers", () => {
    expect(formatDiscount("percent", 15, "USD")).toBe("15% off");
    expect(formatDiscount("fixed", 30_000, "USD")).toBe("$300 off");
    expect(formatDiscount("fixed", 1_250, "EUR")).toBe("€12.50 off");
  });

  it("finds a Postgres error code on the error or on its cause", () => {
    expect(pgError({ code: "23503", constraint: "x_fk" })).toEqual({ code: "23503", constraint: "x_fk" });
    expect(pgError({ cause: { code: "23505", constraint: "x_key" } })).toEqual({ code: "23505", constraint: "x_key" });
    expect(pgError(null)).toEqual({ code: undefined, constraint: undefined });
    expect(pgError(new Error("plain"))).toEqual({ code: undefined, constraint: undefined });
  });
});
