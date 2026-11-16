import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATEGORIES,
  createCategory,
  deleteCategory,
  ensureDefaultCategories,
  listCategories,
  renameCategory,
  reorderCategories,
} from "@/server/catalog/categories";
import { createTour, updateTour } from "@/server/catalog/tours";
import { ConflictError, NotFoundError } from "@/server/errors";
import { createTenant, randomId } from "../../helpers/fixtures";
import { as, auditActions, fieldErrors, rejection } from "./support";

describe("tour categories", () => {
  it("seeds the standard list once for a new workspace", async () => {
    const tenant = await createTenant();
    const seeded = await as(tenant, (scope) => ensureDefaultCategories(scope));

    expect(seeded.map((category) => category.name)).toEqual([...DEFAULT_CATEGORIES]);
    expect(seeded.map((category) => category.name)).toEqual(["Cultural", "Historical", "Adventure", "Food & Local", "Private", "Family", "Customized"]);
    expect(seeded.map((category) => category.slug)).toEqual(["cultural", "historical", "adventure", "food-local", "private", "family", "customized"]);
    expect(seeded.map((category) => category.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(seeded.every((category) => category.tourCount === 0)).toBe(true);

    // Running it again changes nothing.
    const again = await as(tenant, (scope) => ensureDefaultCategories(scope));
    expect(again.map((category) => category.id)).toEqual(seeded.map((category) => category.id));
  });

  it("does not bring back a default the workspace deleted", async () => {
    const tenant = await createTenant();
    const seeded = await as(tenant, (scope) => ensureDefaultCategories(scope));
    const family = seeded.find((category) => category.name === "Family")!;
    await as(tenant, (scope) => deleteCategory(scope, family.id));

    const after = await as(tenant, (scope) => ensureDefaultCategories(scope));
    expect(after.map((category) => category.name)).not.toContain("Family");
    expect(after).toHaveLength(6);
  });

  it("seeds exactly once when two requests race", async () => {
    const tenant = await createTenant();
    await Promise.all([as(tenant, (scope) => ensureDefaultCategories(scope)), as(tenant, (scope) => ensureDefaultCategories(scope))]);
    expect(await as(tenant, (scope) => listCategories(scope))).toHaveLength(7);
  });

  it("creates categories at the end of the list with a slug from the name", async () => {
    const tenant = await createTenant();
    const first = await as(tenant, (scope) => createCategory(scope, { name: "  Wine & Dine  " }));
    const second = await as(tenant, (scope) => createCategory(scope, { name: "Hiking" }));

    expect(first).toMatchObject({ name: "Wine & Dine", slug: "wine-dine", sortOrder: 0, tourCount: 0 });
    expect(second).toMatchObject({ name: "Hiking", slug: "hiking", sortOrder: 1 });
  });

  it("gives colliding slugs a numeric suffix", async () => {
    const tenant = await createTenant();
    const a = await as(tenant, (scope) => createCategory(scope, { name: "Food & Local" }));
    const b = await as(tenant, (scope) => createCategory(scope, { name: "Food Local" }));
    const c = await as(tenant, (scope) => createCategory(scope, { name: "Food / Local" }));
    expect([a.slug, b.slug, c.slug]).toEqual(["food-local", "food-local-2", "food-local-3"]);
  });

  it("rejects a blank or over-long name", async () => {
    const tenant = await createTenant();
    expect(await fieldErrors(() => as(tenant, (scope) => createCategory(scope, { name: "   " })))).toEqual({ name: ["Add a category name."] });
    expect(await fieldErrors(() => as(tenant, (scope) => createCategory(scope, { name: "x".repeat(61) })))).toHaveProperty("name");
  });

  it("rejects a duplicate name, ignoring case", async () => {
    const tenant = await createTenant();
    await as(tenant, (scope) => createCategory(scope, { name: "Family" }));
    expect(await rejection(() => as(tenant, (scope) => createCategory(scope, { name: "FAMILY" })))).toBeInstanceOf(ConflictError);
    expect(await as(tenant, (scope) => listCategories(scope))).toHaveLength(1);
  });

  it("renames a category and moves its slug with it", async () => {
    const tenant = await createTenant();
    const family = await as(tenant, (scope) => createCategory(scope, { name: "Family" }));
    await as(tenant, (scope) => createCategory(scope, { name: "Private" }));
    await as(tenant, (scope) => createTour(scope, { title: "Tea country", categoryId: family.id }));

    const renamed = await as(tenant, (scope) => renameCategory(scope, family.id, { name: "Kids & Family" }));
    expect(renamed).toMatchObject({ id: family.id, name: "Kids & Family", slug: "kids-family", sortOrder: 0, tourCount: 1 });

    // Changing only the capitalisation is allowed; taking another category's name is not.
    const recased = await as(tenant, (scope) => renameCategory(scope, family.id, { name: "kids & family" }));
    expect(recased).toMatchObject({ name: "kids & family", slug: "kids-family" });
    expect(await rejection(() => as(tenant, (scope) => renameCategory(scope, family.id, { name: "private" })))).toBeInstanceOf(ConflictError);
    expect(await fieldErrors(() => as(tenant, (scope) => renameCategory(scope, family.id, { name: "" })))).toHaveProperty("name");
  });

  it("answers not found for unknown and malformed ids", async () => {
    const tenant = await createTenant();
    for (const id of [randomId(), "not-an-id"]) {
      expect(await rejection(() => as(tenant, (scope) => renameCategory(scope, id, { name: "Anything" })))).toBeInstanceOf(NotFoundError);
      expect(await rejection(() => as(tenant, (scope) => deleteCategory(scope, id)))).toBeInstanceOf(NotFoundError);
    }
  });

  it("stores a new order and lists by it", async () => {
    const tenant = await createTenant();
    const [a, b, c] = await as(tenant, async (scope) => [
      await createCategory(scope, { name: "Alpha" }),
      await createCategory(scope, { name: "Beta" }),
      await createCategory(scope, { name: "Gamma" }),
    ]);

    const reordered = await as(tenant, (scope) => reorderCategories(scope, [c!.id, a!.id, b!.id]));
    expect(reordered.map((category) => category.name)).toEqual(["Gamma", "Alpha", "Beta"]);
    expect(reordered.map((category) => category.sortOrder)).toEqual([0, 1, 2]);
    expect((await as(tenant, (scope) => listCategories(scope))).map((category) => category.name)).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("refuses a reorder that is incomplete, repeated, foreign or malformed", async () => {
    const tenant = await createTenant();
    const [a, b] = await as(tenant, async (scope) => [await createCategory(scope, { name: "Alpha" }), await createCategory(scope, { name: "Beta" })]);

    for (const ids of [[a!.id], [a!.id, a!.id], [a!.id, randomId()], [a!.id, b!.id, randomId()], ["nope", b!.id]]) {
      expect(await fieldErrors(() => as(tenant, (scope) => reorderCategories(scope, ids))), JSON.stringify(ids)).toHaveProperty("orderedIds");
    }
    expect((await as(tenant, (scope) => listCategories(scope))).map((category) => category.name)).toEqual(["Alpha", "Beta"]);
  });

  it("counts the tours of every status that use a category", async () => {
    const tenant = await createTenant();
    const [used, unused] = await as(tenant, async (scope) => [await createCategory(scope, { name: "Used" }), await createCategory(scope, { name: "Unused" })]);
    await as(tenant, async (scope) => {
      await createTour(scope, { title: "First tour", categoryId: used!.id });
      await createTour(scope, { title: "Second tour", categoryId: used!.id });
      await createTour(scope, { title: "Uncategorised tour" });
    });

    const listed = await as(tenant, (scope) => listCategories(scope));
    expect(listed.map((category) => [category.name, category.tourCount])).toEqual([
      ["Used", 2],
      ["Unused", 0],
    ]);
    expect(listed.map((category) => category.id)).toEqual([used!.id, unused!.id]);
  });

  it("blocks deleting a category that tours still use, then allows it once they move", async () => {
    const tenant = await createTenant();
    const category = await as(tenant, (scope) => createCategory(scope, { name: "Adventure" }));
    const one = await as(tenant, (scope) => createTour(scope, { title: "Khinalug highlands", categoryId: category.id }));

    const single = await rejection(() => as(tenant, (scope) => deleteCategory(scope, category.id)));
    expect(single).toBeInstanceOf(ConflictError);
    expect((single as ConflictError).message).toContain("1 tour uses this category");

    const two = await as(tenant, (scope) => createTour(scope, { title: "Quba forests", categoryId: category.id }));
    const plural = await rejection(() => as(tenant, (scope) => deleteCategory(scope, category.id)));
    expect((plural as ConflictError).message).toContain("2 tours use this category");
    expect(await as(tenant, (scope) => listCategories(scope))).toHaveLength(1);

    await as(tenant, async (scope) => {
      await updateTour(scope, one.id, { categoryId: null });
      await updateTour(scope, two.id, { categoryId: null });
      await deleteCategory(scope, category.id);
    });
    expect(await as(tenant, (scope) => listCategories(scope))).toEqual([]);
    expect(await auditActions(tenant, category.id)).toEqual(["category.deleted"]);
  });
});
