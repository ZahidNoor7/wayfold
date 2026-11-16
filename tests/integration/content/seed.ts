import { desc, eq } from "drizzle-orm";
import { withTenant, type TenantScope } from "@/server/db/context";
import { auditLogs, destinations, mediaAssets, tours } from "@/server/db/schema";
import { unique, type TenantFixture } from "../../helpers/fixtures";

/** Runs a service call as the workspace owner. */
export const asOwner =
  (tenant: TenantFixture) =>
  <T>(fn: (scope: TenantScope) => Promise<T>): Promise<T> =>
    withTenant(tenant.tenantId, fn, { userId: tenant.ownerId });

/** Runs a service call as an anonymous storefront visitor. */
export const asVisitor =
  (tenant: TenantFixture) =>
  <T>(fn: (scope: TenantScope) => Promise<T>): Promise<T> =>
    withTenant(tenant.tenantId, fn);

export async function seedTour(
  tenant: TenantFixture,
  overrides: { title?: string; status?: "draft" | "published" | "archived" } = {},
): Promise<{ id: string; slug: string; title: string }> {
  const slug = unique("tour");
  const [row] = await withTenant(tenant.tenantId, ({ tx }) =>
    tx
      .insert(tours)
      .values({ slug, title: overrides.title ?? `Tour ${slug}`, status: overrides.status ?? "published" })
      .returning({ id: tours.id, slug: tours.slug, title: tours.title }),
  );
  return row!;
}

export async function seedMedia(
  tenant: TenantFixture,
  overrides: { resourceType?: "image" | "video"; alt?: string } = {},
): Promise<{ id: string; url: string }> {
  const publicId = unique("media");
  const [row] = await withTenant(tenant.tenantId, ({ tx }) =>
    tx
      .insert(mediaAssets)
      .values({
        storageOwner: "platform",
        provider: "test",
        publicId,
        resourceType: overrides.resourceType ?? "image",
        url: `https://media.example.test/${publicId}.jpg`,
        alt: overrides.alt ?? "",
        width: 1600,
        height: 1000,
      })
      .returning({ id: mediaAssets.id, url: mediaAssets.url }),
  );
  return row!;
}

export async function seedDestination(
  tenant: TenantFixture,
  overrides: { name?: string; isPublished?: boolean } = {},
): Promise<{ id: string; slug: string; name: string }> {
  const slug = unique("dest");
  const [row] = await withTenant(tenant.tenantId, ({ tx }) =>
    tx
      .insert(destinations)
      .values({ slug, name: overrides.name ?? `Destination ${slug}`, isPublished: overrides.isPublished ?? true })
      .returning({ id: destinations.id, slug: destinations.slug, name: destinations.name }),
  );
  return row!;
}

/** Audit actions of a workspace, newest first. */
export async function auditActions(tenant: TenantFixture): Promise<string[]> {
  const rows = await withTenant(tenant.tenantId, ({ tx, tenantId }) =>
    tx.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.tenantId, tenantId)).orderBy(desc(auditLogs.createdAt)),
  );
  return rows.map((row) => row.action);
}

/** The AppError-style shape a rejected service call is expected to have. */
export async function failure(run: () => Promise<unknown>): Promise<{ name: string; code?: string; fieldErrors?: Record<string, string[]> }> {
  try {
    await run();
  } catch (error) {
    const e = error as { name: string; code?: string; fieldErrors?: Record<string, string[]> };
    return { name: e.name, code: e.code, fieldErrors: e.fieldErrors };
  }
  throw new Error("Expected the call to fail, but it succeeded.");
}
