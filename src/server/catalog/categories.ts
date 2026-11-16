import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { TenantScope } from "../db/context";
import { tourCategories, tours } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { assertSameIds, lockCatalog, nextFreeSlug, parse, reorderSchema, requireId, slugify } from "./shared";

/** The category list a new workspace starts with (from the product design). */
export const DEFAULT_CATEGORIES = ["Cultural", "Historical", "Adventure", "Food & Local", "Private", "Family", "Customized"] as const;

export const categoryNameSchema = z.object({
  name: z.string().trim().min(1, "Add a category name.").max(60, "Keep the name under 60 characters."),
});
export type CategoryNameInput = z.input<typeof categoryNameSchema>;

export interface CategoryView {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  /** Tours of any status that use the category. */
  tourCount: number;
}

type Row = typeof tourCategories.$inferSelect;

async function findRow(scope: TenantScope, id: string): Promise<Row> {
  requireId(id, "Category");
  const [row] = await scope.tx
    .select()
    .from(tourCategories)
    .where(and(eq(tourCategories.tenantId, scope.tenantId), eq(tourCategories.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("Category");
  return row;
}

async function countTours(scope: TenantScope, categoryId: string): Promise<number> {
  const [row] = await scope.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.categoryId, categoryId)));
  return row?.n ?? 0;
}

/** Name must be unique (ignoring case); the slug is derived and made unique. */
async function allocate(scope: TenantScope, name: string, exceptId?: string): Promise<string> {
  await lockCatalog(scope);
  const others = await scope.tx
    .select({ name: tourCategories.name, slug: tourCategories.slug })
    .from(tourCategories)
    .where(and(eq(tourCategories.tenantId, scope.tenantId), exceptId ? ne(tourCategories.id, exceptId) : undefined));
  if (others.some((other) => other.name.toLowerCase() === name.toLowerCase())) {
    throw new ConflictError("A category with that name already exists.");
  }
  return nextFreeSlug(slugify(name, "category"), others.map((other) => other.slug));
}

export async function listCategories(scope: TenantScope): Promise<CategoryView[]> {
  const counts = scope.tx
    .select({ categoryId: tours.categoryId, n: sql<number>`count(*)::int`.as("n") })
    .from(tours)
    .where(eq(tours.tenantId, scope.tenantId))
    .groupBy(tours.categoryId)
    .as("category_tours");
  const rows = await scope.tx
    .select({
      id: tourCategories.id,
      name: tourCategories.name,
      slug: tourCategories.slug,
      sortOrder: tourCategories.sortOrder,
      tourCount: sql<number>`coalesce(${counts.n}, 0)`,
    })
    .from(tourCategories)
    .leftJoin(counts, eq(counts.categoryId, tourCategories.id))
    .where(eq(tourCategories.tenantId, scope.tenantId))
    .orderBy(asc(tourCategories.sortOrder), asc(tourCategories.name));
  return rows;
}

export async function createCategory(scope: TenantScope, input: CategoryNameInput): Promise<CategoryView> {
  const { name } = parse(categoryNameSchema, input);
  const slug = await allocate(scope, name);
  const [last] = await scope.tx
    .select({ max: sql<number>`coalesce(max(${tourCategories.sortOrder}), -1)::int` })
    .from(tourCategories)
    .where(eq(tourCategories.tenantId, scope.tenantId));
  const [row] = (await scope.tx
    .insert(tourCategories)
    .values({ tenantId: scope.tenantId, name, slug, sortOrder: (last?.max ?? -1) + 1 })
    .returning()) as [Row];
  return { id: row.id, name: row.name, slug: row.slug, sortOrder: row.sortOrder, tourCount: 0 };
}

/** Renames a category. Its slug follows the name, since the slug is only a filter value. */
export async function renameCategory(scope: TenantScope, id: string, input: CategoryNameInput): Promise<CategoryView> {
  const existing = await findRow(scope, id);
  const { name } = parse(categoryNameSchema, input);
  const slug = await allocate(scope, name, existing.id);
  const [row] = (await scope.tx
    .update(tourCategories)
    .set({ name, slug })
    .where(and(eq(tourCategories.tenantId, scope.tenantId), eq(tourCategories.id, existing.id)))
    .returning()) as [Row];
  return { id: row.id, name: row.name, slug: row.slug, sortOrder: row.sortOrder, tourCount: await countTours(scope, row.id) };
}

/** Stores a new order. `orderedIds` must list every category of the workspace exactly once. */
export async function reorderCategories(scope: TenantScope, orderedIds: string[]): Promise<CategoryView[]> {
  const parsed = parse(reorderSchema, { orderedIds });
  const existing = await scope.tx.select({ id: tourCategories.id }).from(tourCategories).where(eq(tourCategories.tenantId, scope.tenantId));
  assertSameIds(parsed.orderedIds, existing.map((row) => row.id), "orderedIds");
  for (const [index, id] of parsed.orderedIds.entries()) {
    await scope.tx
      .update(tourCategories)
      .set({ sortOrder: index })
      .where(and(eq(tourCategories.tenantId, scope.tenantId), eq(tourCategories.id, id)));
  }
  return listCategories(scope);
}

export async function deleteCategory(scope: TenantScope, id: string): Promise<void> {
  const row = await findRow(scope, id);
  const used = await countTours(scope, row.id);
  if (used > 0) {
    throw new ConflictError(`${used === 1 ? "1 tour uses" : `${used} tours use`} this category. Move ${used === 1 ? "it" : "them"} to another category first.`);
  }
  await scope.tx.delete(tourCategories).where(and(eq(tourCategories.tenantId, scope.tenantId), eq(tourCategories.id, row.id)));
  await recordAudit(scope, { action: "category.deleted", targetType: "tour_category", targetId: row.id, metadata: { name: row.name } });
}

/**
 * Gives a workspace that has no categories yet the standard list. Does
 * nothing once any category exists, so a deleted default never comes back.
 */
export async function ensureDefaultCategories(scope: TenantScope): Promise<CategoryView[]> {
  await lockCatalog(scope);
  const existing = await scope.tx
    .select({ id: tourCategories.id })
    .from(tourCategories)
    .where(eq(tourCategories.tenantId, scope.tenantId))
    .limit(1);
  if (existing.length === 0) {
    await scope.tx
      .insert(tourCategories)
      .values(DEFAULT_CATEGORIES.map((name, index) => ({ tenantId: scope.tenantId, name, slug: slugify(name, "category"), sortOrder: index })));
  }
  return listCategories(scope);
}
