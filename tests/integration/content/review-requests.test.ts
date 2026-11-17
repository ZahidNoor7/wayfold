import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeBooking } from "@/server/bookings/service";
import {
  CUSTOMER_REVIEW_MEDIA_MAX,
  CUSTOMER_UPLOADS_FOLDER,
  createCustomerUploadSignature,
  finalizeCustomerUpload,
  getReviewRequestStatus,
  hashReviewToken,
  issueReviewLink,
  openReviewLink,
  reviewPath,
  sendReviewRequest,
  submitCustomerReview,
} from "@/server/content/review-requests";
import { getReview } from "@/server/content/reviews";
import { withTenant, type TenantScope } from "@/server/db/context";
import { auditLogs, bookingEvents, mediaFolders, notificationOutbox, reviewRequests, tenantDomains, tenants } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { createMediaFixture, createTourFixture } from "../../helpers/catalog";
import { createTenant, unique, type TenantFixture } from "../../helpers/fixtures";
import { seedBooking } from "../catalog/support";
import { connectCloudinary, FakeCloudinary, newAccount } from "../media/helpers";

vi.mock("@/server/platform/managed-storage", () => ({ getManagedStorage: vi.fn(async () => null) }));

const DAY = 86_400_000;
const NOW = new Date("2031-05-01T10:00:00Z");

/** A staff member's scope. */
const staff = <T>(t: TenantFixture, fn: (scope: TenantScope) => Promise<T>) => withTenant(t.tenantId, fn, { userId: t.ownerId });
/** The storefront's scope: the tenant from the host, nobody signed in. */
const visitor = <T>(t: TenantFixture, fn: (scope: TenantScope) => Promise<T>) => withTenant(t.tenantId, fn);

async function completedBooking(status: "completed" | "confirmed" | "pending" = "completed") {
  const tenant = await createTenant();
  const tour = await createTourFixture(tenant.tenantId, { title: "Silk Road to Sheki" });
  const booking = await seedBooking(tenant, { tourId: tour.id, status, startDate: "2031-04-09" });
  return { tenant, tour, booking };
}

/** The token at the end of an issued link. */
const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

async function openLink() {
  const setup = await completedBooking();
  const link = await staff(setup.tenant, (scope) => issueReviewLink(scope, setup.booking.id, NOW));
  return { ...setup, link, token: tokenOf(link.url) };
}

const review = { customerName: "Anna K.", country: "Germany", rating: 5, title: "Unforgettable", body: "The palace windows in Sheki were breathtaking, and our guide was superb." };

function outbox(t: TenantFixture, kind: string) {
  return staff(t, ({ tx }) => tx.select().from(notificationOutbox).where(and(eq(notificationOutbox.tenantId, t.tenantId), eq(notificationOutbox.kind, kind))));
}

function auditOf(t: TenantFixture) {
  return staff(t, async ({ tx }) => (await tx.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.tenantId, t.tenantId))).map((row) => row.action));
}

describe("review links for staff", () => {
  it("issues a link on the business's site that works for 60 days", async () => {
    const { tenant, booking } = await completedBooking();
    const link = await staff(tenant, (scope) => issueReviewLink(scope, booking.id, NOW));

    expect(link.url).toMatch(new RegExp(`^https://${tenant.slug}\\.wayfold\\.test/review/[A-Za-z0-9_-]{43}$`));
    expect(link.expiresAt.getTime()).toBe(NOW.getTime() + 60 * DAY);
    expect(reviewPath("abc")).toBe("/review/abc");

    // Only the hash is stored.
    const [row] = await staff(tenant, ({ tx }) => tx.select().from(reviewRequests).where(eq(reviewRequests.bookingId, booking.id)));
    expect(row!.tokenHash).toBe(hashReviewToken(tokenOf(link.url)));
    expect(row!.tokenHash).not.toContain(tokenOf(link.url));

    expect(await staff(tenant, (scope) => getReviewRequestStatus(scope, booking.id, NOW))).toEqual({
      state: "open",
      expiresAt: link.expiresAt,
      usedAt: null,
      reviewId: null,
    });
    expect(await auditOf(tenant)).toContain("review_request.issued");
  });

  it("prefers the business's verified domain for the link", async () => {
    const { tenant, booking } = await completedBooking();
    const domain = `${unique("tours")}.example.com`;
    await withPlatform((tx) => tx.insert(tenantDomains).values({ tenantId: tenant.tenantId, domain, status: "verified", verificationToken: unique("token"), verifiedAt: NOW, isPrimary: true }));
    const link = await staff(tenant, (scope) => issueReviewLink(scope, booking.id, NOW));
    expect(link.url.startsWith(`https://${domain}/review/`)).toBe(true);
  });

  it("replaces the earlier link when a new one is issued", async () => {
    const { tenant, booking, token } = await openLink();
    const renewed = await staff(tenant, (scope) => issueReviewLink(scope, booking.id, NOW));
    expect(tokenOf(renewed.url)).not.toBe(token);

    expect(await visitor(tenant, (scope) => openReviewLink(scope, token, NOW))).toEqual({ state: "invalid" });
    expect((await visitor(tenant, (scope) => openReviewLink(scope, tokenOf(renewed.url), NOW))).state).toBe("open");
    expect(await auditOf(tenant)).toContain("review_request.renewed");
  });

  it("only exists for completed bookings of this workspace", async () => {
    for (const status of ["confirmed", "pending"] as const) {
      const { tenant, booking } = await completedBooking(status);
      await expect(staff(tenant, (scope) => issueReviewLink(scope, booking.id, NOW))).rejects.toMatchObject({ code: "booking_not_completed" });
    }
    const { booking } = await completedBooking();
    const other = await createTenant();
    await expect(staff(other, (scope) => issueReviewLink(scope, booking.id, NOW))).rejects.toBeInstanceOf(NotFoundError);
    await expect(staff(other, (scope) => getReviewRequestStatus(scope, "not-a-uuid", NOW))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reports no link, then an expired one", async () => {
    const { tenant, booking } = await completedBooking();
    expect((await staff(tenant, (scope) => getReviewRequestStatus(scope, booking.id, NOW))).state).toBe("none");
    await staff(tenant, (scope) => issueReviewLink(scope, booking.id, NOW));
    expect((await staff(tenant, (scope) => getReviewRequestStatus(scope, booking.id, new Date(NOW.getTime() + 61 * DAY)))).state).toBe("expired");
  });

  it("e-mails the link to the customer", async () => {
    const { tenant, booking } = await completedBooking();
    const link = await staff(tenant, (scope) => sendReviewRequest(scope, booking.id, NOW));
    const [mail] = await outbox(tenant, "review.requested");
    expect(mail).toMatchObject({ toEmail: "guest@example.test", relatedType: "booking", relatedId: booking.id, subject: "How was Seeded?" });
    expect(mail!.bodyText).toContain(link.url);
    expect(mail!.bodyText).toContain("works until");
  });

  it("is sent when a booking is completed, unless the business opts out", async () => {
    const asked = await completedBooking("confirmed");
    await staff(asked.tenant, (scope) => completeBooking(scope, asked.booking.id, { now: NOW }));
    expect(await outbox(asked.tenant, "review.requested")).toHaveLength(1);
    const events = await staff(asked.tenant, ({ tx }) => tx.select({ message: bookingEvents.message }).from(bookingEvents).where(eq(bookingEvents.bookingId, asked.booking.id)));
    expect(events.map((event) => event.message)).toContain("Review link e-mailed to the customer.");

    const quiet = await completedBooking("confirmed");
    await staff(quiet.tenant, (scope) => completeBooking(scope, quiet.booking.id, { now: NOW, requestReview: false }));
    expect(await outbox(quiet.tenant, "review.requested")).toHaveLength(0);
    expect((await staff(quiet.tenant, (scope) => getReviewRequestStatus(scope, quiet.booking.id, NOW))).state).toBe("none");
  });
});

describe("the customer's review page", () => {
  it("shows the booking's details for an open link", async () => {
    const { tenant, token, link } = await openLink();
    expect(await visitor(tenant, (scope) => openReviewLink(scope, token, NOW))).toEqual({
      state: "open",
      customerName: "Guest",
      country: "",
      tourTitle: "Seeded",
      startDate: "2031-04-09",
      expiresAt: link.expiresAt,
      canUpload: false,
    });
  });

  it("does not open for malformed, unknown, other businesses' or expired links", async () => {
    const { tenant, token } = await openLink();
    const other = await createTenant();
    expect(await visitor(tenant, (scope) => openReviewLink(scope, "short", NOW))).toEqual({ state: "invalid" });
    expect(await visitor(tenant, (scope) => openReviewLink(scope, "x".repeat(43), NOW))).toEqual({ state: "invalid" });
    expect(await visitor(other, (scope) => openReviewLink(scope, token, NOW))).toEqual({ state: "invalid" });
    expect(await visitor(tenant, (scope) => openReviewLink(scope, token, new Date(NOW.getTime() + 61 * DAY)))).toEqual({ state: "expired" });
    await expect(visitor(tenant, (scope) => submitCustomerReview(scope, token, review, new Date(NOW.getTime() + 61 * DAY)))).rejects.toMatchObject({
      code: "review_link_expired",
    });
    await expect(visitor(other, (scope) => submitCustomerReview(scope, token, review, NOW))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("saves a verified, unpublished review for the booking's tour and spends the link", async () => {
    const { tenant, tour, booking, token } = await openLink();
    await withPlatform((tx) => tx.update(tenants).set({ email: "owner@business.example" }).where(eq(tenants.id, tenant.tenantId)));

    const saved = await visitor(tenant, (scope) => submitCustomerReview(scope, token, review, NOW));
    expect(saved).toMatchObject({
      customerName: "Anna K.",
      country: "Germany",
      rating: 5,
      title: "Unforgettable",
      isVerified: true,
      isPublished: false,
      isFeatured: false,
      reviewedOn: "2031-05-01",
      tour: { id: tour.id },
    });

    const status = await staff(tenant, (scope) => getReviewRequestStatus(scope, booking.id, NOW));
    expect(status).toMatchObject({ state: "used", reviewId: saved.id });
    expect(await visitor(tenant, (scope) => openReviewLink(scope, token, NOW))).toEqual({ state: "used" });
    await expect(visitor(tenant, (scope) => submitCustomerReview(scope, token, review, NOW))).rejects.toMatchObject({ code: "review_already_written" });
    await expect(staff(tenant, (scope) => issueReviewLink(scope, booking.id, NOW))).rejects.toBeInstanceOf(ConflictError);

    const [alert] = await outbox(tenant, "review.staff_alert");
    expect(alert).toMatchObject({ toEmail: "owner@business.example", relatedType: "review", relatedId: saved.id, subject: "New 5-star review from Anna K." });
    expect(alert!.bodyText).toContain("https://app.wayfold.test/workspace/reviews");
    expect(await auditOf(tenant)).toContain("review.submitted_by_customer");
  });

  it("sends no alert when the business has no e-mail address", async () => {
    const { tenant, token } = await openLink();
    await withPlatform((tx) => tx.update(tenants).set({ email: "" }).where(eq(tenants.id, tenant.tenantId)));
    await visitor(tenant, (scope) => submitCustomerReview(scope, token, { customerName: "Ali", rating: 4, body: "Good tour, friendly guide, long drive." }, NOW));
    expect(await outbox(tenant, "review.staff_alert")).toHaveLength(0);
  });

  it("checks what the customer wrote", async () => {
    const { tenant, token } = await openLink();
    const attempt = (input: Partial<typeof review> & { mediaIds?: string[] }) =>
      visitor(tenant, (scope) => submitCustomerReview(scope, token, { ...review, ...input } as typeof review, NOW)).catch((error: unknown) => error);

    const tooShort = await attempt({ body: "Nice." });
    expect(tooShort).toBeInstanceOf(ValidationError);
    expect((tooShort as ValidationError).fieldErrors?.body?.[0]).toMatch(/at least 20 characters/);
    expect(((await attempt({ rating: 0 })) as ValidationError).fieldErrors?.rating).toBeDefined();
    expect(((await attempt({ customerName: "A" })) as ValidationError).fieldErrors?.customerName).toBeDefined();

    // A library file the customer did not upload through this link cannot be attached.
    const libraryPhoto = await createMediaFixture(tenant.tenantId);
    const foreign = await attempt({ mediaIds: [libraryPhoto.id] });
    expect((foreign as ValidationError).fieldErrors?.mediaIds).toEqual(["Upload your photos and videos on this page."]);

    // Nothing was spent by the failed attempts.
    expect((await visitor(tenant, (scope) => openReviewLink(scope, token, NOW))).state).toBe("open");
  });
});

describe("customer photos and videos", () => {
  let cloud: FakeCloudinary;
  beforeEach(() => {
    cloud = new FakeCloudinary().install();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const jpeg = { resourceType: "image" as const, filename: "sheki.jpg", bytes: 200_000, contentType: "image/jpeg" };

  async function connected() {
    const setup = await openLink();
    cloud.addAccount(await connectCloudinary(setup.tenant, newAccount()));
    return setup;
  }

  async function uploadAs(tenant: TenantFixture, token: string, file = jpeg) {
    const signature = await visitor(tenant, (scope) => createCustomerUploadSignature(scope, token, file, NOW));
    const response = cloud.browserUpload(signature, { format: signature.fields.allowed_formats, bytes: file.bytes });
    if (response.status !== 200) throw new Error(await response.text());
    return visitor(tenant, (scope) => finalizeCustomerUpload(scope, token, { publicId: signature.publicId, resourceType: signature.resourceType, filename: file.filename }, NOW));
  }

  it("uploads into a library folder and attaches the files to the review", async () => {
    const { tenant, token } = await connected();
    expect((await visitor(tenant, (scope) => openReviewLink(scope, token, NOW))) as { canUpload: boolean }).toMatchObject({ canUpload: true });

    const first = await uploadAs(tenant, token);
    const second = await uploadAs(tenant, token, { resourceType: "image", filename: "palace.png", bytes: 100_000, contentType: "image/png" });
    expect(first.resourceType).toBe("image");

    const folders = await staff(tenant, ({ tx }) => tx.select().from(mediaFolders).where(eq(mediaFolders.name, CUSTOMER_UPLOADS_FOLDER)));
    expect(folders).toHaveLength(1);

    const saved = await visitor(tenant, (scope) => submitCustomerReview(scope, token, { ...review, mediaIds: [second.id, first.id] }, NOW));
    const stored = await staff(tenant, (scope) => getReview(scope, saved.id));
    expect(stored.media.map((item) => item.id)).toEqual([second.id, first.id]);

    // The link is spent: no more uploads through it.
    await expect(visitor(tenant, (scope) => createCustomerUploadSignature(scope, token, jpeg, NOW))).rejects.toMatchObject({ code: "review_already_written" });
  });

  it("caps files and upload attempts per link", async () => {
    const { tenant, token } = await connected();
    for (let index = 0; index < CUSTOMER_REVIEW_MEDIA_MAX; index += 1) await uploadAs(tenant, token);
    await expect(visitor(tenant, (scope) => createCustomerUploadSignature(scope, token, jpeg, NOW))).rejects.toBeInstanceOf(ValidationError);

    const fresh = await connected();
    // Signatures that never become uploads still count.
    for (let index = 0; index < 12; index += 1) await visitor(fresh.tenant, (scope) => createCustomerUploadSignature(scope, fresh.token, jpeg, NOW));
    await expect(visitor(fresh.tenant, (scope) => createCustomerUploadSignature(scope, fresh.token, jpeg, NOW))).rejects.toThrow(/most uploads this link allows/);
  });

  it("refuses to finalise beyond the file limit, and repeats are harmless", async () => {
    const { tenant, token } = await connected();
    const first = await uploadAs(tenant, token);
    const signature = await visitor(tenant, (scope) => createCustomerUploadSignature(scope, token, jpeg, NOW));
    cloud.browserUpload(signature, { format: "jpg", bytes: jpeg.bytes });
    const again = { publicId: signature.publicId, resourceType: "image" as const };
    const once = await visitor(tenant, (scope) => finalizeCustomerUpload(scope, token, again, NOW));
    const twice = await visitor(tenant, (scope) => finalizeCustomerUpload(scope, token, again, NOW));
    expect(twice.id).toBe(once.id);
    const [row] = await staff(tenant, ({ tx }) => tx.select().from(reviewRequests).where(eq(reviewRequests.tokenHash, hashReviewToken(token))));
    expect(row!.uploadedMediaIds).toEqual([first.id, once.id]);

    await staff(tenant, ({ tx }) =>
      tx
        .update(reviewRequests)
        .set({ uploadedMediaIds: Array.from({ length: CUSTOMER_REVIEW_MEDIA_MAX }, () => first.id) })
        .where(eq(reviewRequests.tokenHash, hashReviewToken(token))),
    );
    await expect(visitor(tenant, (scope) => finalizeCustomerUpload(scope, token, again, NOW))).rejects.toBeInstanceOf(ValidationError);
  });

  it("reuses the customer folder when it already exists", async () => {
    const { tenant, token } = await connected();
    await staff(tenant, ({ tx }) => tx.insert(mediaFolders).values({ tenantId: tenant.tenantId, name: CUSTOMER_UPLOADS_FOLDER }));
    await uploadAs(tenant, token);
    const folders = await staff(tenant, ({ tx }) => tx.select().from(mediaFolders).where(eq(mediaFolders.name, CUSTOMER_UPLOADS_FOLDER)));
    expect(folders).toHaveLength(1);
  });
});
