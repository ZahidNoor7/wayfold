import { describe, expect, it } from "vitest";
import {
  appearanceSummary,
  DEFAULT_APPEARANCE,
  modeClass,
  modeLabel,
  RADIUS_SCALE_STYLE,
  themedSurface,
  themeName,
  toAppearance,
} from "./appearance";
import {
  BOOKING_LIMITS,
  cleanPrefix,
  describeDaysOff,
  formatDays,
  formatHours,
  holdText,
  horizonText,
  noticeText,
  referenceExample,
  toggleWeekday,
  WEEKDAYS,
} from "./booking-rules";
import { cleanDomainInput, defaultAddress, domainInputError, recordHostLabel } from "./domains";
import {
  buildIntegrationPayload,
  checkFieldValues,
  deleteConsequence,
  groupIntegrations,
  initialFieldValues,
  keepSecretHint,
  STATUS_META,
} from "./integration-form";
import { ACCESS_DURATIONS, GRANT_STATUS_META, groupGrants, timeLeft } from "./support";
import { addTags, canonicalLanguage, currencyName, languageName, splitTags } from "./tags";
import { searchTimezones, selectableTimezones, timezoneLabel, utcOffset } from "./timezones";
import type { FieldSpec } from "@/server/integrations/types";

describe("appearance", () => {
  it("maps modes to the classes the theme CSS reads", () => {
    expect(modeClass("light")).toBe("light");
    expect(modeClass("dark")).toBe("dark");
    expect(modeClass("system")).toBe("mode-system");
  });

  it("builds self-theming attributes for a preview surface", () => {
    const surface = themedSurface({ theme: "caspian", mode: "system", radius: "lg", font: "sans" });
    expect(surface).toMatchObject({ "data-theme": "caspian", "data-radius": "lg", "data-font": "sans", className: "mode-system" });
    expect(surface.style).toBe(RADIUS_SCALE_STYLE);
  });

  it("names themes and modes, falling back to the first option", () => {
    expect(themeName("pomegranate")).toBe("Pomegranate");
    expect(themeName("nope" as never)).toBe("Emerald & Gold");
    expect(modeLabel("dark")).toBe("Dark");
    expect(modeLabel("nope" as never)).toBe("Light");
    expect(appearanceSummary({ theme: "graphite", mode: "system", radius: "sm", font: "modern" })).toBe("Graphite · System");
  });

  it("narrows stored branding to a complete, valid look", () => {
    expect(toAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(toAppearance({ theme: "caspian", mode: "dark", radius: "none", font: "modern" })).toEqual({
      theme: "caspian",
      mode: "dark",
      radius: "none",
      font: "modern",
    });
    expect(toAppearance({ theme: "neon", mode: "dim", radius: "xl", font: "comic" })).toEqual(DEFAULT_APPEARANCE);
  });
});

describe("timezones", () => {
  it("keeps zones of the accepted shape, adds UTC and sorts", () => {
    expect(selectableTimezones(["Europe/London", "EST", "America/Argentina/Buenos_Aires", "Asia/Baku"])).toEqual([
      "America/Argentina/Buenos_Aires",
      "Asia/Baku",
      "Europe/London",
      "UTC",
    ]);
    expect(selectableTimezones(["UTC"])).toEqual(["UTC"]);
  });

  it("labels zones for reading", () => {
    expect(timezoneLabel("America/Argentina/Buenos_Aires")).toBe("America / Argentina / Buenos Aires");
    expect(timezoneLabel("UTC")).toBe("UTC");
  });

  it("reads the current offset, or nothing for an unknown zone", () => {
    const winter = new Date("2026-01-15T12:00:00Z");
    expect(utcOffset("Asia/Baku", winter)).toBe("GMT+4");
    expect(utcOffset("UTC", winter)).toMatch(/^GMT(\+0)?$/);
    expect(utcOffset("Not/AZone", winter)).toBe("");
  });

  it("searches by any word, best matches first", () => {
    const zones = ["America/New_York", "Europe/London", "Asia/Baku", "America/Los_Angeles", "Europe/Lisbon", "Australia/Lord_Howe"];
    expect(searchTimezones(zones, "")).toEqual(zones);
    expect(searchTimezones(zones, "", 2)).toEqual(zones.slice(0, 2));
    expect(searchTimezones(zones, "new york")).toEqual(["America/New_York"]);
    expect(searchTimezones(zones, "lo")).toEqual(["America/Los_Angeles", "Australia/Lord_Howe", "Europe/London"]);
    expect(searchTimezones(zones, "america lo")).toEqual(["America/Los_Angeles"]);
    expect(searchTimezones(["Europe/Paris", "America/Paris_Ville"], "eu")).toEqual(["Europe/Paris"]);
    expect(searchTimezones(zones, "europe")).toEqual(["Europe/Lisbon", "Europe/London"]);
    expect(searchTimezones(zones, "ondon")).toEqual(["Europe/London"]);
    expect(searchTimezones(zones, "tokyo")).toEqual([]);
  });
});

describe("tags", () => {
  it("splits on commas, semicolons and new lines", () => {
    expect(splitTags(" en, de;fr\n\n , it ")).toEqual(["en", "de", "fr", "it"]);
    expect(splitTags("   ")).toEqual([]);
  });

  it("adds new tags, skipping duplicates and stopping at the maximum", () => {
    expect(addTags(["en"], "EN, de, de, fr")).toEqual(["en", "de", "fr"]);
    expect(addTags(["en"], "de, fr, it", { max: 2 })).toEqual(["en", "de"]);
    expect(addTags([], "pt-br, PT-BR", { normalise: canonicalLanguage })).toEqual(["pt-BR"]);
  });

  it("canonicalises language codes and keeps anything else as typed", () => {
    expect(canonicalLanguage(" pt-br ")).toBe("pt-BR");
    expect(canonicalLanguage("not a tag!")).toBe("not a tag!");
  });

  it("names languages and currencies, falling back to the code", () => {
    expect(languageName("de")).toBe("German");
    expect(languageName("!!")).toBe("!!");
    expect(currencyName("EUR")).toBe("Euro");
    expect(currencyName("??")).toBe("??");
  });
});

describe("booking rules", () => {
  it("toggles weekdays in week order", () => {
    expect(toggleWeekday([7, 1], 3)).toEqual([1, 3, 7]);
    expect(toggleWeekday([1, 3, 7], 3)).toEqual([1, 7]);
    expect(WEEKDAYS).toHaveLength(7);
    expect(BOOKING_LIMITS.maxDaysOff).toBe(6);
  });

  it("describes days off in a sentence", () => {
    expect(describeDaysOff([])).toBe("None");
    expect(describeDaysOff([7])).toBe("Sunday");
    expect(describeDaysOff([6, 7])).toBe("Saturday and Sunday");
    expect(describeDaysOff([5, 1, 3])).toBe("Monday, Wednesday and Friday");
  });

  it("keeps the prefix to four capital letters", () => {
    expect(cleanPrefix("a1b-c d e")).toBe("ABCD");
    expect(cleanPrefix("")).toBe("");
  });

  it("builds an example reference only for a valid prefix", () => {
    expect(referenceExample("ct")).toBe("CT-TOU-4821");
    expect(referenceExample("WAYF", "SHE", 77)).toBe("WAYF-SHE-77");
    expect(referenceExample("W")).toBeNull();
    expect(referenceExample("W1")).toBeNull();
  });

  it("formats hours and days in words", () => {
    expect(formatHours(1)).toBe("1 hour");
    expect(formatHours(36)).toBe("36 hours");
    expect(formatHours(48)).toBe("48 hours");
    expect(formatHours(72)).toBe("3 days");
    expect(formatHours(0)).toBe("");
    expect(formatHours(Number.NaN)).toBe("");
    expect(formatDays(0)).toBe("the same day");
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(14)).toBe("14 days");
    expect(formatDays(90)).toBe("about 3 months");
    expect(formatDays(365)).toBe("about 1 year");
    expect(formatDays(730)).toBe("about 2 years");
    expect(formatDays(-1)).toBe("");
  });

  it("writes hints that follow the numbers typed", () => {
    expect(holdText(24)).toBe("Seats stay reserved for 24 hours while you decide.");
    expect(holdText(Number.NaN)).toBe("How long seats stay reserved while you decide.");
    expect(noticeText(0)).toBe("People can book a tour for today.");
    expect(noticeText(2)).toBe("The earliest tour date is 2 days from today.");
    expect(noticeText(Number.NaN)).toBe("The earliest day someone can book, counted from today.");
    expect(horizonText(365)).toBe("People can book about 1 year ahead.");
    expect(horizonText(-5)).toBe("How far ahead people can book.");
  });
});

describe("domains", () => {
  it("builds the default address", () => {
    expect(defaultAddress("caspian", " Wayfold.App ")).toBe("caspian.wayfold.app");
    expect(defaultAddress("caspian", "localhost:3210")).toBe("caspian.localhost:3210");
  });

  it("reduces pasted addresses to a host", () => {
    expect(cleanDomainInput(" https://Tours.Example.com/about?x=1 ")).toBe("tours.example.com");
    expect(cleanDomainInput("example.com.")).toBe("example.com");
  });

  it("checks the shape of a domain", () => {
    expect(domainInputError("")).toMatch(/Enter a domain/);
    expect(domainInputError("not a domain")).toMatch(/Enter a domain/);
    expect(domainInputError("http://tours.example.com/")).toBeNull();
  });

  it("shortens the record name to the host label most DNS panels expect", () => {
    expect(recordHostLabel("_wayfold.tours.example.com", "tours.example.com")).toBe("_wayfold.tours");
    expect(recordHostLabel("_wayfold.example.com", "example.com")).toBe("_wayfold");
    expect(recordHostLabel("something.else", "example.com")).toBe("something.else");
  });
});

const smtpFields: FieldSpec[] = [
  { key: "host", label: "SMTP server", type: "text", secret: false, required: true },
  { key: "port", label: "Port", type: "number", secret: false, required: true },
  { key: "secure", label: "TLS on connect", type: "boolean", secret: false, required: false },
  { key: "mode", label: "Mode", type: "select", secret: false, required: false, options: [{ value: "test", label: "Test" }] },
  { key: "username", label: "Username", type: "text", secret: true, required: true },
  { key: "password", label: "Password", type: "password", secret: true, required: true },
  { key: "webhook", label: "Webhook secret", type: "password", secret: true, required: false },
];

describe("integration form", () => {
  it("starts from stored settings with every secret empty", () => {
    expect(initialFieldValues(smtpFields, { host: "smtp.example.com", port: 587, secure: true, mode: null })).toEqual({
      host: "smtp.example.com",
      port: "587",
      secure: true,
      mode: "",
      username: "",
      password: "",
      webhook: "",
    });
    expect(initialFieldValues(smtpFields)).toMatchObject({ host: "", port: "", secure: false });
  });

  it("splits values into typed config and non-empty secrets", () => {
    const payload = buildIntegrationPayload(smtpFields, {
      host: " smtp.example.com ",
      port: " 465 ",
      secure: true,
      mode: "test",
      username: " me@example.com ",
      password: "",
      webhook: "   ",
    });
    expect(payload).toEqual({
      config: { host: "smtp.example.com", port: 465, secure: true, mode: "test" },
      secrets: { username: "me@example.com" },
    });
  });

  it("passes unparseable numbers through for the server to reject", () => {
    expect(buildIntegrationPayload(smtpFields, { port: "abc", secure: "yes" }).config).toMatchObject({ port: "abc", secure: false, host: "" });
    expect(buildIntegrationPayload(smtpFields, {}).config.port).toBe("");
  });

  it("flags empty required fields and bad numbers", () => {
    const empty = initialFieldValues(smtpFields);
    expect(checkFieldValues(smtpFields, empty)).toEqual({
      host: "Enter the smtp server.",
      port: "Enter the port.",
      username: "Enter the username.",
      password: "Enter the password.",
    });
    expect(checkFieldValues(smtpFields, { ...empty, host: "h", port: "x" }, { username: "••••ab12", password: "••••cd34" })).toEqual({
      port: "Enter a number.",
    });
  });

  it("explains how to keep a stored secret", () => {
    expect(keepSecretHint("••••a1b2")).toBe("Leave blank to keep the current value ••••a1b2");
    expect(keepSecretHint(undefined)).toBeNull();
  });

  it("labels every status in words", () => {
    expect(Object.keys(STATUS_META).sort()).toEqual(["connected", "disabled", "error", "untested"]);
    expect(STATUS_META.error.label).toBe("Connection failed");
  });

  it("groups connections by category in the listed order", () => {
    const grouped = groupIntegrations(["media", "email"], [
      { id: "a", category: "email" },
      { id: "b", category: "media" },
      { id: "c", category: "email" },
    ]);
    expect(grouped).toEqual([
      { category: "media", items: [{ id: "b", category: "media" }] },
      { category: "email", items: [{ id: "a", category: "email" }, { id: "c", category: "email" }] },
    ]);
  });

  it("says what stops working when a connection is deleted", () => {
    expect(deleteConsequence({ category: "media", isDefault: true, status: "connected" }, 0)).toMatch(/^Uploading photos.*stop working/);
    expect(deleteConsequence({ category: "email", isDefault: true, status: "connected" }, 1)).toMatch(/becomes the default/);
    expect(deleteConsequence({ category: "email", isDefault: false, status: "connected" }, 1)).toMatch(/not your default/);
    expect(deleteConsequence({ category: "email", isDefault: true, status: "disabled" }, 0)).toMatch(/turned off/);
    expect(deleteConsequence({ category: "media", isDefault: true, status: "connected" }, 0, "Managed storage takes over.")).toBe("Managed storage takes over.");
  });
});

describe("support access", () => {
  const now = new Date("2026-11-16T12:00:00Z");

  it("offers the allowed durations", () => {
    expect(ACCESS_DURATIONS.map((d) => d.hours)).toEqual([1, 4, 24, 72]);
    expect(GRANT_STATUS_META.requested.label).toBe("Waiting for you");
  });

  it("groups requests into pending, active and history", () => {
    const grants = [
      { id: "1", status: "requested" as const, expiresAt: null },
      { id: "2", status: "approved" as const, expiresAt: new Date("2026-11-16T14:00:00Z") },
      { id: "3", status: "approved" as const, expiresAt: new Date("2026-11-16T11:00:00Z") },
      { id: "4", status: "approved" as const, expiresAt: null },
      { id: "5", status: "denied" as const, expiresAt: null },
    ];
    const groups = groupGrants(grants, now);
    expect(groups.pending.map((g) => g.id)).toEqual(["1"]);
    expect(groups.active.map((g) => g.id)).toEqual(["2"]);
    expect(groups.history.map((g) => g.id)).toEqual(["3", "4", "5"]);
    expect(groupGrants([]).pending).toEqual([]);
  });

  it("describes the time left on a window", () => {
    expect(timeLeft(null, now)).toBe("Ended");
    expect(timeLeft("2026-11-16T11:59:00Z", now)).toBe("Ended");
    expect(timeLeft("invalid", now)).toBe("Ended");
    expect(timeLeft(new Date("2026-11-16T12:00:30Z"), now)).toBe("Less than a minute left");
    expect(timeLeft(new Date("2026-11-16T12:45:00Z"), now)).toBe("45 min left");
    expect(timeLeft(new Date("2026-11-16T14:00:00Z"), now)).toBe("2 h left");
    expect(timeLeft(new Date("2026-11-16T14:15:00Z"), now)).toBe("2 h 15 min left");
    expect(timeLeft(new Date("2026-11-18T12:00:00Z"), now)).toBe("2 d left");
    expect(timeLeft(new Date("2026-11-18T15:00:00Z"), now)).toBe("2 d 3 h left");
  });
});
