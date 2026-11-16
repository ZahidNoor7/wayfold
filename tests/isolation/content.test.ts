import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  archiveInquiry,
  countInquiriesByStatus,
  countNewInquiries,
  deleteInquiry,
  getInquiry,
  listInquiries,
  markInquiryRead,
  submitInquiry,
} from "@/server/content/inquiries";
import {
  createJourneyEntry,
  deleteJourneyEntry,
  getJourneyEntry,
  getPublishedJourneyEntry,
  listJourneyEntries,
  listPublishedJourneyEntries,
  setJourneyEntryMedia,
  setJourneyEntryPublished,
  updateJourneyEntry,
} from "@/server/content/journey";
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
import { withTenant } from "@/server/db/context";
import { inquiries, journeyEntries, journeyEntryMedia, reviews, tenants } from "@/server/db/schema";
import { enqueueNotification } from "@/server/notifications";
import { createTenant, type TenantFixture } from "../helpers/fixtures";
import { asOwner, asVisitor, failure, seedDestination, seedMedia, seedTour } from "../integration/content/seed";

// Delivery belongs to the notifications module; only the hand-off matters here.
vi.mock("@/server/notifications", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

const reviewInput = { customerName: "Eleanor Whitfield", rating: 5, body: "A wonderful two weeks with Leyla.", isFeatured: true };
const inquiryInput = { name: "Daniel Okafor", email: "daniel@example.com", message: "We are four adults visiting in May." };

const NOT_FOUND = { name: "NotFoundError", code: "not_found" };

/** Workspace A with one of everything, and an empty workspace B. */
async function twoWorkspaces() {
  const a = await createTenant({ name: "Workspace A" });
  const b = await createTenant({ name: "Workspace B" });
  const tour = await seedTour(a, { title: "A's Silk Road" });
  const media = await seedMedia(a);
  const destination = await seedDestination(a, { name: "A's Sheki" });
  const review = await asOwner(a)((scope) => createReview(scope, { ...reviewInput, tourId: tour.id, avatarMediaId: media.id }));
  const entry = await asOwner(a)((scope) =>
    createJourneyEntry(scope, {
      title: "A's autumn journal",
      destinationId: destination.id,
      relatedTourId: tour.id,
      coverMediaId: media.id,
      mediaIds: [media.id],
      category: "Cultural",
      isPublished: true,
    }),
  );
  const inquiry = await asVisitor(a)((scope) => submitInquiry(scope, { ...inquiryInput, tourId: tour.id }));
  return { a, b, tour, media, destination, review, entry, inquiry };
}

async function unchanged(a: TenantFixture, ids: { review: string; entry: string; inquiry: string }) {
  return withTenant(a.tenantId, async ({ tx }) => ({
    review: (await tx.select().from(reviews).where(eq(reviews.id, ids.review)))[0],
    entry: (await tx.select().from(journeyEntries).where(eq(journeyEntries.id, ids.entry)))[0],
    photos: await tx.select({ mediaId: journeyEntryMedia.mediaId }).from(journeyEntryMedia).where(eq(journeyEntryMedia.entryId, ids.entry)),
    inquiry: (await tx.select().from(inquiries).where(eq(inquiries.id, ids.inquiry)))[0],
  }));
}

describe("tenant isolation: reviews", () => {
  it("B cannot read, list, update, publish, feature or delete A's review", async () => {
    const { a, b, review, entry, inquiry } = await twoWorkspaces();
    const before = await unchanged(a, { review: review.id, entry: entry.id, inquiry: inquiry.id });

    for (const call of [
      () => asOwner(b)((scope) => getReview(scope, review.id)),
      () => asOwner(b)((scope) => updateReview(scope, review.id, { title: "Defaced", rating: 1 })),
      () => asOwner(b)((scope) => setReviewPublished(scope, review.id, false)),
      () => asOwner(b)((scope) => setReviewFeatured(scope, review.id, false)),
      () => asOwner(b)((scope) => deleteReview(scope, review.id)),
    ]) {
      expect(await failure(call)).toMatchObject(NOT_FOUND);
    }

    expect(await asOwner(b)((scope) => listReviews(scope))).toEqual({ items: [], total: 0 });
    expect(await asOwner(b)((scope) => listReviews(scope, { search: "Eleanor" }))).toEqual({ items: [], total: 0 });
    expect((await unchanged(a, { review: review.id, entry: entry.id, inquiry: inquiry.id })).review).toEqual(before.review);
  });

  it("B cannot link A's tour or A's media to its own review", async () => {
    const { b, tour, media } = await twoWorkspaces();
    const own = await asOwner(b)((scope) => createReview(scope, reviewInput));

    expect(await failure(() => asOwner(b)((scope) => createReview(scope, { ...reviewInput, tourId: tour.id })))).toMatchObject({
      name: "ValidationError",
      fieldErrors: { tourId: ["Choose one of your tours."] },
    });
    expect(await failure(() => asOwner(b)((scope) => createReview(scope, { ...reviewInput, avatarMediaId: media.id })))).toMatchObject({
      name: "ValidationError",
      fieldErrors: { avatarMediaId: ["Choose an image from your media library."] },
    });
    expect(await failure(() => asOwner(b)((scope) => updateReview(scope, own.id, { tourId: tour.id })))).toMatchObject({ name: "ValidationError" });
    expect(await failure(() => asOwner(b)((scope) => updateReview(scope, own.id, { avatarMediaId: media.id })))).toMatchObject({
      name: "ValidationError",
    });

    expect(await asOwner(b)((scope) => getReview(scope, own.id))).toMatchObject({ tour: null, avatar: null });
    expect((await asOwner(b)((scope) => listReviews(scope))).total).toBe(1);
  });

  it("a tenant id smuggled into the payload is ignored", async () => {
    const { a, b } = await twoWorkspaces();
    const created = await asOwner(b)((scope) => createReview(scope, { ...reviewInput, tenantId: a.tenantId, createdBy: a.ownerId } as never));

    expect((await asOwner(b)((scope) => listReviews(scope))).items.map((review) => review.id)).toEqual([created.id]);
    expect((await asOwner(a)((scope) => listReviews(scope))).items.map((review) => review.id)).not.toContain(created.id);
  });

  it("public queries return neither another tenant's reviews nor unpublished ones", async () => {
    const { a, b, tour, review } = await twoWorkspaces();
    await asOwner(a)((scope) => createReview(scope, { ...reviewInput, customerName: "Hidden Guest", rating: 1, isPublished: false }));

    // B's storefront: nothing of A's, by any route.
    expect(await asVisitor(b)((scope) => listPublishedReviews(scope))).toEqual({ items: [], total: 0 });
    expect(await asVisitor(b)((scope) => listPublishedReviews(scope, { tourId: tour.id }))).toEqual({ items: [], total: 0 });
    expect(await asVisitor(b)((scope) => listPublishedReviews(scope, { rating: 5 }))).toEqual({ items: [], total: 0 });
    expect(await asVisitor(b)((scope) => listFeaturedReviews(scope))).toEqual([]);
    expect(await asVisitor(b)((scope) => getReviewSummary(scope))).toEqual({ average: 0, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });

    // A's storefront: the published review only.
    const ownList = await asVisitor(a)((scope) => listPublishedReviews(scope));
    expect(ownList.items.map((item) => item.id)).toEqual([review.id]);
    expect(await asVisitor(a)((scope) => getReviewSummary(scope))).toMatchObject({ average: 5, total: 1 });
    expect((await asVisitor(a)((scope) => listFeaturedReviews(scope))).map((item) => item.id)).toEqual([review.id]);
  });

  it("the database itself refuses a cross-tenant link, whatever the service does", async () => {
    const { b, tour, media } = await twoWorkspaces();
    const code = (run: () => Promise<unknown>) =>
      run().then(
        () => undefined,
        (error: { code?: string; cause?: { code?: string } }) => error.code ?? error.cause?.code,
      );

    expect(
      await code(() => withTenant(b.tenantId, ({ tx }) => tx.insert(reviews).values({ customerName: "X", rating: 5, body: "Planted link.", tourId: tour.id }))),
    ).toBe("23503");
    expect(
      await code(() =>
        withTenant(b.tenantId, ({ tx }) => tx.insert(journeyEntries).values({ title: "Planted", slug: "planted", coverMediaId: media.id })),
      ),
    ).toBe("23503");
    expect(await code(() => withTenant(b.tenantId, ({ tx }) => tx.insert(inquiries).values({ name: "X", email: "x@example.com", message: "Planted link.", tourId: tour.id })))).toBe(
      "23503",
    );
  });
});

describe("tenant isolation: journey entries", () => {
  it("B cannot read, list, update, publish, re-photo or delete A's entry", async () => {
    const { a, b, review, entry, inquiry } = await twoWorkspaces();
    const ownMedia = await seedMedia(b);
    const before = await unchanged(a, { review: review.id, entry: entry.id, inquiry: inquiry.id });

    for (const call of [
      () => asOwner(b)((scope) => getJourneyEntry(scope, entry.id)),
      () => asOwner(b)((scope) => updateJourneyEntry(scope, entry.id, { title: "Defaced entry" })),
      () => asOwner(b)((scope) => updateJourneyEntry(scope, entry.id, {})),
      () => asOwner(b)((scope) => setJourneyEntryMedia(scope, entry.id, [ownMedia.id])),
      () => asOwner(b)((scope) => setJourneyEntryMedia(scope, entry.id, [])),
      () => asOwner(b)((scope) => setJourneyEntryPublished(scope, entry.id, false)),
      () => asOwner(b)((scope) => deleteJourneyEntry(scope, entry.id)),
    ]) {
      expect(await failure(call)).toMatchObject(NOT_FOUND);
    }

    expect(await asOwner(b)((scope) => listJourneyEntries(scope))).toEqual({ items: [], total: 0 });
    expect(await asOwner(b)((scope) => listJourneyEntries(scope, { search: "autumn" }))).toEqual({ items: [], total: 0 });

    const after = await unchanged(a, { review: review.id, entry: entry.id, inquiry: inquiry.id });
    expect(after.entry).toEqual(before.entry);
    expect(after.photos).toEqual(before.photos);
  });

  it("B cannot link A's destination, tour, cover or photos to its own entry", async () => {
    const { b, tour, media, destination } = await twoWorkspaces();
    const own = await asOwner(b)((scope) => createJourneyEntry(scope, { title: "B's own entry" }));

    const attempts: [Parameters<typeof updateJourneyEntry>[2], string][] = [
      [{ destinationId: destination.id }, "destinationId"],
      [{ relatedTourId: tour.id }, "relatedTourId"],
      [{ coverMediaId: media.id }, "coverMediaId"],
      [{ mediaIds: [media.id] }, "mediaIds"],
    ];
    for (const [links, field] of attempts) {
      const created = await failure(() => asOwner(b)((scope) => createJourneyEntry(scope, { title: "Borrowed", ...links })));
      expect(created, field).toMatchObject({ name: "ValidationError" });
      expect(created.fieldErrors).toHaveProperty(field);

      const updated = await failure(() => asOwner(b)((scope) => updateJourneyEntry(scope, own.id, links)));
      expect(updated, field).toMatchObject({ name: "ValidationError" });
      expect(updated.fieldErrors).toHaveProperty(field);
    }

    expect(await asOwner(b)((scope) => getJourneyEntry(scope, own.id))).toMatchObject({
      destinationId: null,
      relatedTourId: null,
      coverMediaId: null,
      photos: [],
    });
    expect((await asOwner(b)((scope) => listJourneyEntries(scope))).total).toBe(1);
  });

  it("slugs are unique per workspace, not globally", async () => {
    const { a, b, entry } = await twoWorkspaces();
    const twin = await asOwner(b)((scope) => createJourneyEntry(scope, { title: "A's autumn journal", isPublished: true }));
    expect(twin.slug).toBe(entry.slug);

    // The same slug resolves to each workspace's own entry.
    expect((await asVisitor(a)((scope) => getPublishedJourneyEntry(scope, entry.slug))).id).toBe(entry.id);
    expect((await asVisitor(b)((scope) => getPublishedJourneyEntry(scope, entry.slug))).id).toBe(twin.id);
  });

  it("public queries return neither another tenant's entries nor drafts", async () => {
    const { a, b, destination, entry } = await twoWorkspaces();
    const draft = await asOwner(a)((scope) => createJourneyEntry(scope, { title: "A's unfinished draft", destinationId: destination.id, category: "Cultural" }));

    expect(await asVisitor(b)((scope) => listPublishedJourneyEntries(scope))).toEqual({ items: [], total: 0 });
    expect(await asVisitor(b)((scope) => listPublishedJourneyEntries(scope, { destinationId: destination.id }))).toEqual({ items: [], total: 0 });
    expect(await asVisitor(b)((scope) => listPublishedJourneyEntries(scope, { category: "Cultural" }))).toEqual({ items: [], total: 0 });
    for (const slug of [entry.slug, draft.slug]) {
      expect(await failure(() => asVisitor(b)((scope) => getPublishedJourneyEntry(scope, slug)))).toMatchObject(NOT_FOUND);
    }

    const ownList = await asVisitor(a)((scope) => listPublishedJourneyEntries(scope, { destinationId: destination.id }));
    expect(ownList.items.map((item) => item.id)).toEqual([entry.id]);
    expect(ownList.total).toBe(1);
    expect(await failure(() => asVisitor(a)((scope) => getPublishedJourneyEntry(scope, draft.slug)))).toMatchObject(NOT_FOUND);
  });
});

describe("tenant isolation: inquiries", () => {
  it("B cannot read, list, mark, archive or delete A's inquiry", async () => {
    const { a, b, review, entry, inquiry } = await twoWorkspaces();

    for (const call of [
      () => asOwner(b)((scope) => getInquiry(scope, inquiry.id)),
      () => asOwner(b)((scope) => markInquiryRead(scope, inquiry.id)),
      () => asOwner(b)((scope) => archiveInquiry(scope, inquiry.id)),
      () => asOwner(b)((scope) => deleteInquiry(scope, inquiry.id)),
    ]) {
      expect(await failure(call)).toMatchObject(NOT_FOUND);
    }

    expect(await asOwner(b)((scope) => listInquiries(scope))).toEqual({ items: [], total: 0 });
    expect(await asOwner(b)((scope) => listInquiries(scope, { status: "new" }))).toEqual({ items: [], total: 0 });
    expect(await asOwner(b)((scope) => countNewInquiries(scope))).toBe(0);
    expect(await asOwner(b)((scope) => countInquiriesByStatus(scope))).toEqual({ new: 0, read: 0, archived: 0 });

    const after = await unchanged(a, { review: review.id, entry: entry.id, inquiry: inquiry.id });
    expect(after.inquiry).toMatchObject({ id: inquiry.id, status: "new", email: "daniel@example.com" });
    expect(await asOwner(a)((scope) => countNewInquiries(scope))).toBe(1);
    expect(await asOwner(a)((scope) => countInquiriesByStatus(scope))).toEqual({ new: 1, read: 0, archived: 0 });
  });

  it("B's contact form cannot reference A's tour, and its inquiries stay in B", async () => {
    const { a, b, tour } = await twoWorkspaces();

    expect(await failure(() => asVisitor(b)((scope) => submitInquiry(scope, { ...inquiryInput, tourId: tour.id })))).toMatchObject({
      name: "ValidationError",
      fieldErrors: { tourId: ["Choose one of the listed tours."] },
    });

    vi.mocked(enqueueNotification).mockClear();
    const { id } = await asVisitor(b)((scope) => submitInquiry(scope, { ...inquiryInput, tenantId: a.tenantId } as never));
    expect((await asOwner(b)((scope) => listInquiries(scope))).items.map((item) => item.id)).toEqual([id]);
    expect((await asOwner(a)((scope) => listInquiries(scope))).items.map((item) => item.id)).not.toContain(id);
    // B has no contact address, and A's must never be used in its place.
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it("an inquiry alert goes to the workspace it was sent to, with that workspace's scope", async () => {
    const { a, b } = await twoWorkspaces();
    await withTenant(a.tenantId, ({ tx }) => tx.update(tenants).set({ email: "a@example.test" }).where(eq(tenants.id, a.tenantId)));
    await withTenant(b.tenantId, ({ tx }) => tx.update(tenants).set({ email: "b@example.test" }).where(eq(tenants.id, b.tenantId)));

    vi.mocked(enqueueNotification).mockClear();
    await asVisitor(b)((scope) => submitInquiry(scope, inquiryInput));

    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    const [scope, notification] = vi.mocked(enqueueNotification).mock.calls[0]!;
    expect(scope.tenantId).toBe(b.tenantId);
    expect(notification.toEmail).toBe("b@example.test");
    expect(notification.bodyText).toContain("Workspace B website");
  });
});
