/**
 * The reviews list keeps its whole view (filters, search, page) in the URL so
 * a view can be shared and Back works. Pure: parsing, link building and the
 * mapping to the service's filters, shared by the server page and the client
 * toolbar.
 */
import { enumParam, firstParam, hrefWith, pageCount, parsePage, uuidParam, type SearchParams } from "@/lib/booking-display";
import type { Rating } from "@/lib/review-display";

export const REVIEWS_PATH = "/workspace/reviews";
export const REVIEWS_PAGE_SIZE = 24;
/** The service refuses longer search text; a longer one in the URL is cut, not rejected. */
export const MAX_REVIEW_SEARCH = 100;

export const REVIEW_STATUSES = ["all", "published", "hidden"] as const;
export type ReviewStatusFilter = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatusFilter, string> = {
  all: "All",
  published: "Published",
  hidden: "Hidden",
};

export interface ReviewListParams {
  status: ReviewStatusFilter;
  /** Featured testimonials only. */
  featured: boolean;
  rating: Rating | null;
  /** Tour id, or null for every tour. */
  tour: string | null;
  /** Search text; empty when there is none. */
  q: string;
  /** 1-based. */
  page: number;
}

export const DEFAULT_REVIEW_PARAMS: ReviewListParams = { status: "all", featured: false, rating: null, tour: null, q: "", page: 1 };

/** A star rating from text: "1"–"5", anything else is null. */
export function ratingParam(value: string | string[] | undefined | null): Rating | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && /^[1-5]$/.test(raw.trim()) ? (Number(raw.trim()) as Rating) : null;
}

/** Reads the list view from the URL. Anything unrecognised falls back to the default. */
export function parseReviewParams(searchParams: SearchParams): ReviewListParams {
  return {
    status: enumParam(searchParams.status, REVIEW_STATUSES) ?? "all",
    featured: firstParam(searchParams.featured) === "1",
    rating: ratingParam(searchParams.rating),
    tour: uuidParam(searchParams.tour) ?? null,
    q: (firstParam(searchParams.q) ?? "").slice(0, MAX_REVIEW_SEARCH).trim(),
    page: parsePage(searchParams.page),
  };
}

/** Link to a list view. Defaults are left out, so the plain list has a clean URL. */
export function reviewsListHref(params: Partial<ReviewListParams> = {}): string {
  return hrefWith(REVIEWS_PATH, {
    status: params.status && params.status !== "all" ? params.status : undefined,
    featured: params.featured || undefined,
    rating: params.rating ?? undefined,
    tour: params.tour ?? undefined,
    q: params.q?.trim(),
    page: params.page && params.page > 1 ? params.page : undefined,
  });
}

/** The filters as `listReviews` takes them. */
export function toReviewQuery(params: ReviewListParams, pageSize = REVIEWS_PAGE_SIZE) {
  return {
    ...(params.status === "published" ? { published: true } : params.status === "hidden" ? { published: false } : {}),
    ...(params.featured ? { featured: true } : {}),
    ...(params.rating ? { rating: params.rating } : {}),
    ...(params.tour ? { tourId: params.tour } : {}),
    ...(params.q ? { search: params.q } : {}),
    limit: pageSize,
    offset: (params.page - 1) * pageSize,
  };
}

/** How many filters (not counting search) narrow the list: the number on the phone's Filters button. */
export function activeFilterCount(params: Pick<ReviewListParams, "status" | "featured" | "rating" | "tour">): number {
  return (params.status !== "all" ? 1 : 0) + (params.featured ? 1 : 0) + (params.rating ? 1 : 0) + (params.tour ? 1 : 0);
}

export function hasReviewFilters(params: ReviewListParams): boolean {
  return activeFilterCount(params) > 0 || params.q !== "";
}

/**
 * The page to show instead when `page` lies past the end of the results
 * (a stale link, or rows removed since). Null when `page` is fine.
 */
export function reviewPageOutOfRange(page: number, total: number, pageSize = REVIEWS_PAGE_SIZE): number | null {
  const last = pageCount(total, pageSize);
  return page > last ? last : null;
}
