import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createReview, deleteReview, getReview, listFeaturedReviews, listPublishedReviews, listReviews, REVIEW_MEDIA_MAX, updateReview } from "@/server/content/reviews";
import { withTenant } from "@/server/db/context";
import { mediaAssets, reviewMedia } from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/server/errors";
import { createMediaFixture } from "../../helpers/catalog";
import { createTenant, randomId, type TenantFixture } from "../../helpers/fixtures";

const as = <T>(tenant: TenantFixture, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(tenant.tenantId, fn, { userId: tenant.ownerId });
const base = { customerName: "Hannah W.", rating: 5, body: "A wonderful day out with a great guide." };

describe("review photos and videos", () => {
  it("attaches media in order, replaces it, and clears it", async () => {
    const tenant = await createTenant();
    const photo = await createMediaFixture(tenant.tenantId);
    const video = await createMediaFixture(tenant.tenantId, { resourceType: "video", format: "mp4", url: "https://media.example.test/clip.mp4" });
    const second = await createMediaFixture(tenant.tenantId);

    const created = await as(tenant, (scope) => createReview(scope, { ...base, mediaIds: [video.id, photo.id] }));
    expect(created.media.map((item) => [item.id, item.resourceType])).toEqual([
      [video.id, "video"],
      [photo.id, "image"],
    ]);

    const reordered = await as(tenant, (scope) => updateReview(scope, created.id, { mediaIds: [second.id, photo.id] }));
    expect(reordered.media.map((item) => item.id)).toEqual([second.id, photo.id]);
    // Other fields are untouched by a media-only change.
    expect(reordered.body).toBe(base.body);

    const listed = await as(tenant, (scope) => listReviews(scope));
    expect(listed.items[0]!.media.map((item) => item.id)).toEqual([second.id, photo.id]);

    const cleared = await as(tenant, (scope) => updateReview(scope, created.id, { mediaIds: [] }));
    expect(cleared.media).toEqual([]);

    // Editing text alone leaves attachments alone.
    await as(tenant, (scope) => updateReview(scope, created.id, { mediaIds: [photo.id] }));
    const retitled = await as(tenant, (scope) => updateReview(scope, created.id, { title: "Lovely" }));
    expect(retitled.media.map((item) => item.id)).toEqual([photo.id]);
  });

  it("shows attachments on the storefront only for published reviews", async () => {
    const tenant = await createTenant();
    const photo = await createMediaFixture(tenant.tenantId, { alt: "Guests at the Maiden Tower" });
    await as(tenant, (scope) => createReview(scope, { ...base, mediaIds: [photo.id], isFeatured: true }));
    await as(tenant, (scope) => createReview(scope, { ...base, customerName: "Hidden H.", mediaIds: [photo.id], isPublished: false }));

    const page = await as(tenant, (scope) => listPublishedReviews(scope));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.media).toEqual([{ id: photo.id, url: photo.url, alt: "Guests at the Maiden Tower", resourceType: "image", width: null, height: null }]);
    const featured = await as(tenant, (scope) => listFeaturedReviews(scope));
    expect(featured[0]!.media).toHaveLength(1);
  });

  it("validates the list: unknown files, duplicates and the limit", async () => {
    const tenant = await createTenant();
    const photo = await createMediaFixture(tenant.tenantId);
    const error = (run: () => Promise<unknown>) => run().then(() => null, (thrown: unknown) => thrown);

    const unknown = await error(() => as(tenant, (scope) => createReview(scope, { ...base, mediaIds: [randomId()] })));
    expect(unknown).toBeInstanceOf(ValidationError);
    expect((unknown as ValidationError).fieldErrors?.mediaIds).toBeDefined();

    expect(await error(() => as(tenant, (scope) => createReview(scope, { ...base, mediaIds: [photo.id, photo.id] })))).toBeInstanceOf(ValidationError);
    const many = Array.from({ length: REVIEW_MEDIA_MAX + 1 }, () => randomId());
    expect(await error(() => as(tenant, (scope) => createReview(scope, { ...base, mediaIds: many })))).toBeInstanceOf(ValidationError);
  });

  it("drops attachments when the review or the file is deleted", async () => {
    const tenant = await createTenant();
    const photo = await createMediaFixture(tenant.tenantId);
    const keep = await createMediaFixture(tenant.tenantId);
    const review = await as(tenant, (scope) => createReview(scope, { ...base, mediaIds: [photo.id, keep.id] }));

    await as(tenant, ({ tx }) => tx.delete(mediaAssets).where(eq(mediaAssets.id, photo.id)));
    expect((await as(tenant, (scope) => getReview(scope, review.id))).media.map((item) => item.id)).toEqual([keep.id]);

    await as(tenant, (scope) => deleteReview(scope, review.id));
    expect(await as(tenant, ({ tx }) => tx.select().from(reviewMedia).where(eq(reviewMedia.reviewId, review.id)))).toEqual([]);
  });
});

describe("review media isolation", () => {
  it("never attaches, shows or changes another business's files or reviews", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const aPhoto = await createMediaFixture(a.tenantId);
    const aReview = await as(a, (scope) => createReview(scope, { ...base, mediaIds: [aPhoto.id] }));

    // B cannot attach A's file to its own review...
    const attach = await as(b, (scope) => createReview(scope, { ...base, mediaIds: [aPhoto.id] })).then(() => null, (thrown: unknown) => thrown);
    expect(attach).toBeInstanceOf(ValidationError);
    // ...nor change the attachments of A's review.
    const bPhoto = await createMediaFixture(b.tenantId);
    const change = await as(b, (scope) => updateReview(scope, aReview.id, { mediaIds: [bPhoto.id] })).then(() => null, (thrown: unknown) => thrown);
    expect(change).toBeInstanceOf(NotFoundError);

    // B's storefront and dashboard never see A's attachments.
    expect((await as(b, (scope) => listReviews(scope))).items.flatMap((review) => review.media)).toEqual([]);
    expect((await as(b, (scope) => listPublishedReviews(scope))).items).toEqual([]);
    // A's review still has exactly its own file.
    expect((await as(a, (scope) => getReview(scope, aReview.id))).media.map((item) => item.id)).toEqual([aPhoto.id]);
    // And the table itself is row-level secured.
    expect(await as(b, ({ tx }) => tx.select().from(reviewMedia))).toEqual([]);
  });
});
