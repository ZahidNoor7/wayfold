import { describe, expect, it } from "vitest";
import { HERO_ROUTES, isHeroRoute, pathFromSegments, sectionOf } from "./hero-routes";

describe("pathFromSegments", () => {
  it("builds the storefront path from layout segments", () => {
    expect(pathFromSegments([])).toBe("/");
    expect(pathFromSegments(["experiences"])).toBe("/experiences");
    expect(pathFromSegments(["experiences", "silk-road-to-sheki"])).toBe("/experiences/silk-road-to-sheki");
  });

  it("drops route groups, slots and internal segments, and splits catch-alls", () => {
    expect(pathFromSegments(["(marketing)", "about"])).toBe("/about");
    expect(pathFromSegments(["__PAGE__"])).toBe("/");
    expect(pathFromSegments(["@modal", "book"])).toBe("/book");
    expect(pathFromSegments(["docs", "a/b/c"])).toBe("/docs/a/b/c");
    expect(pathFromSegments([""])).toBe("/");
  });
});

describe("isHeroRoute", () => {
  it("starts with home and the tour page", () => {
    expect(HERO_ROUTES).toEqual(["/"]);
  });

  it("matches exact paths and single dynamic segments", () => {
    expect(isHeroRoute("/")).toBe(true);
    expect(isHeroRoute("/?ref=newsletter#top")).toBe(true);
    // Dynamic segments still match when a pattern lists them.
    const routes = ["/", "/experiences/[slug]"];
    expect(isHeroRoute("/experiences/silk-road-to-sheki", routes)).toBe(true);
    expect(isHeroRoute("/experiences/silk-road-to-sheki/", routes)).toBe(true);
    expect(isHeroRoute("/experiences/silk-road-to-sheki?date=2031-04-01#itinerary", routes)).toBe(true);
    // The tour page itself opens on a light block, as in the design.
    expect(isHeroRoute("/experiences/silk-road-to-sheki")).toBe(false);
  });

  it("leaves every other page solid", () => {
    for (const path of ["/experiences", "/about", "/book", "/offers", "/experiences/a/b", "/journey", "/contact", "/privacy"]) {
      expect(isHeroRoute(path)).toBe(false);
    }
  });

  it("accepts a custom list", () => {
    expect(isHeroRoute("/about", ["/about"])).toBe(true);
    expect(isHeroRoute("/", ["/about"])).toBe(false);
    expect(isHeroRoute("/journey/autumn/photos", ["/journey/[entry]/photos"])).toBe(true);
    expect(isHeroRoute("", ["/"])).toBe(true);
  });
});

describe("sectionOf", () => {
  it("returns the top-level section of a path", () => {
    expect(sectionOf("/")).toBe("/");
    expect(sectionOf("/experiences")).toBe("/experiences");
    expect(sectionOf("/experiences/silk-road-to-sheki")).toBe("/experiences");
    expect(sectionOf("")).toBe("/");
  });
});
