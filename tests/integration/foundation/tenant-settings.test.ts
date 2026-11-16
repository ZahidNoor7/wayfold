import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant, type TenantScope } from "@/server/db/context";
import { tenantSettings } from "@/server/db/schema";
import { toActionError, ValidationError } from "@/server/errors";
import {
  bookingSettingsSchema,
  getBookingSettings,
  getPromotionSettings,
  promotionSettingsSchema,
  readSiteDocument,
  updateBookingSettings,
  updatePromotionSettings,
  writeSiteDocument,
} from "@/server/settings/tenant-settings";
import { createTenant } from "../../helpers/fixtures";
import { pgCode, rejection } from "./support";

const BOOKING_DEFAULTS = { holdHours: 24, horizonDays: 365, minNoticeDays: 1, weeklyDaysOff: [], referencePrefix: "WF" };
const PROMOTION_DEFAULTS = { requestsEnabled: true, maxRequestPercent: 30, responseDays: 2 };

const inTenant = <T>(tenantId: string, fn: (scope: TenantScope) => Promise<T>) => withTenant(tenantId, fn);

async function storedRow(tenantId: string) {
  const [row] = await withTenant(tenantId, ({ tx }) => tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)));
  return row ?? null;
}

describe("booking settings", () => {
  it("returns defaults for a workspace that has saved nothing", async () => {
    const a = await createTenant();
    expect(await inTenant(a.tenantId, getBookingSettings)).toEqual(BOOKING_DEFAULTS);
    // Reading does not create a row.
    expect(await storedRow(a.tenantId)).toBeNull();
  });

  it("saves a partial update over the defaults and returns the result", async () => {
    const a = await createTenant();
    const saved = await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 48, weeklyDaysOff: [7] }));

    expect(saved).toEqual({ ...BOOKING_DEFAULTS, holdHours: 48, weeklyDaysOff: [7] });
    expect(await inTenant(a.tenantId, getBookingSettings)).toEqual(saved);
    expect((await storedRow(a.tenantId))?.booking).toEqual(saved);
  });

  it("merges later updates with earlier ones", async () => {
    const a = await createTenant();
    await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 48, minNoticeDays: 3 }));
    const saved = await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { horizonDays: 90 }));
    expect(saved).toEqual({ ...BOOKING_DEFAULTS, holdHours: 48, minNoticeDays: 3, horizonDays: 90 });
  });

  it("normalises the reference prefix", async () => {
    const a = await createTenant();
    const saved = await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { referencePrefix: "  ct " }));
    expect(saved.referencePrefix).toBe("CT");
  });

  it.each([
    ["hold shorter than an hour", { holdHours: 0 }],
    ["hold longer than a week", { holdHours: 169 }],
    ["a fractional hold", { holdHours: 1.5 }],
    ["a horizon under a week", { horizonDays: 6 }],
    ["a horizon over two years", { horizonDays: 731 }],
    ["negative notice", { minNoticeDays: -1 }],
    ["a weekday that does not exist", { weeklyDaysOff: [0] }],
    ["every day off", { weeklyDaysOff: [1, 2, 3, 4, 5, 6, 7] }],
    ["a one-letter prefix", { referencePrefix: "W" }],
    ["a five-letter prefix", { referencePrefix: "WFOLD" }],
    ["a prefix with digits", { referencePrefix: "W1" }],
    ["a string where a number belongs", { holdHours: "48" }],
  ])("rejects %s and stores nothing", async (_name, input) => {
    const a = await createTenant();
    await expect(inTenant(a.tenantId, (scope) => updateBookingSettings(scope, input))).rejects.toBeInstanceOf(ValidationError);
    expect(await storedRow(a.tenantId)).toBeNull();
    expect(await inTenant(a.tenantId, getBookingSettings)).toEqual(BOOKING_DEFAULTS);
  });

  it("reports which field was wrong, as a ValidationError the action layer can show", async () => {
    const a = await createTenant();
    const error = (await rejection(
      inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 0, referencePrefix: "W1", horizonDays: 90 })),
    )) as ValidationError;

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ code: "validation", status: 422, message: "Please check the highlighted fields." });
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual(["holdHours", "referencePrefix"]);
    for (const messages of Object.values(error.fieldErrors ?? {})) {
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.every((message) => typeof message === "string" && message.length > 0)).toBe(true);
    }
    expect(toActionError(error)).toMatchObject({ ok: false, code: "validation", fieldErrors: error.fieldErrors });
  });

  it("treats an undefined field as 'leave as is', not as a reset to the default", async () => {
    const a = await createTenant();
    await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 48, weeklyDaysOff: [6, 7], referencePrefix: "CT" }));

    const saved = await inTenant(a.tenantId, (scope) =>
      updateBookingSettings(scope, { holdHours: undefined, weeklyDaysOff: undefined, referencePrefix: undefined, minNoticeDays: 5 }),
    );

    expect(saved).toEqual({ ...BOOKING_DEFAULTS, holdHours: 48, weeklyDaysOff: [6, 7], referencePrefix: "CT", minNoticeDays: 5 });
    expect((await storedRow(a.tenantId))?.booking).toEqual(saved);
  });

  it("still rejects an explicit null, which is a value and not an omission", async () => {
    const a = await createTenant();
    await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 48 }));
    const error = (await rejection(inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { holdHours: null })))) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(["holdHours"]);
    expect((await inTenant(a.tenantId, getBookingSettings)).holdHours).toBe(48);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty object", {}],
    ["a string", "holdHours=1"],
    ["a number", 42],
    ["a boolean", true],
    ["an array", [{ holdHours: 1 }]],
  ])("changes nothing when the patch is %s", async (_name, input) => {
    const a = await createTenant();
    const before = await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 48, minNoticeDays: 4 }));

    const after = await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, input));

    expect(after).toEqual(before);
    // Nothing from a malformed patch is stored alongside the real settings.
    expect((await storedRow(a.tenantId))?.booking).toEqual(before);
  });

  it("keeps the previous values when an update is rejected", async () => {
    const a = await createTenant();
    await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 12 }));
    await expect(inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 9_999 }))).rejects.toBeInstanceOf(ValidationError);
    expect((await inTenant(a.tenantId, getBookingSettings)).holdHours).toBe(12);
  });

  it("drops unknown keys instead of storing them", async () => {
    const a = await createTenant();
    const saved = await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 6, tenantId: "someone-else", isAdmin: true }));
    expect(saved).toEqual({ ...BOOKING_DEFAULTS, holdHours: 6 });
    expect((await storedRow(a.tenantId))?.booking).toEqual(saved);
  });

  it("falls back to defaults when the stored document is invalid", async () => {
    const a = await createTenant();
    await withTenant(a.tenantId, ({ tx }) => tx.insert(tenantSettings).values({ booking: { holdHours: "soon", horizonDays: -5 } }));
    expect(await inTenant(a.tenantId, getBookingSettings)).toEqual(BOOKING_DEFAULTS);
  });

  it("exposes a schema whose empty input yields the defaults", () => {
    expect(bookingSettingsSchema.parse({})).toEqual(BOOKING_DEFAULTS);
  });
});

describe("promotion settings", () => {
  it("returns defaults for a workspace that has saved nothing", async () => {
    const a = await createTenant();
    expect(await inTenant(a.tenantId, getPromotionSettings)).toEqual(PROMOTION_DEFAULTS);
    expect(promotionSettingsSchema.parse({})).toEqual(PROMOTION_DEFAULTS);
  });

  it("saves and merges updates", async () => {
    const a = await createTenant();
    await inTenant(a.tenantId, (scope) => updatePromotionSettings(scope, { requestsEnabled: false }));
    const saved = await inTenant(a.tenantId, (scope) => updatePromotionSettings(scope, { maxRequestPercent: 15, responseDays: 3 }));

    expect(saved).toEqual({ requestsEnabled: false, maxRequestPercent: 15, responseDays: 3 });
    expect(await inTenant(a.tenantId, getPromotionSettings)).toEqual(saved);
  });

  it.each([
    ["a zero discount cap", { maxRequestPercent: 0 }],
    ["a discount cap over ninety percent", { maxRequestPercent: 91 }],
    ["a response time of four days", { responseDays: 4 }],
    ["a response time of zero days", { responseDays: 0 }],
    ["a non-boolean switch", { requestsEnabled: "yes" }],
  ])("rejects %s", async (_name, input) => {
    const a = await createTenant();
    await expect(inTenant(a.tenantId, (scope) => updatePromotionSettings(scope, input))).rejects.toBeInstanceOf(ValidationError);
    expect(await inTenant(a.tenantId, getPromotionSettings)).toEqual(PROMOTION_DEFAULTS);
  });

  it("reports invalid promotion fields as a ValidationError with field errors", async () => {
    const a = await createTenant();
    const error = (await rejection(
      inTenant(a.tenantId, (scope) => updatePromotionSettings(scope, { maxRequestPercent: 500, responseDays: 0, requestsEnabled: false })),
    )) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual(["maxRequestPercent", "responseDays"]);
    expect(await inTenant(a.tenantId, getPromotionSettings)).toEqual(PROMOTION_DEFAULTS);
  });

  it("ignores undefined fields in a promotion patch", async () => {
    const a = await createTenant();
    await inTenant(a.tenantId, (scope) => updatePromotionSettings(scope, { requestsEnabled: false, maxRequestPercent: 12 }));

    const saved = await inTenant(a.tenantId, (scope) =>
      updatePromotionSettings(scope, { requestsEnabled: undefined, maxRequestPercent: undefined, responseDays: 1 }),
    );
    expect(saved).toEqual({ requestsEnabled: false, maxRequestPercent: 12, responseDays: 1 });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "requestsEnabled=false"],
    ["a number", 0],
  ])("changes nothing when the promotion patch is %s", async (_name, input) => {
    const a = await createTenant();
    const before = await inTenant(a.tenantId, (scope) => updatePromotionSettings(scope, { maxRequestPercent: 12 }));
    expect(await inTenant(a.tenantId, (scope) => updatePromotionSettings(scope, input))).toEqual(before);
    expect((await storedRow(a.tenantId))?.promotions).toEqual(before);
  });

  it("falls back to defaults when the stored document is invalid", async () => {
    const a = await createTenant();
    await withTenant(a.tenantId, ({ tx }) => tx.insert(tenantSettings).values({ promotions: { maxRequestPercent: 500 } }));
    expect(await inTenant(a.tenantId, getPromotionSettings)).toEqual(PROMOTION_DEFAULTS);
  });
});

describe("site document", () => {
  it("is empty until written, then returned as stored", async () => {
    const a = await createTenant();
    expect(await inTenant(a.tenantId, readSiteDocument)).toEqual({});

    const document = { hero: { title: "Slow travel in the Caucasus", images: ["m1", "m2"] }, sections: [{ kind: "faq", items: [] }] };
    await inTenant(a.tenantId, (scope) => writeSiteDocument(scope, document));
    expect(await inTenant(a.tenantId, readSiteDocument)).toEqual(document);
  });

  it("replaces the whole document on each write", async () => {
    const a = await createTenant();
    await inTenant(a.tenantId, (scope) => writeSiteDocument(scope, { hero: { title: "First" }, footer: { note: "x" } }));
    await inTenant(a.tenantId, (scope) => writeSiteDocument(scope, { hero: { title: "Second" } }));
    expect(await inTenant(a.tenantId, readSiteDocument)).toEqual({ hero: { title: "Second" } });
  });
});

describe("sections are independent", () => {
  it("does not disturb the other sections when one is written", async () => {
    const a = await createTenant();
    await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 72 }));
    await inTenant(a.tenantId, (scope) => updatePromotionSettings(scope, { maxRequestPercent: 10 }));
    await inTenant(a.tenantId, (scope) => writeSiteDocument(scope, { hero: { title: "Hello" } }));
    await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { minNoticeDays: 2 }));

    expect(await inTenant(a.tenantId, getBookingSettings)).toMatchObject({ holdHours: 72, minNoticeDays: 2 });
    expect(await inTenant(a.tenantId, getPromotionSettings)).toMatchObject({ maxRequestPercent: 10 });
    expect(await inTenant(a.tenantId, readSiteDocument)).toEqual({ hero: { title: "Hello" } });

    // One row per tenant, however many sections were written.
    const rows = await withTenant(a.tenantId, ({ tx }) => tx.select().from(tenantSettings));
    expect(rows).toHaveLength(1);
  });

  it("rolls a write back with its transaction", async () => {
    const a = await createTenant();
    await expect(
      withTenant(a.tenantId, async (scope) => {
        await updateBookingSettings(scope, { holdHours: 99 });
        throw new Error("later step failed");
      }),
    ).rejects.toThrow("later step failed");
    expect(await inTenant(a.tenantId, getBookingSettings)).toEqual(BOOKING_DEFAULTS);
  });
});

describe("tenant settings isolation", () => {
  it("keeps each tenant's settings to itself", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await inTenant(a.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 100, referencePrefix: "AAA" }));
    await inTenant(a.tenantId, (scope) => updatePromotionSettings(scope, { maxRequestPercent: 77 }));
    await inTenant(a.tenantId, (scope) => writeSiteDocument(scope, { hero: { title: "Tenant A only" } }));

    expect(await inTenant(b.tenantId, getBookingSettings)).toEqual(BOOKING_DEFAULTS);
    expect(await inTenant(b.tenantId, getPromotionSettings)).toEqual(PROMOTION_DEFAULTS);
    expect(await inTenant(b.tenantId, readSiteDocument)).toEqual({});

    await inTenant(b.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 5 }));
    await inTenant(b.tenantId, (scope) => writeSiteDocument(scope, { hero: { title: "Tenant B" } }));

    expect(await inTenant(a.tenantId, getBookingSettings)).toMatchObject({ holdHours: 100, referencePrefix: "AAA" });
    expect(await inTenant(a.tenantId, readSiteDocument)).toEqual({ hero: { title: "Tenant A only" } });
  });

  it("cannot read or change another tenant's row, even by naming it", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await inTenant(b.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 5 }));

    const fromA = await withTenant(a.tenantId, async ({ tx }) => ({
      read: await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, b.tenantId)),
      updated: await tx.update(tenantSettings).set({ booking: {} }).where(eq(tenantSettings.tenantId, b.tenantId)).returning(),
      deleted: await tx.delete(tenantSettings).where(eq(tenantSettings.tenantId, b.tenantId)).returning(),
    }));
    expect(fromA).toEqual({ read: [], updated: [], deleted: [] });
    expect((await inTenant(b.tenantId, getBookingSettings)).holdHours).toBe(5);
  });

  it("cannot be tricked into writing another tenant's settings with a forged scope", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await inTenant(b.tenantId, (scope) => updateBookingSettings(scope, { holdHours: 5 }));

    // A scope that lies about its tenant still runs on A's transaction, so the
    // database refuses the write and B's settings are untouched.
    const code = await pgCode(() =>
      withTenant(a.tenantId, (scope) => updateBookingSettings({ ...scope, tenantId: b.tenantId }, { holdHours: 150 })),
    );
    expect(code).toBe("42501");
    const forgedRead = await withTenant(a.tenantId, (scope) => getBookingSettings({ ...scope, tenantId: b.tenantId }));
    expect(forgedRead).toEqual(BOOKING_DEFAULTS);
    expect((await inTenant(b.tenantId, getBookingSettings)).holdHours).toBe(5);
  });
});
