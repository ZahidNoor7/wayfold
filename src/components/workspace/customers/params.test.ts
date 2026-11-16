import { describe, expect, it } from "vitest";
import {
  CUSTOMER_SORT_LABELS,
  CUSTOMER_SORTS,
  customerHref,
  customersExportHref,
  customersHref,
  MAX_SEARCH_LENGTH,
  pageOutOfRange,
  parseCustomerParams,
} from "./params";

describe("parseCustomerParams", () => {
  it("returns the default view for an empty URL", () => {
    expect(parseCustomerParams({})).toEqual({ q: "", sort: "name", page: 1 });
  });

  it("reads search, sort and page", () => {
    expect(parseCustomerParams({ q: "  eleanor ", sort: "top_spenders", page: "3" })).toEqual({ q: "eleanor", sort: "top_spenders", page: 3 });
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseCustomerParams({ q: ["a", "b"], sort: ["newest", "name"], page: ["2", "9"] })).toEqual({ q: "a", sort: "newest", page: 2 });
  });

  it("ignores an unknown sort and a malformed page", () => {
    expect(parseCustomerParams({ sort: "drop table", page: "-4" })).toEqual({ q: "", sort: "name", page: 1 });
    expect(parseCustomerParams({ page: "abc" }).page).toBe(1);
    expect(parseCustomerParams({ page: "0" }).page).toBe(1);
  });

  it("cuts search text the service would refuse", () => {
    const parsed = parseCustomerParams({ q: "x".repeat(MAX_SEARCH_LENGTH + 40) });
    expect(parsed.q).toHaveLength(MAX_SEARCH_LENGTH);
  });
});

describe("customersHref", () => {
  it("is the bare path for the default view", () => {
    expect(customersHref()).toBe("/workspace/customers");
    expect(customersHref({ q: "", sort: "name", page: 1 })).toBe("/workspace/customers");
    expect(customersHref({ q: "   " })).toBe("/workspace/customers");
  });

  it("includes only what differs from the default", () => {
    expect(customersHref({ q: "omar haddad" })).toBe("/workspace/customers?q=omar+haddad");
    expect(customersHref({ sort: "recent_booking" })).toBe("/workspace/customers?sort=recent_booking");
    expect(customersHref({ q: "a&b", sort: "newest", page: 2 })).toBe("/workspace/customers?q=a%26b&sort=newest&page=2");
  });

  it("round-trips through parseCustomerParams", () => {
    const view = { q: "claire@example.com", sort: "top_spenders" as const, page: 4 };
    const query = new URL(customersHref(view), "http://app.localhost").searchParams;
    expect(parseCustomerParams(Object.fromEntries(query))).toEqual(view);
  });
});

describe("customersExportHref", () => {
  it("carries the current search and nothing else", () => {
    expect(customersExportHref("")).toBe("/workspace/customers/export");
    expect(customersExportHref(" priya ")).toBe("/workspace/customers/export?q=priya");
  });
});

describe("customerHref", () => {
  it("links to the profile page", () => {
    expect(customerHref("0b0e1a3c-1111-4222-8333-444455556666")).toBe("/workspace/customers/0b0e1a3c-1111-4222-8333-444455556666");
  });
});

describe("pageOutOfRange", () => {
  it("accepts pages inside the results", () => {
    expect(pageOutOfRange(1, 0)).toBeNull();
    expect(pageOutOfRange(1, 10)).toBeNull();
    expect(pageOutOfRange(2, 26)).toBeNull();
  });

  it("points at the last page when the requested one is past the end", () => {
    expect(pageOutOfRange(3, 26)).toBe(2);
    expect(pageOutOfRange(5, 0)).toBe(1);
    expect(pageOutOfRange(4, 30, 10)).toBe(3);
  });
});

describe("sort labels", () => {
  it("names every sort the service accepts", () => {
    for (const sort of CUSTOMER_SORTS) expect(CUSTOMER_SORT_LABELS[sort]).toBeTruthy();
  });
});
