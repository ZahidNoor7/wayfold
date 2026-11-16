import "server-only";
import type { Workspace } from "@/server/auth/workspace";
import { can } from "@/server/auth/workspace";
import { getEntitlements } from "@/server/billing/limits";
import { listCategories } from "@/server/catalog/categories";
import { listDestinations } from "@/server/catalog/destinations";
import { getTourCounts } from "@/server/catalog/tours";
import type { TenantScope } from "@/server/db/context";
import { env } from "@/server/env";
import { tenantOrigin } from "@/server/tenancy/hosts";

/** What both the "new tour" and the "edit tour" pages need around the form. */
export async function loadEditorContext(scope: TenantScope) {
  const categories = await listCategories(scope);
  const destinations = await listDestinations(scope);
  const counts = await getTourCounts(scope);
  const { limits } = await getEntitlements(scope);
  return {
    categories: categories.map((category) => ({ id: category.id, name: category.name, tourCount: category.tourCount })),
    destinations: destinations.map((destination) => ({ id: destination.id, name: destination.name })),
    publishing: { published: counts.published, limit: limits.maxPublishedTours },
  };
}

/** Props that depend only on the workspace and the member's role. */
export function editorAccess(workspace: Workspace) {
  const protocol = env().APP_URL.startsWith("https://") ? "https" : "http";
  return {
    currency: workspace.tenant.currency,
    timezone: workspace.tenant.timezone,
    storefrontOrigin: tenantOrigin(workspace.tenant.slug, { rootDomain: env().ROOT_DOMAIN, appHost: env().APP_HOST }, protocol),
    canPublish: can(workspace, "tours.publish"),
    canPickMedia: can(workspace, "media.view"),
    canUploadMedia: can(workspace, "media.manage"),
  };
}
