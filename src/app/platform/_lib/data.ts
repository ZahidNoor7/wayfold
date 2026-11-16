import "server-only";
import type { PlatformActor } from "@/server/platform/access";
import { listTenants } from "@/server/platform/tenants";

export interface TenantOption {
  id: string;
  name: string;
  slug: string;
}

const PAGE = 100;
const MAX_PAGES = 10;

/**
 * Options for the tenant filters on Billing and System: every workspace by
 * name, at most 1,000. Rows carry their own tenant names; this list exists
 * only so a tenant can be picked. `complete` says whether it holds them all.
 */
export async function loadTenantDirectory(actor: PlatformActor): Promise<{ options: TenantOption[]; byId: Map<string, TenantOption>; complete: boolean }> {
  const options: TenantOption[] = [];
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listTenants(actor, { sort: "name_asc", limit: PAGE, offset: page * PAGE });
    total = result.total;
    for (const tenant of result.items) options.push({ id: tenant.id, name: tenant.name, slug: tenant.slug });
    if (result.items.length < PAGE || options.length >= total) break;
  }
  return { options, byId: new Map(options.map((option) => [option.id, option])), complete: options.length >= total };
}
