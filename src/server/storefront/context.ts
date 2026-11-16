import "server-only";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { todayIn } from "@/lib/dates";
import { withTenant, type TenantScope } from "../db/context";
import { resolveSite, type SiteTenant } from "../tenancy/resolve";

/**
 * The tenant a storefront request is for, from the `[site]` route segment the
 * proxy derived from the request host. Unknown sites and unverified domains
 * are a 404; nothing ever falls back to another tenant. De-duplicated per
 * request, so layouts and pages can all call it.
 */
export const getSite = cache(async (site: string): Promise<SiteTenant> => {
  // Storefront data is per request (and opening a database connection uses
  // random values), so prerendering stops here rather than at the database.
  await connection();
  let key: string;
  try {
    key = decodeURIComponent(site);
  } catch {
    notFound();
  }
  const tenant = await resolveSite(key);
  if (!tenant) notFound();
  return tenant;
});

/** As `getSite`, but a suspended business is also a 404 for visitors. */
export async function requireActiveSite(site: string): Promise<SiteTenant> {
  const tenant = await getSite(site);
  if (tenant.status !== "active") notFound();
  return tenant;
}

/** Runs public, read-only work in the site's tenant scope (no user). */
export function inSite<T>(tenant: Pick<SiteTenant, "id">, fn: (scope: TenantScope) => Promise<T>): Promise<T> {
  return withTenant(tenant.id, fn);
}

/** Today's calendar date where the business operates. */
export function siteToday(tenant: Pick<SiteTenant, "timezone">, now: Date = new Date()): string {
  return todayIn(tenant.timezone, now);
}
