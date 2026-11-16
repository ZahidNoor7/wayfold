import { describe, expect, it } from "vitest";
import {
  featureLines,
  invoiceDay,
  invoiceHref,
  formatMegabytes,
  joinList,
  limitLine,
  meterTone,
  meterView,
  priceLine,
  renewalSentence,
  yearlySaving,
} from "./billing-display";

describe("meterTone", () => {
  it("warns above 80% and is full at 100%", () => {
    expect(meterTone(null)).toBe("normal");
    expect(meterTone(0)).toBe("normal");
    expect(meterTone(80)).toBe("normal");
    expect(meterTone(80.1)).toBe("warning");
    expect(meterTone(99.9)).toBe("warning");
    expect(meterTone(100)).toBe("full");
    expect(meterTone(140)).toBe("full");
  });
});

describe("formatMegabytes", () => {
  it("reads like a file size", () => {
    expect(formatMegabytes(0)).toBe("0 MB");
    expect(formatMegabytes(0.4)).toBe("<1 MB");
    expect(formatMegabytes(120.4)).toBe("120 MB");
    expect(formatMegabytes(1536)).toBe("1.5 GB");
    expect(formatMegabytes(1024)).toBe("1 GB");
  });
});

describe("meterView", () => {
  it("describes a limited meter", () => {
    expect(meterView("maxTeamMembers", { used: 4, limit: 5, percent: 80 })).toEqual({
      label: "Team seats",
      value: "4 of 5",
      percentText: "80%",
      barPercent: 80,
      tone: "normal",
      note: null,
    });
  });

  it("warns with a sentence and clamps the bar", () => {
    const warning = meterView("maxStorageMb", { used: 900, limit: 1024, percent: 87.9 });
    expect(warning).toMatchObject({ value: "900 MB of 1 GB", percentText: "88%", tone: "warning" });
    expect(warning.note).toMatch(/nearly full/);

    const over = meterView("maxBookingsPerMonth", { used: 120, limit: 100, percent: 120 });
    expect(over).toMatchObject({ value: "120 of 100", barPercent: 100, tone: "full" });
    expect(over.note).toMatch(/used up/);
  });

  it("describes an unlimited meter", () => {
    expect(meterView("maxPublishedTours", { used: 1200, limit: null, percent: null })).toEqual({
      label: "Published tours",
      value: "1,200 · unlimited",
      percentText: null,
      barPercent: 0,
      tone: "normal",
      note: null,
    });
  });

  it("has notes for every limit when full", () => {
    expect(meterView("maxTeamMembers", { used: 5, limit: 5, percent: 100 }).note).toMatch(/Every seat/);
    expect(meterView("maxPublishedTours", { used: 5, limit: 5, percent: 100 }).note).toMatch(/publish more/);
    expect(meterView("maxPublishedTours", { used: 9, limit: 10, percent: 90 }).note).toMatch(/close/);
  });
});

describe("limitLine", () => {
  it("phrases each limit", () => {
    expect(limitLine("maxTeamMembers", 5)).toBe("Up to 5 team members");
    expect(limitLine("maxTeamMembers", 1)).toBe("Up to 1 team member");
    expect(limitLine("maxTeamMembers", null)).toBe("Unlimited team members");
    expect(limitLine("maxPublishedTours", 1000)).toBe("Up to 1,000 published tours");
    expect(limitLine("maxBookingsPerMonth", 1)).toBe("Up to 1 booking a month");
    expect(limitLine("maxStorageMb", 2048)).toBe("2 GB of media storage");
    expect(limitLine("maxStorageMb", null)).toBe("Unlimited media storage");
  });
});

describe("featureLines", () => {
  it("lists only what is included", () => {
    expect(
      featureLines({ customDomain: true, promotions: true, removeBranding: true, platformStorage: true, integrations: ["media", "email", "crm"] }),
    ).toEqual([
      "Your own domain name",
      "Discount campaigns and personal offers",
      "No Wayfold branding on your website",
      "Media storage hosted by Wayfold",
      "Connect your own media storage, e-mail and crm",
    ]);
    expect(featureLines({ customDomain: false, promotions: false, removeBranding: false, platformStorage: false, integrations: [] })).toEqual([]);
  });
});

describe("joinList", () => {
  it("joins in plain English", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("prices", () => {
  it("shows a price per cycle", () => {
    expect(priceLine(0, "USD", "monthly")).toBe("Free");
    expect(priceLine(4900, "USD", "monthly")).toBe("$49 / month");
    expect(priceLine(49000, "USD", "yearly")).toBe("$490 / year");
  });

  it("shows a yearly saving only when there is one", () => {
    expect(yearlySaving(4900, 49000, "USD")).toBe("Save $98 a year");
    expect(yearlySaving(4900, 58800, "USD")).toBeNull();
    expect(yearlySaving(0, 0, "USD")).toBeNull();
  });
});

describe("renewalSentence", () => {
  it("says what happens at the end of the period", () => {
    const end = "1 Feb 2027";
    expect(renewalSentence({ status: "active", cancelAtPeriodEnd: false }, end)).toBe("Renews on 1 Feb 2027.");
    expect(renewalSentence({ status: "active", cancelAtPeriodEnd: true }, end)).toBe("The subscription ends on 1 Feb 2027 and will not renew.");
    expect(renewalSentence({ status: "trialing", cancelAtPeriodEnd: false }, end)).toBe("The trial ends on 1 Feb 2027.");
    expect(renewalSentence({ status: "past_due", cancelAtPeriodEnd: false }, end)).toBe("A payment is overdue for the period ending 1 Feb 2027.");
    expect(renewalSentence({ status: "cancelled", cancelAtPeriodEnd: false }, end)).toMatch(/cancelled/);
  });
});

describe("invoices", () => {
  it("reads periods as calendar dates and links to the detail page", () => {
    expect(invoiceDay(new Date("2027-01-31T00:00:00Z"))).toBe("2027-01-31");
    expect(invoiceHref("abc")).toBe("/workspace/billing/invoices/abc");
  });
});
