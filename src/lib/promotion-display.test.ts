import { describe, expect, it } from "vitest";
import {
  ACTIVITY_AREA_PREFIX,
  ACTIVITY_AREAS,
  activityActor,
  activityKind,
  describeActivity,
  type ActivityEntry,
  type ActivityLookups,
  approvalError,
  approvalHint,
  campaignSummary,
  campaignWindow,
  CAMPAIGN_FILTERS,
  countBy,
  defaultLowerApproval,
  discountAmount,
  discountInputValue,
  eligibilityText,
  filterByStatus,
  formatDiscountLabel,
  isOverMaximum,
  joinAnd,
  nextTabIndex,
  normaliseEmail,
  parseDiscountValue,
  parseRuleNumber,
  priceAfter,
  replaceableDiscounts,
  REQUEST_FILTERS,
  scopeText,
  sortRequests,
  splitEmails,
  valueFieldLabel,
  type ApprovalLimits,
  type CampaignDraftSummary,
} from "./promotion-display";

describe("nextTabIndex", () => {
  it("wraps with arrow keys and jumps with Home and End", () => {
    expect(nextTabIndex("ArrowRight", 3, 4)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 4)).toBe(3);
    expect(nextTabIndex("Home", 2, 4)).toBe(0);
    expect(nextTabIndex("End", 0, 4)).toBe(3);
  });
  it("ignores other keys and empty lists", () => {
    expect(nextTabIndex("Enter", 1, 4)).toBeNull();
    expect(nextTabIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("countBy and filterByStatus", () => {
  const items = [{ status: "active" }, { status: "active" }, { status: "expired" }, { status: "inactive" }];
  it("counts each filter and everything under all", () => {
    expect(countBy(items, CAMPAIGN_FILTERS)).toEqual({ all: 4, active: 2, scheduled: 0, expired: 1, inactive: 1 });
    expect(countBy([{ status: "pending" }], REQUEST_FILTERS)).toEqual({ pending: 1, approved: 0, rejected: 0, all: 1 });
  });
  it("filters by status, or returns a copy for all", () => {
    expect(filterByStatus(items, "active")).toHaveLength(2);
    const all = filterByStatus(items, "all");
    expect(all).toEqual(items);
    expect(all).not.toBe(items);
  });
});

describe("wording", () => {
  it("labels discounts in the workspace currency", () => {
    expect(formatDiscountLabel("percent", 15, "USD")).toBe("15% off");
    expect(formatDiscountLabel("fixed", 30000, "USD")).toBe("$300 off");
    expect(valueFieldLabel("percent", "EUR")).toBe("Percentage off (%)");
    expect(valueFieldLabel("fixed", "EUR")).toBe("Amount off (EUR)");
  });

  it("computes amounts like the booking engine", () => {
    expect(discountAmount("percent", 15, 60000)).toBe(9000);
    expect(discountAmount("fixed", 90000, 60000)).toBe(60000);
    expect(discountAmount("percent", 10, 0)).toBe(0);
    expect(discountAmount("fixed", 0, 100)).toBe(0);
    expect(priceAfter("percent", 15, 60000)).toBe(51000);
    expect(priceAfter("fixed", 90000, 60000)).toBe(0);
  });

  it("joins lists in plain English", () => {
    expect(joinAnd([])).toBe("");
    expect(joinAnd(["A"])).toBe("A");
    expect(joinAnd(["A", "B"])).toBe("A and B");
    expect(joinAnd(["A", "B", "C"])).toBe("A, B and C");
  });

  it("describes eligibility rules", () => {
    expect(eligibilityText({ minGuests: 0, minChildren: 0, bookAheadDays: 0, visibility: "public" })).toBe("Everyone");
    expect(eligibilityText({ minGuests: 6, minChildren: 1, bookAheadDays: 90, visibility: "private" })).toBe(
      "6+ guests · at least 1 child · booked 90+ days ahead · invited customers only",
    );
    expect(eligibilityText({ minGuests: 0, minChildren: 2, bookAheadDays: 0, visibility: "public" })).toBe("at least 2 children");
  });

  it("describes scope and window", () => {
    expect(scopeText(true, [])).toBe("All tours");
    expect(scopeText(false, [])).toBe("No tours");
    expect(scopeText(false, [{ title: "Sheki" }, { title: "Quba" }])).toBe("Sheki, Quba");
    expect(campaignWindow("2026-11-01", "2026-12-15")).toBe("1 Nov – 15 Dec 2026");
  });
});

describe("campaignSummary", () => {
  const base: CampaignDraftSummary = {
    type: "percent",
    value: 15,
    appliesToAllTours: true,
    tourTitles: [],
    visibility: "public",
    assignedCount: 0,
    minGuests: 0,
    minChildren: 0,
    bookAheadDays: 60,
    startsOn: "2027-03-01",
    endsOn: "2027-05-31",
  };

  it("says who gets what in one sentence", () => {
    expect(campaignSummary(base, "USD")).toBe("15% off every tour for bookings made at least 60 days ahead, 1 Mar – 31 May 2027.");
  });

  it("names a few tours and counts the rest", () => {
    expect(campaignSummary({ ...base, bookAheadDays: 0, appliesToAllTours: false, tourTitles: ["Sheki", "Quba"] }, "USD")).toBe(
      "15% off Sheki and Quba, 1 Mar – 31 May 2027.",
    );
    expect(
      campaignSummary({ ...base, bookAheadDays: 0, appliesToAllTours: false, tourTitles: ["A", "B", "C", "D", "E"] }, "USD"),
    ).toBe("15% off A, B and 3 more tours, 1 Mar – 31 May 2027.");
  });

  it("covers fixed amounts, private audiences and party rules", () => {
    expect(
      campaignSummary(
        { ...base, type: "fixed", value: 30000, visibility: "private", assignedCount: 2, minGuests: 6, minChildren: 1, bookAheadDays: 1 },
        "USD",
      ),
    ).toBe(
      "$300 off each booking every tour for 2 invited customers, for groups of 6 or more, when at least 1 child travels and for bookings made at least 1 day ahead, 1 Mar – 31 May 2027.",
    );
    expect(campaignSummary({ ...base, visibility: "private", assignedCount: 1, bookAheadDays: 0, minChildren: 2 }, "USD")).toBe(
      "15% off every tour for 1 invited customer and when at least 2 children travel, 1 Mar – 31 May 2027.",
    );
    expect(campaignSummary({ ...base, visibility: "private", assignedCount: 0, bookAheadDays: 0 }, "USD")).toBe(
      "15% off every tour for invited customers, 1 Mar – 31 May 2027.",
    );
  });

  it("waits for a complete draft", () => {
    expect(campaignSummary({ ...base, value: null }, "USD")).toBeNull();
    expect(campaignSummary({ ...base, value: 0 }, "USD")).toBeNull();
    expect(campaignSummary({ ...base, endsOn: "2027-01-01" }, "USD")).toBeNull();
    expect(campaignSummary({ ...base, startsOn: "" }, "USD")).toBeNull();
    expect(campaignSummary({ ...base, appliesToAllTours: false, tourTitles: [] }, "USD")).toBeNull();
  });
});

describe("parseDiscountValue", () => {
  it("accepts whole percentages from 1 to 90", () => {
    expect(parseDiscountValue("percent", " 15 ", "USD")).toEqual({ ok: true, value: 15 });
    expect(parseDiscountValue("percent", "90", "USD")).toEqual({ ok: true, value: 90 });
  });
  it("rejects blank, fractional, zero and oversize percentages", () => {
    expect(parseDiscountValue("percent", "", "USD")).toEqual({ ok: false, error: "Enter a discount above 0." });
    expect(parseDiscountValue("percent", "12.5", "USD")).toEqual({ ok: false, error: "Enter a whole number." });
    expect(parseDiscountValue("percent", "0", "USD")).toEqual({ ok: false, error: "Enter a discount above 0." });
    expect(parseDiscountValue("percent", "91", "USD")).toEqual({ ok: false, error: "Percentages can’t exceed 90%." });
  });
  it("turns fixed decimals into minor units", () => {
    expect(parseDiscountValue("fixed", "300", "USD")).toEqual({ ok: true, value: 30000 });
    expect(parseDiscountValue("fixed", "25.50", "USD")).toEqual({ ok: true, value: 2550 });
    expect(parseDiscountValue("fixed", "500", "JPY")).toEqual({ ok: true, value: 500 });
  });
  it("rejects malformed, zero and huge amounts", () => {
    expect(parseDiscountValue("fixed", "abc", "USD")).toEqual({ ok: false, error: "Enter an amount like 25.00." });
    expect(parseDiscountValue("fixed", "0", "USD")).toEqual({ ok: false, error: "Enter a discount above 0." });
    expect(parseDiscountValue("fixed", "2000000", "USD")).toEqual({ ok: false, error: "That amount is too large." });
  });
  it("formats stored values back for editing", () => {
    expect(discountInputValue("percent", 15, "USD")).toBe("15");
    expect(discountInputValue("fixed", 2550, "USD")).toBe("25.50");
  });
});

describe("parseRuleNumber", () => {
  it("reads blank as zero and caps the value", () => {
    expect(parseRuleNumber("", 100)).toBe(0);
    expect(parseRuleNumber(" 6 ", 100)).toBe(6);
    expect(parseRuleNumber("101", 100)).toBeNull();
    expect(parseRuleNumber("-1", 100)).toBeNull();
    expect(parseRuleNumber("2.5", 100)).toBeNull();
  });
});

describe("e-mail input", () => {
  it("normalises valid addresses and rejects the rest", () => {
    expect(normaliseEmail("  Priya@Example.COM ")).toBe("priya@example.com");
    expect(normaliseEmail("priya@example")).toBeNull();
    expect(normaliseEmail(`${"a".repeat(250)}@x.com`)).toBeNull();
  });
  it("splits pasted lists, skips duplicates and keeps invalid tokens", () => {
    expect(splitEmails("a@x.com, B@x.com;\nbad a@x.com", ["b@x.com"])).toEqual({ added: ["a@x.com"], invalid: ["bad"] });
    expect(splitEmails("")).toEqual({ added: [], invalid: [] });
  });
});

describe("replaceableDiscounts", () => {
  const list = [
    { id: "1", email: "a@x.com", tourId: null, status: "active" as const },
    { id: "2", email: "a@x.com", tourId: "t1", status: "active" as const },
    { id: "3", email: "a@x.com", tourId: "t2", status: "active" as const },
    { id: "4", email: "a@x.com", tourId: "t1", status: "used" as const },
    { id: "5", email: "b@x.com", tourId: null, status: "active" as const },
  ];
  it("finds active discounts with overlapping scope for the same e-mail", () => {
    expect(replaceableDiscounts(list, "A@x.com", "t1").map((d) => d.id)).toEqual(["1", "2"]);
    expect(replaceableDiscounts(list, "a@x.com", null).map((d) => d.id)).toEqual(["1", "2", "3"]);
  });
  it("finds nothing for an invalid e-mail", () => {
    expect(replaceableDiscounts(list, "nope", null)).toEqual([]);
  });
});

describe("approval rules", () => {
  const limits: ApprovalLimits = {
    base: 60000,
    asked: { percent: 15, fixed: 9000 },
    cap: { percent: 30, fixed: 18000 },
    maxPercent: 15,
    maxFixed: 9000,
  };
  const over: ApprovalLimits = {
    base: 60000,
    asked: { percent: 40, fixed: 24000 },
    cap: { percent: 30, fixed: 18000 },
    maxPercent: 30,
    maxFixed: 18000,
  };

  it("mirrors the server's checks", () => {
    expect(approvalError("percent", 0, limits)).toBe("Enter the discount you’re approving.");
    expect(approvalError("percent", 1.5, limits)).toBe("Enter the discount you’re approving.");
    expect(approvalError("percent", 16, limits)).toBe("You can’t approve more than the customer asked for.");
    expect(approvalError("fixed", 9001, limits)).toBe("You can’t approve more than the customer asked for.");
    expect(approvalError("percent", 35, over)).toBe("That’s above your maximum of 30%. Approve 30% or less, or reject.");
    expect(approvalError("percent", 15, limits)).toBeNull();
    expect(approvalError("fixed", 9000, limits)).toBeNull();
  });

  it("flags requests above the private maximum", () => {
    expect(isOverMaximum(limits)).toBe(false);
    expect(isOverMaximum(over)).toBe(true);
  });

  it("suggests a lower approval", () => {
    expect(defaultLowerApproval(limits)).toEqual({ type: "percent", value: 7 });
    expect(defaultLowerApproval(over)).toEqual({ type: "percent", value: 30 });
    expect(defaultLowerApproval({ ...limits, asked: { percent: 1, fixed: 600 } })).toEqual({ type: "percent", value: 1 });
  });

  it("explains the ceiling", () => {
    expect(approvalHint(limits, "USD", "Kenji")).toBe("You can approve up to 15% or $90 — what Kenji asked for.");
    expect(approvalHint(over, "USD", "")).toBe("You can approve up to 30% or $180 — your private maximum.");
    expect(approvalHint(limits, "USD", "")).toBe("You can approve up to 15% or $90 — what the customer asked for.");
  });
});

describe("activity", () => {
  const lookups: ActivityLookups = {
    currency: "USD",
    personalNames: { p1: "Eleanor Whitfield" },
    requests: { r1: { name: "Kenji Watanabe", reference: "DR-1046" } },
  };
  const entry = (action: string, metadata: Record<string, unknown> = {}, targetId: string | null = null): ActivityEntry => ({
    action,
    actorName: "Leyla",
    targetId,
    metadata,
  });

  it("maps every filter to an action prefix", () => {
    for (const area of ACTIVITY_AREAS) expect(ACTIVITY_AREA_PREFIX[area].startsWith("promotions.")).toBe(true);
  });

  it("gives each action a type badge", () => {
    expect(activityKind("promotions.campaign_created").label).toBe("Campaign");
    expect(activityKind("promotions.personal_discount_assigned").label).toBe("Personal");
    expect(activityKind("promotions.personal_discount_revoked").label).toBe("Revoked");
    expect(activityKind("promotions.request_submitted").label).toBe("Request");
    expect(activityKind("promotions.request_approved").label).toBe("Approved");
    expect(activityKind("promotions.request_rejected").label).toBe("Rejected");
    expect(activityKind("promotions.discount_redeemed").label).toBe("Redeemed");
    expect(activityKind("promotions.settings_changed").label).toBe("Settings");
    expect(activityKind("promotions.unknown")).toEqual({ label: "Other", badge: "badge badge-outline" });
  });

  it("describes campaign changes", () => {
    const meta = { name: "Autumn", type: "percent", value: 15 };
    expect(describeActivity(entry("promotions.campaign_created", meta), lookups)).toBe("Created campaign “Autumn” (15% off)");
    expect(describeActivity(entry("promotions.campaign_updated", { name: "Autumn", type: "fixed", value: 30000 }), lookups)).toBe(
      "Edited campaign “Autumn” ($300 off)",
    );
    expect(describeActivity(entry("promotions.campaign_updated", { name: "Autumn", type: "other", value: 1 }), lookups)).toBe("Edited campaign “Autumn”");
    expect(describeActivity(entry("promotions.campaign_activated", meta), lookups)).toBe("Activated campaign “Autumn”");
    expect(describeActivity(entry("promotions.campaign_deactivated", meta), lookups)).toBe("Deactivated campaign “Autumn”");
    expect(describeActivity(entry("promotions.campaign_deleted", {}), lookups)).toBe("Deleted campaign a campaign");
  });

  it("describes personal discounts by customer when known", () => {
    expect(describeActivity(entry("promotions.personal_discount_assigned", { type: "percent", value: 10, replaced: 1 }, "p1"), lookups)).toBe(
      "Assigned a 10% off personal discount to Eleanor Whitfield — replaced the previous one",
    );
    expect(describeActivity(entry("promotions.personal_discount_assigned", {}, "zz"), lookups)).toBe("Assigned a personal discount");
    expect(describeActivity(entry("promotions.personal_discount_revoked", { reason: "replaced" }, "p1"), lookups)).toBe(
      "Revoked the personal discount for Eleanor Whitfield (replaced by a new one)",
    );
    expect(describeActivity(entry("promotions.personal_discount_revoked"), lookups)).toBe("Revoked the personal discount");
  });

  it("describes requests and decisions", () => {
    expect(describeActivity(entry("promotions.request_submitted", { reference: "DR-1046", type: "percent", value: 15 }, "r1"), lookups)).toBe(
      "Requested 15% off (DR-1046)",
    );
    expect(describeActivity(entry("promotions.request_submitted", {}, "r9"), lookups)).toBe("Requested a discount (a request)");
    expect(
      describeActivity(
        entry("promotions.request_approved", { reference: "DR-1046", type: "percent", value: 8, requestedType: "percent", requestedValue: 15, partial: true }, "r1"),
        lookups,
      ),
    ).toBe("Approved DR-1046 at 8% off (requested 15% off) for Kenji Watanabe");
    expect(describeActivity(entry("promotions.request_approved", { reference: "DR-1", type: "percent", value: 15, partial: false }), lookups)).toBe(
      "Approved DR-1 at 15% off in full",
    );
    expect(describeActivity(entry("promotions.request_approved", { partial: true }, "r1"), lookups)).toBe("Approved DR-1046 for Kenji Watanabe");
    expect(describeActivity(entry("promotions.request_rejected", {}, "r1"), lookups)).toBe("Rejected DR-1046 for Kenji Watanabe");
    expect(describeActivity(entry("promotions.request_rejected", { reference: "DR-2" }), lookups)).toBe("Rejected DR-2");
  });

  it("describes redemptions", () => {
    expect(describeActivity(entry("promotions.discount_redeemed", { amount: 2000 }, "p1"), lookups)).toBe(
      "Personal discount for Eleanor Whitfield used on a booking ($20 off)",
    );
    expect(describeActivity(entry("promotions.discount_redeemed", {}, "r1"), lookups)).toBe("Approved request DR-1046 used on a booking");
    expect(describeActivity(entry("promotions.discount_redeemed", { amount: Number.NaN }), lookups)).toBe("A single-use discount used on a booking");
  });

  it("describes settings changes without values", () => {
    expect(describeActivity(entry("promotions.settings_changed", { changed: ["maxRequestPercent", "responseDays", 3, "other"] }), lookups)).toBe(
      "Changed the private maximum, the promised response time and other",
    );
    expect(describeActivity(entry("promotions.settings_changed", { changed: "x" }), lookups)).toBe("Changed discount request settings");
  });

  it("falls back to the action code", () => {
    expect(describeActivity(entry("promotions.something_new"), lookups)).toBe("promotions.something_new");
  });

  it("names the customer for submitted requests", () => {
    expect(activityActor(entry("promotions.request_submitted", {}, "r1"), lookups)).toBe("Kenji Watanabe (customer)");
    expect(activityActor(entry("promotions.request_submitted", {}, null), lookups)).toBe("Customer");
    expect(activityActor(entry("promotions.campaign_created"), lookups)).toBe("Leyla");
  });
});

describe("sortRequests", () => {
  it("puts pending first, then newest", () => {
    const sorted = sortRequests([
      { id: "a", status: "approved" as const, createdAt: "2026-11-15T10:00:00Z" },
      { id: "b", status: "pending" as const, createdAt: "2026-11-10T10:00:00Z" },
      { id: "c", status: "pending" as const, createdAt: new Date("2026-11-12T10:00:00Z") },
      { id: "d", status: "rejected" as const, createdAt: "2026-11-01T10:00:00Z" },
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["c", "b", "a", "d"]);
  });
});
