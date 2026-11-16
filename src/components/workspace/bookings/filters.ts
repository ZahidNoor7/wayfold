/**
 * The bookings list lives in the URL: status tab, search, tour, date range,
 * payment, sort, page and the open booking. These helpers turn search
 * parameters into a validated view and a view back into a link, so every
 * view is shareable and the back button retraces filter changes.
 */
import {
  BOOKING_STATUSES,
  PAYMENT_STATUSES,
  dateParam,
  enumParam,
  firstParam,
  hrefWith,
  parsePage,
  uuidParam,
  type BookingStatus,
  type PaymentStatus,
  type SearchParams,
} from "@/lib/booking-display";

export const BOOKINGS_PATH = "/workspace/bookings";
export const BOOKINGS_EXPORT_PATH = "/workspace/bookings/export";
export const BOOKINGS_PAGE_SIZE = 25;
export const MAX_SEARCH_LENGTH = 120;

export const BOOKING_SORTS = ["newest", "oldest", "date_asc", "date_desc"] as const;
export type BookingSort = (typeof BOOKING_SORTS)[number];

export const BOOKING_SORT_LABELS: Record<BookingSort, string> = {
  newest: "Newest request first",
  oldest: "Oldest request first",
  date_asc: "Tour date, soonest first",
  date_desc: "Tour date, latest first",
};

export interface BookingsView {
  status?: BookingStatus;
  q?: string;
  /** Tour id. */
  tour?: string;
  from?: string;
  to?: string;
  payment?: PaymentStatus;
  /** Only bookings with a scheduling conflict. */
  clash: boolean;
  sort: BookingSort;
  page: number;
  /** Id of the booking whose detail panel is open. */
  booking?: string;
}

export function parseBookingsView(params: SearchParams): BookingsView {
  let from = dateParam(params.from);
  let to = dateParam(params.to);
  // A range typed backwards still means that range.
  if (from && to && to < from) [from, to] = [to, from];
  return {
    status: enumParam(params.status, BOOKING_STATUSES),
    q: firstParam(params.q)?.slice(0, MAX_SEARCH_LENGTH),
    tour: uuidParam(params.tour),
    from,
    to,
    payment: enumParam(params.payment, PAYMENT_STATUSES),
    clash: firstParam(params.clash) === "1",
    sort: enumParam(params.sort, BOOKING_SORTS) ?? "newest",
    page: parsePage(params.page),
    booking: uuidParam(params.booking),
  };
}

function filterParams(view: BookingsView) {
  return {
    status: view.status,
    q: view.q,
    tour: view.tour,
    from: view.from,
    to: view.to,
    payment: view.payment,
    clash: view.clash,
  };
}

/** Link to the list in `view`, with `patch` applied. Defaults are left out of the URL. */
export function bookingsHref(view: BookingsView, patch: Partial<BookingsView> = {}): string {
  const next = { ...view, ...patch };
  return hrefWith(BOOKINGS_PATH, {
    ...filterParams(next),
    sort: next.sort === "newest" ? undefined : next.sort,
    page: next.page > 1 ? next.page : undefined,
    booking: next.booking,
  });
}

/** Link for a changed filter: back to page one, detail panel closed. */
export function filterHref(view: BookingsView, patch: Partial<BookingsView>): string {
  return bookingsHref(view, { ...patch, page: 1, booking: undefined });
}

/** The CSV export of exactly what the filters show (every page of it). */
export function exportHref(view: BookingsView): string {
  return hrefWith(BOOKINGS_EXPORT_PATH, filterParams(view));
}

/** Filters in the shape the bookings service takes. */
export function toBookingFilters(view: BookingsView) {
  return {
    status: view.status,
    tourId: view.tour,
    search: view.q,
    from: view.from,
    to: view.to,
    payment: view.payment,
    clashOnly: view.clash || undefined,
  };
}

export function toListInput(view: BookingsView) {
  return {
    ...toBookingFilters(view),
    sort: view.sort,
    limit: BOOKINGS_PAGE_SIZE,
    offset: (view.page - 1) * BOOKINGS_PAGE_SIZE,
  };
}

/** How many of the secondary filters (the ones in the phone's filter sheet) are set. */
export function secondaryFilterCount(view: BookingsView): number {
  return [view.tour, view.from, view.to, view.payment, view.sort !== "newest"].filter(Boolean).length;
}

/** True when anything narrows the list, so an empty result can offer "Clear filters". */
export function isFiltered(view: BookingsView): boolean {
  return Boolean(view.status || view.q || view.tour || view.from || view.to || view.payment || view.clash);
}

/** The view with every filter cleared; sort is kept. */
export function clearedHref(view: BookingsView): string {
  return bookingsHref({ clash: false, sort: view.sort, page: 1 });
}
