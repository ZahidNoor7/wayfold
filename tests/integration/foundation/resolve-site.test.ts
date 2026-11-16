import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/server/db/context";
import { tenantDomains, tenants } from "@/server/db/schema";
import { withPlatform } from "@/server/platform/db";
import { classifyHost } from "@/server/tenancy/hosts";
import { resolveSite } from "@/server/tenancy/resolve";
import { createTenant, unique } from "../../helpers/fixtures";

const domainName = (prefix = "tours") => `${unique(prefix)}.example.test`;

function claimDomain(tenantId: string, domain: string, status: "pending" | "verified") {
  return withTenant(tenantId, ({ tx }) =>
    tx.insert(tenantDomains).values({
      domain,
      status,
      verificationToken: unique("txt"),
      verifiedAt: status === "verified" ? new Date() : null,
    }),
  );
}

describe("resolveSite: sub-domain", () => {
  it("resolves a slug to its tenant's public profile", async () => {
    const a = await createTenant({ name: "Caspian Trails" });
    await withTenant(a.tenantId, ({ tx }) =>
      tx.update(tenants).set({ tagline: "Slow travel", currency: "AZN", timezone: "Asia/Baku", regions: ["Sheki"] }).where(eq(tenants.id, a.tenantId)),
    );

    expect(await resolveSite(a.slug)).toEqual({
      id: a.tenantId,
      slug: a.slug,
      name: "Caspian Trails",
      status: "active",
      tagline: "Slow travel",
      description: "",
      email: "",
      phone: "",
      address: "",
      website: "",
      social: {},
      regions: ["Sheki"],
      languages: ["en"],
      currency: "AZN",
      timezone: "Asia/Baku",
      branding: { theme: "emerald", mode: "light", radius: "md", font: "classic" },
    });
  });

  it("exposes nothing the platform controls", async () => {
    const a = await createTenant();
    await withPlatform((tx) => tx.update(tenants).set({ limitOverrides: { maxPublishedTours: 3 }, suspendedReason: "internal note" }).where(eq(tenants.id, a.tenantId)));
    const site = await resolveSite(a.slug);
    for (const hidden of ["planId", "limitOverrides", "suspendedReason", "createdAt", "updatedAt", "onboardingCompletedAt"]) {
      expect(site).not.toHaveProperty(hidden);
    }
    expect(JSON.stringify(site)).not.toContain("internal note");
  });

  it("normalises case and surrounding whitespace", async () => {
    const a = await createTenant();
    expect((await resolveSite(`  ${a.slug.toUpperCase()}  `))?.id).toBe(a.tenantId);
  });

  it("still resolves a suspended tenant, flagged for the caller to refuse", async () => {
    const a = await createTenant();
    await withPlatform((tx) => tx.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, a.tenantId)));
    expect(await resolveSite(a.slug)).toMatchObject({ id: a.tenantId, status: "suspended" });
  });

  it("returns null for an unknown slug, never another tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();
    expect(await resolveSite(unique("nobody"))).toBeNull();
    // A prefix or extension of a real slug is a different site.
    expect(await resolveSite(a.slug.slice(0, -1))).toBeNull();
    expect(await resolveSite(`${b.slug}x`)).toBeNull();
  });

  it.each(["", "   ", "%", "_", "*", "' or '1'='1", "a' or true --", "null", "undefined", "x".repeat(254)])(
    "returns null for %j",
    async (site) => {
      await createTenant();
      expect(await resolveSite(site)).toBeNull();
    },
  );

  it("returns each tenant only for its own slug", async () => {
    const a = await createTenant();
    const b = await createTenant();
    expect((await resolveSite(a.slug))?.id).toBe(a.tenantId);
    expect((await resolveSite(b.slug))?.id).toBe(b.tenantId);
  });
});

describe("resolveSite: custom domain", () => {
  it("resolves a verified domain to its owner", async () => {
    const a = await createTenant();
    const domain = domainName();
    await claimDomain(a.tenantId, domain, "verified");

    expect(await resolveSite(domain)).toMatchObject({ id: a.tenantId, slug: a.slug });
    expect((await resolveSite(`  ${domain.toUpperCase()} `))?.id).toBe(a.tenantId);
  });

  it("does not resolve a pending domain", async () => {
    const a = await createTenant();
    const domain = domainName("pending");
    await claimDomain(a.tenantId, domain, "pending");
    expect(await resolveSite(domain)).toBeNull();
  });

  it("starts resolving only once the claim is verified", async () => {
    const a = await createTenant();
    const domain = domainName();
    await claimDomain(a.tenantId, domain, "pending");
    expect(await resolveSite(domain)).toBeNull();

    await withTenant(a.tenantId, ({ tx }) =>
      tx.update(tenantDomains).set({ status: "verified", verifiedAt: new Date() }).where(eq(tenantDomains.domain, domain)),
    );
    expect((await resolveSite(domain))?.id).toBe(a.tenantId);
  });

  it("returns null for an unknown domain, never another tenant", async () => {
    const a = await createTenant();
    const domain = domainName();
    await claimDomain(a.tenantId, domain, "verified");

    expect(await resolveSite(domainName("unknown"))).toBeNull();
    // Parent, child and sibling names are not the verified host.
    expect(await resolveSite(domain.split(".").slice(1).join("."))).toBeNull();
    expect(await resolveSite(`www.${domain}`)).toBeNull();
    expect(await resolveSite(`${domain}.evil.test`)).toBeNull();
  });

  it("keeps resolving to the verified owner while another tenant's claim is pending", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const domain = domainName();
    await claimDomain(a.tenantId, domain, "verified");
    await claimDomain(b.tenantId, domain, "pending");

    for (let i = 0; i < 3; i++) expect((await resolveSite(domain))?.id).toBe(a.tenantId);
  });

  it("does not resolve a platform sub-domain through the custom-domain path", async () => {
    const a = await createTenant();
    // What classifyHost produces for a tenant host on an unexpected port.
    const target = classifyHost(`${a.slug}.wayfold.test:8443`, { rootDomain: "wayfold.test", appHost: "app.wayfold.test" });
    expect(target).toEqual({ kind: "custom", site: `${a.slug}.wayfold.test` });
    expect(await resolveSite(`${a.slug}.wayfold.test`)).toBeNull();
  });

  it("stops resolving when the domain is removed", async () => {
    const a = await createTenant();
    const domain = domainName();
    await claimDomain(a.tenantId, domain, "verified");
    await withTenant(a.tenantId, ({ tx }) => tx.delete(tenantDomains).where(eq(tenantDomains.domain, domain)));
    expect(await resolveSite(domain)).toBeNull();
  });
});
