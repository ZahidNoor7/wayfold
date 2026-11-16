import { describe, expect, it } from "vitest";
import {
  aboutSchema,
  contactErrorPath,
  contactSchema,
  contactToInput,
  contactToValues,
  emptyRow,
  footerSchema,
  heroSchema,
  legalSchema,
  LIST_SPECS,
  listSchema,
  listSectionErrorPath,
  objectErrorPath,
  pagesWithErrors,
  parseTab,
  rowLabel,
  rowsFromList,
  rowsToInput,
  seoPageInfo,
  seoSchema,
} from "./site-model";

const messages = (result: { error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`);

describe("tabs", () => {
  it("falls back to the home tab", () => {
    expect(parseTab("seo")).toBe("seo");
    expect(parseTab(["about", "seo"])).toBe("about");
    expect(parseTab("nope")).toBe("home");
    expect(parseTab(undefined)).toBe("home");
  });
});

describe("list sections", () => {
  it("round-trips stored rows through the form", () => {
    const languages = [{ name: "English", level: "Fluent", percent: 92 }];
    const rows = rowsFromList(LIST_SPECS.languages, languages);
    expect(rows).toEqual([{ name: "English", level: "Fluent", percent: "92" }]);
    expect(rowsToInput(LIST_SPECS.languages, rows)).toEqual(languages);
  });

  it("keeps plain-string lists as { value } rows", () => {
    const rows = rowsFromList(LIST_SPECS.skills, ["Silk Road history", 3]);
    expect(rows).toEqual([{ value: "Silk Road history" }, { value: "" }]);
    expect(rowsToInput(LIST_SPECS.skills, [{ value: "Wine" }, {}])).toEqual(["Wine", ""]);
  });

  it("fills missing values with empty text, prints numbers and trims years", () => {
    expect(rowsFromList(LIST_SPECS.qualifications, [null, { year: "2014", title: 5 }])).toEqual([
      { year: "", title: "", issuer: "" },
      { year: "2014", title: "5", issuer: "" },
    ]);
    expect(rowsToInput(LIST_SPECS.milestones, [{ year: " 2020 ", title: "Started" }])).toEqual([{ year: "2020", title: "Started", text: "" }]);
  });

  it("creates blank rows", () => {
    expect(emptyRow(LIST_SPECS.valueProps, ["award", "car"])).toEqual({ title: "", text: "", icon: "award" });
    expect(emptyRow(LIST_SPECS.valueProps)).toEqual({ title: "", text: "", icon: "" });
    expect(emptyRow(LIST_SPECS.languages)).toEqual({ name: "", level: "", percent: "100" });
  });

  it("validates rows like the server", () => {
    const schema = listSchema(LIST_SPECS.languages);
    expect(schema.safeParse({ items: [{ name: "English", level: "", percent: "92" }] }).success).toBe(true);
    expect(messages(schema.safeParse({ items: [{ name: "", level: "", percent: "101" }] }))).toEqual([
      "items.0.name: Fill this in or remove the row.",
      "items.0.percent: Use a whole number from 0 to 100.",
    ]);
    expect(messages(schema.safeParse({ items: [{ name: "x", level: "", percent: "abc" }] }))).toEqual(["items.0.percent: Use a whole number from 0 to 100."]);
    const years = listSchema(LIST_SPECS.milestones);
    expect(messages(years.safeParse({ items: [{ year: "20", title: "t", text: "" }] }))).toEqual(["items.0.year: Use a four-digit year."]);
    const icons = listSchema(LIST_SPECS.valueProps);
    expect(messages(icons.safeParse({ items: [{ title: "t", text: "", icon: "" }] }))).toEqual(["items.0.icon: Choose an icon."]);
  });

  it("limits the number of rows", () => {
    const schema = listSchema(LIST_SPECS.stats);
    const row = { value: "12", label: "Years" };
    expect(messages(schema.safeParse({ items: Array.from({ length: 7 }, () => row) }))).toEqual(["items: You can add up to 6."]);
  });

  it("maps server errors and names rows", () => {
    expect(listSectionErrorPath(LIST_SPECS.skills, "2")).toBe("items.2.value");
    expect(listSectionErrorPath(LIST_SPECS.stats, "2.label")).toBe("items.2.label");
    expect(rowLabel(LIST_SPECS.languages, { name: " English " }, 0)).toBe("language 1: English");
    expect(rowLabel(LIST_SPECS.languages, {}, 1)).toBe("language 2");
    expect(rowLabel(LIST_SPECS.qualifications, { year: "2014", title: "Licensed guide" }, 0)).toBe("qualification 1: Licensed guide");
    expect(rowLabel(LIST_SPECS.qualifications, { year: "2014" }, 0)).toBe("qualification 1");
  });
});

describe("object sections", () => {
  it("validates the hero, about, footer and legal limits", () => {
    expect(heroSchema.safeParse({ kicker: "", headline: "Discover", headlineEmphasis: "", body: "", nowGuiding: "" }).success).toBe(true);
    expect(messages(heroSchema.safeParse({ kicker: "x".repeat(81), headline: "", headlineEmphasis: "", body: "", nowGuiding: "" }))).toEqual([
      "kicker: Keep this under 80 characters.",
    ]);
    expect(messages(aboutSchema.safeParse({ credentialLine: "<b>x</b>", shortBio: "", longBio: "", philosophyQuote: "", licenceLine: "" }))).toEqual([
      "credentialLine: Plain text only: HTML tags are not allowed.",
    ]);
    expect(footerSchema.safeParse({ blurb: "x".repeat(301) }).success).toBe(false);
    expect(legalSchema.safeParse({ privacy: "Policy", terms: "" }).success).toBe(true);
  });

  it("converts contact details both ways", () => {
    const stored = { hours: "Mon", responseTime: "Soon", mapLatitude: 40.5, mapLongitude: null, serviceLocations: ["Baku"] };
    const values = contactToValues(stored);
    expect(values).toEqual({ hours: "Mon", responseTime: "Soon", mapLatitude: "40.5", mapLongitude: "", serviceLocations: [{ value: "Baku" }] });
    expect(contactToInput(values)).toEqual(stored);
    expect(contactToInput({ ...values, mapLatitude: "abc" }).mapLatitude).toBeNull();
  });

  it("validates coordinates as a pair", () => {
    const base = { hours: "", responseTime: "", serviceLocations: [] };
    expect(contactSchema.safeParse({ ...base, mapLatitude: "", mapLongitude: "" }).success).toBe(true);
    expect(contactSchema.safeParse({ ...base, mapLatitude: "40.4", mapLongitude: "49.8" }).success).toBe(true);
    expect(messages(contactSchema.safeParse({ ...base, mapLatitude: "40.4", mapLongitude: "" }))).toEqual([
      "mapLongitude: Set both latitude and longitude, or neither.",
    ]);
    expect(messages(contactSchema.safeParse({ ...base, mapLatitude: "91", mapLongitude: "x" }))).toEqual([
      "mapLatitude: Use a latitude between -90 and 90, e.g. 40.3777.",
      "mapLongitude: Use a longitude between -180 and 180, e.g. 49.8920.",
    ]);
    expect(messages(contactSchema.safeParse({ ...base, mapLatitude: "", mapLongitude: "", serviceLocations: [{ value: "" }] }))).toEqual([
      "serviceLocations.0.value: Fill this in or remove the row.",
    ]);
  });

  it("maps contact and object server errors", () => {
    expect(contactErrorPath("serviceLocations.4")).toBe("serviceLocations.4.value");
    expect(contactErrorPath("mapLongitude")).toBe("mapLongitude");
    expect(contactErrorPath("form")).toBe("root");
    expect(contactErrorPath("")).toBe("root");
    expect(objectErrorPath("form")).toBe("root");
    expect(objectErrorPath("")).toBe("root");
    expect(objectErrorPath("home.title")).toBe("home.title");
  });
});

describe("search settings", () => {
  it("describes each page", () => {
    expect(seoPageInfo("journey")).toEqual({ label: "Journal", path: "/journey" });
    expect(seoPageInfo("gallery")).toEqual({ label: "Gallery", path: "/gallery" });
  });

  it("validates every page and finds the ones with errors", () => {
    const schema = seoSchema(["home", "about"]);
    expect(schema.safeParse({ home: { title: "Hi", description: "" }, about: { title: "", description: "" } }).success).toBe(true);
    expect(messages(schema.safeParse({ home: { title: "x".repeat(71), description: "" }, about: { title: "", description: "" } }))).toEqual([
      "home.title: Keep this under 70 characters.",
    ]);
    expect(pagesWithErrors({ about: { title: {} } }, ["home", "about"])).toEqual(["about"]);
    expect(pagesWithErrors(undefined, ["home"])).toEqual([]);
  });
});
