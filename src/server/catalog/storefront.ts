import "server-only";
import { and, asc, desc, eq, gte, ilike, isNotNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { TenantScope } from "../db/context";
import { destinations, mediaAssets, reviews, tourCategories, tours, type TourFaq, type TourSchedule } from "../db/schema";
import { NotFoundError } from "../errors";
import { listDepartures, type TodayOption } from "./departures";
import { containsPattern, parse, requireToday } from "./shared";
import { readItinerary, readMedia, type ItineraryDay, type TourMediaItem } from "./tours";

/**
 * Public catalogue queries. Everything here is what an anonymous visitor may
 * see: published tours and published destinations of the storefront's tenant,
 * and nothing about drafts, archived tours or internal fields.
 */

export const TOUR_SORTS = ["popular", "price_asc", "price_desc", "duration", "rating"] as const;
export type TourSort = (typeof TOUR_SORTS)[number];

const filterSlug = z.string().trim().toLowerCase().max(80);

export const listPublishedToursSchema = z.object({
  /** Category slug. */
  category: filterSlug.optional(),
  /** Destination slug. */
  destination: filterSlug.optional(),
  search: z.string().trim().max(100).optional(),
  /** Length in days, inclusive. */
  minDuration: z.int().min(1).max(365).optional(),
  maxDuration: z.int().min(1).max(365).optional(),
  /** Adult list price in minor units, inclusive. */
  priceMin: z.int().min(0).optional(),
  priceMax: z.int().min(0).optional(),
  sort: z.enum(TOUR_SORTS).default("popular"),
  featuredOnly: z.boolean().optional(),
  limit: z.int().min(1).max(100).default(24),
  offset: z.int().min(0).default(0),
});
export type ListPublishedToursInput = z.input<typeof listPublishedToursSchema>;

export interface PublicTourCard {
  id: string;
  slug: string;
  title: string;
  summary: string;
  place: string;
  kind: "day" | "departure" | "private";
  durationDays: number;
  /** Display length, e.g. "6 hours"; falls back to the day count. */
  durationLabel: string;
  /** Adult list price in minor units. */
  priceAdult: number;
  childPricePercent: number;
  minGroupSize: number;
  maxGroupSize: number;
  isFeatured: boolean;
  isPopular: boolean;
  categoryName: string | null;
  categorySlug: string | null;
  destinationName: string | null;
  destinationSlug: string | null;
  coverUrl: string | null;
  coverAlt: string | null;
  /** Mean of published reviews to one decimal; null when there are none. */
  ratingAverage: number | null;
  reviewCount: number;
}

export interface PublicDeparture {
  id: string;
  startDate: string;
  startTime: string | null;
  capacity: number;
  seatsLeft: number;
}

export interface PublicTourDetail extends PublicTourCard {
  description: string;
  childMaxAge: number;
  schedule: TourSchedule;
  languages: string[];
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  goodToKnow: string[];
  faq: TourFaq[];
  meetingPoint: string;
  meetingLatitude: number | null;
  meetingLongitude: number | null;
  cancellationPolicy: string;
  itinerary: ItineraryDay[];
  media: TourMediaItem[];
  /** Open departures from today onwards (`departure` tours only). */
  departures: PublicDeparture[];
}

export interface PublicDestination {
  id: string;
  name: string;
  slug: string;
  region: string;
  tagline: string;
  description: string;
  coverUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Published tours at this destination. */
  tourCount: number;
}

export interface PublicCategory {
  id: string;
  name: string;
  slug: string;
  /** Published tours in this category. */
  tourCount: number;
}

const categoryJoin = and(eq(tourCategories.tenantId, tours.tenantId), eq(tourCategories.id, tours.categoryId));
// An unpublished destination is invisible to visitors, so its tours simply show no destination.
const destinationJoin = and(eq(destinations.tenantId, tours.tenantId), eq(destinations.id, tours.destinationId), eq(destinations.isPublished, true));
const coverJoin = and(eq(mediaAssets.tenantId, tours.tenantId), eq(mediaAssets.id, tours.coverMediaId));

const publishedTours = (scope: TenantScope) => and(eq(tours.tenantId, scope.tenantId), eq(tours.status, "published"));

function dayLabel(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

async function selectCards(
  scope: TenantScope,
  where: SQL | undefined,
  options: { sort: TourSort; limit: number; offset: number },
): Promise<PublicTourCard[]> {
  // Rating figures come from published reviews only; hidden reviews never count.
  const ratings = scope.tx
    .select({
      tourId: reviews.tourId,
      average: sql<number>`avg(${reviews.rating})::float8`.as("rating_average"),
      count: sql<number>`count(*)::int`.as("review_count"),
    })
    .from(reviews)
    .where(and(eq(reviews.tenantId, scope.tenantId), eq(reviews.isPublished, true), isNotNull(reviews.tourId)))
    .groupBy(reviews.tourId)
    .as("tour_ratings");

  const order: Record<TourSort, SQL[]> = {
    popular: [desc(tours.isPopular), desc(tours.isFeatured), sql`${ratings.count} desc nulls last`, asc(tours.sortOrder), asc(tours.title)],
    price_asc: [asc(tours.priceAdult), asc(tours.title)],
    price_desc: [desc(tours.priceAdult), asc(tours.title)],
    duration: [asc(tours.durationDays), asc(tours.priceAdult), asc(tours.title)],
    rating: [sql`${ratings.average} desc nulls last`, sql`${ratings.count} desc nulls last`, asc(tours.title)],
  };

  const rows = await scope.tx
    .select({
      id: tours.id,
      slug: tours.slug,
      title: tours.title,
      summary: tours.summary,
      place: tours.place,
      kind: tours.kind,
      durationDays: tours.durationDays,
      durationLabel: tours.durationLabel,
      priceAdult: tours.priceAdult,
      childPricePercent: tours.childPricePercent,
      minGroupSize: tours.minGroupSize,
      maxGroupSize: tours.maxGroupSize,
      isFeatured: tours.isFeatured,
      isPopular: tours.isPopular,
      categoryName: tourCategories.name,
      categorySlug: tourCategories.slug,
      destinationName: destinations.name,
      destinationSlug: destinations.slug,
      coverUrl: mediaAssets.url,
      coverAlt: mediaAssets.alt,
      ratingAverage: sql<number | null>`${ratings.average}`,
      reviewCount: sql<number>`coalesce(${ratings.count}, 0)`,
    })
    .from(tours)
    .leftJoin(tourCategories, categoryJoin)
    .leftJoin(destinations, destinationJoin)
    .leftJoin(mediaAssets, coverJoin)
    .leftJoin(ratings, eq(ratings.tourId, tours.id))
    .where(and(publishedTours(scope), where))
    .orderBy(...order[options.sort], asc(tours.id))
    .limit(options.limit)
    .offset(options.offset);

  return rows.map((row) => ({
    ...row,
    durationLabel: row.durationLabel || dayLabel(row.durationDays),
    ratingAverage: row.ratingAverage === null ? null : Math.round(row.ratingAverage * 10) / 10,
  }));
}

/** Storefront catalogue: published tours only, with search, filters, sorting and paging. */
export async function listPublishedTours(scope: TenantScope, input: ListPublishedToursInput = {}): Promise<{ items: PublicTourCard[]; total: number }> {
  const filters = parse(listPublishedToursSchema, input);
  // The search text is a bound parameter with its wildcards escaped; it is never spliced into SQL.
  const pattern = filters.search ? containsPattern(filters.search) : null;
  const where = and(
    filters.category ? eq(tourCategories.slug, filters.category) : undefined,
    filters.destination ? eq(destinations.slug, filters.destination) : undefined,
    pattern ? or(ilike(tours.title, pattern), ilike(tours.place, pattern), ilike(destinations.name, pattern)) : undefined,
    filters.minDuration !== undefined ? gte(tours.durationDays, filters.minDuration) : undefined,
    filters.maxDuration !== undefined ? lte(tours.durationDays, filters.maxDuration) : undefined,
    filters.priceMin !== undefined ? gte(tours.priceAdult, filters.priceMin) : undefined,
    filters.priceMax !== undefined ? lte(tours.priceAdult, filters.priceMax) : undefined,
    filters.featuredOnly ? eq(tours.isFeatured, true) : undefined,
  );

  const items = await selectCards(scope, where, filters);
  const [count] = await scope.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tours)
    .leftJoin(tourCategories, categoryJoin)
    .leftJoin(destinations, destinationJoin)
    .where(and(publishedTours(scope), where));
  return { items, total: count?.n ?? 0 };
}

/**
 * Tour page data by slug. Drafts and archived tours are "not found", exactly
 * like a slug that does not exist, so a visitor cannot probe for unpublished work.
 */
export async function getPublishedTourBySlug(scope: TenantScope, slug: string, options: TodayOption): Promise<PublicTourDetail> {
  const today = requireToday(options.today);
  const wanted = typeof slug === "string" ? slug.trim().toLowerCase() : "";
  if (!wanted) throw new NotFoundError("Tour");

  const [card] = await selectCards(scope, eq(tours.slug, wanted), { sort: "popular", limit: 1, offset: 0 });
  if (!card) throw new NotFoundError("Tour");

  const [row] = await scope.tx
    .select({
      description: tours.description,
      childMaxAge: tours.childMaxAge,
      schedule: tours.schedule,
      languages: tours.languages,
      highlights: tours.highlights,
      inclusions: tours.inclusions,
      exclusions: tours.exclusions,
      goodToKnow: tours.goodToKnow,
      faq: tours.faq,
      meetingPoint: tours.meetingPoint,
      meetingLatitude: tours.meetingLatitude,
      meetingLongitude: tours.meetingLongitude,
      cancellationPolicy: tours.cancellationPolicy,
    })
    .from(tours)
    .where(and(publishedTours(scope), eq(tours.id, card.id)))
    .limit(1);
  if (!row) throw new NotFoundError("Tour");

  const departures = card.kind === "departure" ? await listDepartures(scope, card.id, { from: today, openOnly: true }) : [];
  return {
    ...card,
    ...row,
    itinerary: await readItinerary(scope, card.id),
    media: await readMedia(scope, card.id),
    departures: departures.map((departure) => ({
      id: departure.id,
      startDate: departure.startDate,
      startTime: departure.startTime,
      capacity: departure.capacity,
      seatsLeft: departure.seatsLeft,
    })),
  };
}

/** Published destinations in display order, each with its number of published tours. */
export async function listPublishedDestinations(scope: TenantScope): Promise<PublicDestination[]> {
  const counts = scope.tx
    .select({ destinationId: tours.destinationId, n: sql<number>`count(*)::int`.as("n") })
    .from(tours)
    .where(and(publishedTours(scope), isNotNull(tours.destinationId)))
    .groupBy(tours.destinationId)
    .as("destination_published_tours");
  return scope.tx
    .select({
      id: destinations.id,
      name: destinations.name,
      slug: destinations.slug,
      region: destinations.region,
      tagline: destinations.tagline,
      description: destinations.description,
      coverUrl: mediaAssets.url,
      latitude: destinations.latitude,
      longitude: destinations.longitude,
      tourCount: sql<number>`coalesce(${counts.n}, 0)`,
    })
    .from(destinations)
    .leftJoin(mediaAssets, and(eq(mediaAssets.tenantId, destinations.tenantId), eq(mediaAssets.id, destinations.coverMediaId)))
    .leftJoin(counts, eq(counts.destinationId, destinations.id))
    .where(and(eq(destinations.tenantId, scope.tenantId), eq(destinations.isPublished, true)))
    .orderBy(asc(destinations.sortOrder), asc(destinations.name));
}

/** Categories that have at least one published tour, for the storefront filter chips. */
export async function listCategoriesInUse(scope: TenantScope): Promise<PublicCategory[]> {
  const counts = scope.tx
    .select({ categoryId: tours.categoryId, n: sql<number>`count(*)::int`.as("n") })
    .from(tours)
    .where(and(publishedTours(scope), isNotNull(tours.categoryId)))
    .groupBy(tours.categoryId)
    .as("category_published_tours");
  return scope.tx
    .select({
      id: tourCategories.id,
      name: tourCategories.name,
      slug: tourCategories.slug,
      tourCount: sql<number>`${counts.n}`,
    })
    .from(tourCategories)
    .innerJoin(counts, eq(counts.categoryId, tourCategories.id))
    .where(eq(tourCategories.tenantId, scope.tenantId))
    .orderBy(asc(tourCategories.sortOrder), asc(tourCategories.name));
}
