import { describe, expect, it } from "vitest";
import { isFreePlan, joinList, planFeatures, planLimits, planPrice, storageLabel, type PlanLike } from "./plan-format";

const base: PlanLike = {
  priceMonthly: 2900,
  priceYearly: 29000,
  currency: "USD",
  limits: { maxTeamMembers: 5, maxPublishedTours: 15, maxStorageMb: 2000, maxBookingsPerMonth: 200 },
  features: { customDomain: true, integrations: ["media", "email", "maps"], platformStorage: true, promotions: true, removeBranding: false },
};

describe("isFreePlan", () => {
  it("is true only when both prices are zero", () => {
    expect(isFreePlan({ priceMonthly: 0, priceYearly: 0 })).toBe(true);
    expect(isFreePlan({ priceMonthly: 0, priceYearly: 100 })).toBe(false);
    expect(isFreePlan({ priceMonthly: 100, priceYearly: 0 })).toBe(false);
  });
});

describe("planPrice", () => {
  it("says Free for a free plan", () => {
    expect(planPrice({ priceMonthly: 0, priceYearly: 0, currency: "USD" })).toEqual({ amount: "Free", period: "", yearly: null });
  });

  it("shows the monthly price with the yearly alternative", () => {
    expect(planPrice(base)).toEqual({ amount: "$29", period: "per month", yearly: "or $290 billed yearly" });
  });

  it("omits the yearly line when there is no yearly price", () => {
    expect(planPrice({ priceMonthly: 1950, priceYearly: 0, currency: "EUR" })).toEqual({ amount: "€19.50", period: "per month", yearly: null });
  });

  it("falls back to the yearly price for a yearly-only plan", () => {
    expect(planPrice({ priceMonthly: 0, priceYearly: 12000, currency: "USD" })).toEqual({ amount: "$120", period: "per year", yearly: null });
  });
});

describe("storageLabel", () => {
  it("uses megabytes below 1,000 and gigabytes from there", () => {
    expect(storageLabel(250)).toBe("250 MB of media storage");
    expect(storageLabel(999)).toBe("999 MB of media storage");
    expect(storageLabel(1000)).toBe("1 GB of media storage");
    expect(storageLabel(2500)).toBe("2.5 GB of media storage");
    expect(storageLabel(50000)).toBe("50 GB of media storage");
  });

  it("says unlimited for no limit", () => {
    expect(storageLabel(null)).toBe("Unlimited media storage");
  });
});

describe("planLimits", () => {
  it("lists the four allowances with thousands separators", () => {
    expect(planLimits({ limits: { maxTeamMembers: 15, maxPublishedTours: 60, maxStorageMb: 10000, maxBookingsPerMonth: 1000 } })).toEqual([
      "60 published tours",
      "1,000 bookings a month",
      "15 team members",
      "10 GB of media storage",
    ]);
  });

  it("uses the singular for one", () => {
    expect(planLimits({ limits: { maxTeamMembers: 1, maxPublishedTours: 1, maxStorageMb: 100, maxBookingsPerMonth: 1 } })).toEqual([
      "1 published tour",
      "1 booking a month",
      "1 team member",
      "100 MB of media storage",
    ]);
  });

  it("says unlimited where there is no limit", () => {
    expect(planLimits({ limits: { maxTeamMembers: null, maxPublishedTours: null, maxStorageMb: null, maxBookingsPerMonth: null } })).toEqual([
      "Unlimited published tours",
      "Unlimited bookings",
      "Unlimited team members",
      "Unlimited media storage",
    ]);
  });
});

describe("planFeatures", () => {
  it("lists what is switched on, with known integrations named", () => {
    expect(planFeatures(base)).toEqual([
      "Your own domain name",
      "Discount campaigns and offers",
      "Media storage included, no extra account",
      "Connects to Cloudinary, your own e-mail server and Google Maps",
    ]);
  });

  it("includes the branding line and every integration when enabled", () => {
    const lines = planFeatures({
      features: { ...base.features, removeBranding: true, integrations: ["media", "email", "payments", "maps", "messaging"] },
    });
    expect(lines).toContain("No Wayfold credit on your website");
    expect(lines.at(-1)).toBe("Connects to Cloudinary, your own e-mail server, Stripe, Google Maps and WhatsApp");
  });

  it("returns nothing for a plan with no extras and skips unknown categories", () => {
    expect(
      planFeatures({ features: { customDomain: false, integrations: ["telepathy"], platformStorage: false, promotions: false, removeBranding: false } }),
    ).toEqual([]);
  });
});

describe("joinList", () => {
  it("joins with commas and a final and", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
});
