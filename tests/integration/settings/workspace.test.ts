import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/server/db/context";
import { tenants } from "@/server/db/schema";
import { withPlatform } from "@/server/platform/db";
import {
  completeOnboarding,
  DEFAULT_BRANDING,
  getWorkspaceProfile,
  SUPPORTED_CURRENCIES,
  updateBranding,
  updateWorkspaceProfile,
} from "@/server/settings/workspace";
import { createTenant, randomId, unique, type TenantFixture } from "../../helpers/fixtures";
import { asOwner, auditActions, failure, seedMedia } from "../content/seed";

const INSUFFICIENT_PRIVILEGE = "42501";

async function platformRow(tenant: TenantFixture) {
  const [row] = await withPlatform((tx) => tx.select().from(tenants).where(eq(tenants.id, tenant.tenantId)));
  return row!;
}

describe("workspace profile", () => {
  it("reads the workspace's own profile", async () => {
    const tenant = await createTenant({ name: "Aurelia Journeys" });
    expect(await asOwner(tenant)((scope) => getWorkspaceProfile(scope))).toEqual({
      id: tenant.tenantId,
      slug: tenant.slug,
      name: "Aurelia Journeys",
      tagline: "",
      description: "",
      email: "",
      phone: "",
      address: "",
      website: "",
      social: {},
      regions: [],
      languages: ["en"],
      currency: "USD",
      timezone: "UTC",
      branding: DEFAULT_BRANDING,
      logoUrl: null,
      onboardingCompletedAt: null,
    });
  });

  it("updates every editable field, normalising as it goes", async () => {
    const tenant = await createTenant();
    const profile = await asOwner(tenant)((scope) =>
      updateWorkspaceProfile(scope, {
        name: "  Aurelia   Journeys ",
        tagline: "Private & small-group journeys",
        description: "First paragraph.\r\n\r\nSecond paragraph.",
        email: " Hello@AureliaJourneys.AZ ",
        phone: "+994 50 123 45 67",
        address: "Icherisheher\nBaku",
        website: "aureliajourneys.az/tours",
        social: { instagram: "@aureliajourneys", youtube: "youtube.com/@aureliajourneys", whatsapp: "+994 50 123 45 67" },
        regions: ["Baku", " Sheki "],
        languages: ["en", "AZ", "pt-br", "en"],
        currency: "AZN",
        timezone: "Asia/Baku",
      }),
    );

    expect(profile).toMatchObject({
      name: "Aurelia Journeys",
      tagline: "Private & small-group journeys",
      description: "First paragraph.\n\nSecond paragraph.",
      email: "hello@aureliajourneys.az",
      phone: "+994 50 123 45 67",
      address: "Icherisheher\nBaku",
      website: "https://aureliajourneys.az/tours",
      social: { instagram: "@aureliajourneys", youtube: "youtube.com/@aureliajourneys", whatsapp: "+994 50 123 45 67" },
      regions: ["Baku", "Sheki"],
      languages: ["en", "az", "pt-BR"],
      currency: "AZN",
      timezone: "Asia/Baku",
    });

    const audit = await withTenant(tenant.tenantId, ({ tx }) => tx.query.auditLogs.findMany());
    const entry = audit.find((row) => row.action === "workspace.profile_updated")!;
    expect(entry).toMatchObject({ targetType: "workspace", targetId: tenant.tenantId, actorUserId: tenant.ownerId });
    // Field names only: no values in the audit trail.
    expect((entry.metadata as { fields: string[] }).fields).toEqual(expect.arrayContaining(["name", "email", "social", "timezone"]));
    expect(JSON.stringify(entry.metadata)).not.toContain("aureliajourneys");
  });

  it("changes only what was sent, merges social links and clears them with an empty value", async () => {
    const tenant = await createTenant({ name: "Original Name" });
    const update = (input: Parameters<typeof updateWorkspaceProfile>[1]) => asOwner(tenant)((scope) => updateWorkspaceProfile(scope, input));

    await update({ tagline: "Slow travel", social: { instagram: "@first", facebook: "facebook.com/first" } });
    const next = await update({ social: { instagram: "", tiktok: "https://www.tiktok.com/@first" }, email: "" });

    expect(next).toMatchObject({
      name: "Original Name",
      tagline: "Slow travel",
      email: "",
      social: { facebook: "facebook.com/first", tiktok: "https://www.tiktok.com/@first" },
    });
    expect(next.social).not.toHaveProperty("instagram");
    expect((await update({ website: "" })).website).toBe("");
    expect((await update({ website: "HTTP://Example.com" })).website).toBe("HTTP://Example.com");

    const before = (await auditActions(tenant)).length;
    expect(await update({})).toMatchObject({ tagline: "Slow travel" });
    expect((await auditActions(tenant)).length).toBe(before);
  });

  it("rejects bad input with field errors", async () => {
    const tenant = await createTenant();
    const run = (input: unknown) => failure(() => asOwner(tenant)((scope) => updateWorkspaceProfile(scope, input as never)));

    expect(await run({ name: "A" })).toMatchObject({ name: "ValidationError", fieldErrors: { name: ["Add your business name."] } });
    expect((await run({ name: "<b>Bold Tours</b>" })).fieldErrors).toHaveProperty("name");
    expect((await run({ email: "not-an-email" })).fieldErrors).toEqual({ email: ["Enter a valid email address."] });
    expect((await run({ phone: "call me" })).fieldErrors).toHaveProperty("phone");
    for (const website of ["javascript:alert(1)", "ftp://example.com", "not a url", "https://", "example", "https://exa mple.com"]) {
      expect((await run({ website })).fieldErrors, website).toHaveProperty("website");
    }
    for (const instagram of ["javascript:alert(1)", "two words", "https://insta gram.com/x", "x".repeat(201)]) {
      expect((await run({ social: { instagram } })).fieldErrors, instagram).toHaveProperty("social.instagram");
    }
    expect((await run({ social: { whatsapp: "abc" } })).fieldErrors).toHaveProperty("social.whatsapp");
    expect((await run({ regions: Array.from({ length: 31 }, (_, i) => `Region ${i}`) })).fieldErrors).toHaveProperty("regions");
    expect((await run({ languages: [] })).fieldErrors).toEqual({ languages: ["Keep at least one language."] });
    // The last two have the right shape but are not language tags.
    for (const language of ["english", "e", "en_US", "12", "en-12", "en-xx-yy"]) {
      expect((await run({ languages: [language] })).fieldErrors, language).toHaveProperty("languages.0");
    }
  });

  it("keeps the contact e-mail empty or valid, since staff alerts are sent to it", async () => {
    const tenant = await createTenant();
    const update = (email: string) => asOwner(tenant)((scope) => updateWorkspaceProfile(scope, { email }));

    for (const email of ["owner", "owner@", "@example.com", "owner@example", "two words@example.com", "a@b.com, c@d.com", "owner@example.com\nBcc: x@y.com", `${"a".repeat(200)}@example.com`]) {
      expect((await failure(() => update(email))).fieldErrors?.email?.[0], email).toBe("Enter a valid email address.");
    }
    expect((await asOwner(tenant)((scope) => getWorkspaceProfile(scope))).email).toBe("");

    expect((await update("Owner+Tours@Example.CO.UK")).email).toBe("owner+tours@example.co.uk");
    expect((await update("   ")).email).toBe("");
  });

  it("keeps the website empty or an http(s) URL", async () => {
    const tenant = await createTenant();
    const update = (website: string) => asOwner(tenant)((scope) => updateWorkspaceProfile(scope, { website }));

    for (const website of ["javascript:alert(1)", "data:text/html,x", "mailto:a@b.com", "ftp://example.com", "//example.com", "https://", "http://localhost", "example", "https://exa mple.com", "https://example.com/<script>", `https://example.com/${"a".repeat(200)}`]) {
      expect((await failure(() => update(website))).fieldErrors, website).toHaveProperty("website");
    }
    expect((await asOwner(tenant)((scope) => getWorkspaceProfile(scope))).website).toBe("");

    for (const [input, stored] of [
      ["example.com", "https://example.com"],
      ["http://example.com", "http://example.com"],
      ["https://www.example.co.uk/tours?ref=1#top", "https://www.example.co.uk/tours?ref=1#top"],
      ["  ", ""],
    ] as const) {
      const website = (await update(input)).website;
      expect(website, input).toBe(stored);
      if (website) expect(["http:", "https:"]).toContain(new URL(website).protocol);
    }
  });

  it("accepts only currencies on the ISO 4217 allow-list", async () => {
    const tenant = await createTenant();
    const run = (currency: unknown) => failure(() => asOwner(tenant)((scope) => updateWorkspaceProfile(scope, { currency } as never)));

    for (const currency of ["XXX", "usd", "US", "BTC", "", 840]) {
      expect((await run(currency)).fieldErrors, String(currency)).toEqual({ currency: ["Choose a supported currency."] });
    }
    expect((await asOwner(tenant)((scope) => updateWorkspaceProfile(scope, { currency: "EUR" }))).currency).toBe("EUR");

    // Every code offered is a real ISO 4217 currency the runtime can format.
    const known = new Set(Intl.supportedValuesOf("currency"));
    expect(SUPPORTED_CURRENCIES.filter((code) => !known.has(code))).toEqual([]);
    expect(new Set(SUPPORTED_CURRENCIES).size).toBe(SUPPORTED_CURRENCIES.length);
    expect(SUPPORTED_CURRENCIES).toContain("AZN");
  });

  it("accepts only real IANA time zones", async () => {
    const tenant = await createTenant();
    const run = (timezone: string) => failure(() => asOwner(tenant)((scope) => updateWorkspaceProfile(scope, { timezone })));

    for (const timezone of ["Mars/Olympus", "EST", "utc", "GMT+4", "asia/baku", "Asia/Baku; drop table", "", "+04:00"]) {
      expect((await run(timezone)).fieldErrors, timezone).toEqual({ timezone: ["Choose a time zone such as Europe/London."] });
    }
    for (const timezone of ["Europe/London", "America/Argentina/Buenos_Aires", "Asia/Ho_Chi_Minh", "UTC"]) {
      expect((await asOwner(tenant)((scope) => updateWorkspaceProfile(scope, { timezone }))).timezone, timezone).toBe(timezone);
    }
  });

  it("never touches address, status, plan or limits, whatever the payload says", async () => {
    const tenant = await createTenant();
    const other = await createTenant();
    const before = await platformRow(tenant);

    const profile = await asOwner(tenant)((scope) =>
      updateWorkspaceProfile(scope, {
        tagline: "Still allowed",
        slug: unique("stolen"),
        status: "suspended",
        planId: other.planId,
        limitOverrides: { maxPublishedTours: 9999 },
        suspendedReason: "self-inflicted",
        id: other.tenantId,
        tenantId: other.tenantId,
        branding: { theme: "graphite" },
        onboardingCompletedAt: new Date(),
      } as never),
    );
    expect(profile).toMatchObject({ id: tenant.tenantId, slug: tenant.slug, tagline: "Still allowed", branding: DEFAULT_BRANDING, onboardingCompletedAt: null });

    const after = await platformRow(tenant);
    expect(after).toMatchObject({
      slug: before.slug,
      status: "active",
      planId: before.planId,
      limitOverrides: {},
      suspendedReason: null,
      tagline: "Still allowed",
    });
    expect((await platformRow(other)).tagline).toBe("");
  });

  it("is backed by the database: the runtime role cannot write those columns at all", async () => {
    const tenant = await createTenant();
    const other = await createTenant();

    for (const patch of [
      { slug: unique("stolen") },
      { status: "suspended" as const },
      { planId: other.planId },
      { limitOverrides: { maxTeamMembers: 9999 } },
      { suspendedReason: "x" },
    ]) {
      const code = await withTenant(tenant.tenantId, ({ tx }) => tx.update(tenants).set(patch).where(eq(tenants.id, tenant.tenantId))).then(
        () => undefined,
        (error: { code?: string; cause?: { code?: string } }) => error.code ?? error.cause?.code,
      );
      expect(code, JSON.stringify(patch)).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect(await platformRow(tenant)).toMatchObject({ slug: tenant.slug, status: "active", planId: tenant.planId, limitOverrides: {} });
  });
});

describe("workspace branding", () => {
  it("updates theme, mode, corners and font one pick at a time", async () => {
    const tenant = await createTenant();
    const update = (input: Parameters<typeof updateBranding>[1]) => asOwner(tenant)((scope) => updateBranding(scope, input));

    expect(await update({ theme: "caspian" })).toEqual({ theme: "caspian", mode: "light", radius: "md", font: "classic" });
    expect(await update({ mode: "system", radius: "lg" })).toEqual({ theme: "caspian", mode: "system", radius: "lg", font: "classic" });
    expect(await update({ font: "sans" })).toEqual({ theme: "caspian", mode: "system", radius: "lg", font: "sans" });
    expect((await asOwner(tenant)((scope) => getWorkspaceProfile(scope))).branding).toEqual({ theme: "caspian", mode: "system", radius: "lg", font: "sans" });

    // "Reset to default" is just another update.
    expect(await update({ ...DEFAULT_BRANDING, accent: null, logoMediaId: null })).toEqual(DEFAULT_BRANDING);

    const actions = await auditActions(tenant);
    expect(actions.filter((action) => action === "workspace.branding_updated")).toHaveLength(4);
    expect(await update({})).toEqual(DEFAULT_BRANDING);
    expect(await auditActions(tenant)).toHaveLength(actions.length);
  });

  it("validates every id against its allow-list", async () => {
    const tenant = await createTenant();
    const run = (input: unknown) => failure(() => asOwner(tenant)((scope) => updateBranding(scope, input as never)));

    expect((await run({ theme: "neon" })).fieldErrors).toEqual({ theme: ["Choose one of the listed themes."] });
    expect((await run({ mode: "auto" })).fieldErrors).toHaveProperty("mode");
    expect((await run({ radius: "xl" })).fieldErrors).toHaveProperty("radius");
    expect((await run({ font: "comic" })).fieldErrors).toHaveProperty("font");
    expect((await run({ logoMediaId: "logo.png" })).fieldErrors).toHaveProperty("logoMediaId");
    expect((await platformRow(tenant)).branding).toEqual(DEFAULT_BRANDING);
  });

  it("accepts an accent only as `H S% L%` within range", async () => {
    const tenant = await createTenant();
    const update = (accent: string | null) => asOwner(tenant)((scope) => updateBranding(scope, { accent }));

    for (const accent of [
      "red",
      "#10b981",
      "hsl(160 84% 39%)",
      "160, 84%, 39%",
      "160 84 39",
      "361 84% 39%",
      "160 101% 39%",
      "160 84% 101%",
      "-10 84% 39%",
      "160 84% 39%; } body { display: none",
      "160 84% 39% / 0.5",
      "160  84% 39%",
      "1600 84% 39%",
      "",
    ]) {
      expect((await failure(() => update(accent))).fieldErrors, accent).toEqual({ accent: ["Use the form H S% L%, for example 160 84% 39%."] });
    }

    expect((await update("160 84% 39%")).accent).toBe("160 84% 39%");
    expect((await update(" 222.2 47.4% 11.2% ")).accent).toBe("222.2 47.4% 11.2%");
    expect((await update("0 0% 0%")).accent).toBe("0 0% 0%");
    expect((await update("360 100% 100%")).accent).toBe("360 100% 100%");
    expect(await update(null)).not.toHaveProperty("accent");
  });

  it("accepts as logo only an image from this workspace's library", async () => {
    const tenant = await createTenant();
    const logo = await seedMedia(tenant);
    const video = await seedMedia(tenant, { resourceType: "video" });
    const update = (logoMediaId: string | null) => asOwner(tenant)((scope) => updateBranding(scope, { logoMediaId }));

    expect(await update(logo.id)).toEqual({ ...DEFAULT_BRANDING, logoMediaId: logo.id });
    expect((await asOwner(tenant)((scope) => getWorkspaceProfile(scope))).logoUrl).toBe(logo.url);

    for (const id of [randomId(), video.id]) {
      expect(await failure(() => update(id))).toMatchObject({
        name: "ValidationError",
        fieldErrors: { logoMediaId: ["Choose an image from your media library."] },
      });
    }
    // The failed attempts changed nothing.
    expect((await platformRow(tenant)).branding).toEqual({ ...DEFAULT_BRANDING, logoMediaId: logo.id });

    expect(await update(null)).toEqual(DEFAULT_BRANDING);
    expect((await asOwner(tenant)((scope) => getWorkspaceProfile(scope))).logoUrl).toBeNull();
  });

  it("stores nothing outside the known branding shape", async () => {
    const tenant = await createTenant();
    await asOwner(tenant)((scope) => updateBranding(scope, { theme: "pomegranate", css: "body{}", script: "<script>" } as never));
    expect((await platformRow(tenant)).branding).toEqual({ theme: "pomegranate", mode: "light", radius: "md", font: "classic" });
  });

  it("fills gaps in older stored branding with the defaults", async () => {
    const tenant = await createTenant();
    await withTenant(tenant.tenantId, ({ tx }) =>
      tx.update(tenants).set({ branding: { theme: "graphite" } as never }).where(eq(tenants.id, tenant.tenantId)),
    );
    expect((await asOwner(tenant)((scope) => getWorkspaceProfile(scope))).branding).toEqual({ ...DEFAULT_BRANDING, theme: "graphite" });
  });
});

describe("onboarding", () => {
  it("is completed once and keeps the first timestamp", async () => {
    const tenant = await createTenant();
    const first = await asOwner(tenant)((scope) => completeOnboarding(scope));
    expect(first).toBeInstanceOf(Date);

    const second = await asOwner(tenant)((scope) => completeOnboarding(scope));
    expect(second.getTime()).toBe((await platformRow(tenant)).onboardingCompletedAt!.getTime());
    expect(Math.abs(second.getTime() - first.getTime())).toBeLessThan(5);
    expect((await asOwner(tenant)((scope) => getWorkspaceProfile(scope))).onboardingCompletedAt).toEqual(second);
    expect((await auditActions(tenant)).filter((action) => action === "workspace.onboarding_completed")).toHaveLength(1);
  });

  it("answers `not available` for a workspace that no longer exists", async () => {
    const tenant = await createTenant();
    await withPlatform((tx) => tx.delete(tenants).where(eq(tenants.id, tenant.tenantId)));
    expect(await failure(() => withTenant(tenant.tenantId, (scope) => getWorkspaceProfile(scope)))).toMatchObject({
      name: "ForbiddenError",
      code: "forbidden",
    });
  });
});
