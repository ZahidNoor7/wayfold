import { describe, expect, it } from "vitest";
import {
  describeReviewFile,
  playableReviewFiles,
  clampShown,
  DEFAULT_REVIEW_FILTERS,
  distributionRows,
  fiveStarShare,
  formatMonthYear,
  initials,
  nextShown,
  parseReviewFilters,
  plural,
  REVIEW_MAX_SHOWN,
  REVIEW_PAGE_STEP,
  reviewsHref,
  showingLine,
  starLabel,
  starString,
  wholeStars,
} from "./review-display";

const TOUR = "0b9f6c1e-3f1a-4d2b-9c57-2a1d5e8f7a10";

describe("parseReviewFilters", () => {
  it("returns the defaults for an empty query", () => {
    expect(parseReviewFilters({})).toEqual(DEFAULT_REVIEW_FILTERS);
  });

  it("reads every recognised filter", () => {
    expect(parseReviewFilters({ rating: "4", tour: TOUR.toUpperCase(), sort: "lowest", shown: "12" })).toEqual({
      rating: 4,
      tourId: TOUR,
      sort: "lowest",
      shown: 12,
    });
  });

  it("takes the first value when a key repeats", () => {
    expect(parseReviewFilters({ rating: ["5", "1"], sort: ["highest", "lowest"] })).toMatchObject({ rating: 5, sort: "highest" });
  });

  it("ignores values it does not recognise", () => {
    expect(parseReviewFilters({ rating: "6", tour: "not-a-uuid", sort: "random", shown: "-4" })).toEqual(DEFAULT_REVIEW_FILTERS);
    expect(parseReviewFilters({ rating: "2.5", shown: "abc" })).toEqual(DEFAULT_REVIEW_FILTERS);
    expect(parseReviewFilters({ rating: "0" }).rating).toBeNull();
  });
});

describe("clampShown", () => {
  it("never goes below one step", () => {
    expect(clampShown(0)).toBe(REVIEW_PAGE_STEP);
    expect(clampShown(Number.NaN)).toBe(REVIEW_PAGE_STEP);
    expect(clampShown(REVIEW_PAGE_STEP)).toBe(REVIEW_PAGE_STEP);
  });

  it("rounds up to a whole step", () => {
    expect(clampShown(7)).toBe(12);
    expect(clampShown(18)).toBe(18);
  });

  it("stops at the cap", () => {
    expect(clampShown(10_000)).toBe(REVIEW_MAX_SHOWN);
    expect(clampShown(Number.POSITIVE_INFINITY)).toBe(REVIEW_PAGE_STEP);
  });
});

describe("reviewsHref", () => {
  it("is the bare path for the defaults", () => {
    expect(reviewsHref(DEFAULT_REVIEW_FILTERS)).toBe("/reviews");
    expect(reviewsHref({})).toBe("/reviews");
  });

  it("writes only what differs from the defaults", () => {
    expect(reviewsHref({ rating: 5, tourId: TOUR, sort: "highest", shown: 18 })).toBe(`/reviews?rating=5&tour=${TOUR}&sort=highest&shown=18`);
    expect(reviewsHref({ sort: "newest", shown: 6 })).toBe("/reviews");
  });

  it("round-trips through the parser", () => {
    const filters = { rating: 3 as const, tourId: TOUR, sort: "lowest" as const, shown: 24 };
    const query = Object.fromEntries(new URL(reviewsHref(filters), "https://example.test").searchParams);
    expect(parseReviewFilters(query)).toEqual(filters);
  });

  it("accepts another base path", () => {
    expect(reviewsHref({ rating: 1 }, "/r")).toBe("/r?rating=1");
  });
});

describe("nextShown", () => {
  it("adds one step while more remain", () => {
    expect(nextShown(6, 20)).toBe(12);
  });

  it("is null once everything is visible or the cap is reached", () => {
    expect(nextShown(6, 6)).toBeNull();
    expect(nextShown(12, 4)).toBeNull();
    expect(nextShown(REVIEW_MAX_SHOWN, 10_000)).toBeNull();
  });
});

describe("initials", () => {
  it("uses the first and last name", () => {
    expect(initials("Daniel Okafor")).toBe("DO");
    expect(initials("  eleanor   whitfield ")).toBe("EW");
  });

  it("skips words that are not names", () => {
    expect(initials("Sofia & Marco Bellini")).toBe("SB");
  });

  it("handles single names, non-Latin names and empty input", () => {
    expect(initials("Leyla")).toBe("L");
    expect(initials("Əli Məmmədov")).toBe("ƏM");
    expect(initials("")).toBe("");
    expect(initials("& 42")).toBe("");
  });
});

describe("stars", () => {
  it("clamps to whole stars between 0 and 5", () => {
    expect(wholeStars(4.4)).toBe(4);
    expect(wholeStars(4.5)).toBe(5);
    expect(wholeStars(9)).toBe(5);
    expect(wholeStars(-2)).toBe(0);
    expect(wholeStars(Number.NaN)).toBe(0);
  });

  it("draws filled then empty stars", () => {
    expect(starString(4)).toBe("★★★★☆");
    expect(starString(0)).toBe("☆☆☆☆☆");
    expect(starString(5)).toBe("★★★★★");
  });

  it("labels whole and fractional ratings", () => {
    expect(starLabel(4)).toBe("4 out of 5 stars");
    expect(starLabel(4.9)).toBe("4.9 out of 5 stars");
  });
});

describe("formatMonthYear", () => {
  it("formats a calendar date without timezone drift", () => {
    expect(formatMonthYear("2026-09-18")).toBe("Sep 2026");
    expect(formatMonthYear("2026-01-01")).toBe("Jan 2026");
    expect(formatMonthYear("2026-12-31")).toBe("Dec 2026");
  });

  it("returns an empty string for anything else", () => {
    expect(formatMonthYear(null)).toBe("");
    expect(formatMonthYear(undefined)).toBe("");
    expect(formatMonthYear("")).toBe("");
    expect(formatMonthYear("Sep 2026")).toBe("");
    expect(formatMonthYear("2026-13-45")).toBe("");
    expect(formatMonthYear("2026-00-10")).toBe("");
  });
});

describe("distribution", () => {
  const summary = { total: 386, distribution: { 5: 367, 4: 15, 3: 3, 2: 1, 1: 0 } };

  it("lists five stars first with each level's share", () => {
    expect(distributionRows(summary)).toEqual([
      { rating: 5, count: 367, percent: 95.1 },
      { rating: 4, count: 15, percent: 3.9 },
      { rating: 3, count: 3, percent: 0.8 },
      { rating: 2, count: 1, percent: 0.3 },
      { rating: 1, count: 0, percent: 0 },
    ]);
  });

  it("is all zeroes when there are no reviews", () => {
    const empty = { total: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } };
    expect(distributionRows(empty).every((row) => row.count === 0 && row.percent === 0)).toBe(true);
    expect(fiveStarShare(empty)).toBeNull();
  });

  it("tolerates a level missing from the record", () => {
    const partial = { total: 2, distribution: { 5: 2 } as Record<1 | 2 | 3 | 4 | 5, number> };
    expect(distributionRows(partial).map((row) => row.count)).toEqual([2, 0, 0, 0, 0]);
    expect(fiveStarShare({ total: 2, distribution: { 4: 2 } as Record<1 | 2 | 3 | 4 | 5, number> })).toBe(0);
  });

  it("gives the five-star share as a whole percentage", () => {
    expect(fiveStarShare(summary)).toBe(95);
  });
});

describe("copy helpers", () => {
  it("picks singular or plural", () => {
    expect(plural(1, "review")).toBe("review");
    expect(plural(0, "review")).toBe("reviews");
    expect(plural(2, "entry", "entries")).toBe("entries");
  });

  it("describes what is shown", () => {
    expect(showingLine(6, 14, null)).toBe("Showing 6 of 14");
    expect(showingLine(12, 4, 4)).toBe("Showing 4 of 4 · 4-star only");
  });
});

describe("review photos and videos", () => {
  const photo = { id: "1", url: "https://res.cloudinary.com/demo/image/upload/a.jpg", alt: "", resourceType: "image" as const };
  const video = { id: "2", url: "https://res.cloudinary.com/demo/video/upload/b.mp4", alt: "Mud volcano", resourceType: "video" as const };
  const foreign = { id: "3", url: "https://example.com/c.jpg", alt: "", resourceType: "image" as const };

  it("keeps only library files, in order", () => {
    const isLibrary = (url: string) => url.startsWith("https://res.cloudinary.com/");
    expect(playableReviewFiles([photo, foreign, video], isLibrary)).toEqual([photo, video]);
    expect(playableReviewFiles([], isLibrary)).toEqual([]);
  });

  it("describes a file by its own text, or by kind, position and reviewer", () => {
    expect(describeReviewFile(video, 1, 2, "Aiko T.")).toBe("Mud volcano");
    expect(describeReviewFile(photo, 0, 2, "Aiko T.")).toBe("Photo 1 of 2 from Aiko T.");
    expect(describeReviewFile({ ...video, alt: "   " }, 1, 2, "Aiko T.")).toBe("Video 2 of 2 from Aiko T.");
  });
});
