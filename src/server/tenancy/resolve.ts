import "server-only";
import { and, eq } from "drizzle-orm";
import { withoutTenant } from "../db/context";
import { tenantDomains, tenants, type TenantBranding, type TenantSocial } from "../db/schema";

/** The public face of a tenant: everything a storefront may render. */
export interface SiteTenant {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
  tagline: string;
  description: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  social: TenantSocial;
  regions: string[];
  languages: string[];
  currency: string;
  timezone: string;
  branding: TenantBranding;
}

const publicColumns = {
  id: tenants.id,
  slug: tenants.slug,
  name: tenants.name,
  status: tenants.status,
  tagline: tenants.tagline,
  description: tenants.description,
  email: tenants.email,
  phone: tenants.phone,
  address: tenants.address,
  website: tenants.website,
  social: tenants.social,
  regions: tenants.regions,
  languages: tenants.languages,
  currency: tenants.currency,
  timezone: tenants.timezone,
  branding: tenants.branding,
};

/**
 * Maps a storefront key to a tenant. `site` is either a sub-domain label or a
 * full custom host name, as produced by `classifyHost`. A custom domain only
 * resolves once its ownership has been verified. Returns null for anything
 * unknown: callers render a 404 and never fall back to another tenant.
 */
export async function resolveSite(site: string): Promise<SiteTenant | null> {
  const key = site.trim().toLowerCase();
  if (!key || key.length > 253) return null;

  return withoutTenant(async (tx) => {
    if (key.includes(".")) {
      const [row] = await tx
        .select(publicColumns)
        .from(tenantDomains)
        .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
        .where(and(eq(tenantDomains.domain, key), eq(tenantDomains.status, "verified")))
        .limit(1);
      return row ?? null;
    }
    const [row] = await tx.select(publicColumns).from(tenants).where(eq(tenants.slug, key)).limit(1);
    return row ?? null;
  });
}
