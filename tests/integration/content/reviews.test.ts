import { describe, expect, it } from "vitest";
import {
  createReview,
  deleteReview,
  getReview,
  getReviewSummary,
  listFeaturedReviews,
  listPublishedReviews,
  listReviews,
  setReviewFeatured,
  setReviewPublished,
  updateReview,
} from "@/server/content/reviews";
import { todayIn } from "@/lib/dates";
import { createTenant, randomId } from "../../helpers/fixtures";
import { asOwner, asVisitor, auditActions, failure, seedMedia, seedTour } from "./seed";

const base = { customerName: "Eleanor Whitfield", rating: 5, body: "Leyla turned a holiday into two meaningful weeks." };

describe("reviews: dashboard", () => {
  it("creates a review with the design's defaults and links it to a tour and an avatar", async () => {
    const tenant = await createTenant();
    const tour = await seedTour(tenant, { title: "Silk Road to Sheki" });
    const avatar = await seedMedia(tenant);

    const review = await asOwner(tenant)((scope) =>
      createReview(scope, { ...base, country: "United Kingdom", title: "Like coming home", tourId: tour.id, avatarMediaId: avatar.id }),
    );

    expect(review).toMatchObject({
      customerName: "Eleanor Whitfield",
      country: "United Kingdom",
      rating: 5,
      title: "Like coming home",
      isPublished: true,
      isFeatured: false,
      isVerified: false,
      tour: { id: tour.id, title: "Silk Road to Sheki" },
      avatar: { id: avatar.id, url: avatar.url },
    });
    // The column default is the database's current date.
    expect([todayIn("UTC"), todayIn("Pacific/Kiritimati"), todayIn("Pacific/Pago_Pago")]).toContain(review.reviewedOn);
    expect(await auditActions(tenant)).toContain("review.created");
  });

  it("stores an explicit date, flags and trims whitespace", async () => {
    const tenant = await createTenant();
    const review = await asOwner(tenant)((scope) =>
      createReview(scope, {
        customerName: "  Daniel   Okafor ",
        rating: 4,
        body: "  First line.\r\nSecond line.  ",
        reviewedOn: "2026-09-18",
        isVerified: true,
        isFeatured: true,
        isPublished: false,
      }),
    );
    expect(review).toMatchObject({
      customerName: "Daniel Okafor",
      body: "First line.\nSecond line.",
      reviewedOn: "2026-09-18",
      isVerified: true,
      isFeatured: true,
      isPublished: false,
      tour: null,
      avatar: null,
    });
  });

  it("rejects bad input with field errors", async () => {
    const tenant = await createTenant();
    const run = (input: unknown) => failure(() => asOwner(tenant)((scope) => createReview(scope, input as never)));

    expect(await run({ ...base, customerName: "E" })).toMatchObject({
      name: "ValidationError",
      fieldErrors: { customerName: ["Add the customer's name."] },
    });
    expect((await run({ ...base, body: "Too short" })).fieldErrors).toEqual({ body: ["Add the review text (10+ characters)."] });
    for (const rating of [0, 6, 2.5, "5"]) {
      expect((await run({ ...base, rating })).fieldErrors, String(rating)).toHaveProperty("rating");
    }
    expect((await run({ ...base, reviewedOn: "18/09/2026" })).fieldErrors).toHaveProperty("reviewedOn");
    expect((await run({ ...base, reviewedOn: "2026-02-30" })).fieldErrors).toHaveProperty("reviewedOn");
    expect((await run({ ...base, tourId: "not-a-uuid" })).fieldErrors).toHaveProperty("tourId");
    expect((await run({ ...base, title: "x".repeat(161) })).fieldErrors).toHaveProperty("title");
    expect((await run({ rating: 5 })).fieldErrors).toHaveProperty("customerName");
  });

  it("stores plain text only: markup is refused, not saved", async () => {
    const tenant = await createTenant();
    const result = await failure(() =>
      asOwner(tenant)((scope) => createReview(scope, { ...base, body: "Lovely trip <script>alert(1)</script> indeed" })),
    );
    expect(result.fieldErrors).toEqual({ body: ["Plain text only: HTML tags are not allowed."] });

    // Angle brackets that are not tags are ordinary text.
    const review = await asOwner(tenant)((scope) => createReview(scope, { ...base, body: "Rated it 5 < 6 and loved it <3" }));
    expect(review.body).toBe("Rated it 5 < 6 and loved it <3");
  });

  it("turns a link to an unknown tour or image into a field error and keeps the transaction usable", async () => {
    const tenant = await createTenant();
    const outcome = await asOwner(tenant)(async (scope) => {
      const badTour = await failure(() => createReview(scope, { ...base, tourId: randomId() }));
      const badAvatar = await failure(() => createReview(scope, { ...base, avatarMediaId: randomId() }));
      // The failed inserts ran in savepoints, so this still works.
      const ok = await createReview(scope, base);
      return { badTour, badAvatar, ok };
    });

    expect(outcome.badTour).toMatchObject({ name: "ValidationError", fieldErrors: { tourId: ["Choose one of your tours."] } });
    expect(outcome.badAvatar.fieldErrors).toEqual({ avatarMediaId: ["Choose an image from your media library."] });
    expect((await asOwner(tenant)((scope) => listReviews(scope))).total).toBe(1);
  });

  it("updates only the fields that were sent", async () => {
    const tenant = await createTenant();
    const tour = await seedTour(tenant);
    const created = await asOwner(tenant)((scope) => createReview(scope, { ...base, country: "Canada", tourId: tour.id, isFeatured: true }));

    const updated = await asOwner(tenant)((scope) => updateReview(scope, created.id, { rating: 4, title: "Edited" }));
    expect(updated).toMatchObject({ rating: 4, title: "Edited", country: "Canada", isFeatured: true, isPublished: true, tour: { id: tour.id } });

    const cleared = await asOwner(tenant)((scope) => updateReview(scope, created.id, { tourId: null, country: "" }));
    expect(cleared).toMatchObject({ tour: null, country: "", rating: 4 });

    const untouched = await asOwner(tenant)((scope) => updateReview(scope, created.id, {}));
    expect(untouched).toMatchObject({ rating: 4, title: "Edited" });
    expect((await auditActions(tenant)).filter((action) => action === "review.updated")).toHaveLength(2);
  });

  it("refuses an update that links an unknown tour, and reports unknown reviews as not found", async () => {
    const tenant = await createTenant();
    const created = await asOwner(tenant)((scope) => createReview(scope, base));

    expect(await failure(() => asOwner(tenant)((scope) => updateReview(scope, created.id, { tourId: randomId() })))).toMatchObject({
      name: "ValidationError",
      fieldErrors: { tourId: ["Choose one of your tours."] },
    });
    expect(await failure(() => asOwner(tenant)((scope) => updateReview(scope, created.id, { rating: 9 })))).toMatchObject({
      name: "ValidationError",
    });

    // An id that is not even a UUID is "not found" too, not a database error.
    for (const id of ["42", "", "../etc/passwd", "' or 1=1 --"]) {
      expect(await failure(() => asOwner(tenant)((scope) => getReview(scope, id))), id).toMatchObject({ name: "NotFoundError" });
      expect(await failure(() => asOwner(tenant)((scope) => setReviewPublished(scope, id, true))), id).toMatchObject({ name: "NotFoundError" });
      expect(await failure(() => asOwner(tenant)((scope) => deleteReview(scope, id))), id).toMatchObject({ name: "NotFoundError" });
    }

    const missing = randomId();
    for (const call of [
      () => asOwner(tenant)((scope) => getReview(scope, missing)),
      () => asOwner(tenant)((scope) => updateReview(scope, missing, { rating: 3 })),
      () => asOwner(tenant)((scope) => updateReview(scope, missing, {})),
      () => asOwner(tenant)((scope) => setReviewPublished(scope, missing, false)),
      () => asOwner(tenant)((scope) => setReviewFeatured(scope, missing, true)),
      () => asOwner(tenant)((scope) => deleteReview(scope, missing)),
    ]) {
      expect(await failure(call)).toMatchObject({ name: "NotFoundError", code: "not_found" });
    }
  });

  it("publishes, hides, features and deletes", async () => {
    const tenant = await createTenant();
    const created = await asOwner(tenant)((scope) => createReview(scope, base));

    expect((await asOwner(tenant)((scope) => setReviewPublished(scope, created.id, false))).isPublished).toBe(false);
    expect((await asOwner(tenant)((scope) => setReviewPublished(scope, created.id, true))).isPublished).toBe(true);
    expect((await asOwner(tenant)((scope) => setReviewFeatured(scope, created.id, true))).isFeatured).toBe(true);
    expect((await asOwner(tenant)((scope) => setReviewFeatured(scope, created.id, false))).isFeatured).toBe(false);

    await asOwner(tenant)((scope) => deleteReview(scope, created.id));
    expect(await failure(() => asOwner(tenant)((scope) => getReview(scope, created.id)))).toMatchObject({ name: "NotFoundError" });

    expect(await auditActions(tenant)).toEqual(
      expect.arrayContaining(["review.hidden", "review.published", "review.featured", "review.unfeatured", "review.deleted"]),
    );
  });

  it("lists with filters, search and paging", async () => {
    const tenant = await createTenant();
    const tour = await seedTour(tenant);
    await asOwner(tenant)(async (scope) => {
      await createReview(scope, { ...base, customerName: "Amira Hassan", rating: 5, tourId: tour.id, reviewedOn: "2026-05-01", isFeatured: true });
      await createReview(scope, { ...base, customerName: "Björn Dahl", rating: 4, reviewedOn: "2026-06-01", isPublished: false });
      await createReview(scope, { ...base, customerName: "Chen Wei", rating: 4, title: "100% worth it", reviewedOn: "2026-07-01" });
    });
    const list = (input: Parameters<typeof listReviews>[1]) => asOwner(tenant)((scope) => listReviews(scope, input));

    const all = await list({});
    expect(all.total).toBe(3);
    expect(all.items.map((review) => review.customerName)).toEqual(["Chen Wei", "Björn Dahl", "Amira Hassan"]);

    expect((await list({ published: false })).items.map((review) => review.customerName)).toEqual(["Björn Dahl"]);
    expect((await list({ published: true })).total).toBe(2);
    expect((await list({ featured: true })).items.map((review) => review.customerName)).toEqual(["Amira Hassan"]);
    expect((await list({ rating: 4 })).total).toBe(2);
    expect((await list({ tourId: tour.id })).items.map((review) => review.customerName)).toEqual(["Amira Hassan"]);
    expect((await list({ search: "chen" })).items.map((review) => review.customerName)).toEqual(["Chen Wei"]);
    // `%` is matched literally, not as a wildcard.
    expect((await list({ search: "100%" })).total).toBe(1);
    expect((await list({ search: "%" })).total).toBe(1);

    const page = await list({ limit: 1, offset: 1 });
    expect(page.items.map((review) => review.customerName)).toEqual(["Björn Dahl"]);
    expect(page.total).toBe(3);

    expect(await failure(() => list({ limit: 0 }))).toMatchObject({ name: "ValidationError" });
    expect(await failure(() => list({ limit: 101 }))).toMatchObject({ name: "ValidationError" });
  });
});

describe("reviews: storefront", () => {
  async function seeded() {
    const tenant = await createTenant();
    const published = await seedTour(tenant, { title: "Old City Walk" });
    const draft = await seedTour(tenant, { title: "Secret Draft Tour", status: "draft" });
    const avatar = await seedMedia(tenant);
    await asOwner(tenant)(async (scope) => {
      await createReview(scope, { ...base, customerName: "Five A", rating: 5, reviewedOn: "2026-01-10", tourId: published.id, avatarMediaId: avatar.id, isFeatured: true });
      await createReview(scope, { ...base, customerName: "Five B", rating: 5, reviewedOn: "2026-03-10", tourId: draft.id });
      await createReview(scope, { ...base, customerName: "Four", rating: 4, reviewedOn: "2026-02-10", isVerified: true });
      await createReview(scope, { ...base, customerName: "Two", rating: 2, reviewedOn: "2026-04-10" });
      await createReview(scope, { ...base, customerName: "Hidden one-star", rating: 1, reviewedOn: "2026-05-10", isPublished: false, isFeatured: true });
    });
    return { tenant, published, draft, avatar };
  }

  it("returns published reviews only, newest first by default", async () => {
    const { tenant, published, avatar } = await seeded();
    const result = await asVisitor(tenant)((scope) => listPublishedReviews(scope));

    expect(result.total).toBe(4);
    expect(result.items.map((review) => review.customerName)).toEqual(["Two", "Five B", "Four", "Five A"]);
    expect(result.items.map((review) => review.customerName)).not.toContain("Hidden one-star");

    const fiveA = result.items.find((review) => review.customerName === "Five A")!;
    expect(fiveA).toEqual({
      id: expect.any(String),
      customerName: "Five A",
      country: "",
      rating: 5,
      title: "",
      body: base.body,
      reviewedOn: "2026-01-10",
      isVerified: false,
      isFeatured: true,
      tour: { id: published.id, slug: published.slug, title: "Old City Walk" },
      avatarUrl: avatar.url,
      media: [],
    });
    expect(result.items.find((review) => review.customerName === "Four")).toMatchObject({ isVerified: true, tour: null, avatarUrl: null });
  });

  it("never exposes an unpublished tour through a review", async () => {
    const { tenant } = await seeded();
    const result = await asVisitor(tenant)((scope) => listPublishedReviews(scope));
    expect(result.items.find((review) => review.customerName === "Five B")!.tour).toBeNull();
    expect(JSON.stringify(result)).not.toContain("Secret Draft Tour");
  });

  it("sorts by rating with newest first inside a rating", async () => {
    const { tenant } = await seeded();
    const names = async (sort: "newest" | "highest" | "lowest") =>
      (await asVisitor(tenant)((scope) => listPublishedReviews(scope, { sort }))).items.map((review) => review.customerName);

    expect(await names("highest")).toEqual(["Five B", "Five A", "Four", "Two"]);
    expect(await names("lowest")).toEqual(["Two", "Four", "Five B", "Five A"]);
    expect(await names("newest")).toEqual(["Two", "Five B", "Four", "Five A"]);
  });

  it("filters by rating and tour, and pages", async () => {
    const { tenant, published, draft } = await seeded();
    const list = (input: Parameters<typeof listPublishedReviews>[1]) => asVisitor(tenant)((scope) => listPublishedReviews(scope, input));

    const fives = await list({ rating: 5 });
    expect(fives.total).toBe(2);
    expect((await list({ rating: 3 })).items).toEqual([]);
    // The hidden one-star review stays hidden even when asked for by rating.
    expect((await list({ rating: 1 })).total).toBe(0);

    expect((await list({ tourId: published.id })).items.map((review) => review.customerName)).toEqual(["Five A"]);
    expect((await list({ tourId: draft.id })).items.map((review) => review.customerName)).toEqual(["Five B"]);

    const second = await list({ limit: 2, offset: 2 });
    expect(second.items.map((review) => review.customerName)).toEqual(["Four", "Five A"]);
    expect(second.total).toBe(4);

    expect(await failure(() => list({ sort: "random" as never }))).toMatchObject({ name: "ValidationError" });
    expect(await failure(() => list({ rating: 7 }))).toMatchObject({ name: "ValidationError" });
    expect(await failure(() => list({ limit: 51 }))).toMatchObject({ name: "ValidationError" });
  });

  it("summarises published reviews: one-decimal average, total and distribution", async () => {
    const { tenant } = await seeded();
    const summary = await asVisitor(tenant)((scope) => getReviewSummary(scope));
    // (5 + 5 + 4 + 2) / 4 = 4.0; the hidden one-star review is not counted.
    expect(summary).toEqual({ average: 4, total: 4, distribution: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 2 } });

    await asOwner(tenant)((scope) => createReview(scope, { ...base, rating: 5 }));
    await asOwner(tenant)((scope) => createReview(scope, { ...base, rating: 5 }));
    // 26 / 6 = 4.33…
    expect((await asVisitor(tenant)((scope) => getReviewSummary(scope))).average).toBe(4.3);
  });

  it("summarises an empty workspace as zeros", async () => {
    const tenant = await createTenant();
    expect(await asVisitor(tenant)((scope) => getReviewSummary(scope))).toEqual({
      average: 0,
      total: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
    expect(await asVisitor(tenant)((scope) => listPublishedReviews(scope))).toEqual({ items: [], total: 0 });
  });

  it("lists featured testimonials that are also published", async () => {
    const { tenant } = await seeded();
    const featured = await asVisitor(tenant)((scope) => listFeaturedReviews(scope));
    expect(featured.map((review) => review.customerName)).toEqual(["Five A"]);

    await asOwner(tenant)(async (scope) => {
      const all = await listReviews(scope, { rating: 4 });
      await setReviewFeatured(scope, all.items[0]!.id, true);
    });
    expect((await asVisitor(tenant)((scope) => listFeaturedReviews(scope))).map((review) => review.customerName)).toEqual(["Four", "Five A"]);
    expect(await asVisitor(tenant)((scope) => listFeaturedReviews(scope, 1))).toHaveLength(1);
    expect(await failure(() => asVisitor(tenant)((scope) => listFeaturedReviews(scope, 0)))).toMatchObject({ name: "ValidationError" });
  });
});
