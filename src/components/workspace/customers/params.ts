/**
 * The customers list keeps its whole view (search, sort, page) in the URL so
 * a view can be shared and the back button works. Pure: parsing and link
 * building only, shared by the server page and the client toolbar.
 */
import { enumParam, firstParam, hrefWith, pageCount, parsePage, type SearchParams } from "@/lib/booking-display";

export const CUSTOMERS_PATH = "/workspace/customers";
export const CUSTOMERS_PAGE_SIZE = 25;
/** The service refuses longer search text; a longer one in the URL is cut, not rejected. */
export const MAX_SEARCH_LENGTH = 120;

export const CUSTOMER_SORTS = ["name", "newest", "top_spenders", "recent_booking"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];
export const DEFAULT_CUSTOMER_SORT: CustomerSort = "name";

export const CUSTOMER_SORT_LABELS: Record<CustomerSort, string> = {
  name: "Name A–Z",
  newest: "Newest customers",
  top_spenders: "Highest total spent",
  recent_booking: "Most recent booking",
};

export interface CustomerListParams {
  /** Search text; empty when there is none. */
  q: string;
  sort: CustomerSort;
  /** 1-based. */
  page: number;
}

/** Reads the list view from the URL. Anything unrecognised falls back to the default view. */
export function parseCustomerParams(searchParams: SearchParams): CustomerListParams {
  return {
    q: (firstParam(searchParams.q) ?? "").slice(0, MAX_SEARCH_LENGTH).trim(),
    sort: enumParam(searchParams.sort, CUSTOMER_SORTS) ?? DEFAULT_CUSTOMER_SORT,
    page: parsePage(searchParams.page),
  };
}

/** Link to a list view. Defaults are left out, so the plain list has a clean URL. */
export function customersHref(params: Partial<CustomerListParams> = {}): string {
  return hrefWith(CUSTOMERS_PATH, {
    q: params.q?.trim(),
    sort: params.sort && params.sort !== DEFAULT_CUSTOMER_SORT ? params.sort : undefined,
    page: params.page && params.page > 1 ? params.page : undefined,
  });
}

/** The CSV export of the current search (sort and page do not apply to an export). */
export function customersExportHref(q: string): string {
  return hrefWith(`${CUSTOMERS_PATH}/export`, { q: q.trim() });
}

export function customerHref(id: string): string {
  return `${CUSTOMERS_PATH}/${id}`;
}

/**
 * The page to show instead when `page` lies past the end of the results
 * (a stale link, or rows removed since). Null when `page` is fine.
 */
export function pageOutOfRange(page: number, total: number, pageSize = CUSTOMERS_PAGE_SIZE): number | null {
  const last = pageCount(total, pageSize);
  return page > last ? last : null;
}
