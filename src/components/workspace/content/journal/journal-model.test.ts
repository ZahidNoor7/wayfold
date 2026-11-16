import { describe, expect, it } from "vitest";
import {
  entryHref,
  entryLiveUrl,
  entryMeta,
  journalDefaults,
  journalErrorPath,
  journalFormSchema,
  journalHref,
  journalListInput,
  parseJournalParams,
  pickedPhotos,
  slugFromTitle,
  toJourneyInput,
  type JournalEntryData,
  type JournalFormValues,
} from "./journal-model";

const entry: JournalEntryData = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Autumn in Sheki",
  slug: "autumn-in-sheki",
  destinationId: "22222222-2222-4222-8222-222222222222",
  location: "Sheki",
  visitedOn: "2026-10-01",
  category: "Culture",
  teaser: "Silk and walnuts",
  description: "Long text",
  highlights: ["Caravanserai", "Palace"],
  coverMediaId: "33333333-3333-4333-8333-333333333333",
  coverUrl: "https://res.cloudinary.com/x/cover.jpg",
  relatedTourId: null,
  isPublished: true,
  photos: [{ id: "p1", url: "https://res.cloudinary.com/x/1.jpg", alt: "One", resourceType: "image" }],
};

describe("list params", () => {
  it("parses defaults and valid values", () => {
    expect(parseJournalParams({})).toEqual({ status: "all", q: "", page: 1 });
    expect(parseJournalParams({ status: "draft", q: "  sheki ", page: "3" })).toEqual({ status: "draft", q: "sheki", page: 3 });
    expect(parseJournalParams({ status: "bogus", page: "-2" }).status).toBe("all");
    expect(parseJournalParams({ q: "x".repeat(150) }).q).toHaveLength(100);
  });

  it("builds clean hrefs", () => {
    expect(journalHref()).toBe("/workspace/journal");
    expect(journalHref({ status: "all", q: " ", page: 1 })).toBe("/workspace/journal");
    expect(journalHref({ status: "published", q: "baku", page: 2 })).toBe("/workspace/journal?status=published&q=baku&page=2");
    expect(entryHref("abc")).toBe("/workspace/journal/abc");
  });

  it("maps the view to service filters", () => {
    expect(journalListInput({ status: "all", q: "", page: 1 })).toEqual({ limit: 24, offset: 0 });
    expect(journalListInput({ status: "published", q: " baku ", page: 2 })).toEqual({ published: true, search: "baku", limit: 24, offset: 24 });
    expect(journalListInput({ status: "draft", q: "", page: 1 })).toMatchObject({ published: false });
  });
});

describe("display helpers", () => {
  it("builds the live url", () => {
    expect(entryLiveUrl("https://acme.example.com/", "autumn")).toBe("https://acme.example.com/journey/autumn");
  });

  it("describes an entry", () => {
    expect(entryMeta({ location: "Sheki", visitedOn: "2026-10-01", photoCount: 12 })).toBe("Sheki · Oct 2026 · 12 photos");
    expect(entryMeta({ location: " ", visitedOn: null, photoCount: 1 })).toBe("Undated · 1 photo");
  });

  it("previews a slug like the server", () => {
    expect(slugFromTitle("  Autumn in Şeki!  ")).toBe("autumn-in-seki");
    expect(slugFromTitle("a".repeat(80) + " b")).toHaveLength(72);
    expect(slugFromTitle("!!!")).toBe("");
  });
});

describe("form values", () => {
  it("starts empty for a new entry", () => {
    const values = journalDefaults(null);
    expect(values).toMatchObject({ title: "", highlights: [], photos: [], cover: null, isPublished: false });
  });

  it("loads an existing entry", () => {
    const values = journalDefaults(entry);
    expect(values.visitedMonth).toBe("2026-10");
    expect(values.highlights).toEqual([{ value: "Caravanserai" }, { value: "Palace" }]);
    expect(values.cover).toEqual({ id: entry.coverMediaId, url: entry.coverUrl });
    expect(values.relatedTourId).toBe("");
    expect(journalDefaults({ ...entry, coverUrl: null, destinationId: null }).cover).toBeNull();
  });

  it("converts to service input", () => {
    const values: JournalFormValues = { ...journalDefaults(entry), slug: " Autumn-Sheki ", highlights: [{ value: " Palace " }], relatedTourId: "t1" };
    expect(toJourneyInput(values)).toEqual({
      title: "Autumn in Sheki",
      slug: "autumn-sheki",
      destinationId: entry.destinationId,
      location: "Sheki",
      visitedOn: "2026-10-01",
      category: "Culture",
      teaser: "Silk and walnuts",
      description: "Long text",
      highlights: ["Palace"],
      coverMediaId: entry.coverMediaId,
      relatedTourId: "t1",
      mediaIds: ["p1"],
      isPublished: true,
    });
    const blank = toJourneyInput(journalDefaults(null));
    expect(blank).not.toHaveProperty("slug");
    expect(blank).toMatchObject({ destinationId: null, visitedOn: null, coverMediaId: null, relatedTourId: null, mediaIds: [] });
  });

  it("validates like the server", () => {
    const ok = journalFormSchema.safeParse({ ...journalDefaults(null), title: "Baku" });
    expect(ok.success).toBe(true);
    const bad = journalFormSchema.safeParse({
      ...journalDefaults(null),
      title: "Ba",
      slug: "Bad slug",
      visitedMonth: "2026-13",
      teaser: "<b>hi</b>",
      highlights: [{ value: " " }],
    });
    expect(bad.success).toBe(false);
    const paths = bad.error!.issues.map((issue) => issue.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["title", "slug", "visitedMonth", "teaser", "highlights.0.value"]));
  });
});

describe("errors and photos", () => {
  it("maps service error keys to form paths", () => {
    expect(journalErrorPath("")).toBe("root");
    expect(journalErrorPath("form")).toBe("root");
    expect(journalErrorPath("highlights.3")).toBe("highlights.3.value");
    expect(journalErrorPath("highlights")).toBe("highlights");
    expect(journalErrorPath("visitedOn")).toBe("visitedMonth");
    expect(journalErrorPath("coverMediaId")).toBe("cover");
    expect(journalErrorPath("mediaIds.2")).toBe("photos");
    expect(journalErrorPath("title")).toBe("title");
  });

  it("deduplicates and caps the photo set", () => {
    const photo = (id: string) => ({ id, url: `u${id}`, alt: "", resourceType: "image" as const });
    expect(pickedPhotos([photo("a"), photo("b"), photo("a")]).map((p) => p.id)).toEqual(["a", "b"]);
    expect(pickedPhotos(Array.from({ length: 45 }, (_, i) => photo(String(i))))).toHaveLength(40);
  });
});
