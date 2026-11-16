import { describe, expect, it } from "vitest";
import { activeFilterCount, durationText, pageCount, parseTourListParams, toListQuery, tourListHref, type TourListParams } from "./tour-list-params";

const CATEGORY = "0b9f6c1e-6c0b-4a57-9d5e-2f1a3b4c5d6e";
const none: TourListParams = { status: "all", category: "", search: "", featured: false, page: 1 };

describe("parseTourListParams", () => {
  it("defaults to everything on the first page", () => {
    expect(parseTourListParams({})).toEqual(none);
  });

  it("reads each filter", () => {
    expect(parseTourListParams({ status: "draft", category: CATEGORY, q: "  sheki ", featured: "1", page: "3" })).toEqual({
      status: "draft",
      category: CATEGORY,
      search: "sheki",
      featured: true,
      page: 3,
    });
  });

  it("ignores values it does not recognise", () => {
    expect(parseTourListParams({ status: "deleted", category: "abc", featured: "yes", page: "-2" })).toEqual(none);
    expect(parseTourListParams({ page: "x" }).page).toBe(1);
    expect(parseTourListParams({ page: "999999" }).page).toBe(10_000);
    expect(parseTourListParams({ q: "x".repeat(150) }).search).toHaveLength(100);
  });

  it("takes the first of a repeated parameter", () => {
    expect(parseTourListParams({ status: ["archived", "draft"], q: [] }).status).toBe("archived");
    expect(parseTourListParams({ q: [] }).search).toBe("");
  });
});

describe("tourListHref", () => {
  it("links to the bare list when nothing is filtered", () => {
    expect(tourListHref(none)).toBe("/workspace/tours");
  });

  it("writes only the filters that are on", () => {
    expect(tourListHref(none, { status: "published" })).toBe("/workspace/tours?status=published");
    expect(tourListHref({ ...none, status: "draft", search: "old city", featured: true, category: CATEGORY })).toBe(
      `/workspace/tours?status=draft&category=${CATEGORY}&q=old+city&featured=1`,
    );
  });

  it("returns to the first page when a filter changes, and keeps filters when paging", () => {
    const onPageThree = { ...none, status: "published" as const, page: 3 };
    expect(tourListHref(onPageThree, { search: "wine" })).toBe("/workspace/tours?status=published&q=wine");
    expect(tourListHref(onPageThree, { page: 4 })).toBe("/workspace/tours?status=published&page=4");
    expect(tourListHref(onPageThree, { page: 1 })).toBe("/workspace/tours?status=published");
  });
});

describe("toListQuery", () => {
  it("asks for the right slice", () => {
    expect(toListQuery(none)).toEqual({ limit: 20, offset: 0 });
    expect(toListQuery({ status: "archived", category: CATEGORY, search: "tea", featured: true, page: 3 })).toEqual({
      status: "archived",
      categoryId: CATEGORY,
      search: "tea",
      featured: true,
      limit: 20,
      offset: 40,
    });
  });
});

describe("list summaries", () => {
  it("counts pages", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(20)).toBe(1);
    expect(pageCount(21)).toBe(2);
  });

  it("counts active filters, leaving the status tab out", () => {
    expect(activeFilterCount(none)).toBe(0);
    expect(activeFilterCount({ ...none, status: "draft" })).toBe(0);
    expect(activeFilterCount({ ...none, category: CATEGORY, search: "x", featured: true })).toBe(3);
  });

  it("describes a tour's length", () => {
    expect(durationText({ durationLabel: " 6 hours ", durationDays: 1 })).toBe("6 hours");
    expect(durationText({ durationLabel: "", durationDays: 1 })).toBe("1 day");
    expect(durationText({ durationLabel: "", durationDays: 3 })).toBe("3 days");
  });
});
