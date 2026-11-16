import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { TenantScope } from "../db/context";
import { mediaAssets, reviewMedia, reviews, tours } from "../db/schema";
import { NotFoundError } from "../errors";
import { guardedWrite, isoDate, likePattern, pageSchema, parseInput, plainText, requireId, type ConstraintMap, type Page } from "./shared";

/** Most photos and videos one review can carry. */
export const REVIEW_MEDIA_MAX = 12;

const fields = {
  customerName: plainText(120, { min: 2, minMessage: "Add the customer's name." }),
  country: plainText(80),
  rating: z.number().int().min(1, "Choose a rating from 1 to 5.").max(5, "Choose a rating from 1 to 5."),
  title: plainText(160),
  body: plainText(4000, { min: 10, minMessage: "Add the review text (10+ characters).", multiline: true }),
  /** Calendar date of the review. Defaults to today on create. */
  reviewedOn: isoDate,
  /** One of this workspace's tours, or null for a general review. */
  tourId: z.uuid().nullable(),
  avatarMediaId: z.uuid().nullable(),
  isVerified: z.boolean(),
  isFeatured: z.boolean(),
  isPublished: z.boolean(),
  /** Photos and videos from the media library, in display order. */
  mediaIds: z
    .array(z.uuid())
    .max(REVIEW_MEDIA_MAX, `Attach up to ${REVIEW_MEDIA_MAX} photos or videos.`)
    .refine((ids) => new Set(ids).size === ids.length, { error: "Each file can only be attached once." }),
};

// No Zod defaults here on purpose: in Zod 4 a default also fires for a key
// that is merely absent, which would turn a partial update into a reset.
export const createReviewSchema = z.object(fields).partial().required({ customerName: true, rating: true, body: true });
export const updateReviewSchema = z.object(fields).partial();
export type CreateReviewInput = z.input<typeof createReviewSchema>;
export type UpdateReviewInput = z.input<typeof updateReviewSchema>;

const CONSTRAINTS: ConstraintMap = {
  foreignKeys: {
    reviews_tour_fk: { field: "tourId", message: "Choose one of your tours." },
    reviews_avatar_fk: { field: "avatarMediaId", message: "Choose an image from your media library." },
    review_media_media_fk: { field: "mediaIds", message: "Choose photos and videos from your media library." },
  },
};

export interface ReviewMediaItem {
  id: string;
  url: string;
  alt: string;
  resourceType: "image" | "video";
  width: number | null;
  height: number | null;
}

export interface ReviewView {
  id: string;
  customerName: string;
  country: string;
  rating: number;
  title: string;
  body: string;
  reviewedOn: string;
  isVerified: boolean;
  isFeatured: boolean;
  isPublished: boolean;
  tour: { id: string; title: string } | null;
  avatar: { id: string; url: string } | null;
  /** Attached photos and videos, in display order. */
  media: ReviewMediaItem[];
  createdAt: Date;
  updatedAt: Date;
}

const viewColumns = {
  id: reviews.id,
  customerName: reviews.customerName,
  country: reviews.country,
  rating: reviews.rating,
  title: reviews.title,
  body: reviews.body,
  reviewedOn: reviews.reviewedOn,
  isVerified: reviews.isVerified,
  isFeatured: reviews.isFeatured,
  isPublished: reviews.isPublished,
  tourId: reviews.tourId,
  tourTitle: tours.title,
  avatarMediaId: reviews.avatarMediaId,
  avatarUrl: mediaAssets.url,
  createdAt: reviews.createdAt,
  updatedAt: reviews.updatedAt,
};

// Joined rows are matched on tenant as well as id: the join can never pull a
// title or URL across a workspace boundary.
const tourJoin = and(eq(tours.tenantId, reviews.tenantId), eq(tours.id, reviews.tourId));
const avatarJoin = and(eq(mediaAssets.tenantId, reviews.tenantId), eq(mediaAssets.id, reviews.avatarMediaId));

interface ViewRow {
  id: string;
  customerName: string;
  country: string;
  rating: number;
  title: string;
  body: string;
  reviewedOn: string;
  isVerified: boolean;
  isFeatured: boolean;
  isPublished: boolean;
  tourId: string | null;
  tourTitle: string | null;
  avatarMediaId: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toView(row: ViewRow, media: ReviewMediaItem[] = []): ReviewView {
  const { tourId, tourTitle, avatarMediaId, avatarUrl, ...rest } = row;
  return {
    ...rest,
    tour: tourId && tourTitle !== null ? { id: tourId, title: tourTitle } : null,
    avatar: avatarMediaId && avatarUrl !== null ? { id: avatarMediaId, url: avatarUrl } : null,
    media,
  };
}

/** Attached media for a page of reviews, in one query, keyed by review id. */
async function mediaFor(scope: TenantScope, reviewIds: string[]): Promise<Map<string, ReviewMediaItem[]>> {
  const byReview = new Map<string, ReviewMediaItem[]>();
  if (reviewIds.length === 0) return byReview;
  const rows = await scope.tx
    .select({
      reviewId: reviewMedia.reviewId,
      id: mediaAssets.id,
      url: mediaAssets.url,
      alt: mediaAssets.alt,
      resourceType: mediaAssets.resourceType,
      width: mediaAssets.width,
      height: mediaAssets.height,
    })
    .from(reviewMedia)
    .innerJoin(mediaAssets, and(eq(mediaAssets.tenantId, reviewMedia.tenantId), eq(mediaAssets.id, reviewMedia.mediaId)))
    .where(and(eq(reviewMedia.tenantId, scope.tenantId), inArray(reviewMedia.reviewId, reviewIds)))
    .orderBy(reviewMedia.reviewId, asc(reviewMedia.sortOrder));
  for (const { reviewId, ...item } of rows) {
    const list = byReview.get(reviewId) ?? [];
    list.push(item);
    byReview.set(reviewId, list);
  }
  return byReview;
}

/** Replaces a review's attachments with `mediaIds`, in that order. */
async function replaceMedia(scope: TenantScope, reviewId: string, mediaIds: string[]): Promise<void> {
  await scope.tx.delete(reviewMedia).where(and(eq(reviewMedia.tenantId, scope.tenantId), eq(reviewMedia.reviewId, reviewId)));
  if (mediaIds.length === 0) return;
  // The composite key refuses another workspace's file; guardedWrite turns that into a field error.
  await guardedWrite(scope, CONSTRAINTS, (tx) =>
    tx.insert(reviewMedia).values(mediaIds.map((mediaId, index) => ({ tenantId: scope.tenantId, reviewId, mediaId, sortOrder: index }))),
  );
}

export async function getReview(scope: TenantScope, id: string): Promise<ReviewView> {
  requireId(id, "Review");
  const [row] = await scope.tx
    .select(viewColumns)
    .from(reviews)
    .leftJoin(tours, tourJoin)
    .leftJoin(mediaAssets, avatarJoin)
    .where(and(eq(reviews.tenantId, scope.tenantId), eq(reviews.id, id)))
    .limit(1);
  // Same answer whether the id is unknown or belongs to another workspace.
  if (!row) throw new NotFoundError("Review");
  return toView(row, (await mediaFor(scope, [row.id])).get(row.id));
}

export const listReviewsSchema = z.object({
  published: z.boolean().optional(),
  featured: z.boolean().optional(),
  rating: fields.rating.optional(),
  tourId: z.uuid().optional(),
  /** Matches customer name, title or review text. */
  search: z.string().trim().max(100).optional(),
  ...pageSchema(50, 100),
});
export type ListReviewsInput = z.input<typeof listReviewsSchema>;

/** Dashboard list: every review of the workspace, published or not. */
export async function listReviews(scope: TenantScope, input: ListReviewsInput = {}): Promise<Page<ReviewView>> {
  const filters = parseInput(listReviewsSchema, input);
  const conditions: (SQL | undefined)[] = [eq(reviews.tenantId, scope.tenantId)];
  if (filters.published !== undefined) conditions.push(eq(reviews.isPublished, filters.published));
  if (filters.featured !== undefined) conditions.push(eq(reviews.isFeatured, filters.featured));
  if (filters.rating !== undefined) conditions.push(eq(reviews.rating, filters.rating));
  if (filters.tourId) conditions.push(eq(reviews.tourId, filters.tourId));
  if (filters.search) {
    const pattern = likePattern(filters.search);
    conditions.push(or(ilike(reviews.customerName, pattern), ilike(reviews.title, pattern), ilike(reviews.body, pattern)));
  }
  const where = and(...conditions);

  const rows = await scope.tx
    .select(viewColumns)
    .from(reviews)
    .leftJoin(tours, tourJoin)
    .leftJoin(mediaAssets, avatarJoin)
    .where(where)
    .orderBy(desc(reviews.reviewedOn), desc(reviews.createdAt), desc(reviews.id))
    .limit(filters.limit)
    .offset(filters.offset);
  const [totals] = await scope.tx.select({ total: count() }).from(reviews).where(where);
  const media = await mediaFor(scope, rows.map((row) => row.id));
  return { items: rows.map((row) => toView(row, media.get(row.id))), total: totals?.total ?? 0 };
}

export async function createReview(scope: TenantScope, input: CreateReviewInput): Promise<ReviewView> {
  const data = parseInput(createReviewSchema, input);
  const [row] = await guardedWrite(scope, CONSTRAINTS, (tx) =>
    tx
      .insert(reviews)
      .values({
        tenantId: scope.tenantId,
        customerName: data.customerName,
        country: data.country ?? "",
        rating: data.rating,
        title: data.title ?? "",
        body: data.body,
        // Omitted: the column default (today) applies.
        ...(data.reviewedOn ? { reviewedOn: data.reviewedOn } : {}),
        tourId: data.tourId ?? null,
        avatarMediaId: data.avatarMediaId ?? null,
        isVerified: data.isVerified ?? false,
        isFeatured: data.isFeatured ?? false,
        // The dashboard publishes a new review straight away unless told otherwise.
        isPublished: data.isPublished ?? true,
        createdBy: scope.userId,
      })
      .returning({ id: reviews.id }),
  );
  const id = row!.id;
  if (data.mediaIds?.length) await replaceMedia(scope, id, data.mediaIds);
  await recordAudit(scope, { action: "review.created", targetType: "review", targetId: id });
  return getReview(scope, id);
}

async function patchReview(scope: TenantScope, id: string, patch: Partial<typeof reviews.$inferInsert>): Promise<void> {
  requireId(id, "Review");
  const updated = await guardedWrite(scope, CONSTRAINTS, (tx) =>
    tx
      .update(reviews)
      .set(patch)
      .where(and(eq(reviews.tenantId, scope.tenantId), eq(reviews.id, id)))
      .returning({ id: reviews.id }),
  );
  if (updated.length === 0) throw new NotFoundError("Review");
}

export async function updateReview(scope: TenantScope, id: string, input: UpdateReviewInput): Promise<ReviewView> {
  const { mediaIds, ...data } = parseInput(updateReviewSchema, input);
  // Only keys the caller actually sent; everything else keeps its value.
  const patch = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  if (Object.keys(patch).length === 0 && mediaIds === undefined) return getReview(scope, id);
  if (Object.keys(patch).length > 0) await patchReview(scope, id, patch);
  else await getReview(scope, id); // a media-only change still needs the review to be this workspace's
  if (mediaIds !== undefined) await replaceMedia(scope, id, mediaIds);
  const changed = [...Object.keys(patch), ...(mediaIds !== undefined ? ["mediaIds"] : [])];
  await recordAudit(scope, { action: "review.updated", targetType: "review", targetId: id, metadata: { fields: changed } });
  return getReview(scope, id);
}

/** Publishes a review to the storefront, or hides it again. */
export async function setReviewPublished(scope: TenantScope, id: string, published: boolean): Promise<ReviewView> {
  await patchReview(scope, id, { isPublished: published });
  await recordAudit(scope, { action: published ? "review.published" : "review.hidden", targetType: "review", targetId: id });
  return getReview(scope, id);
}

/** Adds a review to, or removes it from, the featured testimonials. */
export async function setReviewFeatured(scope: TenantScope, id: string, featured: boolean): Promise<ReviewView> {
  await patchReview(scope, id, { isFeatured: featured });
  await recordAudit(scope, { action: featured ? "review.featured" : "review.unfeatured", targetType: "review", targetId: id });
  return getReview(scope, id);
}

export async function deleteReview(scope: TenantScope, id: string): Promise<void> {
  requireId(id, "Review");
  const deleted = await scope.tx
    .delete(reviews)
    .where(and(eq(reviews.tenantId, scope.tenantId), eq(reviews.id, id)))
    .returning({ id: reviews.id });
  if (deleted.length === 0) throw new NotFoundError("Review");
  await recordAudit(scope, { action: "review.deleted", targetType: "review", targetId: id });
}

/** What a storefront may show of a review. No internal flags, no author ids. */
export interface PublicReview {
  id: string;
  customerName: string;
  country: string;
  rating: number;
  title: string;
  body: string;
  reviewedOn: string;
  /** True when matched to a completed booking; false when added by the guide. */
  isVerified: boolean;
  isFeatured: boolean;
  /** Present only while the tour itself is published. */
  tour: { id: string; slug: string; title: string } | null;
  avatarUrl: string | null;
  /** Attached photos and videos, in display order. */
  media: ReviewMediaItem[];
}

const publicColumns = {
  id: reviews.id,
  customerName: reviews.customerName,
  country: reviews.country,
  rating: reviews.rating,
  title: reviews.title,
  body: reviews.body,
  reviewedOn: reviews.reviewedOn,
  isVerified: reviews.isVerified,
  isFeatured: reviews.isFeatured,
  tourId: tours.id,
  tourSlug: tours.slug,
  tourTitle: tours.title,
  avatarUrl: mediaAssets.url,
};

// A draft or archived tour must not surface through a review that links to it.
const publishedTourJoin = and(tourJoin, eq(tours.status, "published"));

interface PublicRow extends Omit<PublicReview, "tour" | "media"> {
  tourId: string | null;
  tourSlug: string | null;
  tourTitle: string | null;
}

function toPublic(row: PublicRow, media: ReviewMediaItem[] = []): PublicReview {
  const { tourId, tourSlug, tourTitle, ...rest } = row;
  return { ...rest, tour: tourId && tourSlug !== null && tourTitle !== null ? { id: tourId, slug: tourSlug, title: tourTitle } : null, media };
}

export const listPublishedReviewsSchema = z.object({
  rating: fields.rating.optional(),
  tourId: z.uuid().optional(),
  sort: z.enum(["newest", "highest", "lowest"]).default("newest"),
  ...pageSchema(6, 50),
});
export type ListPublishedReviewsInput = z.input<typeof listPublishedReviewsSchema>;

/** Storefront list: published reviews only, with the page's filters and sort. */
export async function listPublishedReviews(scope: TenantScope, input: ListPublishedReviewsInput = {}): Promise<Page<PublicReview>> {
  const options = parseInput(listPublishedReviewsSchema, input);
  const conditions: SQL[] = [eq(reviews.tenantId, scope.tenantId), eq(reviews.isPublished, true)];
  if (options.rating !== undefined) conditions.push(eq(reviews.rating, options.rating));
  if (options.tourId) conditions.push(eq(reviews.tourId, options.tourId));
  const where = and(...conditions);

  const newestFirst = [desc(reviews.reviewedOn), desc(reviews.createdAt), desc(reviews.id)];
  const order =
    options.sort === "highest"
      ? [desc(reviews.rating), ...newestFirst]
      : options.sort === "lowest"
        ? [asc(reviews.rating), ...newestFirst]
        : newestFirst;

  const rows = await scope.tx
    .select(publicColumns)
    .from(reviews)
    .leftJoin(tours, publishedTourJoin)
    .leftJoin(mediaAssets, avatarJoin)
    .where(where)
    .orderBy(...order)
    .limit(options.limit)
    .offset(options.offset);
  const [totals] = await scope.tx.select({ total: count() }).from(reviews).where(where);
  const media = await mediaFor(scope, rows.map((row) => row.id));
  return { items: rows.map((row) => toPublic(row, media.get(row.id))), total: totals?.total ?? 0 };
}

/** Featured testimonials for the home page and the reviews page header. */
export async function listFeaturedReviews(scope: TenantScope, limit = 6): Promise<PublicReview[]> {
  const size = parseInput(z.number().int().min(1).max(24), limit);
  const rows = await scope.tx
    .select(publicColumns)
    .from(reviews)
    .leftJoin(tours, publishedTourJoin)
    .leftJoin(mediaAssets, avatarJoin)
    .where(and(eq(reviews.tenantId, scope.tenantId), eq(reviews.isPublished, true), eq(reviews.isFeatured, true)))
    .orderBy(desc(reviews.reviewedOn), desc(reviews.createdAt), desc(reviews.id))
    .limit(size);
  const media = await mediaFor(scope, rows.map((row) => row.id));
  return rows.map((row) => toPublic(row, media.get(row.id)));
}

export type Rating = 1 | 2 | 3 | 4 | 5;

export interface ReviewSummary {
  /** Mean rating to one decimal; 0 when there are no published reviews. */
  average: number;
  total: number;
  distribution: Record<Rating, number>;
}

/** Aggregates over published reviews only, so they always match the public list. */
export async function getReviewSummary(scope: TenantScope): Promise<ReviewSummary> {
  const rows = await scope.tx
    .select({ rating: reviews.rating, n: count() })
    .from(reviews)
    .where(and(eq(reviews.tenantId, scope.tenantId), eq(reviews.isPublished, true)))
    .groupBy(reviews.rating);

  const distribution: Record<Rating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let sum = 0;
  for (const row of rows) {
    distribution[row.rating as Rating] = row.n;
    total += row.n;
    sum += row.rating * row.n;
  }
  return { average: total === 0 ? 0 : Math.round((sum / total) * 10) / 10, total, distribution };
}
