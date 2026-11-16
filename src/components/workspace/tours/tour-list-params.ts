/**
 * The tours list keeps its filters and page in the URL, so a filtered view
 * can be bookmarked, shared and survives a reload. Pure helpers: read the
 * query string into filters, and write filters back into a link.
 */

export type StatusTab = "all" | "draft" | "published" | "archived";

export interface TourListParams {
  status: StatusTab;
  /** A category id, or "" for every category. */
  category: string;
  search: string;
  featured: boolean;
  /** 1-based. */
  page: number;
}

export const TOURS_PAGE_SIZE = 20;
export const TOURS_PATH = "/workspace/tours";

const STATUSES: readonly StatusTab[] = ["all", "draft", "published", "archived"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

/** Reads the query string leniently: anything unrecognised falls back to "no filter". */
export function parseTourListParams(raw: RawParams): TourListParams {
  const status = first(raw.status) as StatusTab;
  const category = first(raw.category);
  const page = Number.parseInt(first(raw.page), 10);
  return {
    status: STATUSES.includes(status) ? status : "all",
    // A malformed id would only ever match nothing; drop it instead of asking the server.
    category: UUID.test(category) ? category : "",
    search: first(raw.q).trim().slice(0, 100),
    featured: first(raw.featured) === "1",
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 10_000) : 1,
  };
}

/** Link to the list with `patch` applied. Changing any filter returns to the first page. */
export function tourListHref(current: TourListParams, patch: Partial<TourListParams> = {}): string {
  const next = { ...current, ...patch };
  if (!("page" in patch)) next.page = 1;
  const query = new URLSearchParams();
  if (next.status !== "all") query.set("status", next.status);
  if (next.category) query.set("category", next.category);
  if (next.search.trim()) query.set("q", next.search.trim());
  if (next.featured) query.set("featured", "1");
  if (next.page > 1) query.set("page", String(next.page));
  const text = query.toString();
  return text ? `${TOURS_PATH}?${text}` : TOURS_PATH;
}

/** Filters in the shape the catalogue service takes. */
export function toListQuery(params: TourListParams): {
  status?: "draft" | "published" | "archived";
  categoryId?: string;
  search?: string;
  featured?: boolean;
  limit: number;
  offset: number;
} {
  return {
    ...(params.status !== "all" ? { status: params.status } : {}),
    ...(params.category ? { categoryId: params.category } : {}),
    ...(params.search ? { search: params.search } : {}),
    ...(params.featured ? { featured: true } : {}),
    limit: TOURS_PAGE_SIZE,
    offset: (params.page - 1) * TOURS_PAGE_SIZE,
  };
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / TOURS_PAGE_SIZE));
}

/** How many of the category, search and featured filters are on (the status tab is not a filter). */
export function activeFilterCount(params: TourListParams): number {
  return [params.category !== "", params.search !== "", params.featured].filter(Boolean).length;
}

/** "3 days", "1 day", or the operator's own wording when they gave one. */
export function durationText(tour: { durationLabel: string; durationDays: number }): string {
  if (tour.durationLabel.trim()) return tour.durationLabel.trim();
  return `${tour.durationDays} ${tour.durationDays === 1 ? "day" : "days"}`;
}
