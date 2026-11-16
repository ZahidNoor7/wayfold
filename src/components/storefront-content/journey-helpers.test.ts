import { describe, expect, it } from "vitest";
import {
  categoryCounts,
  destinationStats,
  entryMedia,
  filterEntries,
  groupByYear,
  journeyHref,
  parseJourneyFilters,
  projectPins,
  tileRatioClass,
} from "./journey-helpers";

const entry = (id: string, visitedOn: string | null, category: string, destination: string | null) => ({
  id,
  visitedOn,
  category,
  destination: destination ? { slug: destination } : null,
});

const ENTRIES = [
  entry("a", "2026-10-01", "Cultural", "sheki"),
  entry("b", "2026-08-01", "Adventure", "absheron"),
  entry("c", "2026-03-01", "Cultural", "baku"),
  entry("d", "2025-09-01", "Private", "baku"),
  entry("e", null, "", null),
];

describe("parseJourneyFilters", () => {
  it("defaults to everything in the gallery", () => {
    expect(parseJourneyFilters({})).toEqual({ destination: null, category: null, view: "gallery" });
  });

  it("reads destination, category and view", () => {
    expect(parseJourneyFilters({ destination: " Sheki ", category: "Cultural", view: "timeline" })).toEqual({
      destination: "sheki",
      category: "Cultural",
      view: "timeline",
    });
  });

  it("takes the first of repeated keys", () => {
    expect(parseJourneyFilters({ destination: ["baku", "sheki"], view: ["places", "gallery"] })).toMatchObject({ destination: "baku", view: "places" });
  });

  it("drops values that cannot be a slug, a category or a view", () => {
    expect(parseJourneyFilters({ destination: "../etc", category: "x".repeat(61), view: "map" })).toEqual({
      destination: null,
      category: null,
      view: "gallery",
    });
  });
});

describe("journeyHref", () => {
  it("is the bare path without filters", () => {
    expect(journeyHref({})).toBe("/journey");
    expect(journeyHref({ view: "gallery", destination: null, category: null })).toBe("/journey");
  });

  it("encodes what is set", () => {
    expect(journeyHref({ destination: "baku", category: "Food & wine", view: "places" })).toBe("/journey?destination=baku&category=Food+%26+wine&view=places");
  });

  it("round-trips through the parser", () => {
    const filters = { destination: "khinalug-quba", category: "Food & wine", view: "timeline" as const };
    const query = Object.fromEntries(new URL(journeyHref(filters), "https://example.test").searchParams);
    expect(parseJourneyFilters(query)).toEqual(filters);
  });

  it("accepts another base path", () => {
    expect(journeyHref({ destination: "baku" }, "/j")).toBe("/j?destination=baku");
  });
});

describe("filterEntries", () => {
  it("returns everything without filters", () => {
    expect(filterEntries(ENTRIES, { destination: null, category: null })).toHaveLength(5);
  });

  it("filters by destination, by category, and by both", () => {
    expect(filterEntries(ENTRIES, { destination: "baku", category: null }).map((e) => e.id)).toEqual(["c", "d"]);
    expect(filterEntries(ENTRIES, { destination: null, category: "Cultural" }).map((e) => e.id)).toEqual(["a", "c"]);
    expect(filterEntries(ENTRIES, { destination: "baku", category: "Cultural" }).map((e) => e.id)).toEqual(["c"]);
    expect(filterEntries(ENTRIES, { destination: "quba", category: null })).toEqual([]);
  });
});

describe("categoryCounts", () => {
  it("counts non-empty categories alphabetically", () => {
    expect(categoryCounts(ENTRIES)).toEqual([
      { name: "Adventure", count: 1 },
      { name: "Cultural", count: 2 },
      { name: "Private", count: 1 },
    ]);
    expect(categoryCounts([])).toEqual([]);
  });
});

describe("destinationStats", () => {
  it("counts entries and finds the latest visit per destination", () => {
    const stats = destinationStats([...ENTRIES, entry("f", "2026-11-01", "", "baku"), entry("g", null, "", "quba")]);
    expect(stats.get("baku")).toEqual({ count: 3, lastVisited: "2026-11-01" });
    expect(stats.get("sheki")).toEqual({ count: 1, lastVisited: "2026-10-01" });
    expect(stats.get("quba")).toEqual({ count: 1, lastVisited: null });
    expect(stats.has("lankaran")).toBe(false);
  });
});

describe("groupByYear", () => {
  it("groups newest year first and keeps undated entries last", () => {
    const groups = groupByYear(ENTRIES);
    expect(groups.map((group) => group.year)).toEqual(["2026", "2025", null]);
    expect(groups[0]!.items.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(groups[2]!.items.map((e) => e.id)).toEqual(["e"]);
  });

  it("has no undated group when every entry is dated", () => {
    expect(groupByYear(ENTRIES.slice(0, 4)).map((group) => group.year)).toEqual(["2026", "2025"]);
    expect(groupByYear([])).toEqual([]);
  });
});

describe("tileRatioClass", () => {
  it("picks the shape nearest the photo's proportions", () => {
    expect(tileRatioClass(1600, 1100, 0)).toBe("aspect-[16/11]");
    expect(tileRatioClass(1000, 1000, 0)).toBe("aspect-square");
    expect(tileRatioClass(800, 1000, 0)).toBe("aspect-[4/5]");
    expect(tileRatioClass(750, 1000, 0)).toBe("aspect-[3/4]");
    expect(tileRatioClass(4000, 1000, 0)).toBe("aspect-[16/11]");
  });

  it("rotates through the shapes when dimensions are unknown", () => {
    expect([0, 1, 2, 3, 4].map((index) => tileRatioClass(null, null, index))).toEqual([
      "aspect-[4/5]",
      "aspect-[3/4]",
      "aspect-square",
      "aspect-[16/11]",
      "aspect-[4/5]",
    ]);
    expect(tileRatioClass(0, 500, 1)).toBe("aspect-[3/4]");
    expect(tileRatioClass(500, undefined, -2)).toBe("aspect-square");
  });
});

describe("projectPins", () => {
  it("returns nothing when no destination has coordinates", () => {
    expect(projectPins([{ slug: "baku", latitude: null, longitude: null }])).toEqual([]);
    expect(projectPins([])).toEqual([]);
  });

  it("centres a single place", () => {
    expect(projectPins([{ slug: "baku", latitude: 40.4, longitude: 49.9 }])).toEqual([{ slug: "baku", x: 50, y: 50 }]);
  });

  it("spreads places across the panel with north at the top", () => {
    const pins = projectPins([
      { slug: "north-west", latitude: 41, longitude: 45 },
      { slug: "south-east", latitude: 39, longitude: 49 },
      { slug: "middle", latitude: 40, longitude: 47 },
      { slug: "unplaced", latitude: null, longitude: 47 },
    ]);
    expect(pins).toEqual([
      { slug: "north-west", x: 14, y: 14 },
      { slug: "south-east", x: 86, y: 86 },
      { slug: "middle", x: 50, y: 50 },
    ]);
  });

  it("centres an axis all places share and honours the margin", () => {
    const pins = projectPins(
      [
        { slug: "a", latitude: 40, longitude: 45 },
        { slug: "b", latitude: 40, longitude: 49 },
      ],
      10,
    );
    expect(pins).toEqual([
      { slug: "a", x: 10, y: 50 },
      { slug: "b", x: 90, y: 50 },
    ]);
  });
});

describe("entryMedia", () => {
  const cover = { url: "https://res.cloudinary.com/demo/cover.jpg" };
  const photos = [{ url: "https://res.cloudinary.com/demo/one.jpg" }, { url: cover.url }, { url: "https://res.cloudinary.com/demo/two.jpg" }];

  it("puts the cover first and does not repeat it", () => {
    expect(entryMedia(cover, photos).map((item) => item.url)).toEqual([cover.url, photos[0]!.url, photos[2]!.url]);
  });

  it("is just the photos when there is no cover", () => {
    expect(entryMedia(null, photos)).toEqual(photos);
    expect(entryMedia(null, [])).toEqual([]);
  });

  it("is just the cover when there are no photos", () => {
    expect(entryMedia(cover, [])).toEqual([cover]);
  });
});
