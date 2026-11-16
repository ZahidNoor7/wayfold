import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPERIENCE_FILTERS,
  appIconLetter,
  latest,
  robotsTxt,
  shortAppName,
  sitemapXml,
  bestOffer,
  cardPrice,
  catalogueQuery,
  discountLabel,
  easeOutCubic,
  experienceSearch,
  experiencesHref,
  formatCount,
  formatDayMonth,
  formatMonthYear,
  formatStat,
  hasActiveFilters,
  heroCopy,
  initials,
  normaliseSearch,
  isCloudinaryUrl,
  offerCoverage,
  offerSaving,
  paginate,
  paragraphs,
  parseExperienceFilters,
  parseStat,
  pluralize,
  priceBandLabels,
  priceThresholds,
  sheetFilterCount,
  socialUrl,
  splitWordmark,
  type ExperienceFilters,
  type RankableOffer,
} from "./storefront-format";

const filters = (patch: Partial<ExperienceFilters> = {}): ExperienceFilters => ({ ...DEFAULT_EXPERIENCE_FILTERS, ...patch });

describe("splitWordmark", () => {
  it("splits the first word from the rest", () => {
    expect(splitWordmark("Aurelia Journeys")).toEqual({ primary: "Aurelia", rest: "Journeys" });
    expect(splitWordmark("  Caspian   Trails  & Co ")).toEqual({ primary: "Caspian", rest: "Trails & Co" });
  });

  it("gives a one-word name no sub-label, and an empty name nothing", () => {
    expect(splitWordmark("Nomad")).toEqual({ primary: "Nomad", rest: "" });
    expect(splitWordmark("   ")).toEqual({ primary: "", rest: "" });
  });
});

describe("initials", () => {
  it.each([
    ["Eleanor Whitfield", "EW"],
    ["Sofia & Marco Bellini", "SB"],
    ["aiko", "A"],
    ["Jean-Luc van der Berg", "JB"],
    ["  ", ""],
    ["& +", ""],
    ["Élodie Østergaard", "ÉØ"],
    ["“Quoted” Name", "QN"],
  ])("%s → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe("heroCopy", () => {
  const empty = { kicker: "", headline: "", headlineEmphasis: "", body: "" };
  const tenant = { name: "Aurelia Journeys", tagline: "Slow travel in the Caucasus", description: "Private tours with a local guide.", regions: ["Baku", "Sheki", "Quba", "Lankaran"] };

  it("uses the hero the business wrote", () => {
    expect(heroCopy({ kicker: "Private journeys", headline: "Discover the world", headlineEmphasis: "through local eyes.", body: "From fire-lit hills." }, tenant)).toEqual({
      kicker: "Private journeys",
      headline: "Discover the world",
      emphasis: "through local eyes.",
      body: "From fire-lit hills.",
    });
  });

  it("falls back to the profile for a business that has written nothing", () => {
    expect(heroCopy(empty, tenant)).toEqual({
      kicker: "Baku · Sheki · Quba",
      headline: "Slow travel in the Caucasus",
      emphasis: "",
      body: "Private tours with a local guide.",
    });
  });

  it("uses the name alone when there is no tagline, and never repeats the tagline", () => {
    const bare = { name: "Nomad", tagline: "", description: "", regions: [] };
    expect(heroCopy(empty, bare)).toEqual({ kicker: "", headline: "Nomad", emphasis: "", body: "" });
    expect(heroCopy(empty, { ...bare, tagline: "Walk further" })).toEqual({ kicker: "", headline: "Walk further", emphasis: "", body: "" });
    // With its own headline, the tagline becomes the supporting line.
    expect(heroCopy({ ...empty, headline: "Hello" }, { ...bare, tagline: "Walk further" }).body).toBe("Walk further");
  });

  it("drops an emphasis that has no headline to follow", () => {
    expect(heroCopy({ ...empty, headlineEmphasis: "through local eyes." }, tenant).emphasis).toBe("");
  });
});

describe("socialUrl", () => {
  it("turns a profile name into a profile link", () => {
    expect(socialUrl("instagram", "@aurelia.journeys")).toBe("https://www.instagram.com/aurelia.journeys");
    expect(socialUrl("youtube", "aurelia")).toBe("https://www.youtube.com/@aurelia");
    expect(socialUrl("facebook", "aurelia_journeys")).toBe("https://www.facebook.com/aurelia_journeys");
    expect(socialUrl("tiktok", "@aurelia")).toBe("https://www.tiktok.com/@aurelia");
  });

  it("keeps a full address and adds https to a bare one", () => {
    expect(socialUrl("instagram", "https://instagram.com/aurelia")).toBe("https://instagram.com/aurelia");
    expect(socialUrl("facebook", "facebook.com/aurelia")).toBe("https://facebook.com/aurelia");
    expect(socialUrl("youtube", "www.youtube.com")).toBe("https://www.youtube.com");
    expect(socialUrl("youtube", "http://youtube.com/c/aurelia")).toBe("http://youtube.com/c/aurelia");
  });

  it("returns no link for empty or unsafe values", () => {
    expect(socialUrl("instagram", "")).toBeNull();
    expect(socialUrl("instagram", undefined)).toBeNull();
    expect(socialUrl("instagram", null)).toBeNull();
    expect(socialUrl("instagram", "javascript:alert(1)")).toBeNull();
    expect(socialUrl("instagram", "not a handle")).toBeNull();
    expect(socialUrl("instagram", "data:text/html,x/y")).toBeNull();
  });
});

describe("isCloudinaryUrl", () => {
  it("accepts only https Cloudinary delivery URLs", () => {
    expect(isCloudinaryUrl("https://res.cloudinary.com/demo/image/upload/v1/a.jpg")).toBe(true);
    expect(isCloudinaryUrl("http://res.cloudinary.com/demo/a.jpg")).toBe(false);
    expect(isCloudinaryUrl("https://res.cloudinary.com.evil.test/a.jpg")).toBe(false);
    expect(isCloudinaryUrl("https://media.example.test/a.jpg")).toBe(false);
    expect(isCloudinaryUrl("not a url")).toBe(false);
    expect(isCloudinaryUrl(null)).toBe(false);
    expect(isCloudinaryUrl(undefined)).toBe(false);
    expect(isCloudinaryUrl("")).toBe(false);
  });
});

describe("text helpers", () => {
  it("splits paragraphs on blank lines and drops empties", () => {
    expect(paragraphs("One.\n\nTwo\nstill two.\n\n\n  \n\nThree.")).toEqual(["One.", "Two\nstill two.", "Three."]);
    expect(paragraphs("")).toEqual([]);
    expect(paragraphs(null)).toEqual([]);
    expect(paragraphs(undefined)).toEqual([]);
  });

  it("pluralizes and groups counts", () => {
    expect(pluralize(1, "experience", "experiences")).toBe("experience");
    expect(pluralize(0, "experience", "experiences")).toBe("experiences");
    expect(pluralize(7, "experience", "experiences")).toBe("experiences");
    expect(formatCount(1284)).toBe("1,284");
  });
});

describe("dates", () => {
  it("formats calendar dates without timezone drift", () => {
    expect(formatDayMonth("2026-12-15")).toBe("15 December");
    expect(formatDayMonth("2026-12-15", "short")).toBe("15 Dec");
    expect(formatDayMonth("2027-01-01", "short")).toBe("1 Jan");
    expect(formatMonthYear("2026-10-01")).toBe("Oct 2026");
    expect(formatMonthYear("2026-10-31", "long")).toBe("October 2026");
  });

  it("returns an empty string for a missing or invalid date", () => {
    expect(formatDayMonth("soon")).toBe("");
    expect(formatDayMonth("2026-02-30")).toBe("");
    expect(formatMonthYear(null)).toBe("");
    expect(formatMonthYear(undefined)).toBe("");
    expect(formatMonthYear("2026-13-01")).toBe("");
  });
});

describe("discountLabel", () => {
  it("words percentages and fixed amounts", () => {
    expect(discountLabel("percent", 15, "USD")).toBe("15% off");
    expect(discountLabel("fixed", 30_000, "USD")).toBe("$300 off");
    expect(discountLabel("fixed", 2_550, "EUR")).toBe("€25.50 off");
  });
});

describe("cardPrice", () => {
  const offer = { name: "Autumn in the Caucasus", type: "percent" as const, value: 15, endsOn: "2026-12-15" };

  it("shows the list price when there is no offer", () => {
    const plain = { now: "$690", original: null, badge: null, offerLine: null, onOffer: false };
    expect(cardPrice(69_000, undefined, "USD")).toEqual(plain);
    expect(cardPrice(69_000, null, "USD")).toEqual(plain);
    expect(cardPrice(69_000, { discountedPriceAdult: null, offer: null }, "USD")).toEqual(plain);
  });

  it("strikes the list price for a percentage offer", () => {
    expect(cardPrice(69_000, { discountedPriceAdult: 58_650, offer }, "USD")).toEqual({
      now: "$586.50",
      original: "$690",
      badge: "−15%",
      offerLine: "Autumn in the Caucasus · Ends 15 Dec",
      onOffer: true,
    });
  });

  it("keeps the per-person price for a fixed offer and says it is per booking", () => {
    const fixed = { name: "Early bird", type: "fixed" as const, value: 30_000, endsOn: "2027-01-31" };
    expect(cardPrice(245_000, { discountedPriceAdult: null, offer: fixed }, "USD")).toEqual({
      now: "$2,450",
      original: null,
      badge: "$300 off per booking",
      offerLine: "Early bird · Ends 31 Jan",
      onOffer: true,
    });
  });

  it("never strikes a price that is not actually lower", () => {
    expect(cardPrice(69_000, { discountedPriceAdult: 69_000, offer }, "USD")).toMatchObject({ now: "$690", original: null, badge: "−15%", onOffer: true });
    expect(cardPrice(69_000, { discountedPriceAdult: null, offer }, "USD")).toMatchObject({ now: "$690", original: null, badge: "−15%" });
  });

  it("omits the end date when it is not a calendar date", () => {
    expect(cardPrice(69_000, { discountedPriceAdult: 58_650, offer: { ...offer, endsOn: "" } }, "USD").offerLine).toBe("Autumn in the Caucasus");
  });
});

describe("bestOffer", () => {
  const make = (patch: Partial<RankableOffer> & { id: string }): RankableOffer & { id: string } => ({
    type: "percent",
    value: 10,
    endsOn: "2026-12-31",
    isConditional: false,
    tours: [{ priceAdult: 10_000 }],
    ...patch,
  });

  it("measures the saving on one adult ticket of the dearest covered tour", () => {
    expect(offerSaving(make({ id: "a", value: 15, tours: [{ priceAdult: 48_000 }, { priceAdult: 69_000 }] }))).toBe(10_350);
    expect(offerSaving(make({ id: "b", type: "fixed", value: 30_000, tours: [{ priceAdult: 12_000 }, { priceAdult: 245_000 }] }))).toBe(30_000);
    // A fixed amount cannot save more than the ticket costs.
    expect(offerSaving(make({ id: "c", type: "fixed", value: 30_000, tours: [{ priceAdult: 12_000 }] }))).toBe(12_000);
    expect(offerSaving(make({ id: "d", tours: [] }))).toBe(0);
    expect(offerSaving(make({ id: "e", value: 0 }))).toBe(0);
    expect(offerSaving(make({ id: "f", tours: [{ priceAdult: 0 }] }))).toBe(0);
  });

  it("picks by value, not by position", () => {
    const small = make({ id: "small", value: 8 });
    const big = make({ id: "big", type: "fixed", value: 30_000, tours: [{ priceAdult: 245_000 }] });
    const medium = make({ id: "medium", value: 15, tours: [{ priceAdult: 69_000 }] });
    expect(bestOffer([small, big, medium])?.id).toBe("big");
    expect(bestOffer([medium, small, big])?.id).toBe("big");
    expect(bestOffer([small, medium])?.id).toBe("medium");
  });

  it("breaks a tie with the unconditional offer, then the one ending first", () => {
    const conditional = make({ id: "conditional", isConditional: true });
    const open = make({ id: "open" });
    expect(bestOffer([conditional, open])?.id).toBe("open");
    expect(bestOffer([open, conditional])?.id).toBe("open");

    const later = make({ id: "later", endsOn: "2027-03-01" });
    const sooner = make({ id: "sooner", endsOn: "2026-11-30" });
    expect(bestOffer([later, sooner])?.id).toBe("sooner");
    expect(bestOffer([sooner, later])?.id).toBe("sooner");
  });

  it("returns null when nothing saves anything", () => {
    expect(bestOffer([])).toBeNull();
    expect(bestOffer([make({ id: "empty", tours: [] })])).toBeNull();
  });
});

describe("offerCoverage", () => {
  const tours = [{ title: "Silk Road to Sheki" }, { title: "Khinalug Highlands" }, { title: "Fire & Stone" }, { title: "Old City" }];

  it("describes the tours an offer covers", () => {
    expect(offerCoverage({ appliesToAllTours: true, tours })).toBe("All experiences");
    expect(offerCoverage({ appliesToAllTours: false, tours: tours.slice(0, 1) })).toBe("Silk Road to Sheki");
    expect(offerCoverage({ appliesToAllTours: false, tours: tours.slice(0, 2) })).toBe("Silk Road to Sheki, Khinalug Highlands");
    expect(offerCoverage({ appliesToAllTours: false, tours })).toBe("Silk Road to Sheki, Khinalug Highlands and 2 more");
    expect(offerCoverage({ appliesToAllTours: false, tours }, 3)).toBe("Silk Road to Sheki, Khinalug Highlands, Fire & Stone and 1 more");
  });
});

describe("stats", () => {
  it("splits a figure around its first number", () => {
    expect(parseStat("2,900+")).toEqual({ prefix: "", number: 2900, decimals: 0, grouped: true, suffix: "+" });
    expect(parseStat("4.9 / 5")).toEqual({ prefix: "", number: 4.9, decimals: 1, grouped: false, suffix: " / 5" });
    expect(parseStat("$1.25M")).toEqual({ prefix: "$", number: 1.25, decimals: 2, grouped: false, suffix: "M" });
    expect(parseStat("48")).toEqual({ prefix: "", number: 48, decimals: 0, grouped: false, suffix: "" });
  });

  it("has nothing to count in a figure without digits", () => {
    expect(parseStat("Since forever")).toBeNull();
    expect(parseStat("")).toBeNull();
  });

  it("formats every step like the original figure", () => {
    const guests = parseStat("2,900+")!;
    expect(formatStat(guests, 0)).toBe("0+");
    expect(formatStat(guests, 0.5)).toBe("1,450+");
    expect(formatStat(guests, 1)).toBe("2,900+");
    const rating = parseStat("4.9 / 5")!;
    expect(formatStat(rating, 0.5)).toBe("2.5 / 5");
    expect(formatStat(rating, 1)).toBe("4.9 / 5");
    // Progress outside 0…1 is clamped.
    expect(formatStat(guests, 2)).toBe("2,900+");
    expect(formatStat(guests, -1)).toBe("0+");
  });

  it("eases out", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(easeOutCubic(3)).toBe(1);
    expect(easeOutCubic(-3)).toBe(0);
  });
});

describe("parseExperienceFilters", () => {
  it("returns the defaults for an empty URL", () => {
    expect(parseExperienceFilters({})).toEqual(DEFAULT_EXPERIENCE_FILTERS);
  });

  it("reads every filter", () => {
    expect(
      parseExperienceFilters({
        q: "  silk   road ",
        category: "Cultural",
        destination: "sheki",
        duration: "short",
        price: "mid",
        offer: "1",
        sort: "price_asc",
        page: "3",
      }),
    ).toEqual({ q: "silk road", category: "cultural", destination: "sheki", duration: "short", price: "mid", onOffer: true, sort: "price_asc", page: 3 });
  });

  it("uses the first value of a repeated parameter", () => {
    expect(parseExperienceFilters({ category: ["family", "private"], sort: ["rating", "duration"] })).toMatchObject({ category: "family", sort: "rating" });
  });

  it("ignores anything it does not recognise", () => {
    expect(
      parseExperienceFilters({
        category: "../etc",
        destination: "a".repeat(120),
        duration: "forever",
        price: "free",
        offer: "yes",
        sort: "random",
        page: "-2",
      }),
    ).toEqual(DEFAULT_EXPERIENCE_FILTERS);
    expect(parseExperienceFilters({ page: "abc" }).page).toBe(1);
    expect(parseExperienceFilters({ page: "9999" }).page).toBe(1);
    expect(parseExperienceFilters({ q: "x".repeat(300) }).q).toHaveLength(100);
  });
});

describe("normaliseSearch", () => {
  it("trims, collapses whitespace and caps the length", () => {
    expect(normaliseSearch("  silk \n  road  ")).toBe("silk road");
    expect(normaliseSearch("   ")).toBe("");
    expect(normaliseSearch("y".repeat(140))).toHaveLength(100);
  });
});

describe("experienceSearch", () => {
  it("leaves defaults out of the URL", () => {
    expect(experienceSearch(filters())).toBe("");
    expect(experiencesHref()).toBe("/experiences");
  });

  it("round-trips through the parser", () => {
    const state = filters({ q: "tea & forest", category: "family", destination: "lankaran", duration: "long", price: "high", onOffer: true, sort: "rating", page: 2 });
    const search = experienceSearch(state);
    expect(search).toBe("?q=tea+%26+forest&category=family&destination=lankaran&duration=long&price=high&offer=1&sort=rating&page=2");
    expect(parseExperienceFilters(Object.fromEntries(new URLSearchParams(search)))).toEqual(state);
  });

  it("builds deep links for one filter", () => {
    expect(experiencesHref({ destination: "sheki" })).toBe("/experiences?destination=sheki");
    expect(experiencesHref({ onOffer: true })).toBe("/experiences?offer=1");
  });
});

describe("filter counts", () => {
  it("counts only the filters inside the mobile sheet", () => {
    expect(sheetFilterCount(filters())).toBe(0);
    expect(sheetFilterCount(filters({ q: "tea", category: "family", onOffer: true, sort: "rating" }))).toBe(0);
    expect(sheetFilterCount(filters({ destination: "sheki" }))).toBe(1);
    expect(sheetFilterCount(filters({ destination: "sheki", duration: "day", price: "low" }))).toBe(3);
  });

  it("knows when there is anything to clear", () => {
    expect(hasActiveFilters(filters())).toBe(false);
    expect(hasActiveFilters(filters({ page: 4 }))).toBe(false);
    for (const patch of [{ q: "x" }, { category: "a" }, { destination: "b" }, { duration: "day" }, { price: "low" }, { onOffer: true }, { sort: "rating" }] as const) {
      expect(hasActiveFilters(filters(patch))).toBe(true);
    }
  });
});

describe("priceThresholds", () => {
  it("cuts the design catalogue at $300 and $1,000", () => {
    expect(priceThresholds(8_500, 320_000, "USD")).toEqual({ low: 30_000, high: 100_000 });
  });

  it("works in a currency without minor units", () => {
    const yen = priceThresholds(9_000, 480_000, "JPY");
    expect(yen).toEqual({ low: 30_000, high: 150_000 });
    expect(priceBandLabels(yen!, "JPY")).toEqual({ low: "Under ¥30,000", mid: "¥30,000 – ¥150,000", high: "¥150,000+" });
  });

  it("offers no bands when prices are missing or too close together", () => {
    expect(priceThresholds(0, 50_000, "USD")).toBeNull();
    expect(priceThresholds(50_000, 50_000, "USD")).toBeNull();
    expect(priceThresholds(50_000, 40_000, "USD")).toBeNull();
    expect(priceThresholds(10_000, 12_000, "USD")).toBeNull();
    expect(priceThresholds(Number.NaN, 12_000, "USD")).toBeNull();
  });

  it("labels the bands in the tenant's currency", () => {
    expect(priceBandLabels({ low: 30_000, high: 100_000 }, "USD")).toEqual({ low: "Under $300", mid: "$300 – $1,000", high: "$1,000+" });
  });
});

describe("catalogueQuery", () => {
  const thresholds = { low: 30_000, high: 100_000 };

  it("passes only the sort for the default state", () => {
    expect(catalogueQuery(filters(), thresholds)).toEqual({ sort: "popular" });
  });

  it("maps search, category and destination", () => {
    expect(catalogueQuery(filters({ q: "sheki", category: "cultural", destination: "sheki", sort: "rating" }), null)).toEqual({
      search: "sheki",
      category: "cultural",
      destination: "sheki",
      sort: "rating",
    });
  });

  it("maps the length buckets to whole days", () => {
    expect(catalogueQuery(filters({ duration: "day" }), null)).toEqual({ sort: "popular", maxDuration: 1 });
    expect(catalogueQuery(filters({ duration: "short" }), null)).toEqual({ sort: "popular", minDuration: 2, maxDuration: 3 });
    expect(catalogueQuery(filters({ duration: "long" }), null)).toEqual({ sort: "popular", minDuration: 4 });
  });

  it("maps the budget bands without overlap", () => {
    expect(catalogueQuery(filters({ price: "low" }), thresholds)).toEqual({ sort: "popular", priceMax: 29_999 });
    expect(catalogueQuery(filters({ price: "mid" }), thresholds)).toEqual({ sort: "popular", priceMin: 30_000, priceMax: 100_000 });
    expect(catalogueQuery(filters({ price: "high" }), thresholds)).toEqual({ sort: "popular", priceMin: 100_001 });
  });

  it("ignores a budget band when the catalogue has none", () => {
    expect(catalogueQuery(filters({ price: "mid" }), null)).toEqual({ sort: "popular" });
  });
});

describe("paginate", () => {
  it("clamps the page to what exists", () => {
    expect(paginate(0, 1)).toEqual({ page: 1, pages: 1, offset: 0 });
    expect(paginate(24, 1)).toEqual({ page: 1, pages: 1, offset: 0 });
    expect(paginate(25, 2)).toEqual({ page: 2, pages: 2, offset: 24 });
    expect(paginate(25, 9)).toEqual({ page: 2, pages: 2, offset: 24 });
    expect(paginate(25, 0)).toEqual({ page: 1, pages: 2, offset: 0 });
    expect(paginate(30, 3, 10)).toEqual({ page: 3, pages: 3, offset: 20 });
  });
});

describe("app naming", () => {
  it("keeps a name that fits and shortens one that does not", () => {
    expect(shortAppName("Aurelia")).toBe("Aurelia");
    expect(shortAppName(" Nomad Tours ")).toBe("Nomad Tours");
    expect(shortAppName("Aurelia Journeys")).toBe("Aurelia");
    expect(shortAppName("Transcaucasian Expeditions")).toBe("Transcaucasi");
    expect(shortAppName("Aurelia Journeys", 20)).toBe("Aurelia Journeys");
  });

  it("draws one letter on the icon", () => {
    expect(appIconLetter("aurelia journeys")).toBe("A");
    expect(appIconLetter("Élan")).toBe("É");
    expect(appIconLetter("  ")).toBe("•");
  });
});

describe("sitemap and robots", () => {
  it("finds the latest date", () => {
    const older = new Date("2031-01-01T00:00:00Z");
    const newer = new Date("2031-03-01T00:00:00Z");
    expect(latest([older, null, newer, undefined])).toBe(newer);
    expect(latest([newer, older])).toBe(newer);
    expect(latest([])).toBeNull();
    expect(latest([null])).toBeNull();
  });

  it("lists every entry on the given origin, with lastmod where known", () => {
    const xml = sitemapXml("https://aurelia.wayfold.com", [
      { path: "/" },
      { path: "/experiences/silk-road-to-sheki", lastModified: new Date("2031-03-10T08:30:00Z") },
      { path: "/about", lastModified: null },
    ]);
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url><loc>https://aurelia.wayfold.com/</loc></url>",
        "  <url><loc>https://aurelia.wayfold.com/experiences/silk-road-to-sheki</loc><lastmod>2031-03-10T08:30:00.000Z</lastmod></url>",
        "  <url><loc>https://aurelia.wayfold.com/about</loc></url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
  });

  it("encodes anything unusual in a path", () => {
    const xml = sitemapXml("https://a.test", [{ path: "/journey/tea & <forest>" }, { path: "/journey/it's" }]);
    expect(xml).toContain("<loc>https://a.test/journey/tea%20%26%20%3Cforest%3E</loc>");
    expect(xml).toContain("<loc>https://a.test/journey/it&apos;s</loc>");
    expect(sitemapXml("https://a.test/?x=1&y=\"2\"", [{ path: "/" }])).toContain("<loc>https://a.test/?x=1&amp;y=&quot;2&quot;/</loc>");
    expect(sitemapXml("https://a.test", [])).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n');
  });

  it("allows every crawler and points at the sitemap on the same host", () => {
    expect(robotsTxt("https://aurelia.wayfold.com")).toBe("User-agent: *\nAllow: /\n\nSitemap: https://aurelia.wayfold.com/sitemap.xml\n");
    expect(robotsTxt(null)).toBe("User-agent: *\nAllow: /\n");
  });
});

describe("languageName", () => {
  it("turns language codes into names and leaves names alone", async () => {
    const { languageName } = await import("./storefront-format");
    expect(languageName("en")).toBe("English");
    expect(languageName("az")).toBe("Azerbaijani");
    expect(languageName("pt-BR")).toBe("Brazilian Portuguese");
    expect(languageName("Russian")).toBe("Russian");
    expect(languageName(" de ")).toBe("German");
    expect(languageName("zz")).toBe("zz");
  });
});
