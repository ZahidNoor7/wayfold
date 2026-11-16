import { beforeAll, describe, expect, it } from "vitest";
import { createCategory } from "@/server/catalog/categories";
import { addDeparture, updateDeparture } from "@/server/catalog/departures";
import { createDestination, updateDestination } from "@/server/catalog/destinations";
import { publishTour, unpublishTour } from "@/server/catalog/publishing";
import {
  getPublishedTourBySlug,
  listCategoriesInUse,
  listPublishedDestinations,
  listPublishedTours,
  type ListPublishedToursInput,
} from "@/server/catalog/storefront";
import { archiveTour, createTour, replaceItinerary, setTourMedia, updateTour } from "@/server/catalog/tours";
import { withTenant } from "@/server/db/context";
import { NotFoundError, ValidationError } from "@/server/errors";
import { FIXTURE_TODAY, completeTourInput, createMediaFixture, createPublishedTourFixture, createTourFixture } from "../../helpers/catalog";
import { createTenant, type TenantFixture } from "../../helpers/fixtures";
import { as, rejection, seedBooking, seedReview } from "./support";

const today = { today: FIXTURE_TODAY };

/** Storefront reads have no signed-in user, exactly like a real visitor. */
function visit<T>(tenant: TenantFixture, fn: Parameters<typeof withTenant<T>>[1]): Promise<T> {
  return withTenant(tenant.tenantId, fn);
}

describe("storefront catalogue", () => {
  let tenant: TenantFixture;
  const id: Record<string, string> = {};

  // One read-only catalogue shared by the listing tests:
  //   sheki   Cultural   Sheki     3 days  $690   popular+featured  reviews 5,4 (+1 hidden)
  //   fire    Adventure  Absheron  1 day   $165   featured          reviews 5,5,5
  //   old     Historical Baku      1 day   $120   (day tour)        no reviews
  //   grand   Private    —         8 days  $2450  popular           review 3
  //   khin    Adventure  Quba*     2 days  $480                     review 4     (*destination unpublished)
  // plus a draft and an archived tour that must never appear.
  beforeAll(async () => {
    tenant = await createTenant();
    const [cultural, adventure, historical, priv, unused] = await as(tenant, async (scope) => [
      await createCategory(scope, { name: "Cultural" }),
      await createCategory(scope, { name: "Adventure" }),
      await createCategory(scope, { name: "Historical" }),
      await createCategory(scope, { name: "Private" }),
      await createCategory(scope, { name: "Family" }),
    ]);
    const cover = await createMediaFixture(tenant.tenantId, { alt: "Sheki palace" });
    const [sheki, absheron, baku, quba, empty] = await as(tenant, async (scope) => [
      await createDestination(scope, { name: "Sheki", region: "Shaki-Zagatala", tagline: "Caravanserais", coverMediaId: cover.id }),
      await createDestination(scope, { name: "Absheron" }),
      await createDestination(scope, { name: "Baku" }),
      await createDestination(scope, { name: "Quba", isPublished: false }),
      await createDestination(scope, { name: "Lankaran" }),
    ]);
    Object.assign(id, {
      cultural: cultural!.id,
      adventure: adventure!.id,
      historical: historical!.id,
      private: priv!.id,
      family: unused!.id,
      dSheki: sheki!.id,
      dAbsheron: absheron!.id,
      dBaku: baku!.id,
      dQuba: quba!.id,
      dLankaran: empty!.id,
      cover: cover.id,
    });

    const publish = async (key: string, overrides: Parameters<typeof completeTourInput>[0]) => {
      id[key] = (await createPublishedTourFixture(tenant.tenantId, overrides)).id;
    };
    await publish("sheki", {
      title: "Silk Road to Sheki",
      place: "Sheki, Greater Caucasus",
      categoryId: id.cultural,
      destinationId: id.dSheki,
      durationDays: 3,
      durationLabel: "3 days",
      priceAdult: 69_000,
      isPopular: true,
      isFeatured: true,
      coverMediaId: cover.id,
    });
    await publish("fire", {
      title: "Fire & Stone",
      place: "Gobustan",
      categoryId: id.adventure,
      destinationId: id.dAbsheron,
      durationDays: 1,
      durationLabel: "",
      priceAdult: 16_500,
      isFeatured: true,
    });
    await publish("old", {
      title: "Icherisheher & Flame Towers",
      place: "Old City",
      kind: "day",
      categoryId: id.historical,
      destinationId: id.dBaku,
      priceAdult: 12_000,
    });
    await publish("grand", { title: "Private Grand Azerbaijan", place: "Nationwide", categoryId: id.private, durationDays: 8, durationLabel: "8 days", priceAdult: 245_000, isPopular: true });
    await publish("khin", {
      title: "Khinalug Highlands",
      place: "100% off_road",
      categoryId: id.adventure,
      destinationId: id.dQuba,
      durationDays: 2,
      durationLabel: "2 days",
      priceAdult: 48_000,
    });
    id.draft = (await createTourFixture(tenant.tenantId, completeTourInput({ title: "Gabala Draft", place: "Sheki", categoryId: id.family, destinationId: id.dLankaran }))).id;
    id.archived = (await createPublishedTourFixture(tenant.tenantId, { title: "Archived Sheki Classic", categoryId: id.cultural, destinationId: id.dSheki })).id;
    await as(tenant, (scope) => archiveTour(scope, id.archived!));

    for (const rating of [5, 4]) await seedReview(tenant, { tourId: id.sheki!, rating });
    await seedReview(tenant, { tourId: id.sheki!, rating: 1, isPublished: false });
    for (const rating of [5, 5, 5]) await seedReview(tenant, { tourId: id.fire!, rating });
    await seedReview(tenant, { tourId: id.grand!, rating: 3 });
    await seedReview(tenant, { tourId: id.khin!, rating: 4 });
    // A review that is not about any tour, and reviews of unpublished tours, affect nothing.
    await seedReview(tenant, { tourId: null, rating: 1 });
    await seedReview(tenant, { tourId: id.draft!, rating: 5 });
  });

  const list = (filters: ListPublishedToursInput = {}) => visit(tenant, (scope) => listPublishedTours(scope, filters));
  const keys = async (filters: ListPublishedToursInput = {}) => {
    const { items } = await list(filters);
    return items.map((item) => Object.keys(id).find((key) => id[key] === item.id));
  };

  it("lists only published tours", async () => {
    const { items, total } = await list();
    expect(total).toBe(5);
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.id)).not.toContain(id.draft);
    expect(items.map((item) => item.id)).not.toContain(id.archived);
  });

  it("returns card data with cover, category, destination and rating", async () => {
    const { items } = await list();
    const sheki = items.find((item) => item.id === id.sheki)!;
    expect(sheki).toEqual({
      id: id.sheki,
      slug: "silk-road-to-sheki",
      title: "Silk Road to Sheki",
      summary: "A small-group journey with a local guide.",
      place: "Sheki, Greater Caucasus",
      kind: "private",
      durationDays: 3,
      durationLabel: "3 days",
      priceAdult: 69_000,
      childPricePercent: 50,
      minGroupSize: 1,
      maxGroupSize: 8,
      isFeatured: true,
      isPopular: true,
      categoryName: "Cultural",
      categorySlug: "cultural",
      destinationName: "Sheki",
      destinationSlug: "sheki",
      coverUrl: expect.stringMatching(/^https:\/\/media\.example\.test\//),
      coverAlt: "Sheki palace",
      // The hidden 1-star review is excluded: (5 + 4) / 2.
      ratingAverage: 4.5,
      reviewCount: 2,
    });
    // Internal fields never reach a card.
    for (const hidden of ["status", "tenantId", "sortOrder", "coverMediaId", "createdAt", "publishedAt"]) expect(sheki).not.toHaveProperty(hidden);

    const old = items.find((item) => item.id === id.old)!;
    expect(old).toMatchObject({ ratingAverage: null, reviewCount: 0, coverUrl: null, coverAlt: null, kind: "day", durationLabel: "6 hours" });
    // No label stored: the day count is spelled out.
    expect(items.find((item) => item.id === id.fire)).toMatchObject({ durationLabel: "1 day", ratingAverage: 5, reviewCount: 3 });
    // A tour whose destination is unpublished shows no destination.
    expect(items.find((item) => item.id === id.khin)).toMatchObject({ destinationName: null, destinationSlug: null, categoryName: "Adventure" });
    expect(items.find((item) => item.id === id.grand)).toMatchObject({ destinationName: null, ratingAverage: 3, reviewCount: 1 });
  });

  it("sorts by popularity by default", async () => {
    // popular flag, then featured flag, then review count.
    expect(await keys()).toEqual(["sheki", "grand", "fire", "khin", "old"]);
    expect(await keys({ sort: "popular" })).toEqual(["sheki", "grand", "fire", "khin", "old"]);
  });

  it("sorts by price, duration and rating", async () => {
    expect(await keys({ sort: "price_asc" })).toEqual(["old", "fire", "khin", "sheki", "grand"]);
    expect(await keys({ sort: "price_desc" })).toEqual(["grand", "sheki", "khin", "fire", "old"]);
    // Shortest first; the two one-day tours are ordered by price.
    expect(await keys({ sort: "duration" })).toEqual(["old", "fire", "khin", "sheki", "grand"]);
    // Highest rated first; tours without reviews go last.
    expect(await keys({ sort: "rating" })).toEqual(["fire", "sheki", "khin", "grand", "old"]);
  });

  it("filters by category slug", async () => {
    expect(await keys({ category: "adventure" })).toEqual(["fire", "khin"]);
    expect(await keys({ category: " Cultural " })).toEqual(["sheki"]);
    // The draft is the only tour in Family.
    expect(await keys({ category: "family" })).toEqual([]);
    expect(await keys({ category: "no-such-category" })).toEqual([]);
    expect((await list({ category: "adventure" })).total).toBe(2);
  });

  it("filters by published destination slug", async () => {
    expect(await keys({ destination: "sheki" })).toEqual(["sheki"]);
    expect(await keys({ destination: "baku" })).toEqual(["old"]);
    // Quba is unpublished, so it cannot be used as a filter; Lankaran only has a draft.
    expect(await keys({ destination: "quba" })).toEqual([]);
    expect(await keys({ destination: "lankaran" })).toEqual([]);
  });

  it("searches title, place and destination name, case-insensitively", async () => {
    expect(await keys({ search: "sheki" })).toEqual(["sheki"]);
    expect(await keys({ search: "FLAME" })).toEqual(["old"]);
    expect(await keys({ search: "gobustan" })).toEqual(["fire"]);
    expect(await keys({ search: "absheron" })).toEqual(["fire"]);
    expect(await keys({ search: "  azerbaijan  " })).toEqual(["grand"]);
    // The unpublished destination's name is not searchable.
    expect(await keys({ search: "quba" })).toEqual([]);
    expect(await keys({ search: "gabala" })).toEqual([]);
    expect(await keys({ search: "" })).toHaveLength(5);
  });

  it("treats wildcard and quote characters in a search as plain text", async () => {
    expect(await keys({ search: "%" })).toEqual(["khin"]);
    expect(await keys({ search: "_" })).toEqual(["khin"]);
    expect(await keys({ search: "100%" })).toEqual(["khin"]);
    expect(await keys({ search: "off_road" })).toEqual(["khin"]);
    expect(await keys({ search: "off%road" })).toEqual([]);
    expect(await keys({ search: "s_lk" })).toEqual([]);
    expect(await keys({ search: "%%" })).toEqual([]);
    expect(await keys({ search: "\\" })).toEqual([]);
    for (const hostile of ["' OR '1'='1", "'; drop table tours; --", "\\'; select pg_sleep(5); --", "$1", "${id}"]) {
      expect(await keys({ search: hostile }), hostile).toEqual([]);
    }
    // Nothing was dropped or altered along the way.
    expect((await list()).total).toBe(5);
  });

  it("filters by duration and price ranges, inclusive", async () => {
    expect(await keys({ maxDuration: 1, sort: "price_asc" })).toEqual(["old", "fire"]);
    expect(await keys({ minDuration: 2, maxDuration: 3, sort: "price_asc" })).toEqual(["khin", "sheki"]);
    expect(await keys({ minDuration: 4 })).toEqual(["grand"]);
    expect(await keys({ priceMax: 16_500, sort: "price_asc" })).toEqual(["old", "fire"]);
    expect(await keys({ priceMax: 16_499 })).toEqual(["old"]);
    expect(await keys({ priceMin: 48_000, priceMax: 69_000, sort: "price_asc" })).toEqual(["khin", "sheki"]);
    expect(await keys({ priceMin: 100_000 })).toEqual(["grand"]);
    expect(await keys({ priceMin: 300_000 })).toEqual([]);
  });

  it("shows only featured tours when asked", async () => {
    expect(await keys({ featuredOnly: true })).toEqual(["sheki", "fire"]);
    expect(await keys({ featuredOnly: false })).toHaveLength(5);
    expect((await list({ featuredOnly: true })).total).toBe(2);
  });

  it("combines filters", async () => {
    expect(await keys({ category: "adventure", maxDuration: 1 })).toEqual(["fire"]);
    expect(await keys({ search: "s", featuredOnly: true, priceMin: 20_000 })).toEqual(["sheki"]);
    expect(await keys({ category: "cultural", destination: "baku" })).toEqual([]);
  });

  it("pages with a stable order and the full total", async () => {
    const first = await list({ sort: "price_asc", limit: 2 });
    const second = await list({ sort: "price_asc", limit: 2, offset: 2 });
    const third = await list({ sort: "price_asc", limit: 2, offset: 4 });
    expect([first.total, second.total, third.total]).toEqual([5, 5, 5]);
    expect([...first.items, ...second.items, ...third.items].map((item) => item.id)).toEqual([id.old, id.fire, id.khin, id.sheki, id.grand]);
    expect((await list({ offset: 50 })).items).toEqual([]);
  });

  it("rejects malformed filters", async () => {
    for (const bad of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { sort: "newest" }, { minDuration: 0 }, { priceMax: -1 }, { priceMin: 1.5 }, { featuredOnly: "yes" }]) {
      expect(await rejection(() => list(bad as never)), JSON.stringify(bad)).toBeInstanceOf(ValidationError);
    }
  });

  it("lists published destinations with their published-tour counts", async () => {
    const destinations = await visit(tenant, (scope) => listPublishedDestinations(scope));
    expect(destinations.map((destination) => [destination.name, destination.tourCount])).toEqual([
      ["Sheki", 1],
      ["Absheron", 1],
      ["Baku", 1],
      // Lankaran's only tour is a draft; Quba is unpublished and absent.
      ["Lankaran", 0],
    ]);
    expect(destinations[0]).toEqual({
      id: id.dSheki,
      name: "Sheki",
      slug: "sheki",
      region: "Shaki-Zagatala",
      tagline: "Caravanserais",
      description: "",
      coverUrl: expect.stringMatching(/^https:\/\/media\.example\.test\//),
      latitude: null,
      longitude: null,
      tourCount: 1,
    });
    expect(destinations[1]!.coverUrl).toBeNull();
  });

  it("lists only categories that have a published tour", async () => {
    const categories = await visit(tenant, (scope) => listCategoriesInUse(scope));
    expect(categories).toEqual([
      { id: id.cultural, name: "Cultural", slug: "cultural", tourCount: 1 },
      { id: id.adventure, name: "Adventure", slug: "adventure", tourCount: 2 },
      { id: id.historical, name: "Historical", slug: "historical", tourCount: 1 },
      { id: id.private, name: "Private", slug: "private", tourCount: 1 },
    ]);
  });
});

describe("storefront tour page", () => {
  it("returns the full detail of a published tour", async () => {
    const tenant = await createTenant();
    const [first, second] = await Promise.all([createMediaFixture(tenant.tenantId), createMediaFixture(tenant.tenantId, { resourceType: "video", format: "mp4" })]);
    const category = await as(tenant, (scope) => createCategory(scope, { name: "Cultural" }));
    const tour = await as(tenant, (scope) =>
      createTour(
        scope,
        completeTourInput({
          title: "Silk Road to Sheki",
          description: "Three unhurried days.",
          categoryId: category.id,
          languages: ["EN", "AZ"],
          highlights: ["A night in the caravanserai"],
          inclusions: ["Guiding"],
          exclusions: ["Flights"],
          goodToKnow: ["Bring a jacket"],
          faq: [{ question: "Can it be private?", answer: "Yes, on request." }],
          meetingPoint: "Your Baku hotel",
          meetingLatitude: 40.4093,
          meetingLongitude: 49.8671,
          cancellationPolicy: "Free up to 7 days before.",
          minGroupSize: 2,
        }),
      ),
    );
    await as(tenant, async (scope) => {
      await replaceItinerary(scope, tour.id, [
        { dayNumber: 1, title: "Along the caravan road", location: "Baku → Sheki", meta: "Drive 5 h" },
        { dayNumber: 2, title: "Palaces and halva", location: "Sheki" },
      ]);
      await setTourMedia(scope, tour.id, [second!.id, first!.id]);
      await publishTour(scope, tour.id, today);
    });
    await seedReview(tenant, { tourId: tour.id, rating: 5 });
    await seedReview(tenant, { tourId: tour.id, rating: 4 });
    await seedReview(tenant, { tourId: tour.id, rating: 4 });

    const detail = await withTenant(tenant.tenantId, (scope) => getPublishedTourBySlug(scope, "silk-road-to-sheki", today));
    expect(detail).toMatchObject({
      id: tour.id,
      slug: "silk-road-to-sheki",
      title: "Silk Road to Sheki",
      description: "Three unhurried days.",
      categoryName: "Cultural",
      kind: "private",
      priceAdult: 69_000,
      childPricePercent: 50,
      childMaxAge: 11,
      minGroupSize: 2,
      maxGroupSize: 8,
      languages: ["EN", "AZ"],
      highlights: ["A night in the caravanserai"],
      inclusions: ["Guiding"],
      exclusions: ["Flights"],
      goodToKnow: ["Bring a jacket"],
      faq: [{ question: "Can it be private?", answer: "Yes, on request." }],
      meetingPoint: "Your Baku hotel",
      meetingLatitude: 40.4093,
      meetingLongitude: 49.8671,
      cancellationPolicy: "Free up to 7 days before.",
      schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [] },
      // (5 + 4 + 4) / 3 = 4.33 → one decimal.
      ratingAverage: 4.3,
      reviewCount: 3,
      departures: [],
    });
    expect(detail.itinerary).toEqual([
      { dayNumber: 1, title: "Along the caravan road", location: "Baku → Sheki", description: "", meta: "Drive 5 h" },
      { dayNumber: 2, title: "Palaces and halva", location: "Sheki", description: "", meta: "" },
    ]);
    expect(detail.media.map((item) => [item.mediaId, item.resourceType])).toEqual([
      [second!.id, "video"],
      [first!.id, "image"],
    ]);
    // The first gallery file is the cover.
    expect(detail.coverUrl).toBe(second!.url);
    for (const hidden of ["status", "tenantId", "sortOrder", "createdAt", "updatedAt", "publishedAt"]) expect(detail).not.toHaveProperty(hidden);

    // Slugs from a URL are matched without regard to case or stray spaces.
    const again = await withTenant(tenant.tenantId, (scope) => getPublishedTourBySlug(scope, "  Silk-Road-To-Sheki ", today));
    expect(again.id).toBe(tour.id);
  });

  it("is not found for drafts, archived tours, unknown slugs and junk", async () => {
    const tenant = await createTenant();
    const draft = await as(tenant, (scope) => createTour(scope, completeTourInput({ title: "Still a draft" })));
    const live = await createPublishedTourFixture(tenant.tenantId, { title: "Now you see it" });
    const get = (slug: string) => withTenant(tenant.tenantId, (scope) => getPublishedTourBySlug(scope, slug, today));

    expect(await rejection(() => get(draft.slug))).toBeInstanceOf(NotFoundError);
    expect(await rejection(() => get("no-such-tour"))).toBeInstanceOf(NotFoundError);
    for (const junk of ["", "   ", "%", "_", "' or 1=1 --", undefined as never, 42 as never]) {
      expect(await rejection(() => get(junk)), String(junk)).toBeInstanceOf(NotFoundError);
    }

    expect((await get(live.slug)).id).toBe(live.id);
    await as(tenant, (scope) => unpublishTour(scope, live.id));
    expect(await rejection(() => get(live.slug))).toBeInstanceOf(NotFoundError);
    await as(tenant, (scope) => publishTour(scope, live.id, today));
    expect((await get(live.slug)).id).toBe(live.id);
    await as(tenant, (scope) => archiveTour(scope, live.id));
    expect(await rejection(() => get(live.slug))).toBeInstanceOf(NotFoundError);

    const unpublishedError = await rejection(() => get(draft.slug));
    const unknownError = await rejection(() => get("no-such-tour"));
    // A draft is indistinguishable from a slug that does not exist.
    expect((unpublishedError as NotFoundError).message).toBe((unknownError as NotFoundError).message);
  });

  it("requires a real `today`", async () => {
    const tenant = await createTenant();
    const live = await createPublishedTourFixture(tenant.tenantId);
    expect(await rejection(() => withTenant(tenant.tenantId, (scope) => getPublishedTourBySlug(scope, live.slug, { today: "now" })))).toBeInstanceOf(RangeError);
  });

  it("shows upcoming open departures with seats left", async () => {
    const tenant = await createTenant();
    const tour = await as(tenant, (scope) => createTour(scope, completeTourInput({ title: "Scheduled Sheki", kind: "departure" })));
    const [past, soon, closed, later] = await as(tenant, async (scope) => [
      await addDeparture(scope, tour.id, { startDate: "2031-03-12", capacity: 8 }, today),
      await addDeparture(scope, tour.id, { startDate: "2031-04-17", capacity: 8, startTime: "08:00" }, today),
      await addDeparture(scope, tour.id, { startDate: "2031-05-08", capacity: 8 }, today),
      await addDeparture(scope, tour.id, { startDate: "2031-06-12", capacity: 4 }, today),
    ]);
    await as(tenant, async (scope) => {
      await updateDeparture(scope, closed!.id, { isOpen: false }, today);
      await publishTour(scope, tour.id, today);
    });
    await seedBooking(tenant, { tourId: tour.id, departureId: soon!.id, status: "confirmed", adults: 4, children: 2 });
    await seedBooking(tenant, { tourId: tour.id, departureId: soon!.id, status: "cancelled", adults: 2 });
    await seedBooking(tenant, { tourId: tour.id, departureId: later!.id, status: "pending", adults: 5 });

    // Viewed a few days later, the first departure has already left.
    const detail = await withTenant(tenant.tenantId, (scope) => getPublishedTourBySlug(scope, tour.slug, { today: "2031-03-13" }));
    expect(detail.departures).toEqual([
      { id: soon!.id, startDate: "2031-04-17", startTime: "08:00", capacity: 8, seatsLeft: 2 },
      // Over-booked rows never show negative seats.
      { id: later!.id, startDate: "2031-06-12", startTime: null, capacity: 4, seatsLeft: 0 },
    ]);
    expect(detail.departures.map((departure) => departure.id)).not.toContain(past!.id);
  });

  it("reflects edits made after publishing", async () => {
    const tenant = await createTenant();
    const destination = await as(tenant, (scope) => createDestination(scope, { name: "Lankaran" }));
    const tour = await createPublishedTourFixture(tenant.tenantId, { title: "Tea Country", destinationId: destination.id });
    const get = () => withTenant(tenant.tenantId, (scope) => getPublishedTourBySlug(scope, "tea-country", today));

    expect(await get()).toMatchObject({ destinationName: "Lankaran", destinationSlug: "lankaran", priceAdult: 69_000 });
    await as(tenant, async (scope) => {
      await updateTour(scope, tour.id, { priceAdult: 75_000 });
      await updateDestination(scope, destination.id, { isPublished: false });
    });
    expect(await get()).toMatchObject({ destinationName: null, destinationSlug: null, priceAdult: 75_000 });
    expect(await withTenant(tenant.tenantId, (scope) => listPublishedDestinations(scope))).toEqual([]);
  });

  it("returns empty lists for a workspace with nothing published", async () => {
    const tenant = await createTenant();
    await createTourFixture(tenant.tenantId);
    const result = await withTenant(tenant.tenantId, async (scope) => ({
      tours: await listPublishedTours(scope),
      destinations: await listPublishedDestinations(scope),
      categories: await listCategoriesInUse(scope),
    }));
    expect(result).toEqual({ tours: { items: [], total: 0 }, destinations: [], categories: [] });
  });
});
