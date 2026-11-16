/**
 * Display rules for public reviews: URL filters, paging steps, and the small
 * derivations the reviews page shows (initials, stars, month labels,
 * distribution bars). Pure, so the page and its controls agree by sharing it.
 */

export type Rating = 1 | 2 | 3 | 4 | 5;
export const RATINGS: readonly Rating[] = [5, 4, 3, 2, 1];

export const REVIEW_SORTS = ["newest", "highest", "lowest"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export const REVIEW_SORT_LABELS: Record<ReviewSort, string> = {
  newest: "Newest",
  highest: "Highest rated",
  lowest: "Lowest rated",
};

/** "Load more" reveals this many reviews at a time. */
export const REVIEW_PAGE_STEP = 6;
/** Upper bound on how many reviews one page view will load. */
export const REVIEW_MAX_SHOWN = 300;

export interface ReviewFilters {
  rating: Rating | null;
  tourId: string | null;
  sort: ReviewSort;
  /** How many reviews are revealed: a multiple of the step. */
  shown: number;
}

export const DEFAULT_REVIEW_FILTERS: ReviewFilters = { rating: null, tourId: null, sort: "newest", shown: REVIEW_PAGE_STEP };

type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Reads the page's filters from the URL. Anything unrecognised falls back to the default. */
export function parseReviewFilters(params: SearchParams): ReviewFilters {
  const rating = Number(first(params.rating));
  const tour = first(params.tour);
  const sort = first(params.sort);
  const shown = Number(first(params.shown));
  return {
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? (rating as Rating) : null,
    tourId: UUID.test(tour) ? tour.toLowerCase() : null,
    sort: (REVIEW_SORTS as readonly string[]).includes(sort) ? (sort as ReviewSort) : "newest",
    shown: clampShown(shown),
  };
}

/** Rounds up to a whole step and keeps the value inside the allowed range. */
export function clampShown(value: number): number {
  if (!Number.isFinite(value) || value <= REVIEW_PAGE_STEP) return REVIEW_PAGE_STEP;
  const stepped = Math.ceil(value / REVIEW_PAGE_STEP) * REVIEW_PAGE_STEP;
  return Math.min(stepped, REVIEW_MAX_SHOWN);
}

/** The reviews URL for a set of filters. Defaults are left out, so the plain page has a plain address. */
export function reviewsHref(filters: Partial<ReviewFilters>, base = "/reviews"): string {
  const query = new URLSearchParams();
  if (filters.rating) query.set("rating", String(filters.rating));
  if (filters.tourId) query.set("tour", filters.tourId);
  if (filters.sort && filters.sort !== "newest") query.set("sort", filters.sort);
  if (filters.shown && filters.shown > REVIEW_PAGE_STEP) query.set("shown", String(clampShown(filters.shown)));
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}

/** How many reviews the next "Load more" reveals to; null when everything is shown or the cap is reached. */
export function nextShown(shown: number, total: number): number | null {
  if (shown >= total || shown >= REVIEW_MAX_SHOWN) return null;
  return clampShown(shown + REVIEW_PAGE_STEP);
}

/** Up to two initials: the first and last name-like words ("Sofia & Marco Bellini" → "SB"). */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word));
  if (words.length === 0) return "";
  const letter = (word: string) => Array.from(word)[0]!.toLocaleUpperCase();
  return words.length === 1 ? letter(words[0]!) : letter(words[0]!) + letter(words[words.length - 1]!);
}

/** A rating as whole stars, kept inside 0–5. */
export function wholeStars(rating: number): number {
  if (!Number.isFinite(rating)) return 0;
  return Math.min(5, Math.max(0, Math.round(rating)));
}

/** "★★★★☆" for 4. Pair it with a text label; the glyphs alone say nothing to a screen reader. */
export function starString(rating: number): string {
  const filled = wholeStars(rating);
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

/** "4 out of 5 stars"; averages keep their decimal ("4.9 out of 5 stars"). */
export function starLabel(rating: number): string {
  const value = Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
  return `${value} out of 5 stars`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * `2026-09-18` → "Sep 2026". Empty for anything that is not a calendar date.
 * A fixed month table rather than `Intl`: the label is rendered on the server
 * and again in the browser, and the two can ship different locale data
 * ("Sep" against "Sept"), which would break hydration.
 */
export function formatMonthYear(date: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date ?? "");
  if (!match) return "";
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : "";
}

export interface RatingSummary {
  average: number;
  total: number;
  distribution: Record<Rating, number>;
}

export interface DistributionRow {
  rating: Rating;
  count: number;
  /** Share of all reviews, 0–100 to one decimal: the bar's width. */
  percent: number;
}

/** One row per star level, five stars first, with the share each holds. */
export function distributionRows(summary: Pick<RatingSummary, "total" | "distribution">): DistributionRow[] {
  return RATINGS.map((rating) => {
    const count = summary.distribution[rating] ?? 0;
    return { rating, count, percent: summary.total > 0 ? Math.round((count / summary.total) * 1000) / 10 : 0 };
  });
}

/** Whole-number share of five-star reviews; null when there are no reviews to take a share of. */
export function fiveStarShare(summary: Pick<RatingSummary, "total" | "distribution">): number | null {
  if (summary.total <= 0) return null;
  return Math.round(((summary.distribution[5] ?? 0) / summary.total) * 100);
}

/** "review" / "reviews" (and friends), chosen by count. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** The live status under "All reviews": "Showing 6 of 14 · 4-star only". */
export function showingLine(shown: number, total: number, rating: Rating | null): string {
  const visible = Math.min(shown, total);
  const base = `Showing ${visible} of ${total}`;
  return rating ? `${base} · ${rating}-star only` : base;
}
