import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { todayIn } from "@/lib/dates";
import { createDestination } from "@/server/catalog/destinations";
import { archiveTour } from "@/server/catalog/tours";
import { createJourneyEntry } from "@/server/content/journey";
import { withTenant, type TenantScope } from "@/server/db/context";
import { integrations, tenants } from "@/server/db/schema";
import { saveIntegration, setIntegrationEnabled } from "@/server/integrations";
import { createCampaign } from "@/server/promotions/campaigns";
import { defaultSiteContent, updateSiteContent } from "@/server/settings/site-content";
import { getSiteImage, getStorefrontShell, loadSitemap, loadStorefrontShell, originFromHeaders } from "@/server/storefront/shell";
import { FIXTURE_TODAY, createMediaFixture, createPublishedTourFixture, createTourFixture } from "../../helpers/catalog";
import { createTenant, randomId, type TenantFixture } from "../../helpers/fixtures";

const TODAY = FIXTURE_TODAY;

const asOwner = <T>(tenant: TenantFixture, fn: (scope: TenantScope) => Promise<T>) => withTenant(tenant.tenantId, fn, { userId: tenant.ownerId });
/** Storefront reads have a tenant and no user, exactly like a real visitor. */
const asVisitor = <T>(tenant: TenantFixture, fn: (scope: TenantScope) => Promise<T>) => withTenant(tenant.tenantId, fn);

const shellOf = (tenant: TenantFixture, social = {}) => asVisitor(tenant, (scope) => loadStorefrontShell(scope, { today: TODAY, social }));

const connectWhatsApp = (tenant: TenantFixture, phoneNumber: string) =>
  asOwner(tenant, (scope) => saveIntegration(scope, { provider: "whatsapp", config: { phoneNumber }, secrets: {} }));

const publicCampaign = (tenant: TenantFixture, overrides: Partial<Parameters<typeof createCampaign>[1]> = {}) =>
  asOwner(tenant, (scope) =>
    createCampaign(scope, { name: "Autumn offer", type: "percent", value: 15, startsOn: "2031-03-01", endsOn: "2031-03-31", ...overrides }, TODAY),
  );

describe("storefront shell: a brand-new workspace", () => {
  it("returns a complete, empty shell", async () => {
    const tenant = await createTenant({ plan: { features: { removeBranding: false } } });

    expect(await shellOf(tenant)).toEqual({
      content: defaultSiteContent(),
      heroImage: null,
      offerCount: 0,
      promotionsEnabled: true,
      showOffers: false,
      destinations: [],
      whatsapp: null,
      showPoweredBy: true,
    });
  });

  it("drops the Wayfold line when the plan removes branding", async () => {
    const tenant = await createTenant({ plan: { features: { removeBranding: true } } });
    expect((await shellOf(tenant)).showPoweredBy).toBe(false);
  });

  it("reports a plan without promotions", async () => {
    const tenant = await createTenant({ plan: { features: { promotions: false } } });
    expect(await shellOf(tenant)).toMatchObject({ promotionsEnabled: false, offerCount: 0, showOffers: false });
  });
});

describe("storefront shell: content", () => {
  it("carries the site content and resolves the hero image", async () => {
    const tenant = await createTenant();
    const cover = await createMediaFixture(tenant.tenantId, { alt: "Old city at dusk", width: 2400, height: 1600 });
    await asOwner(tenant, async (scope) => {
      await updateSiteContent(scope, "hero", { headline: "Discover the world", headlineEmphasis: "through local eyes.", imageMediaId: cover.id });
      await updateSiteContent(scope, "footer", { blurb: "Private journeys across the Caucasus." });
      await updateSiteContent(scope, "seo", { home: { title: "Private tours", description: "Slow travel with a local guide." } });
    });

    const shell = await shellOf(tenant);
    expect(shell.heroImage).toEqual({ url: cover.url, alt: "Old city at dusk", width: 2400, height: 1600 });
    expect(shell.content.hero).toMatchObject({ headline: "Discover the world", headlineEmphasis: "through local eyes.", imageMediaId: cover.id });
    expect(shell.content.footer.blurb).toBe("Private journeys across the Caucasus.");
    expect(shell.content.seo.home).toEqual({ title: "Private tours", description: "Slow travel with a local guide." });
  });

  it("has no hero image for a video, an unknown id, or another workspace's file", async () => {
    const tenant = await createTenant();
    const other = await createTenant();
    const video = await createMediaFixture(tenant.tenantId, { resourceType: "video" });
    const foreign = await createMediaFixture(other.tenantId);

    await asVisitor(tenant, async (scope) => {
      expect(await getSiteImage(scope, null)).toBeNull();
      expect(await getSiteImage(scope, video.id)).toBeNull();
      expect(await getSiteImage(scope, randomId())).toBeNull();
      expect(await getSiteImage(scope, foreign.id)).toBeNull();
    });
    // The owner still sees their own file.
    expect(await asVisitor(other, (scope) => getSiteImage(scope, foreign.id))).toMatchObject({ url: foreign.url });
  });

  it("lists published destinations only, in display order, with their tour counts", async () => {
    const tenant = await createTenant();
    const [sheki] = await asOwner(tenant, async (scope) => [
      await createDestination(scope, { name: "Sheki", region: "Shaki-Zagatala" }),
      await createDestination(scope, { name: "Baku" }),
      await createDestination(scope, { name: "Quba", isPublished: false }),
    ]);
    await createPublishedTourFixture(tenant.tenantId, { destinationId: sheki!.id });
    await createTourFixture(tenant.tenantId, { destinationId: sheki!.id });

    const { destinations } = await shellOf(tenant);
    expect(destinations.map((destination) => [destination.name, destination.slug, destination.tourCount])).toEqual([
      ["Sheki", "sheki", 1],
      ["Baku", "baku", 0],
    ]);
  });
});

describe("storefront shell: offers", () => {
  it("counts live public offers that have a published tour to book", async () => {
    const tenant = await createTenant();
    expect(await shellOf(tenant)).toMatchObject({ offerCount: 0, showOffers: false });

    // No published tour yet: the offer cannot be booked, so it is not advertised.
    await publicCampaign(tenant);
    expect(await shellOf(tenant)).toMatchObject({ offerCount: 0, showOffers: false });

    await createPublishedTourFixture(tenant.tenantId);
    await publicCampaign(tenant, { name: "Private thank-you", visibility: "private", assignedEmails: ["guest@example.test"] });
    await publicCampaign(tenant, { name: "Next season", startsOn: "2031-06-01", endsOn: "2031-06-30" });
    await publicCampaign(tenant, { name: "Paused", isActive: false });
    expect(await shellOf(tenant)).toMatchObject({ offerCount: 1, showOffers: true });

    await publicCampaign(tenant, { name: "Early bird", type: "fixed", value: 5_000 });
    expect(await shellOf(tenant)).toMatchObject({ offerCount: 2, showOffers: true });
  });

  it("uses the date it is given", async () => {
    const tenant = await createTenant();
    await createPublishedTourFixture(tenant.tenantId);
    await publicCampaign(tenant);

    const after = await asVisitor(tenant, (scope) => loadStorefrontShell(scope, { today: "2031-04-01", social: {} }));
    expect(after).toMatchObject({ offerCount: 0, showOffers: false });
  });
});

describe("storefront shell: WhatsApp", () => {
  it("uses the profile's number when nothing is connected", async () => {
    const tenant = await createTenant();
    expect((await shellOf(tenant, { whatsapp: "+994 50 123 45 67" })).whatsapp).toEqual({
      number: "+994 50 123 45 67",
      url: "https://wa.me/994501234567",
    });
  });

  it("ignores a profile value that is not a phone number", async () => {
    const tenant = await createTenant();
    for (const whatsapp of ["", "   ", "call me", "12345", "+1 (2) 3", "javascript:alert(1)"]) {
      expect((await shellOf(tenant, { whatsapp })).whatsapp).toBeNull();
    }
  });

  it("prefers a connected WhatsApp number over the profile's", async () => {
    const tenant = await createTenant();
    await connectWhatsApp(tenant, "+44 7700 900123");

    expect((await shellOf(tenant, { whatsapp: "+994501234567" })).whatsapp).toEqual({ number: "+447700900123", url: "https://wa.me/447700900123" });
    expect((await shellOf(tenant)).whatsapp).toEqual({ number: "+447700900123", url: "https://wa.me/447700900123" });
  });

  it("falls back to the profile when the connection is switched off", async () => {
    const tenant = await createTenant();
    const saved = await connectWhatsApp(tenant, "+447700900123");
    await asOwner(tenant, (scope) => setIntegrationEnabled(scope, saved.id, false));

    expect((await shellOf(tenant, { whatsapp: "+994501234567" })).whatsapp).toEqual({ number: "+994501234567", url: "https://wa.me/994501234567" });
    expect((await shellOf(tenant)).whatsapp).toBeNull();
  });

  it("ignores a connection the plan no longer includes, or one with a damaged number", async () => {
    const downgraded = await createTenant({ plan: { features: { integrations: ["media", "email"] } } });
    const damaged = await createTenant();
    const row = { provider: "whatsapp", category: "messaging", isDefault: true, secretCiphertext: "x", keyVersion: "v2" };
    await asOwner(downgraded, ({ tx }) => tx.insert(integrations).values({ ...row, config: { phoneNumber: "+447700900123" } }));
    await asOwner(damaged, ({ tx }) => tx.insert(integrations).values({ ...row, config: { phoneNumber: 447700900123 } }));

    expect((await shellOf(downgraded)).whatsapp).toBeNull();
    expect((await shellOf(damaged)).whatsapp).toBeNull();
  });
});

describe("storefront shell: isolation", () => {
  it("never shows another workspace's content, offers, destinations or number", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const cover = await createMediaFixture(b.tenantId);
    await asOwner(b, async (scope) => {
      await updateSiteContent(scope, "hero", { headline: "B's headline", imageMediaId: cover.id });
      await createDestination(scope, { name: "B's destination" });
    });
    await createPublishedTourFixture(b.tenantId);
    await publicCampaign(b);
    await connectWhatsApp(b, "+447700900123");

    expect(await shellOf(a)).toMatchObject({ content: defaultSiteContent(), heroImage: null, offerCount: 0, destinations: [], whatsapp: null });
    expect(await shellOf(b)).toMatchObject({ offerCount: 1, whatsapp: { url: "https://wa.me/447700900123" } });
  });
});

describe("getStorefrontShell", () => {
  it("loads the shell for a resolved site with today's date in its timezone", async () => {
    const tenant = await createTenant();
    const today = todayIn("Asia/Baku");
    await createPublishedTourFixture(tenant.tenantId);
    await publicCampaign(tenant, { startsOn: today, endsOn: today });
    await asOwner(tenant, ({ tx, tenantId }) => tx.update(tenants).set({ social: { whatsapp: "+994501234567" } }).where(eq(tenants.id, tenantId)));

    const shell = await getStorefrontShell({ id: tenant.tenantId, timezone: "Asia/Baku", social: { whatsapp: "+994501234567" } });
    expect(shell).toMatchObject({ offerCount: 1, showOffers: true, whatsapp: { number: "+994501234567", url: "https://wa.me/994501234567" } });
  });
});

describe("storefront sitemap", () => {
  it("is empty for a new workspace", async () => {
    const tenant = await createTenant();
    expect(await asVisitor(tenant, loadSitemap)).toEqual({ tours: [], journal: [] });
  });

  it("lists published tours and journal entries only, and only this workspace's", async () => {
    const tenant = await createTenant();
    const other = await createTenant();
    const live = await createPublishedTourFixture(tenant.tenantId);
    const retired = await createPublishedTourFixture(tenant.tenantId);
    await asOwner(tenant, (scope) => archiveTour(scope, retired.id));
    await createTourFixture(tenant.tenantId);
    await createPublishedTourFixture(other.tenantId);
    const [story] = await asOwner(tenant, async (scope) => [
      await createJourneyEntry(scope, { title: "Autumn in Sheki", isPublished: true }),
      await createJourneyEntry(scope, { title: "Unfinished notes" }),
    ]);
    await asOwner(other, (scope) => createJourneyEntry(scope, { title: "Someone else's trip", isPublished: true }));

    const sitemap = await asVisitor(tenant, loadSitemap);
    expect(sitemap.tours.map((tour) => tour.slug)).toEqual([live.slug]);
    expect(sitemap.tours[0]!.updatedAt).toBeInstanceOf(Date);
    expect(sitemap.journal.map((entry) => entry.slug)).toEqual([story!.slug]);
    expect(sitemap.journal[0]!.updatedAt).toBeInstanceOf(Date);
  });
});

describe("originFromHeaders", () => {
  const from = (headers: Record<string, string>, fallback: "http" | "https" = "https") => originFromHeaders(new Headers(headers), fallback);

  it("builds the origin from the host the request was made to", () => {
    expect(from({ host: "aurelia.wayfold.com" })).toBe("https://aurelia.wayfold.com");
    expect(from({ host: "Aurelia.localhost:3210" }, "http")).toBe("http://aurelia.localhost:3210");
  });

  it("prefers what the edge forwarded", () => {
    expect(from({ host: "internal:3000", "x-forwarded-host": "tours.example.com", "x-forwarded-proto": "https" }, "http")).toBe("https://tours.example.com");
    expect(from({ host: "tours.example.com", "x-forwarded-proto": "http, https" })).toBe("http://tours.example.com");
    expect(from({ "x-forwarded-host": "tours.example.com, proxy.internal" })).toBe("https://tours.example.com");
  });

  it("ignores a protocol that is not http or https", () => {
    expect(from({ host: "tours.example.com", "x-forwarded-proto": "javascript" })).toBe("https://tours.example.com");
  });

  it("returns null for a missing or malformed host", () => {
    expect(from({})).toBeNull();
    expect(from({ host: "" })).toBeNull();
    expect(from({ host: "evil.test/path" })).toBeNull();
    expect(from({ host: "a b.test" })).toBeNull();
    expect(from({ host: "tours.example.com:99999999" })).toBeNull();
    expect(from({ host: "<script>" })).toBeNull();
  });
});
