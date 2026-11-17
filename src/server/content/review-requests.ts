import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { todayIn } from "../../lib/dates";
import { recordAudit } from "../audit";
import type { TenantScope } from "../db/context";
import { bookings, mediaFolders, reviewRequests, tenants } from "../db/schema";
import { env } from "../env";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { IntegrationNotConfiguredError } from "../integrations";
import { selectStorage } from "../media/storage";
import { createUploadSignature, finalizeUpload, uploadRequestSchema, type UploadSignature } from "../media/service";
import { enqueueNotification } from "../notifications";
import { renderNotification } from "../notifications/templates";
import { publicSiteOrigin } from "../tenancy/public-origin";
import { createReview, type ReviewView } from "./reviews";
import { parseInput, plainText } from "./shared";

/** How long a review link works after it is issued. */
export const REVIEW_LINK_DAYS = 60;
/** Most photos and videos a customer can add to their review. */
export const CUSTOMER_REVIEW_MEDIA_MAX = 6;
/** Upload attempts per link, including abandoned ones; stops one link filling the business's storage. */
export const CUSTOMER_UPLOAD_ATTEMPTS_MAX = 12;
/** Library folder that collects files customers upload with their reviews. */
export const CUSTOMER_UPLOADS_FOLDER = "Customer reviews";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this is stored, so a database leak does not leak working links. */
export function hashReviewToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function reviewPath(token: string): string {
  return `/review/${token}`;
}

type RequestRow = typeof reviewRequests.$inferSelect;

/* ------------------------------------------------------------ dashboard */

export type ReviewRequestState = "none" | "open" | "expired" | "used";

export interface ReviewRequestStatus {
  state: ReviewRequestState;
  expiresAt: Date | null;
  usedAt: Date | null;
  reviewId: string | null;
}

function stateOf(row: RequestRow | undefined, now: Date): ReviewRequestState {
  if (!row) return "none";
  if (row.usedAt) return "used";
  return row.expiresAt <= now ? "expired" : "open";
}

async function completedBooking(scope: TenantScope, bookingId: string) {
  const parsed = z.uuid().safeParse(bookingId);
  if (!parsed.success) throw new NotFoundError("Booking");
  const [booking] = await scope.tx
    .select({
      id: bookings.id,
      status: bookings.status,
      reference: bookings.reference,
      contactName: bookings.contactName,
      contactEmail: bookings.contactEmail,
      tourTitle: bookings.tourTitle,
      startDate: bookings.startDate,
    })
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.id, parsed.data)))
    .limit(1);
  if (!booking) throw new NotFoundError("Booking");
  return booking;
}

async function requestForBooking(scope: TenantScope, bookingId: string, lock = false): Promise<RequestRow | undefined> {
  const query = scope.tx
    .select()
    .from(reviewRequests)
    .where(and(eq(reviewRequests.tenantId, scope.tenantId), eq(reviewRequests.bookingId, bookingId)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row;
}

/** Where the review link of a booking stands, for the booking page. */
export async function getReviewRequestStatus(scope: TenantScope, bookingId: string, now = new Date()): Promise<ReviewRequestStatus> {
  const booking = await completedBooking(scope, bookingId);
  const row = await requestForBooking(scope, booking.id);
  return { state: stateOf(row, now), expiresAt: row?.expiresAt ?? null, usedAt: row?.usedAt ?? null, reviewId: row?.reviewId ?? null };
}

export interface IssuedReviewLink {
  url: string;
  expiresAt: Date;
}

/**
 * Creates the review link of a completed booking, or replaces it with a new
 * one (the old link stops working). Refused once the customer has reviewed.
 */
export async function issueReviewLink(scope: TenantScope, bookingId: string, now = new Date()): Promise<IssuedReviewLink> {
  const booking = await completedBooking(scope, bookingId);
  if (booking.status !== "completed") {
    throw new ConflictError("A review link can be sent once the tour is marked completed.", "booking_not_completed");
  }
  const existing = await requestForBooking(scope, booking.id, true);
  if (existing?.usedAt) throw new ConflictError("This customer has already written their review.", "review_already_written");

  const token = newToken();
  const expiresAt = new Date(now.getTime() + REVIEW_LINK_DAYS * 86_400_000);
  await scope.tx
    .insert(reviewRequests)
    .values({ tenantId: scope.tenantId, bookingId: booking.id, tokenHash: hashReviewToken(token), expiresAt })
    .onConflictDoUpdate({ target: [reviewRequests.tenantId, reviewRequests.bookingId], set: { tokenHash: hashReviewToken(token), expiresAt } });
  await recordAudit(scope, {
    action: existing ? "review_request.renewed" : "review_request.issued",
    targetType: "booking",
    targetId: booking.id,
  });
  return { url: `${await publicSiteOrigin(scope)}${reviewPath(token)}`, expiresAt };
}

/** Issues (or renews) the link and e-mails it to the customer. */
export async function sendReviewRequest(scope: TenantScope, bookingId: string, now = new Date()): Promise<IssuedReviewLink> {
  const link = await issueReviewLink(scope, bookingId, now);
  const booking = await completedBooking(scope, bookingId);
  const [business] = await scope.tx
    .select({ name: tenants.name, email: tenants.email, phone: tenants.phone, timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, scope.tenantId))
    .limit(1);
  await enqueueNotification(scope, {
    kind: "review.requested",
    toEmail: booking.contactEmail,
    relatedType: "booking",
    relatedId: booking.id,
    ...renderNotification("review.requested", {
      businessName: business?.name ?? "",
      contactEmail: business?.email,
      contactPhone: business?.phone,
      customerName: booking.contactName,
      tourTitle: booking.tourTitle,
      startDate: booking.startDate,
      reviewUrl: link.url,
      expiresOn: todayIn(business?.timezone ?? "UTC", link.expiresAt),
    }),
  });
  return link;
}

/* --------------------------------------------------------------- public */

export interface CustomerUpload {
  id: string;
  url: string;
  resourceType: "image" | "video";
}

export type ReviewLink =
  | {
      state: "open";
      customerName: string;
      country: string;
      tourTitle: string;
      startDate: string;
      expiresAt: Date;
      /** Whether the business has media storage, so photos and videos can be added. */
      canUpload: boolean;
    }
  | { state: "used" | "expired" | "invalid" };

/** The request behind a token, scoped to the site the visitor is on. */
async function requestForToken(scope: TenantScope, token: string, lock = false): Promise<RequestRow | undefined> {
  if (!TOKEN_PATTERN.test(token)) return undefined;
  const query = scope.tx
    .select()
    .from(reviewRequests)
    .where(and(eq(reviewRequests.tenantId, scope.tenantId), eq(reviewRequests.tokenHash, hashReviewToken(token))))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row;
}

async function uploadsAvailable(scope: TenantScope): Promise<boolean> {
  try {
    await selectStorage(scope);
    return true;
  } catch (error) {
    if (error instanceof IntegrationNotConfiguredError) return false;
    throw error;
  }
}

/** What the review page shows for a token: the form, or why there is none. */
export async function openReviewLink(scope: TenantScope, token: string, now = new Date()): Promise<ReviewLink> {
  const row = await requestForToken(scope, token);
  const state = stateOf(row, now);
  if (state === "none") return { state: "invalid" };
  if (state !== "open") return { state };
  const [booking] = await scope.tx
    .select({ contactName: bookings.contactName, country: bookings.country, tourTitle: bookings.tourTitle, startDate: bookings.startDate })
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.id, row!.bookingId)))
    .limit(1);
  if (!booking) return { state: "invalid" };
  return {
    state: "open",
    customerName: booking.contactName,
    country: booking.country,
    tourTitle: booking.tourTitle,
    startDate: booking.startDate,
    expiresAt: row!.expiresAt,
    canUpload: await uploadsAvailable(scope),
  };
}

/** The open request behind a token, locked for the rest of the transaction; refuses a spent or expired one. */
async function openRequest(scope: TenantScope, token: string, now: Date): Promise<RequestRow> {
  const row = await requestForToken(scope, token, true);
  const state = stateOf(row, now);
  if (state === "used") throw new ConflictError("This review has already been sent. Thank you!", "review_already_written");
  if (state === "expired") throw new ConflictError("This review link has expired. Ask the business for a new one.", "review_link_expired");
  if (state !== "open") throw new NotFoundError("Review link");
  return row!;
}

/** Authorises one direct upload for the customer's review. */
export async function createCustomerUploadSignature(
  scope: TenantScope,
  token: string,
  input: z.input<typeof uploadRequestSchema>,
  now = new Date(),
): Promise<UploadSignature> {
  const row = await openRequest(scope, token, now);
  if (row.uploadedMediaIds.length >= CUSTOMER_REVIEW_MEDIA_MAX) {
    throw new ValidationError(`You can add up to ${CUSTOMER_REVIEW_MEDIA_MAX} photos or videos.`);
  }
  if (row.uploadCount >= CUSTOMER_UPLOAD_ATTEMPTS_MAX) {
    throw new ValidationError("That is the most uploads this link allows. Send your review with the files you have.");
  }
  // Customers only add files to the business's library; they never choose a folder.
  const signature = await createUploadSignature(scope, { ...input, folderId: null });
  await scope.tx
    .update(reviewRequests)
    .set({ uploadCount: row.uploadCount + 1 })
    .where(and(eq(reviewRequests.tenantId, scope.tenantId), eq(reviewRequests.id, row.id)));
  return signature;
}

async function customerUploadsFolder(scope: TenantScope): Promise<string> {
  const find = () =>
    scope.tx
      .select({ id: mediaFolders.id })
      .from(mediaFolders)
      .where(and(eq(mediaFolders.tenantId, scope.tenantId), eq(mediaFolders.name, CUSTOMER_UPLOADS_FOLDER)))
      .limit(1);
  const [found] = await find();
  if (found) return found.id;
  const [created] = await scope.tx
    .insert(mediaFolders)
    .values({ tenantId: scope.tenantId, name: CUSTOMER_UPLOADS_FOLDER })
    .onConflictDoNothing()
    .returning({ id: mediaFolders.id });
  return created?.id ?? (await find())[0]!.id;
}

export const finalizeCustomerUploadSchema = z.object({
  publicId: z.string().min(1).max(300),
  resourceType: z.enum(["image", "video"]),
  filename: z.string().max(200).optional(),
});

/** Adds the customer's finished upload to the library and to what this link may attach. */
export async function finalizeCustomerUpload(
  scope: TenantScope,
  token: string,
  input: z.input<typeof finalizeCustomerUploadSchema>,
  now = new Date(),
): Promise<CustomerUpload> {
  const data = parseInput(finalizeCustomerUploadSchema, input);
  const row = await openRequest(scope, token, now);
  if (row.uploadedMediaIds.length >= CUSTOMER_REVIEW_MEDIA_MAX) {
    throw new ValidationError(`You can add up to ${CUSTOMER_REVIEW_MEDIA_MAX} photos or videos.`);
  }
  const asset = await finalizeUpload(scope, {
    publicId: data.publicId,
    resourceType: data.resourceType,
    filename: data.filename,
    folderId: await customerUploadsFolder(scope),
  });
  if (!row.uploadedMediaIds.includes(asset.id)) {
    await scope.tx
      .update(reviewRequests)
      .set({ uploadedMediaIds: [...row.uploadedMediaIds, asset.id] })
      .where(and(eq(reviewRequests.tenantId, scope.tenantId), eq(reviewRequests.id, row.id)));
  }
  return { id: asset.id, url: asset.url, resourceType: asset.resourceType };
}

const customerReviewSchema = z.object({
  customerName: plainText(120, { min: 2, minMessage: "Add your name as you would like it shown." }),
  country: plainText(80).optional(),
  rating: z.number("Choose a rating from 1 to 5.").int().min(1, "Choose a rating from 1 to 5.").max(5, "Choose a rating from 1 to 5."),
  title: plainText(160).optional(),
  body: plainText(4000, { min: 20, minMessage: "Tell us a little more (at least 20 characters).", multiline: true }),
  mediaIds: z
    .array(z.uuid())
    .max(CUSTOMER_REVIEW_MEDIA_MAX, `Add up to ${CUSTOMER_REVIEW_MEDIA_MAX} photos or videos.`)
    .refine((ids) => new Set(ids).size === ids.length, { error: "Each file can only be added once." })
    .optional(),
});
export type CustomerReviewInput = z.input<typeof customerReviewSchema>;

/**
 * Saves the customer's review: tied to their booking and tour, marked as a
 * verified booking, and unpublished until the business reads it. The link is
 * spent in the same transaction, and the business is told.
 */
export async function submitCustomerReview(scope: TenantScope, token: string, input: CustomerReviewInput, now = new Date()): Promise<ReviewView> {
  const data = parseInput(customerReviewSchema, input);
  const row = await openRequest(scope, token, now);
  const mediaIds = data.mediaIds ?? [];
  if (mediaIds.some((id) => !row.uploadedMediaIds.includes(id))) {
    throw new ValidationError(undefined, { mediaIds: ["Upload your photos and videos on this page."] });
  }

  const [booking] = await scope.tx
    .select({ id: bookings.id, tourId: bookings.tourId, reference: bookings.reference, tourTitle: bookings.tourTitle })
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.id, row.bookingId)))
    .limit(1);
  if (!booking) throw new NotFoundError("Review link");
  const [business] = await scope.tx
    .select({ name: tenants.name, email: tenants.email, timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, scope.tenantId))
    .limit(1);

  const review = await createReview(scope, {
    customerName: data.customerName,
    country: data.country ?? "",
    rating: data.rating,
    title: data.title ?? "",
    body: data.body,
    reviewedOn: todayIn(business?.timezone ?? "UTC", now),
    tourId: booking.tourId,
    isVerified: true,
    isFeatured: false,
    isPublished: false,
    mediaIds,
  });
  await scope.tx
    .update(reviewRequests)
    .set({ usedAt: now, reviewId: review.id })
    .where(and(eq(reviewRequests.tenantId, scope.tenantId), eq(reviewRequests.id, row.id)));
  await recordAudit(scope, { action: "review.submitted_by_customer", targetType: "review", targetId: review.id, metadata: { bookingId: booking.id } });

  if (business?.email) {
    await enqueueNotification(scope, {
      kind: "review.staff_alert",
      toEmail: business.email,
      relatedType: "review",
      relatedId: review.id,
      ...renderNotification("review.staff_alert", {
        businessName: business.name,
        customerName: review.customerName,
        bookingReference: booking.reference,
        tourTitle: booking.tourTitle,
        rating: review.rating,
        title: review.title,
        body: review.body,
        attachments: mediaIds.length,
        dashboardUrl: `${env().APP_URL}/workspace/reviews`,
      }),
    });
  }
  return review;
}
