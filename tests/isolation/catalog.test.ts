import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { addAvailabilityBlock, listAvailabilityBlocks, removeAvailabilityBlock } from "@/server/catalog/availability";
import { createCategory, deleteCategory, ensureDefaultCategories, listCategories, renameCategory, reorderCategories } from "@/server/catalog/categories";
import { addDeparture, countUpcomingDepartures, listDepartures, removeDeparture, updateDeparture } from "@/server/catalog/departures";
import {
  createDestination,
  deleteDestination,
  getDestination,
  listDestinations,
  reorderDestinations,
  updateDestination,
} from "@/server/catalog/destinations";
import { publishTour, unpublishTour } from "@/server/catalog/publishing";
import { getPublishedTourBySlug, listCategoriesInUse, listPublishedDestinations, listPublishedTours } from "@/server/catalog/storefront";
import {
  archiveTour,
  createTour,
  deleteTour,
  duplicateTour,
  getTour,
  getTourCounts,
  listTours,
  replaceItinerary,
  restoreTour,
  setTourMedia,
  updateTour,
} from "@/server/catalog/tours";
import { withTenant, withoutTenant, type TenantScope } from "@/server/db/context";
import { auditLogs, availabilityBlocks, destinations, tourCategories, tourDepartures, tourItineraryDays, tourMedia, tours } from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/server/errors";
import {
  FIXTURE_TODAY,
  completeTourInput,
  createCategoryFixture,
  createDestinationFixture,
  createMediaFixture,
  createPublishedTourFixture,
  createTourFixture,
} from "../helpers/catalog";
import { createTenant, type TenantFixture } from "../helpers/fixtures";

const today = { today: FIXTURE_TODAY };

function as<T>(tenant: TenantFixture, fn: (scope: TenantScope) => Promise<T>): Promise<T> {
  return withTenant(tenant.tenantId, fn, { userId: tenant.ownerId });
}

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to be rejected, but it resolved.");
}

/** Postgres error code of a rejected statement, wherever the driver put it. */
async function pgCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code ?? "unknown";
  }
}

const INSUFFICIENT_PRIVILEGE = "42501";
const FOREIGN_KEY_VIOLATION = "23503";

describe("catalogue tenant isolation", () => {
  let a: TenantFixture;
  let b: TenantFixture;
  // Everything below belongs to tenant A. Tenant B is the intruder.
  const own = {} as {
    category: string;
    destination: string;
    media: string;
    mediaUrl: string;
    published: string;
    publishedSlug: string;
    draft: string;
    departureTour: string;
    departure: string;
    tourBlock: string;
    wideBlock: string;
  };

  beforeAll(async () => {
    a = await createTenant({ name: "Aurelia Journeys" });
    b = await createTenant({ name: "Borealis Tours" });

    const category = await createCategoryFixture(a.tenantId, "Cultural");
    const media = await createMediaFixture(a.tenantId);
    const destination = await createDestinationFixture(a.tenantId, { name: "Sheki", coverMediaId: media.id });
    const published = await createPublishedTourFixture(a.tenantId, {
      title: "Silk Road to Sheki",
      place: "Sheki",
      categoryId: category.id,
      destinationId: destination.id,
      isFeatured: true,
    });
    const draft = await createTourFixture(a.tenantId, { title: "Secret Draft of A", place: "Sheki" });
    const departureTour = await createPublishedTourFixture(a.tenantId, { title: "Scheduled Sheki", kind: "departure" });
    const [departure] = await as(a, (scope) => listDepartures(scope, departureTour.id));
    await as(a, async (scope) => {
      await replaceItinerary(scope, published.id, [{ dayNumber: 1, title: "A's day one" }]);
      await setTourMedia(scope, published.id, [media.id]);
    });
    const [tourBlock, wideBlock] = await as(a, async (scope) => [
      await addAvailabilityBlock(scope, { tourId: published.id, startDate: "2031-05-01", endDate: "2031-05-02", reason: "A guide away" }),
      await addAvailabilityBlock(scope, { startDate: "2031-06-01", endDate: "2031-06-02", reason: "A holiday" }),
    ]);

    Object.assign(own, {
      category: category.id,
      destination: destination.id,
      media: media.id,
      mediaUrl: media.url,
      published: published.id,
      publishedSlug: published.slug,
      draft: draft.id,
      departureTour: departureTour.id,
      departure: departure!.id,
      tourBlock: tourBlock!.id,
      wideBlock: wideBlock!.id,
    });
  });

  /** A's catalogue exactly as A sees it; compared before and after B's attempts. */
  function snapshotOfA() {
    return as(a, async (scope) => ({
      tours: (await listTours(scope)).items,
      published: await getTour(scope, own.published),
      draft: await getTour(scope, own.draft),
      departures: await listDepartures(scope, own.departureTour),
      categories: await listCategories(scope),
      destinations: await listDestinations(scope),
      blocks: await listAvailabilityBlocks(scope),
      counts: await getTourCounts(scope),
    }));
  }

  it("shows tenant B none of A's catalogue in any list", async () => {
    const seen = await as(b, async (scope) => ({
      tours: await listTours(scope),
      counts: await getTourCounts(scope),
      categories: await listCategories(scope),
      destinations: await listDestinations(scope),
      blocks: await listAvailabilityBlocks(scope),
      publicTours: await listPublishedTours(scope),
      publicDestinations: await listPublishedDestinations(scope),
      publicCategories: await listCategoriesInUse(scope),
    }));
    expect(seen).toEqual({
      tours: { items: [], total: 0 },
      counts: { published: 0, draft: 0, archived: 0, featured: 0 },
      categories: [],
      destinations: [],
      blocks: [],
      publicTours: { items: [], total: 0 },
      publicDestinations: [],
      publicCategories: [],
    });
  });

  it("finds nothing of A's when B searches or filters", async () => {
    for (const search of ["Sheki", "Silk", "Secret Draft", "silk-road-to-sheki", "%", "_", ""]) {
      const result = await as(b, async (scope) => ({
        dashboard: await listTours(scope, { search }),
        storefront: await listPublishedTours(scope, { search }),
      }));
      expect(result, search).toEqual({ dashboard: { items: [], total: 0 }, storefront: { items: [], total: 0 } });
    }
    const filtered = await as(b, async (scope) => ({
      byCategory: await listTours(scope, { categoryId: own.category }),
      byStatus: await listTours(scope, { status: "published" }),
      featured: await listTours(scope, { featured: true }),
      publicCategory: await listPublishedTours(scope, { category: "cultural" }),
      publicDestination: await listPublishedTours(scope, { destination: "sheki" }),
      publicFeatured: await listPublishedTours(scope, { featuredOnly: true }),
    }));
    for (const [name, result] of Object.entries(filtered)) expect(result, name).toEqual({ items: [], total: 0 });
  });

  it("answers not found when B reads A's records by id", async () => {
    const reads: [string, (scope: TenantScope) => Promise<unknown>][] = [
      ["getTour published", (scope) => getTour(scope, own.published)],
      ["getTour draft", (scope) => getTour(scope, own.draft)],
      ["getDestination", (scope) => getDestination(scope, own.destination)],
      ["listDepartures", (scope) => listDepartures(scope, own.departureTour)],
      ["listAvailabilityBlocks for tour", (scope) => listAvailabilityBlocks(scope, { tourId: own.published })],
      ["getPublishedTourBySlug", (scope) => getPublishedTourBySlug(scope, own.publishedSlug, today)],
    ];
    for (const [name, read] of reads) {
      expect(await rejection(() => as(b, read)), name).toBeInstanceOf(NotFoundError);
    }
    // The count helper takes a bare id; for a foreign tour it simply counts nothing.
    expect(await as(b, (scope) => countUpcomingDepartures(scope, own.departureTour, FIXTURE_TODAY))).toBe(0);
    expect(await as(a, (scope) => countUpcomingDepartures(scope, own.departureTour, FIXTURE_TODAY))).toBe(1);
  });

  it("answers not found when B tries to change, publish, copy or delete A's records", async () => {
    const before = await snapshotOfA();

    const writes: [string, (scope: TenantScope) => Promise<unknown>][] = [
      ["updateTour", (scope) => updateTour(scope, own.published, { title: "Hijacked", priceAdult: 1 })],
      ["publishTour", (scope) => publishTour(scope, own.draft, today)],
      ["unpublishTour", (scope) => unpublishTour(scope, own.published)],
      ["archiveTour", (scope) => archiveTour(scope, own.published)],
      ["restoreTour", (scope) => restoreTour(scope, own.published)],
      ["duplicateTour", (scope) => duplicateTour(scope, own.published)],
      ["deleteTour", (scope) => deleteTour(scope, own.draft)],
      ["replaceItinerary", (scope) => replaceItinerary(scope, own.published, [{ dayNumber: 1, title: "Planted" }])],
      ["setTourMedia", (scope) => setTourMedia(scope, own.published, [])],
      ["addDeparture", (scope) => addDeparture(scope, own.departureTour, { startDate: "2031-09-01", capacity: 8 }, today)],
      ["updateDeparture", (scope) => updateDeparture(scope, own.departure, { capacity: 1, isOpen: false }, today)],
      ["removeDeparture", (scope) => removeDeparture(scope, own.departure)],
      ["addAvailabilityBlock", (scope) => addAvailabilityBlock(scope, { tourId: own.published, startDate: "2031-01-01", endDate: "2031-12-31" })],
      ["removeAvailabilityBlock tour", (scope) => removeAvailabilityBlock(scope, own.tourBlock)],
      ["removeAvailabilityBlock wide", (scope) => removeAvailabilityBlock(scope, own.wideBlock)],
      ["renameCategory", (scope) => renameCategory(scope, own.category, { name: "Hijacked" })],
      ["deleteCategory", (scope) => deleteCategory(scope, own.category)],
      ["updateDestination", (scope) => updateDestination(scope, own.destination, { name: "Hijacked", isPublished: false })],
      ["deleteDestination", (scope) => deleteDestination(scope, own.destination)],
    ];
    for (const [name, write] of writes) {
      expect(await rejection(() => as(b, write)), name).toBeInstanceOf(NotFoundError);
    }

    expect(await snapshotOfA()).toEqual(before);
    // Nothing was created in B either (no stray copy, block or departure).
    expect((await as(b, (scope) => listTours(scope))).total).toBe(0);
    expect(await as(b, (scope) => listAvailabilityBlocks(scope))).toEqual([]);
    // And B's attempts left no trace in A's audit log.
    const audit = await as(a, ({ tx }) => tx.select({ actor: auditLogs.actorUserId }).from(auditLogs));
    expect(audit.every((entry) => entry.actor !== b.ownerId)).toBe(true);
  });

  it("gives the same answer for A's id as for an id that does not exist", async () => {
    const foreign = await rejection(() => as(b, (scope) => getTour(scope, own.draft)));
    const missing = await rejection(() => as(b, (scope) => getTour(scope, "7f1f3a0e-3b0c-4a55-9d7e-0c1f6f5b2a11")));
    expect(foreign).toBeInstanceOf(NotFoundError);
    expect((foreign as NotFoundError).message).toBe((missing as NotFoundError).message);
    expect((foreign as NotFoundError).status).toBe(404);
  });

  it("refuses to attach A's category, destination or media to a tour of B", async () => {
    const outcome = await as(b, async (scope) => {
      const errors = {
        category: await rejection(() => createTour(scope, { title: "B borrows a category", categoryId: own.category })),
        destination: await rejection(() => createTour(scope, { title: "B borrows a destination", destinationId: own.destination })),
        cover: await rejection(() => createTour(scope, { title: "B borrows a cover", coverMediaId: own.media })),
      };
      const mine = await createTour(scope, { title: "B's own tour" });
      return {
        errors,
        onUpdate: {
          category: await rejection(() => updateTour(scope, mine.id, { categoryId: own.category })),
          destination: await rejection(() => updateTour(scope, mine.id, { destinationId: own.destination })),
          cover: await rejection(() => updateTour(scope, mine.id, { coverMediaId: own.media })),
          gallery: await rejection(() => setTourMedia(scope, mine.id, [own.media])),
        },
        after: await getTour(scope, mine.id),
        total: (await listTours(scope)).total,
      };
    });

    for (const [name, error] of Object.entries({ ...outcome.errors, ...Object.fromEntries(Object.entries(outcome.onUpdate).map(([k, v]) => [`update ${k}`, v])) })) {
      expect(error, name).toBeInstanceOf(ValidationError);
    }
    expect((outcome.errors.category as ValidationError).fieldErrors).toEqual({ categoryId: ["Choose one of your categories."] });
    expect((outcome.onUpdate.gallery as ValidationError).fieldErrors).toEqual({ mediaIds: ["One of the selected files is not in your media library."] });
    // The message is the one used for an id that does not exist at all: no hint that it is someone else's.
    expect(outcome.after).toMatchObject({ categoryId: null, destinationId: null, coverMediaId: null, category: null, destination: null, coverUrl: null, media: [] });
    expect(outcome.total).toBe(1);
  });

  it("refuses to use A's media as a destination cover in B", async () => {
    const created = await rejection(() => as(b, (scope) => createDestination(scope, { name: "B's place", coverMediaId: own.media })));
    expect(created).toBeInstanceOf(ValidationError);
    expect((created as ValidationError).fieldErrors).toHaveProperty("coverMediaId");

    const mine = await createDestinationFixture(b.tenantId, { name: "B's real place" });
    expect(await rejection(() => as(b, (scope) => updateDestination(scope, mine.id, { coverMediaId: own.media })))).toBeInstanceOf(ValidationError);
    expect((await as(b, (scope) => getDestination(scope, mine.id))).coverUrl).toBeNull();
  });

  it("does not let B slip A's ids into a reorder", async () => {
    const mine = await createCategoryFixture(b.tenantId, "B category");
    const myDestinations = await as(b, (scope) => listDestinations(scope));
    const before = await as(a, (scope) => listCategories(scope));

    expect(await rejection(() => as(b, (scope) => reorderCategories(scope, [own.category, mine.id])))).toBeInstanceOf(ValidationError);
    expect(await rejection(() => as(b, (scope) => reorderCategories(scope, [own.category])))).toBeInstanceOf(ValidationError);
    expect(
      await rejection(() => as(b, (scope) => reorderDestinations(scope, [own.destination, ...myDestinations.map((destination) => destination.id)]))),
    ).toBeInstanceOf(ValidationError);
    expect(await as(a, (scope) => listCategories(scope))).toEqual(before);
  });

  it("seeds default categories for B without touching A's", async () => {
    const fresh = await createTenant();
    const before = await as(a, (scope) => listCategories(scope));
    const seeded = await as(fresh, (scope) => ensureDefaultCategories(scope));
    expect(seeded).toHaveLength(7);
    // "Cultural" exists in A already; the same name and slug are fine in another workspace.
    expect(seeded[0]).toMatchObject({ name: "Cultural", slug: "cultural" });
    expect(await as(a, (scope) => listCategories(scope))).toEqual(before);
    expect((await as(fresh, (scope) => createCategory(scope, { name: "Sheki Specials" }))).slug).toBe("sheki-specials");
  });

  it("allows identical slugs in two tenants and keeps each storefront to its own tour", async () => {
    const c = await createTenant();
    const mine = await createPublishedTourFixture(c.tenantId, { title: "Silk Road to Sheki", summary: "C's version.", priceAdult: 11_100 });
    expect(mine.slug).toBe(own.publishedSlug);

    const fromC = await withTenant(c.tenantId, (scope) => getPublishedTourBySlug(scope, own.publishedSlug, today));
    const fromA = await withTenant(a.tenantId, (scope) => getPublishedTourBySlug(scope, own.publishedSlug, today));
    expect(fromC).toMatchObject({ id: mine.id, summary: "C's version.", priceAdult: 11_100, categoryName: null, media: [], itinerary: [] });
    expect(fromA).toMatchObject({ id: own.published, priceAdult: 69_000, categoryName: "Cultural", destinationName: "Sheki", coverUrl: own.mediaUrl });
    expect(fromA.itinerary.map((day) => day.title)).toEqual(["A's day one"]);

    const listedInC = await withTenant(c.tenantId, (scope) => listPublishedTours(scope, { search: "sheki" }));
    expect(listedInC.items.map((item) => item.id)).toEqual([mine.id]);
    expect(listedInC.total).toBe(1);

    // A draft in C with the slug of A's published tour stays invisible in C.
    const d = await createTenant();
    const draft = await as(d, (scope) => createTour(scope, completeTourInput({ title: "Silk Road to Sheki" })));
    expect(draft.slug).toBe(own.publishedSlug);
    expect(await rejection(() => withTenant(d.tenantId, (scope) => getPublishedTourBySlug(scope, own.publishedSlug, today)))).toBeInstanceOf(NotFoundError);
    expect((await withTenant(d.tenantId, (scope) => listPublishedTours(scope))).total).toBe(0);
  });

  it("keeps A's published tours out of B's storefront even when B has its own", async () => {
    const category = await createCategoryFixture(b.tenantId, "Cultural");
    const destination = await createDestinationFixture(b.tenantId, { name: "Sheki" });
    const mine = await createPublishedTourFixture(b.tenantId, { title: "Borealis Sheki Day", categoryId: category.id, destinationId: destination.id });

    const seen = await withTenant(b.tenantId, async (scope) => ({
      all: await listPublishedTours(scope),
      byCategory: await listPublishedTours(scope, { category: "cultural" }),
      byDestination: await listPublishedTours(scope, { destination: "sheki" }),
      search: await listPublishedTours(scope, { search: "sheki" }),
      destinations: await listPublishedDestinations(scope),
      categories: await listCategoriesInUse(scope),
    }));
    for (const result of [seen.all, seen.byCategory, seen.byDestination, seen.search]) {
      expect(result.items.map((item) => item.id)).toEqual([mine.id]);
      expect(result.total).toBe(1);
    }
    // Counts are B's alone: A also has one published tour in "Cultural" at "Sheki".
    expect(seen.destinations.map((row) => [row.id, row.tourCount])).toContainEqual([destination.id, 1]);
    expect(seen.destinations.map((row) => row.id)).not.toContain(own.destination);
    expect(seen.categories).toEqual([{ id: category.id, name: "Cultural", slug: "cultural", tourCount: 1 }]);
  });

  it("keeps each tenant's plan limit separate", async () => {
    const small = await createTenant({ plan: { maxPublishedTours: 1 } });
    // A already has two published tours; that must not use up `small`'s single place.
    const tour = await as(small, (scope) => createTour(scope, completeTourInput()));
    expect((await as(small, (scope) => publishTour(scope, tour.id, today))).status).toBe("published");
  });
});

describe("catalogue row-level security, bypassing the services", () => {
  it("returns none of A's catalogue rows to B's raw queries", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const tour = await createPublishedTourFixture(a.tenantId, { kind: "departure" });
    const media = await createMediaFixture(a.tenantId);
    await createCategoryFixture(a.tenantId);
    await createDestinationFixture(a.tenantId);
    await as(a, async (scope) => {
      await replaceItinerary(scope, tour.id, [{ dayNumber: 1, title: "Day" }]);
      await setTourMedia(scope, tour.id, [media.id]);
      await addAvailabilityBlock(scope, { startDate: "2031-05-01", endDate: "2031-05-01" });
    });

    const seen = await as(b, async ({ tx }) => ({
      tours: await tx.select().from(tours).where(eq(tours.tenantId, a.tenantId)),
      byId: await tx.select().from(tours).where(eq(tours.id, tour.id)),
      categories: await tx.select().from(tourCategories),
      destinations: await tx.select().from(destinations),
      itinerary: await tx.select().from(tourItineraryDays),
      media: await tx.select().from(tourMedia),
      departures: await tx.select().from(tourDepartures),
      blocks: await tx.select().from(availabilityBlocks),
    }));
    expect(seen).toEqual({ tours: [], byId: [], categories: [], destinations: [], itinerary: [], media: [], departures: [], blocks: [] });
  });

  it("cannot update, delete or plant catalogue rows across tenants", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const tour = await createPublishedTourFixture(a.tenantId);
    const category = await createCategoryFixture(a.tenantId);

    const touched = await as(b, async ({ tx }) => ({
      updated: await tx.update(tours).set({ title: "Defaced" }).where(eq(tours.id, tour.id)).returning({ id: tours.id }),
      deleted: await tx.delete(tourCategories).where(eq(tourCategories.id, category.id)).returning({ id: tourCategories.id }),
    }));
    expect(touched).toEqual({ updated: [], deleted: [] });

    expect(await pgCode(() => as(b, ({ tx }) => tx.insert(tours).values({ tenantId: a.tenantId, title: "Planted", slug: "planted" })))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    // B's own tour pointing at A's category: the composite key has no such (tenant, category) pair.
    expect(await pgCode(() => as(b, ({ tx }) => tx.insert(tours).values({ title: "Borrowed", slug: "borrowed", categoryId: category.id })))).toBe(
      FOREIGN_KEY_VIOLATION,
    );
    // Nor can B hang a departure or an itinerary day on A's tour.
    expect(await pgCode(() => as(b, ({ tx }) => tx.insert(tourDepartures).values({ tourId: tour.id, startDate: "2031-05-01", capacity: 4 })))).toBe(
      FOREIGN_KEY_VIOLATION,
    );
    expect(await pgCode(() => as(b, ({ tx }) => tx.insert(tourItineraryDays).values({ tourId: tour.id, dayNumber: 1, title: "Planted" })))).toBe(
      FOREIGN_KEY_VIOLATION,
    );

    const intact = await as(a, (scope) => getTour(scope, tour.id));
    expect(intact).toMatchObject({ title: tour.title, status: "published", itinerary: [], departures: [] });
    expect(await as(a, (scope) => listCategories(scope))).toHaveLength(1);
  });

  it("serves nothing without a tenant context", async () => {
    const a = await createTenant();
    await createPublishedTourFixture(a.tenantId);
    const rows = await withoutTenant(async (tx) => ({ tours: await tx.select().from(tours), categories: await tx.select().from(tourCategories) }));
    expect(rows).toEqual({ tours: [], categories: [] });
  });
});
