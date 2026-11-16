import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createJourneyEntry,
  deleteJourneyEntry,
  getJourneyEntry,
  getPublishedJourneyEntry,
  listJourneyEntries,
  listPublishedJourneyEntries,
  MAX_ENTRY_PHOTOS,
  setJourneyEntryMedia,
  setJourneyEntryPublished,
  updateJourneyEntry,
} from "@/server/content/journey";
import { withTenant } from "@/server/db/context";
import { journeyEntryMedia, mediaAssets } from "@/server/db/schema";
import { createTenant, randomId } from "../../helpers/fixtures";
import { asOwner, asVisitor, auditActions, failure, seedDestination, seedMedia, seedTour } from "./seed";

describe("journey entries: dashboard", () => {
  it("creates a draft with a slug derived from the title", async () => {
    const tenant = await createTenant();
    const entry = await asOwner(tenant)((scope) => createJourneyEntry(scope, { title: "Autumn in Şəki" }));

    expect(entry).toMatchObject({
      title: "Autumn in Şəki",
      slug: "autumn-in-s-ki",
      isPublished: false,
      location: "",
      visitedOn: null,
      category: "",
      teaser: "",
      description: "",
      highlights: [],
      destinationId: null,
      relatedTourId: null,
      coverMediaId: null,
      coverUrl: null,
      photos: [],
    });
    expect(await auditActions(tenant)).toContain("journey_entry.created");
  });

  it("keeps slugs unique per workspace by numbering repeats", async () => {
    const tenant = await createTenant();
    const slugs = await asOwner(tenant)(async (scope) => {
      const out: string[] = [];
      for (let i = 0; i < 3; i++) out.push((await createJourneyEntry(scope, { title: "Snow in Khinalug" })).slug);
      // Nothing usable in the title: a generic slug, still unique.
      out.push((await createJourneyEntry(scope, { title: "日本語の旅" })).slug);
      out.push((await createJourneyEntry(scope, { title: "山の旅行" })).slug);
      return out;
    });
    expect(slugs).toEqual(["snow-in-khinalug", "snow-in-khinalug-2", "snow-in-khinalug-3", "entry", "entry-2"]);
  });

  it("refuses an explicit slug that is taken, and keeps the transaction usable", async () => {
    const tenant = await createTenant();
    const outcome = await asOwner(tenant)(async (scope) => {
      await createJourneyEntry(scope, { title: "Tea harvest", slug: "Tea-Harvest" });
      const clash = await failure(() => createJourneyEntry(scope, { title: "Another", slug: "tea-harvest" }));
      const next = await createJourneyEntry(scope, { title: "Another" });
      return { clash, next };
    });
    expect(outcome.clash).toMatchObject({ name: "ConflictError", code: "conflict" });
    expect(outcome.next.slug).toBe("another");
  });

  it("stores description, highlights, links and an ordered photo set", async () => {
    const tenant = await createTenant();
    const destination = await seedDestination(tenant, { name: "Sheki" });
    const tour = await seedTour(tenant, { title: "Silk Road to Sheki" });
    const cover = await seedMedia(tenant);
    const photos = [await seedMedia(tenant), await seedMedia(tenant), await seedMedia(tenant, { resourceType: "video" })];

    const entry = await asOwner(tenant)((scope) =>
      createJourneyEntry(scope, {
        title: "Autumn in Sheki",
        destinationId: destination.id,
        location: "Sheki, Greater Caucasus",
        visitedOn: "2026-10-01",
        category: "Cultural",
        teaser: "Copper light on the caravanserai.",
        description: "We walked the old town.\n\nThen the palace.",
        highlights: ["Stained glass at the Khan's Palace", "Halva with the baker"],
        coverMediaId: cover.id,
        relatedTourId: tour.id,
        mediaIds: [photos[2]!.id, photos[0]!.id, photos[1]!.id],
        isPublished: true,
      }),
    );

    expect(entry).toMatchObject({
      destinationId: destination.id,
      location: "Sheki, Greater Caucasus",
      visitedOn: "2026-10-01",
      category: "Cultural",
      description: "We walked the old town.\n\nThen the palace.",
      highlights: ["Stained glass at the Khan's Palace", "Halva with the baker"],
      coverMediaId: cover.id,
      coverUrl: cover.url,
      relatedTourId: tour.id,
      isPublished: true,
    });
    expect(entry.photos.map((photo) => photo.id)).toEqual([photos[2]!.id, photos[0]!.id, photos[1]!.id]);
    expect(entry.photos[0]).toMatchObject({ resourceType: "video", url: photos[2]!.url, width: 1600, height: 1000 });
  });

  it("rejects bad input with field errors", async () => {
    const tenant = await createTenant();
    const media = await seedMedia(tenant);
    const run = (input: unknown) => failure(() => asOwner(tenant)((scope) => createJourneyEntry(scope, input as never)));

    expect(await run({ title: "ab" })).toMatchObject({ name: "ValidationError", fieldErrors: { title: ["Add a name (3+ characters)."] } });
    expect((await run({})).fieldErrors).toHaveProperty("title");
    expect((await run({ title: "Fine", slug: "Not a slug!" })).fieldErrors).toHaveProperty("slug");
    expect((await run({ title: "Fine", visitedOn: "October 2026" })).fieldErrors).toHaveProperty("visitedOn");
    expect((await run({ title: "Fine", highlights: Array.from({ length: 13 }, (_, i) => `Moment ${i}`) })).fieldErrors).toEqual({
      highlights: ["Keep to 12 highlights."],
    });
    expect((await run({ title: "Fine", highlights: ["ok", " "] })).fieldErrors).toHaveProperty("highlights.1");
    expect((await run({ title: "Fine", mediaIds: [media.id, media.id] })).fieldErrors).toEqual({ mediaIds: ["Each photo can be added once."] });
    expect((await run({ title: "Fine", mediaIds: Array.from({ length: MAX_ENTRY_PHOTOS + 1 }, () => randomId()) })).fieldErrors).toHaveProperty(
      "mediaIds",
    );
    expect((await run({ title: "Fine", description: "<p>Hello</p>" })).fieldErrors).toEqual({
      description: ["Plain text only: HTML tags are not allowed."],
    });
  });

  it("turns links to unknown records into field errors", async () => {
    const tenant = await createTenant();
    const run = (input: Parameters<typeof createJourneyEntry>[1]) => failure(() => asOwner(tenant)((scope) => createJourneyEntry(scope, input)));

    expect((await run({ title: "Fine", destinationId: randomId() })).fieldErrors).toEqual({ destinationId: ["Choose one of your destinations."] });
    expect((await run({ title: "Fine", relatedTourId: randomId() })).fieldErrors).toEqual({ relatedTourId: ["Choose one of your tours."] });
    expect((await run({ title: "Fine", coverMediaId: randomId() })).fieldErrors).toEqual({
      coverMediaId: ["Choose an image from your media library."],
    });
    expect((await run({ title: "Fine", mediaIds: [randomId()] })).fieldErrors).toEqual({ mediaIds: ["Choose photos from your media library."] });
    // A failed photo link rolls the whole entry back, not just the link.
    expect((await asOwner(tenant)((scope) => listJourneyEntries(scope))).total).toBe(0);
  });

  it("updates only the fields that were sent and replaces the photo set on request", async () => {
    const tenant = await createTenant();
    const [a, b, c] = [await seedMedia(tenant), await seedMedia(tenant), await seedMedia(tenant)];
    const created = await asOwner(tenant)((scope) =>
      createJourneyEntry(scope, { title: "Mud volcanoes at dawn", teaser: "Before the heat.", highlights: ["Sunrise"], mediaIds: [a.id, b.id] }),
    );

    const edited = await asOwner(tenant)((scope) => updateJourneyEntry(scope, created.id, { location: "Gobustan", highlights: ["Sunrise", "Petroglyphs"] }));
    expect(edited).toMatchObject({ title: "Mud volcanoes at dawn", teaser: "Before the heat.", location: "Gobustan", highlights: ["Sunrise", "Petroglyphs"] });
    expect(edited.photos.map((photo) => photo.id)).toEqual([a.id, b.id]);

    const reordered = await asOwner(tenant)((scope) => setJourneyEntryMedia(scope, created.id, [c.id, a.id]));
    expect(reordered.photos.map((photo) => photo.id)).toEqual([c.id, a.id]);
    expect(reordered.location).toBe("Gobustan");

    const emptied = await asOwner(tenant)((scope) => updateJourneyEntry(scope, created.id, { mediaIds: [], title: "Mud volcanoes" }));
    expect(emptied.photos).toEqual([]);
    expect(emptied.title).toBe("Mud volcanoes");
    // The slug is an address: it does not follow a title change by itself.
    expect(emptied.slug).toBe("mud-volcanoes-at-dawn");

    const untouched = await asOwner(tenant)((scope) => updateJourneyEntry(scope, created.id, {}));
    expect(untouched.title).toBe("Mud volcanoes");
    expect((await auditActions(tenant)).filter((action) => action === "journey_entry.updated")).toHaveLength(3);
  });

  it("refuses updates that clash or link unknown records", async () => {
    const tenant = await createTenant();
    const [first, second] = await asOwner(tenant)(async (scope) => [
      await createJourneyEntry(scope, { title: "First entry" }),
      await createJourneyEntry(scope, { title: "Second entry" }),
    ]);

    expect(await failure(() => asOwner(tenant)((scope) => updateJourneyEntry(scope, second!.id, { slug: first!.slug })))).toMatchObject({
      name: "ConflictError",
    });
    expect(await failure(() => asOwner(tenant)((scope) => updateJourneyEntry(scope, second!.id, { coverMediaId: randomId() })))).toMatchObject({
      name: "ValidationError",
      fieldErrors: { coverMediaId: ["Choose an image from your media library."] },
    });
    expect(await failure(() => asOwner(tenant)((scope) => setJourneyEntryMedia(scope, second!.id, [randomId()])))).toMatchObject({
      name: "ValidationError",
      fieldErrors: { mediaIds: ["Choose photos from your media library."] },
    });
    expect(await failure(() => asOwner(tenant)((scope) => updateJourneyEntry(scope, second!.id, { title: "x" })))).toMatchObject({
      name: "ValidationError",
    });
  });

  it("reports unknown entries as not found", async () => {
    const tenant = await createTenant();
    const missing = randomId();
    for (const call of [
      () => asOwner(tenant)((scope) => getJourneyEntry(scope, missing)),
      () => asOwner(tenant)((scope) => updateJourneyEntry(scope, missing, { title: "Renamed" })),
      () => asOwner(tenant)((scope) => setJourneyEntryMedia(scope, missing, [])),
      () => asOwner(tenant)((scope) => setJourneyEntryPublished(scope, missing, true)),
      () => asOwner(tenant)((scope) => deleteJourneyEntry(scope, missing)),
      // Ids that are not even UUIDs: not found, not a database error.
      () => asOwner(tenant)((scope) => getJourneyEntry(scope, "autumn-in-sheki")),
      () => asOwner(tenant)((scope) => updateJourneyEntry(scope, "42", { title: "Renamed" })),
      () => asOwner(tenant)((scope) => setJourneyEntryPublished(scope, "", true)),
      () => asOwner(tenant)((scope) => deleteJourneyEntry(scope, "' or 1=1 --")),
    ]) {
      expect(await failure(call)).toMatchObject({ name: "NotFoundError", code: "not_found" });
    }
  });

  it("publishes, unpublishes and deletes, leaving the media library intact", async () => {
    const tenant = await createTenant();
    const photo = await seedMedia(tenant);
    const created = await asOwner(tenant)((scope) => createJourneyEntry(scope, { title: "Caspian sunset sail", mediaIds: [photo.id] }));

    expect((await asOwner(tenant)((scope) => setJourneyEntryPublished(scope, created.id, true))).isPublished).toBe(true);
    expect((await asOwner(tenant)((scope) => setJourneyEntryPublished(scope, created.id, false))).isPublished).toBe(false);

    await asOwner(tenant)((scope) => deleteJourneyEntry(scope, created.id));
    const left = await withTenant(tenant.tenantId, async ({ tx }) => ({
      links: await tx.select().from(journeyEntryMedia).where(eq(journeyEntryMedia.entryId, created.id)),
      media: await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, photo.id)),
    }));
    expect(left).toEqual({ links: [], media: [{ id: photo.id }] });
    expect(await auditActions(tenant)).toEqual(
      expect.arrayContaining(["journey_entry.published", "journey_entry.unpublished", "journey_entry.deleted"]),
    );
  });

  it("lists drafts and published entries with filters, search and paging", async () => {
    const tenant = await createTenant();
    const baku = await seedDestination(tenant, { name: "Baku" });
    await asOwner(tenant)(async (scope) => {
      await createJourneyEntry(scope, { title: "Novruz in Icherisheher", destinationId: baku.id, visitedOn: "2026-03-01", isPublished: true });
      await createJourneyEntry(scope, { title: "Yanar Dag by night", location: "Absheron", visitedOn: "2026-08-01" });
      await createJourneyEntry(scope, { title: "Undated notes" });
    });
    const list = (input: Parameters<typeof listJourneyEntries>[1]) => asOwner(tenant)((scope) => listJourneyEntries(scope, input));

    const all = await list({});
    expect(all.total).toBe(3);
    // Most recent visit first; undated entries last.
    expect(all.items.map((entry) => entry.title)).toEqual(["Yanar Dag by night", "Novruz in Icherisheher", "Undated notes"]);

    expect((await list({ published: true })).items.map((entry) => entry.title)).toEqual(["Novruz in Icherisheher"]);
    expect((await list({ published: false })).total).toBe(2);
    expect((await list({ destinationId: baku.id })).items.map((entry) => entry.title)).toEqual(["Novruz in Icherisheher"]);
    expect((await list({ search: "absheron" })).items.map((entry) => entry.title)).toEqual(["Yanar Dag by night"]);
    expect((await list({ search: "NOVRUZ" })).total).toBe(1);
    expect((await list({ search: "_" })).total).toBe(0);

    const page = await list({ limit: 1, offset: 2 });
    expect(page.items.map((entry) => entry.title)).toEqual(["Undated notes"]);
    expect(page.total).toBe(3);
    expect(await failure(() => list({ offset: -1 }))).toMatchObject({ name: "ValidationError" });
  });
});

describe("journey entries: storefront", () => {
  async function seeded() {
    const tenant = await createTenant();
    const sheki = await seedDestination(tenant, { name: "Sheki" });
    const hiddenPlace = await seedDestination(tenant, { name: "Hidden Valley", isPublished: false });
    const tour = await seedTour(tenant, { title: "Silk Road to Sheki" });
    const draftTour = await seedTour(tenant, { title: "Unannounced Tour", status: "draft" });
    const cover = await seedMedia(tenant, { alt: "Caravanserai courtyard" });
    const video = await seedMedia(tenant, { resourceType: "video" });
    const photo = await seedMedia(tenant);

    const entries = await asOwner(tenant)(async (scope) => ({
      sheki: await createJourneyEntry(scope, {
        title: "Autumn in Sheki",
        destinationId: sheki.id,
        category: "Cultural",
        visitedOn: "2026-10-01",
        coverMediaId: cover.id,
        relatedTourId: tour.id,
        mediaIds: [photo.id, video.id],
        highlights: ["Halva with the baker"],
        description: "Copper light.",
        isPublished: true,
      }),
      hidden: await createJourneyEntry(scope, {
        title: "Valley notes",
        destinationId: hiddenPlace.id,
        relatedTourId: draftTour.id,
        category: "Adventure",
        visitedOn: "2026-11-01",
        isPublished: true,
      }),
      undated: await createJourneyEntry(scope, { title: "Undated memory", category: "Cultural", isPublished: true }),
      draft: await createJourneyEntry(scope, { title: "Still writing", destinationId: sheki.id, category: "Cultural", visitedOn: "2026-12-01" }),
    }));
    return { tenant, sheki, hiddenPlace, tour, cover, video, photo, entries };
  }

  it("returns published entries only, most recent visit first", async () => {
    const { tenant, sheki, tour, cover, photo, video } = await seeded();
    const result = await asVisitor(tenant)((scope) => listPublishedJourneyEntries(scope));

    expect(result.total).toBe(3);
    expect(result.items.map((entry) => entry.title)).toEqual(["Valley notes", "Autumn in Sheki", "Undated memory"]);

    expect(result.items[1]).toEqual({
      id: expect.any(String),
      slug: "autumn-in-sheki",
      title: "Autumn in Sheki",
      location: "",
      visitedOn: "2026-10-01",
      category: "Cultural",
      teaser: "",
      description: "Copper light.",
      highlights: ["Halva with the baker"],
      destination: { id: sheki.id, slug: sheki.slug, name: "Sheki" },
      cover: { url: cover.url, alt: "Caravanserai courtyard", width: 1600, height: 1000 },
      relatedTour: { id: tour.id, slug: tour.slug, title: "Silk Road to Sheki" },
      photos: [
        { id: photo.id, url: photo.url, alt: "", resourceType: "image", width: 1600, height: 1000 },
        { id: video.id, url: video.url, alt: "", resourceType: "video", width: 1600, height: 1000 },
      ],
      hasVideo: true,
    });
    expect(result.items[2]).toMatchObject({ destination: null, cover: null, relatedTour: null, photos: [], hasVideo: false });
  });

  it("never exposes drafts, unpublished destinations or unpublished tours", async () => {
    const { tenant } = await seeded();
    const result = await asVisitor(tenant)((scope) => listPublishedJourneyEntries(scope));
    const text = JSON.stringify(result);

    expect(text).not.toContain("Still writing");
    expect(text).not.toContain("Hidden Valley");
    expect(text).not.toContain("Unannounced Tour");
    expect(result.items[0]).toMatchObject({ title: "Valley notes", destination: null, relatedTour: null });
  });

  it("filters by destination and category, and pages", async () => {
    const { tenant, sheki } = await seeded();
    const list = (input: Parameters<typeof listPublishedJourneyEntries>[1]) => asVisitor(tenant)((scope) => listPublishedJourneyEntries(scope, input));

    // The draft in Sheki is not counted.
    const inSheki = await list({ destinationId: sheki.id });
    expect(inSheki.items.map((entry) => entry.title)).toEqual(["Autumn in Sheki"]);
    expect(inSheki.total).toBe(1);

    expect((await list({ category: "Cultural" })).items.map((entry) => entry.title)).toEqual(["Autumn in Sheki", "Undated memory"]);
    expect((await list({ category: "Family" })).items).toEqual([]);
    expect((await list({ destinationId: randomId() })).total).toBe(0);

    const page = await list({ limit: 1, offset: 1 });
    expect(page.items.map((entry) => entry.title)).toEqual(["Autumn in Sheki"]);
    expect(page.total).toBe(3);

    expect(await failure(() => list({ limit: 61 }))).toMatchObject({ name: "ValidationError" });
    expect(await failure(() => list({ destinationId: "nope" }))).toMatchObject({ name: "ValidationError" });
  });

  it("serves one published entry by slug and hides drafts behind the same not-found", async () => {
    const { tenant, entries } = await seeded();

    const entry = await asVisitor(tenant)((scope) => getPublishedJourneyEntry(scope, " Autumn-In-Sheki "));
    expect(entry).toMatchObject({ id: entries.sheki.id, title: "Autumn in Sheki", hasVideo: true });
    expect(entry.photos).toHaveLength(2);

    expect(await failure(() => asVisitor(tenant)((scope) => getPublishedJourneyEntry(scope, entries.draft.slug)))).toMatchObject({
      name: "NotFoundError",
    });
    expect(await failure(() => asVisitor(tenant)((scope) => getPublishedJourneyEntry(scope, "no-such-entry")))).toMatchObject({
      name: "NotFoundError",
    });

    await asOwner(tenant)((scope) => setJourneyEntryPublished(scope, entries.draft.id, true));
    expect((await asVisitor(tenant)((scope) => getPublishedJourneyEntry(scope, entries.draft.slug))).title).toBe("Still writing");
  });
});
