import { describe, expect, it } from "vitest";
import {
  createDestination,
  deleteDestination,
  getDestination,
  listDestinations,
  reorderDestinations,
  updateDestination,
} from "@/server/catalog/destinations";
import { createTour, updateTour } from "@/server/catalog/tours";
import { journeyEntries } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createMediaFixture } from "../../helpers/catalog";
import { createTenant, randomId } from "../../helpers/fixtures";
import { as, auditActions, fieldErrors, rejection } from "./support";

describe("destinations", () => {
  it("creates a destination with defaults, a slug from the name and the next position", async () => {
    const tenant = await createTenant();
    const sheki = await as(tenant, (scope) => createDestination(scope, { name: "  Sheki  " }));
    const baku = await as(tenant, (scope) => createDestination(scope, { name: "Baku & Absheron", region: "Absheron", tagline: "City of winds" }));

    expect(sheki).toEqual({
      id: sheki.id,
      name: "Sheki",
      slug: "sheki",
      region: "",
      tagline: "",
      description: "",
      coverMediaId: null,
      coverUrl: null,
      latitude: null,
      longitude: null,
      isPublished: true,
      sortOrder: 0,
      tourCount: 0,
    });
    expect(baku).toMatchObject({ slug: "baku-absheron", region: "Absheron", tagline: "City of winds", sortOrder: 1 });
  });

  it("suffixes a generated slug on collision but rejects a chosen slug that is taken", async () => {
    const tenant = await createTenant();
    const first = await as(tenant, (scope) => createDestination(scope, { name: "Quba" }));
    const second = await as(tenant, (scope) => createDestination(scope, { name: "Quba" }));
    expect([first.slug, second.slug]).toEqual(["quba", "quba-2"]);

    expect(await fieldErrors(() => as(tenant, (scope) => createDestination(scope, { name: "Quba again", slug: "quba" })))).toHaveProperty("slug");
    const chosen = await as(tenant, (scope) => createDestination(scope, { name: "Quba again", slug: "Quba-North", sortOrder: 9 }));
    expect(chosen).toMatchObject({ slug: "quba-north", sortOrder: 9 });
  });

  it("validates names, slugs and coordinate ranges", async () => {
    const tenant = await createTenant();
    const bad = await fieldErrors(() =>
      as(tenant, (scope) => createDestination(scope, { name: "x", slug: "Not A Slug", latitude: 91, longitude: -181 })),
    );
    expect(Object.keys(bad).sort()).toEqual(["latitude", "longitude", "name", "slug"]);

    expect(await fieldErrors(() => as(tenant, (scope) => createDestination(scope, { name: "Lankaran", latitude: 38.75 })))).toHaveProperty("longitude");
    expect(await fieldErrors(() => as(tenant, (scope) => createDestination(scope, { name: "Lankaran", longitude: 48.85 })))).toHaveProperty("latitude");

    const edge = await as(tenant, (scope) => createDestination(scope, { name: "Edge", latitude: -90, longitude: 180 }));
    expect(edge).toMatchObject({ latitude: -90, longitude: 180 });
  });

  it("attaches a cover image from the tenant's own library", async () => {
    const tenant = await createTenant();
    const media = await createMediaFixture(tenant.tenantId);
    const created = await as(tenant, (scope) => createDestination(scope, { name: "Gobustan", coverMediaId: media.id }));
    expect(created).toMatchObject({ coverMediaId: media.id, coverUrl: media.url });

    const cleared = await as(tenant, (scope) => updateDestination(scope, created.id, { coverMediaId: null }));
    expect(cleared).toMatchObject({ coverMediaId: null, coverUrl: null });
  });

  it("turns an unknown cover image into a field error and leaves the transaction usable", async () => {
    const tenant = await createTenant();
    const result = await as(tenant, async (scope) => {
      const onCreate = await fieldErrors(() => createDestination(scope, { name: "Ghost cover", coverMediaId: randomId() }));
      // The refused insert ran in a savepoint, so the same transaction can carry on.
      const created = await createDestination(scope, { name: "Real one" });
      const onUpdate = await fieldErrors(() => updateDestination(scope, created.id, { coverMediaId: randomId() }));
      return { onCreate, onUpdate, listed: await listDestinations(scope) };
    });

    expect(result.onCreate).toEqual({ coverMediaId: ["Choose a cover image from your media library."] });
    expect(result.onUpdate).toEqual({ coverMediaId: ["Choose a cover image from your media library."] });
    expect(result.listed.map((destination) => destination.name)).toEqual(["Real one"]);
  });

  it("updates fields, including the publish flag, and keeps coordinates paired", async () => {
    const tenant = await createTenant();
    const created = await as(tenant, (scope) => createDestination(scope, { name: "Khinalug", latitude: 41.18, longitude: 48.13 }));

    const updated = await as(tenant, (scope) =>
      updateDestination(scope, created.id, { name: "Khinalug & Quba", region: "Quba", description: "Highland villages.", isPublished: false }),
    );
    // The slug stays put on a rename so existing links keep working.
    expect(updated).toMatchObject({ name: "Khinalug & Quba", slug: "khinalug", region: "Quba", description: "Highland villages.", isPublished: false });

    expect(await fieldErrors(() => as(tenant, (scope) => updateDestination(scope, created.id, { latitude: null })))).toHaveProperty("latitude");
    const cleared = await as(tenant, (scope) => updateDestination(scope, created.id, { latitude: null, longitude: null }));
    expect(cleared).toMatchObject({ latitude: null, longitude: null });

    const empty = await rejection(() => as(tenant, (scope) => updateDestination(scope, created.id, {})));
    expect(empty).toBeInstanceOf(ValidationError);
  });

  it("changes a slug only to a free one", async () => {
    const tenant = await createTenant();
    const [a, b] = await as(tenant, async (scope) => [await createDestination(scope, { name: "Alpha" }), await createDestination(scope, { name: "Beta" })]);

    expect(await fieldErrors(() => as(tenant, (scope) => updateDestination(scope, b!.id, { slug: "alpha" })))).toHaveProperty("slug");
    expect(await as(tenant, (scope) => updateDestination(scope, b!.id, { slug: "beta" }))).toMatchObject({ slug: "beta" });
    expect(await as(tenant, (scope) => updateDestination(scope, b!.id, { slug: "gamma" }))).toMatchObject({ slug: "gamma" });
    expect((await as(tenant, (scope) => getDestination(scope, a!.id))).slug).toBe("alpha");
  });

  it("answers not found for unknown and malformed ids", async () => {
    const tenant = await createTenant();
    for (const id of [randomId(), "nope"]) {
      expect(await rejection(() => as(tenant, (scope) => getDestination(scope, id)))).toBeInstanceOf(NotFoundError);
      expect(await rejection(() => as(tenant, (scope) => updateDestination(scope, id, { name: "Anything" })))).toBeInstanceOf(NotFoundError);
      expect(await rejection(() => as(tenant, (scope) => deleteDestination(scope, id)))).toBeInstanceOf(NotFoundError);
    }
  });

  it("reorders the whole list and refuses a partial one", async () => {
    const tenant = await createTenant();
    const [a, b, c] = await as(tenant, async (scope) => [
      await createDestination(scope, { name: "Alpha" }),
      await createDestination(scope, { name: "Beta" }),
      await createDestination(scope, { name: "Gamma" }),
    ]);

    const reordered = await as(tenant, (scope) => reorderDestinations(scope, [b!.id, c!.id, a!.id]));
    expect(reordered.map((destination) => [destination.name, destination.sortOrder])).toEqual([
      ["Beta", 0],
      ["Gamma", 1],
      ["Alpha", 2],
    ]);
    expect(await fieldErrors(() => as(tenant, (scope) => reorderDestinations(scope, [a!.id, b!.id])))).toHaveProperty("orderedIds");
    expect(await fieldErrors(() => as(tenant, (scope) => reorderDestinations(scope, [a!.id, b!.id, randomId()])))).toHaveProperty("orderedIds");
  });

  it("counts attached tours and blocks deletion while any remain", async () => {
    const tenant = await createTenant();
    const destination = await as(tenant, (scope) => createDestination(scope, { name: "Lankaran" }));
    const tour = await as(tenant, (scope) => createTour(scope, { title: "Tea and forest", destinationId: destination.id }));
    expect((await as(tenant, (scope) => getDestination(scope, destination.id))).tourCount).toBe(1);

    const blocked = await rejection(() => as(tenant, (scope) => deleteDestination(scope, destination.id)));
    expect(blocked).toBeInstanceOf(ConflictError);
    expect((blocked as ConflictError).message).toContain("1 tour is attached");

    const second = await as(tenant, (scope) => createTour(scope, { title: "Hirkan walk", destinationId: destination.id }));
    expect(((await rejection(() => as(tenant, (scope) => deleteDestination(scope, destination.id)))) as ConflictError).message).toContain(
      "2 tours are attached",
    );

    await as(tenant, async (scope) => {
      await updateTour(scope, tour.id, { destinationId: null });
      await updateTour(scope, second.id, { destinationId: null });
      await deleteDestination(scope, destination.id);
    });
    expect(await as(tenant, (scope) => listDestinations(scope))).toEqual([]);
    expect(await auditActions(tenant, destination.id)).toEqual(["destination.deleted"]);
  });

  it("blocks deletion while other content still points at the destination", async () => {
    const tenant = await createTenant();
    const destination = await as(tenant, (scope) => createDestination(scope, { name: "Shamakhi" }));
    await as(tenant, ({ tx }) => tx.insert(journeyEntries).values({ title: "Wine route", slug: "wine-route", destinationId: destination.id }));

    const outcome = await as(tenant, async (scope) => {
      const error = await rejection(() => deleteDestination(scope, destination.id));
      return { error, stillThere: await getDestination(scope, destination.id) };
    });
    expect(outcome.error).toBeInstanceOf(ConflictError);
    expect((outcome.error as ConflictError).message).toContain("still used by other content");
    expect(outcome.stillThere.id).toBe(destination.id);
    expect(await auditActions(tenant, destination.id)).toEqual([]);
  });
});
