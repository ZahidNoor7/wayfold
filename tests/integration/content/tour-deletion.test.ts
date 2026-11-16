import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { getInquiry, submitInquiry } from "@/server/content/inquiries";
import { createJourneyEntry, getJourneyEntry, getPublishedJourneyEntry } from "@/server/content/journey";
import { createReview, getReview, listPublishedReviews } from "@/server/content/reviews";
import { withTenant } from "@/server/db/context";
import { tours } from "@/server/db/schema";
import { createTenant } from "../../helpers/fixtures";
import { asOwner, asVisitor, seedTour } from "./seed";

// Delivery belongs to the notifications module and plays no part here.
vi.mock("@/server/notifications", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

describe("content that mentions a tour", () => {
  it("survives the tour's deletion with only the link cleared", async () => {
    const tenant = await createTenant();
    const tour = await seedTour(tenant, { title: "Silk Road to Sheki" });
    const kept = await seedTour(tenant, { title: "Old City Walk" });

    const review = await asOwner(tenant)((scope) =>
      createReview(scope, { customerName: "Eleanor Whitfield", rating: 5, body: "A wonderful two weeks with Leyla.", tourId: tour.id }),
    );
    const otherReview = await asOwner(tenant)((scope) =>
      createReview(scope, { customerName: "Daniel Okafor", rating: 4, body: "Baku through a historian's eyes.", tourId: kept.id }),
    );
    const entry = await asOwner(tenant)((scope) => createJourneyEntry(scope, { title: "Autumn in Sheki", relatedTourId: tour.id, isPublished: true }));
    const inquiry = await asVisitor(tenant)((scope) =>
      submitInquiry(scope, { name: "Amira Hassan", email: "amira@example.com", message: "Is this tour suitable for children?", tourId: tour.id }),
    );

    // Deleting the tour is not blocked by the content that points at it.
    const deleted = await withTenant(tenant.tenantId, (scope) =>
      scope.tx
        .delete(tours)
        .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.id, tour.id)))
        .returning({ id: tours.id }),
    );
    expect(deleted).toEqual([{ id: tour.id }]);

    // Each record is still there, intact, with its tour link gone.
    expect(await asOwner(tenant)((scope) => getReview(scope, review.id))).toMatchObject({
      id: review.id,
      customerName: "Eleanor Whitfield",
      rating: 5,
      body: "A wonderful two weeks with Leyla.",
      isPublished: true,
      tour: null,
    });
    expect(await asOwner(tenant)((scope) => getJourneyEntry(scope, entry.id))).toMatchObject({
      id: entry.id,
      title: "Autumn in Sheki",
      slug: "autumn-in-sheki",
      isPublished: true,
      relatedTourId: null,
    });
    expect(await asOwner(tenant)((scope) => getInquiry(scope, inquiry.id))).toMatchObject({
      id: inquiry.id,
      name: "Amira Hassan",
      email: "amira@example.com",
      message: "Is this tour suitable for children?",
      status: "new",
      tour: null,
    });

    // The storefront keeps showing them, without a dangling tour.
    const publicReviews = await asVisitor(tenant)((scope) => listPublishedReviews(scope, { sort: "highest" }));
    expect(publicReviews.items.map((item) => [item.id, item.tour?.id ?? null])).toEqual([
      [review.id, null],
      [otherReview.id, kept.id],
    ]);
    expect((await asVisitor(tenant)((scope) => getPublishedJourneyEntry(scope, entry.slug))).relatedTour).toBeNull();

    // A link to a different tour is untouched.
    expect((await asOwner(tenant)((scope) => getReview(scope, otherReview.id))).tour).toEqual({ id: kept.id, title: "Old City Walk" });
  });
});
