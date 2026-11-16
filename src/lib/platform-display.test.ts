import { describe, expect, it } from "vitest";
import {
  actorLabel,
  barHeights,
  buildHref,
  canEnterWorkspace,
  currencyDigits,
  decimalToMinor,
  describeAction,
  firstParam,
  formatBytes,
  formatCount,
  formatDate,
  formatDateTime,
  formatDay,
  formatLimit,
  formatLongDate,
  formatMonth,
  groupIntegrationUsage,
  healthRows,
  integrationFormDefaults,
  isCurrencyCode,
  isUuidLike,
  limitDraft,
  limitsFromDrafts,
  minorToDecimal,
  overridesFromDrafts,
  pageParam,
  pageWindow,
  parseWholeNumber,
  pickParam,
  revenueTotals,
  slugProblem,
  splitIntegrationForm,
  summariseSeries,
  tickIndexes,
  timeLeft,
  usage,
  worstHealth,
  type FieldShape,
  type HealthInput,
  type LimitDrafts,
} from "./platform-display";

describe("URL parameters", () => {
  it("reads the first value and trims it", () => {
    expect(firstParam(" baku ")).toBe("baku");
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam(undefined)).toBe("");
    expect(firstParam([])).toBe("");
  });

  it("accepts only allowed values", () => {
    expect(pickParam("active", ["active", "suspended"] as const)).toBe("active");
    expect(pickParam("deleted", ["active", "suspended"] as const)).toBeUndefined();
    expect(pickParam(undefined, ["active"] as const)).toBeUndefined();
  });

  it("falls back to page 1 for anything that is not a page number", () => {
    expect(pageParam("3")).toBe(3);
    expect(pageParam("0")).toBe(1);
    expect(pageParam("-2")).toBe(1);
    expect(pageParam("2.5")).toBe(1);
    expect(pageParam("abc")).toBe(1);
    expect(pageParam(undefined)).toBe(1);
    expect(pageParam("999999")).toBe(100_000);
    expect(pageParam("1234567")).toBe(1);
  });

  it("recognises UUIDs", () => {
    expect(isUuidLike("0b0f6c1e-3f0a-4e58-9a39-0a1b2c3d4e5f")).toBe(true);
    expect(isUuidLike("0b0f6c1e")).toBe(false);
    expect(isUuidLike("")).toBe(false);
  });

  it("builds links without empty values or page 1", () => {
    expect(buildHref("/platform/tenants", {})).toBe("/platform/tenants");
    expect(buildHref("/platform/tenants", { q: "", status: undefined, plan: null, page: 1 })).toBe("/platform/tenants");
    expect(buildHref("/platform/tenants", { q: "sea & sky", status: "active", page: 2 })).toBe("/platform/tenants?q=sea+%26+sky&status=active&page=2");
  });

  it("describes the rows a page shows", () => {
    expect(pageWindow(0, 1, 25)).toEqual({ page: 1, pages: 1, from: 0, to: 0, offset: 0, hasPrevious: false, hasNext: false });
    expect(pageWindow(60, 1, 25)).toMatchObject({ pages: 3, from: 1, to: 25, hasPrevious: false, hasNext: true });
    expect(pageWindow(60, 3, 25)).toMatchObject({ from: 51, to: 60, offset: 50, hasPrevious: true, hasNext: false });
    // Past the end: nothing to show, but the way back is still offered.
    expect(pageWindow(60, 9, 25)).toMatchObject({ pages: 3, from: 0, to: 0, hasPrevious: true, hasNext: false });
  });
});

describe("money", () => {
  it("knows how many decimals a currency uses", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("KWD")).toBe(3);
    expect(currencyDigits("nope")).toBe(2);
  });

  it("validates currency codes", () => {
    expect(isCurrencyCode("EUR")).toBe(true);
    expect(isCurrencyCode("eur")).toBe(false);
    expect(isCurrencyCode("EURO")).toBe(false);
  });

  it("turns typed amounts into minor units", () => {
    expect(decimalToMinor("29", "USD")).toBe(2900);
    expect(decimalToMinor("29.5", "USD")).toBe(2950);
    expect(decimalToMinor(" 1,290.00 ", "USD")).toBe(129000);
    expect(decimalToMinor("0", "USD")).toBe(0);
    expect(decimalToMinor("29.", "USD")).toBe(2900);
    expect(decimalToMinor("500", "JPY")).toBe(500);
    expect(decimalToMinor("1.250", "KWD")).toBe(1250);
  });

  it("rejects amounts the currency cannot express", () => {
    expect(decimalToMinor("", "USD")).toBeNull();
    expect(decimalToMinor("-5", "USD")).toBeNull();
    expect(decimalToMinor("29.999", "USD")).toBeNull();
    expect(decimalToMinor("500.5", "JPY")).toBeNull();
    expect(decimalToMinor("twenty", "USD")).toBeNull();
    expect(decimalToMinor("1e3", "USD")).toBeNull();
    expect(decimalToMinor("99999999999", "USD")).toBeNull();
  });

  it("writes minor units back as a decimal", () => {
    expect(minorToDecimal(2900, "USD")).toBe("29.00");
    expect(minorToDecimal(500, "JPY")).toBe("500");
    expect(minorToDecimal(0, "USD")).toBe("0.00");
  });
});

describe("sizes and limits", () => {
  it("formats byte counts", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(250 * 1024 * 1024)).toBe("250 MB");
    expect(formatBytes(1.44 * 1024 ** 3)).toBe("1.4 GB");
    expect(formatBytes(5 * 1024 ** 5)).toBe("5120 TB");
  });

  it("formats counts and limits", () => {
    expect(formatCount(1284)).toBe("1,284");
    expect(formatLimit(null)).toBe("Unlimited");
    expect(formatLimit(2000)).toBe("2,000");
  });

  it("grades usage against a limit in words, not only colour", () => {
    expect(usage(3, null)).toEqual({ percent: null, tone: "ok", label: "No limit" });
    expect(usage(1, 10)).toEqual({ percent: 10, tone: "ok", label: "Within the limit" });
    expect(usage(8, 10)).toEqual({ percent: 80, tone: "warn", label: "Close to the limit" });
    expect(usage(10, 10)).toEqual({ percent: 100, tone: "warn", label: "At the limit" });
    expect(usage(14, 10)).toEqual({ percent: 100, tone: "over", label: "Over the limit" });
    expect(usage(0, 0)).toEqual({ percent: 100, tone: "warn", label: "At the limit" });
    expect(usage(2, 0)).toEqual({ percent: 100, tone: "over", label: "Over the limit" });
  });

  it("parses whole numbers only", () => {
    expect(parseWholeNumber("15")).toBe(15);
    expect(parseWholeNumber(" 2,000 ")).toBe(2000);
    expect(parseWholeNumber("0")).toBe(0);
    expect(parseWholeNumber("")).toBeNull();
    expect(parseWholeNumber("1.5")).toBeNull();
    expect(parseWholeNumber("-1")).toBeNull();
    expect(parseWholeNumber("2000000001")).toBeNull();
    expect(parseWholeNumber("12345678901")).toBeNull();
  });

  it("starts a limit field from stored data", () => {
    expect(limitDraft(null)).toEqual({ unlimited: true, value: "" });
    expect(limitDraft(undefined)).toEqual({ unlimited: false, value: "" });
    expect(limitDraft(25)).toEqual({ unlimited: false, value: "25" });
  });

  const drafts = (overrides: Partial<LimitDrafts> = {}): LimitDrafts => ({
    maxTeamMembers: { unlimited: false, value: "5" },
    maxPublishedTours: { unlimited: false, value: "15" },
    maxStorageMb: { unlimited: false, value: "2,000" },
    maxBookingsPerMonth: { unlimited: true, value: "" },
    ...overrides,
  });

  it("reads plan limits, where every limit is a number or unlimited", () => {
    expect(limitsFromDrafts(drafts())).toEqual({
      ok: true,
      limits: { maxTeamMembers: 5, maxPublishedTours: 15, maxStorageMb: 2000, maxBookingsPerMonth: null },
    });
  });

  it("asks for a plan limit that was left blank or is not a number", () => {
    expect(limitsFromDrafts(drafts({ maxTeamMembers: { unlimited: false, value: " " }, maxStorageMb: { unlimited: false, value: "lots" } }))).toEqual({
      ok: false,
      errors: { maxTeamMembers: "Enter a limit, or switch on Unlimited.", maxStorageMb: "Enter a whole number from 0 to 2,000,000,000." },
    });
  });

  it("reads overrides: blank means the plan default, the switch means unlimited", () => {
    expect(
      overridesFromDrafts(
        drafts({ maxTeamMembers: { unlimited: false, value: "" }, maxPublishedTours: { unlimited: false, value: "40" }, maxStorageMb: { unlimited: false, value: "0" } }),
      ),
    ).toEqual({ ok: true, overrides: { maxPublishedTours: 40, maxStorageMb: 0, maxBookingsPerMonth: null } });
  });

  it("refuses an override that is not a whole number", () => {
    expect(overridesFromDrafts(drafts({ maxPublishedTours: { unlimited: false, value: "4.5" } }))).toEqual({
      ok: false,
      errors: { maxPublishedTours: "Enter a whole number from 0 to 2,000,000,000." },
    });
  });
});

describe("workspace addresses", () => {
  it("accepts a blank address (the server derives one) and well-formed ones", () => {
    expect(slugProblem("")).toBeNull();
    expect(slugProblem("caspian-trails")).toBeNull();
    expect(slugProblem(" Caspian-Trails ")).toBeNull();
    expect(slugProblem("abc")).toBeNull();
  });

  it("explains what is wrong with a malformed address", () => {
    expect(slugProblem("ab")).toBe("Use at least 3 characters.");
    expect(slugProblem("a".repeat(41))).toBe("Use 40 characters or fewer.");
    expect(slugProblem("-trails")).toMatch(/starting and ending/);
    expect(slugProblem("sea side")).toMatch(/lower-case letters/);
    expect(slugProblem("sea--side")).toBe("Use single hyphens only.");
  });
});

describe("dates", () => {
  const moment = new Date("2026-11-14T18:02:00Z");

  it("formats in UTC", () => {
    expect(formatDay("2026-11-14")).toBe("Nov 14");
    expect(formatDay(moment)).toBe("Nov 14");
    expect(formatDate(moment)).toBe("Nov 14, 2026");
    expect(formatDate("2026-11-14T23:59:00-05:00")).toBe("Nov 15, 2026");
    expect(formatDateTime(moment)).toBe("Nov 14, 2026, 18:02 UTC");
    expect(formatLongDate("2026-11-14")).toBe("Saturday 14 November 2026");
  });

  it("formats months and passes through anything else", () => {
    expect(formatMonth("2026-11")).toBe("Nov 2026");
    expect(formatMonth("soon")).toBe("soon");
  });

  it("says how long is left", () => {
    const at = (ms: number) => new Date(moment.getTime() + ms);
    expect(timeLeft(at(-1), moment)).toBe("Ended");
    expect(timeLeft(moment, moment)).toBe("Ended");
    expect(timeLeft(at(30_000), moment)).toBe("Less than a minute left");
    expect(timeLeft(at(42 * 60_000), moment)).toBe("42 min left");
    expect(timeLeft(at(120 * 60_000), moment)).toBe("2 h left");
    expect(timeLeft(at(125 * 60_000), moment)).toBe("2 h 5 min left");
    expect(timeLeft(at(72 * 3_600_000), moment)).toBe("3 days left");
    expect(timeLeft(new Date(Date.now() + 10 * 60_000 + 5_000))).toBe("10 min left");
  });
});

describe("charts", () => {
  it("scales bars to the tallest and keeps small days visible", () => {
    expect(barHeights([0, 0])).toEqual([0, 0]);
    expect(barHeights([])).toEqual([]);
    expect(barHeights([5, 10, 0])).toEqual([50, 100, 0]);
    expect(barHeights([1, 200])).toEqual([4, 100]);
    expect(barHeights([1, 200], 10)).toEqual([10, 100]);
  });

  it("summarises a series in a sentence", () => {
    expect(summariseSeries([], "booking", "bookings")).toBe("No bookings to show.");
    expect(
      summariseSeries(
        [
          { date: "2026-11-01", count: 0 },
          { date: "2026-11-02", count: 0 },
        ],
        "booking",
        "bookings",
      ),
    ).toBe("No bookings from Nov 1 to Nov 2.");
    expect(
      summariseSeries(
        [
          { date: "2026-11-01", count: 2 },
          { date: "2026-11-02", count: 7 },
          { date: "2026-11-03", count: 7 },
        ],
        "booking",
        "bookings",
      ),
    ).toBe("16 bookings from Nov 1 to Nov 3. Busiest day: Nov 2 with 7.");
    expect(summariseSeries([{ date: "2026-11-01", count: 1 }], "workspace", "workspaces")).toBe(
      "1 workspace from Nov 1 to Nov 1. Busiest day: Nov 1 with 1.",
    );
  });

  it("labels the last bar and every seventh before it", () => {
    expect([...tickIndexes(30)].sort((a, b) => a - b)).toEqual([1, 8, 15, 22, 29]);
    expect([...tickIndexes(3)]).toEqual([2]);
    expect(tickIndexes(0).size).toBe(0);
    expect([...tickIndexes(3, 0)].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });
});

describe("summary tables", () => {
  it("totals revenue per currency, largest first", () => {
    expect(
      revenueTotals([
        { month: "2026-10", currency: "USD", amount: 2900, invoices: 1 },
        { month: "2026-11", currency: "EUR", amount: 9000, invoices: 2 },
        { month: "2026-11", currency: "USD", amount: 7900, invoices: 1 },
        { month: "2026-11", currency: "AZN", amount: 9000, invoices: 1 },
      ]),
    ).toEqual([
      { currency: "USD", amount: 10800, invoices: 2 },
      { currency: "AZN", amount: 9000, invoices: 1 },
      { currency: "EUR", amount: 9000, invoices: 2 },
    ]);
    expect(revenueTotals([])).toEqual([]);
  });

  it("groups integration usage by provider", () => {
    expect(
      groupIntegrationUsage([
        { provider: "smtp", status: "connected", count: 4 },
        { provider: "smtp", status: "error", count: 1 },
        { provider: "cloudinary", status: "connected", count: 5 },
        { provider: "stripe", status: "untested", count: 2 },
        { provider: "stripe", status: "disabled", count: 3 },
      ]),
    ).toEqual([
      { provider: "cloudinary", total: 5, connected: 5, error: 0, untested: 0, disabled: 0 },
      { provider: "smtp", total: 5, connected: 4, error: 1, untested: 0, disabled: 0 },
      { provider: "stripe", total: 5, connected: 0, error: 0, untested: 2, disabled: 3 },
    ]);
  });
});

describe("activity", () => {
  it("names who acted", () => {
    expect(actorLabel("platform_admin")).toBe("Platform admin");
    expect(actorLabel("platform_admin", true)).toBe("You (platform admin)");
    expect(actorLabel("support_session")).toBe("Support session");
    expect(actorLabel("user")).toBe("Workspace member");
    expect(actorLabel("system", true)).toBe("System");
  });

  it("turns action codes into words", () => {
    expect(describeAction("tenant.plan_changed")).toBe("Tenant plan changed");
    expect(describeAction("jobs.scheduled_run")).toBe("Jobs scheduled run");
    expect(describeAction("")).toBe("Unknown event");
  });
});

describe("system health", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  const healthy: HealthInput = {
    database: { platformReachable: true, runtimeReachable: true },
    migrations: { expected: 12, applied: 12, pending: 0 },
    runtimeRole: { safe: true, problem: null },
    outbox: { pending: 0, failed: 0, oldestPendingAt: null },
  };
  const row = (input: HealthInput, key: string) => healthRows(input, now).find((entry) => entry.key === key)!;

  it("reports a healthy system as five passing checks", () => {
    const rows = healthRows(healthy, now);
    expect(rows.map((entry) => entry.key)).toEqual(["platform_db", "runtime_db", "migrations", "runtime_role", "outbox"]);
    expect(rows.every((entry) => entry.state === "ok")).toBe(true);
    expect(row(healthy, "migrations").status).toBe("Up to date");
    expect(row(healthy, "outbox").status).toBe("Empty");
    expect(worstHealth(rows)).toBe("ok");
    expect(healthRows(healthy).length).toBe(5);
  });

  it("fails unreachable connections", () => {
    const down = { ...healthy, database: { platformReachable: false, runtimeReachable: false } };
    expect(row(down, "platform_db")).toMatchObject({ state: "fail", status: "Unreachable" });
    expect(row(down, "runtime_db")).toMatchObject({ state: "fail", status: "Unreachable" });
    expect(worstHealth(healthRows(down, now))).toBe("fail");
  });

  it("fails pending migrations and marks an unreadable ledger unknown", () => {
    expect(row({ ...healthy, migrations: { expected: 12, applied: 10, pending: 2 } }, "migrations")).toMatchObject({
      state: "fail",
      status: "2 pending",
    });
    const unknown = { ...healthy, migrations: { expected: 12, applied: null, pending: null } };
    expect(row(unknown, "migrations")).toMatchObject({ state: "unknown", status: "Unknown" });
    expect(worstHealth(healthRows(unknown, now))).toBe("unknown");
  });

  it("fails an unsafe runtime role with the reported problem, or a default", () => {
    expect(row({ ...healthy, runtimeRole: { safe: false, problem: "Role bypasses RLS." } }, "runtime_role")).toMatchObject({
      state: "fail",
      detail: "Role bypasses RLS.",
    });
    expect(row({ ...healthy, runtimeRole: { safe: false, problem: null } }, "runtime_role").detail).toMatch(/not subject to row-level security/);
  });

  it("warns about failed or stuck notifications", () => {
    const sending = { ...healthy, outbox: { pending: 3, failed: 0, oldestPendingAt: new Date("2026-11-14T11:58:00Z") } };
    expect(row(sending, "outbox")).toMatchObject({ state: "ok", status: "Sending" });

    const stuck = { ...healthy, outbox: { pending: 3, failed: 0, oldestPendingAt: new Date("2026-11-14T11:00:00Z") } };
    expect(row(stuck, "outbox")).toMatchObject({ state: "warn", status: "Backlog" });
    expect(row(stuck, "outbox").detail).toMatch(/longer than 15 minutes/);

    const failed = { ...healthy, outbox: { pending: 0, failed: 2, oldestPendingAt: null } };
    expect(row(failed, "outbox")).toMatchObject({ state: "warn", status: "Failures" });
    expect(worstHealth(healthRows(failed, now))).toBe("warn");
  });

  it("treats no rows as healthy", () => {
    expect(worstHealth([])).toBe("ok");
  });
});

describe("support access", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  const grant = { status: "approved" as const, requestedBy: "admin-1", expiresAt: new Date("2026-11-14T13:00:00Z") };

  it("lets only the requesting admin in, and only while the approval lasts", () => {
    expect(canEnterWorkspace(grant, "admin-1", now)).toBe(true);
    expect(canEnterWorkspace(grant, "admin-2", now)).toBe(false);
    expect(canEnterWorkspace({ ...grant, status: "requested" }, "admin-1", now)).toBe(false);
    expect(canEnterWorkspace({ ...grant, status: "expired" }, "admin-1", now)).toBe(false);
    expect(canEnterWorkspace({ ...grant, expiresAt: null }, "admin-1", now)).toBe(false);
    expect(canEnterWorkspace({ ...grant, expiresAt: now }, "admin-1", now)).toBe(false);
    expect(canEnterWorkspace({ ...grant, expiresAt: new Date(Date.now() + 60_000) }, "admin-1")).toBe(true);
  });
});

describe("integration forms", () => {
  const fields: FieldShape[] = [
    { key: "host", type: "text", secret: false, required: true },
    { key: "port", type: "number", secret: false, required: true },
    { key: "secure", type: "boolean", secret: false, required: false },
    { key: "username", type: "text", secret: true, required: true },
    { key: "password", type: "password", secret: true, required: true },
    { key: "folder", type: "text", secret: false, required: false },
    { key: "mode", type: "select", secret: false, required: false },
    { key: "hidden", type: "boolean", secret: true, required: false },
  ];

  it("prefills open settings and never a secret", () => {
    expect(integrationFormDefaults(fields, { host: "smtp.example.com", port: 587, secure: true, username: "leak", password: "leak", folder: null })).toEqual({
      host: "smtp.example.com",
      port: "587",
      secure: true,
      username: "",
      password: "",
      folder: "",
      mode: "",
      hidden: false,
    });
  });

  it("splits a filled form into open settings and secrets", () => {
    expect(
      splitIntegrationForm(fields, { host: " smtp.example.com ", port: "587", secure: false, username: " ops ", password: " p w ", folder: "", mode: "tls", hidden: true }),
    ).toEqual({
      config: { host: "smtp.example.com", port: 587, secure: false, mode: "tls" },
      secrets: { username: "ops", password: " p w " },
      missing: [],
    });
  });

  it("keeps stored secrets when their fields are left blank", () => {
    const result = splitIntegrationForm(fields, { host: "smtp.example.com", port: "587", secure: true, username: "", password: "" }, ["username", "password"]);
    expect(result.secrets).toEqual({});
    expect(result.missing).toEqual([]);
  });

  it("lists required fields left empty and passes odd numbers through for the server to judge", () => {
    const result = splitIntegrationForm(fields, { host: "", port: "five", username: "", password: "" }, ["username"]);
    expect(result.missing).toEqual(["host", "password"]);
    expect(result.config).toEqual({ port: "five", secure: false });
  });
});
