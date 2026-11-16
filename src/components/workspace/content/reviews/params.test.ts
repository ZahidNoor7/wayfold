import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  DEFAULT_REVIEW_PARAMS,
  hasReviewFilters,
  parseReviewParams,
  ratingParam,
  reviewPageOutOfRange,
  reviewsListHref,
  toReviewQuery,
} from "./params";

const TOUR = "3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b";

describe("ratingParam", () => {
  it("accepts 1 to 5", () => {
    expect(ratingParam("1")).toBe(1);
    expect(ratingParam(" 5 ")).toBe(5);
    expect(ratingParam(["4", "2"])).toBe(4);
  });
  it("refuses anything else", () => {
    expect(ratingParam("0")).toBeNull();
    expect(ratingParam("6")).toBeNull();
    expect(ratingParam("4.5")).toBeNull();
    expect(ratingParam("")).toBeNull();
    expect(ratingParam(undefined)).toBeNull();
    expect(ratingParam(null)).toBeNull();
  });
});

describe("parseReviewParams", () => {
  it("returns the default view for an empty URL", () => {
    expect(parseReviewParams({})).toEqual(DEFAULT_REVIEW_PARAMS);
  });

  it("reads every filter", () => {
    expect(parseReviewParams({ status: "hidden", featured: "1", rating: "3", tour: TOUR, q: "  sheki ", page: "2" })).toEqual({
      status: "hidden",
      featured: true,
      rating: 3,
      tour: TOUR,
      q: "sheki",
      page: 2,
    });
  });

  it("falls back on unknown or hand-edited values", () => {
    const parsed = parseReviewParams({ status: "draft", featured: "yes", rating: "9", tour: "not-a-uuid", page: "-1" });
    expect(parsed).toEqual(DEFAULT_REVIEW_PARAMS);
  });

  it("cuts search text to the service limit", () => {
    expect(parseReviewParams({ q: "x".repeat(150) }).q).toHaveLength(100);
  });
});

describe("reviewsListHref", () => {
  it("leaves defaults out", () => {
    expect(reviewsListHref()).toBe("/workspace/reviews");
    expect(reviewsListHref(DEFAULT_REVIEW_PARAMS)).toBe("/workspace/reviews");
  });

  it("writes set filters", () => {
    const href = reviewsListHref({ status: "published", featured: true, rating: 5, tour: TOUR, q: " great ", page: 3 });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/workspace/reviews");
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: "published", featured: "1", rating: "5", tour: TOUR, q: "great", page: "3" });
  });

  it("round-trips through the parser", () => {
    const params = { status: "hidden" as const, featured: false, rating: 2 as const, tour: null, q: "baku", page: 4 };
    const url = new URL(reviewsListHref(params), "http://x");
    expect(parseReviewParams(Object.fromEntries(url.searchParams))).toEqual(params);
  });
});

describe("toReviewQuery", () => {
  it("maps the default view to an unfiltered first page", () => {
    expect(toReviewQuery(DEFAULT_REVIEW_PARAMS)).toEqual({ limit: 24, offset: 0 });
  });

  it("maps published and hidden", () => {
    expect(toReviewQuery({ ...DEFAULT_REVIEW_PARAMS, status: "published" })).toMatchObject({ published: true });
    expect(toReviewQuery({ ...DEFAULT_REVIEW_PARAMS, status: "hidden" })).toMatchObject({ published: false });
  });

  it("maps every other filter and the page offset", () => {
    expect(toReviewQuery({ status: "all", featured: true, rating: 4, tour: TOUR, q: "guide", page: 3 }, 10)).toEqual({
      featured: true,
      rating: 4,
      tourId: TOUR,
      search: "guide",
      limit: 10,
      offset: 20,
    });
  });
});

describe("activeFilterCount and hasReviewFilters", () => {
  it("counts filters but not search", () => {
    expect(activeFilterCount(DEFAULT_REVIEW_PARAMS)).toBe(0);
    expect(activeFilterCount({ status: "hidden", featured: true, rating: 1, tour: TOUR })).toBe(4);
  });

  it("treats search as a filter for the empty state", () => {
    expect(hasReviewFilters(DEFAULT_REVIEW_PARAMS)).toBe(false);
    expect(hasReviewFilters({ ...DEFAULT_REVIEW_PARAMS, q: "x" })).toBe(true);
    expect(hasReviewFilters({ ...DEFAULT_REVIEW_PARAMS, featured: true })).toBe(true);
  });
});

describe("reviewPageOutOfRange", () => {
  it("is null for a page inside the results", () => {
    expect(reviewPageOutOfRange(1, 0)).toBeNull();
    expect(reviewPageOutOfRange(2, 30)).toBeNull();
  });
  it("points a stale page at the last one", () => {
    expect(reviewPageOutOfRange(5, 30)).toBe(2);
    expect(reviewPageOutOfRange(3, 10, 5)).toBe(2);
  });
});
