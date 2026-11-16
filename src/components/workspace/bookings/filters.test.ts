import { describe, expect, it } from "vitest";
import {
  BOOKINGS_PAGE_SIZE,
  bookingsHref,
  clearedHref,
  exportHref,
  filterHref,
  isFiltered,
  parseBookingsView,
  secondaryFilterCount,
  toBookingFilters,
  toListInput,
  type BookingsView,
} from "./filters";

const TOUR = "0191e7c2-8f6a-7c3b-9d2e-5a4b3c2d1e0f";
const BOOKING = "0191e7c2-8f6a-7c3b-9d2e-000000000001";
const DEFAULT: BookingsView = { clash: false, sort: "newest", page: 1 };

describe("parseBookingsView", () => {
  it("gives the default view for an empty URL", () => {
    expect(parseBookingsView({})).toEqual({
      status: undefined,
      q: undefined,
      tour: undefined,
      from: undefined,
      to: undefined,
      payment: undefined,
      clash: false,
      sort: "newest",
      page: 1,
      booking: undefined,
    });
  });

  it("reads every filter", () => {
    expect(
      parseBookingsView({
        status: "pending",
        q: " whitfield ",
        tour: TOUR,
        from: "2026-11-01",
        to: "2026-11-30",
        payment: "deposit_paid",
        clash: "1",
        sort: "date_asc",
        page: "3",
        booking: BOOKING,
      }),
    ).toEqual({
      status: "pending",
      q: "whitfield",
      tour: TOUR,
      from: "2026-11-01",
      to: "2026-11-30",
      payment: "deposit_paid",
      clash: true,
      sort: "date_asc",
      page: 3,
      booking: BOOKING,
    });
  });

  it("drops anything a service would reject", () => {
    const view = parseBookingsView({ status: "declined", tour: "1", from: "2026-13-01", payment: "free", clash: "yes", sort: "random", page: "-4", booking: "x" });
    expect(view).toEqual({ ...DEFAULT, status: undefined, q: undefined, tour: undefined, from: undefined, to: undefined, payment: undefined, booking: undefined });
  });

  it("puts a backwards date range the right way round and caps the search", () => {
    const view = parseBookingsView({ from: "2026-12-10", to: "2026-12-01", q: "x".repeat(300) });
    expect(view.from).toBe("2026-12-01");
    expect(view.to).toBe("2026-12-10");
    expect(view.q).toHaveLength(120);
  });

  it("takes the first of repeated parameters", () => {
    expect(parseBookingsView({ status: ["confirmed", "pending"] }).status).toBe("confirmed");
  });
});

describe("links", () => {
  it("keeps the default view's URL clean", () => {
    expect(bookingsHref(DEFAULT)).toBe("/workspace/bookings");
  });

  it("writes only what differs from the defaults", () => {
    const view: BookingsView = { ...DEFAULT, status: "confirmed", q: "omar", sort: "date_desc", page: 2, clash: true };
    expect(bookingsHref(view)).toBe("/workspace/bookings?status=confirmed&q=omar&clash=1&sort=date_desc&page=2");
    expect(bookingsHref(view, { booking: BOOKING })).toBe(`/workspace/bookings?status=confirmed&q=omar&clash=1&sort=date_desc&page=2&booking=${BOOKING}`);
  });

  it("resets the page and closes the panel when a filter changes", () => {
    const view: BookingsView = { ...DEFAULT, status: "pending", page: 4, booking: BOOKING };
    expect(filterHref(view, { status: undefined })).toBe("/workspace/bookings");
    expect(filterHref(view, { tour: TOUR })).toBe(`/workspace/bookings?status=pending&tour=${TOUR}`);
  });

  it("exports the filters without paging, sorting or the open booking", () => {
    const view: BookingsView = { ...DEFAULT, status: "confirmed", from: "2026-11-01", payment: "paid", sort: "oldest", page: 3, booking: BOOKING };
    expect(exportHref(view)).toBe("/workspace/bookings/export?status=confirmed&from=2026-11-01&payment=paid");
    expect(exportHref(DEFAULT)).toBe("/workspace/bookings/export");
  });

  it("clears filters but keeps the sort", () => {
    expect(clearedHref({ ...DEFAULT, status: "pending", q: "a", sort: "date_asc", page: 2 })).toBe("/workspace/bookings?sort=date_asc");
  });
});

describe("service input", () => {
  it("maps the view to list input", () => {
    const view: BookingsView = { ...DEFAULT, status: "pending", q: "sheki", tour: TOUR, from: "2026-11-01", to: "2026-11-30", payment: "unpaid", clash: true, sort: "date_asc", page: 3 };
    expect(toListInput(view)).toEqual({
      status: "pending",
      tourId: TOUR,
      search: "sheki",
      from: "2026-11-01",
      to: "2026-11-30",
      payment: "unpaid",
      clashOnly: true,
      sort: "date_asc",
      limit: BOOKINGS_PAGE_SIZE,
      offset: 2 * BOOKINGS_PAGE_SIZE,
    });
  });

  it("leaves the clash filter out when it is off", () => {
    expect(toBookingFilters(DEFAULT).clashOnly).toBeUndefined();
    expect(toListInput(DEFAULT).offset).toBe(0);
  });
});

describe("filter state", () => {
  it("counts the filters kept in the phone's sheet", () => {
    expect(secondaryFilterCount(DEFAULT)).toBe(0);
    expect(secondaryFilterCount({ ...DEFAULT, status: "pending", q: "a" })).toBe(0);
    expect(secondaryFilterCount({ ...DEFAULT, tour: TOUR, from: "2026-11-01", to: "2026-11-30", payment: "paid", sort: "oldest" })).toBe(5);
  });

  it("knows when the list is narrowed", () => {
    expect(isFiltered(DEFAULT)).toBe(false);
    expect(isFiltered({ ...DEFAULT, sort: "oldest", page: 2 })).toBe(false);
    expect(isFiltered({ ...DEFAULT, clash: true })).toBe(true);
    expect(isFiltered({ ...DEFAULT, q: "a" })).toBe(true);
    expect(isFiltered({ ...DEFAULT, payment: "paid" })).toBe(true);
  });
});
