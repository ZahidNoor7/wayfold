import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { TenantScope } from "../db/context";
import { tenantDomains, tenants } from "../db/schema";
import { env } from "../env";
import { tenantOrigin } from "./hosts";

/**
 * The address customers should use for this business's website, for links
 * that leave the app (e-mails, copied links): its verified primary domain,
 * else any verified domain, else its `{slug}.{root domain}` address.
 */
export async function publicSiteOrigin(scope: TenantScope): Promise<string> {
  const protocol = env().APP_URL.startsWith("https://") ? "https" : "http";
  const [domain] = await scope.tx
    .select({ domain: tenantDomains.domain })
    .from(tenantDomains)
    .where(and(eq(tenantDomains.tenantId, scope.tenantId), eq(tenantDomains.status, "verified")))
    .orderBy(desc(tenantDomains.isPrimary), tenantDomains.domain)
    .limit(1);
  if (domain) return `${protocol}://${domain.domain}`;

  const [tenant] = await scope.tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, scope.tenantId)).limit(1);
  return tenantOrigin(tenant?.slug ?? "", { rootDomain: env().ROOT_DOMAIN, appHost: env().APP_HOST }, protocol);
}
