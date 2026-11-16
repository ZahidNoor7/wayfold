import { describe, expect, it } from "vitest";
import { excerpt, firstText, lgColumns, mosaicPlan, quoted, toParagraphs } from "./text";

describe("toParagraphs", () => {
  it("returns nothing for empty input", () => {
    expect(toParagraphs("")).toEqual([]);
    expect(toParagraphs(null)).toEqual([]);
    expect(toParagraphs(undefined)).toEqual([]);
    expect(toParagraphs("  \n\n \n")).toEqual([]);
  });

  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    expect(toParagraphs("First line\nsecond line\n\nNext paragraph")).toEqual([["First line", "second line"], ["Next paragraph"]]);
  });

  it("normalises Windows and old Mac line endings and stray whitespace", () => {
    expect(toParagraphs("One\r\n\r\nTwo\rThree\n \t\n\n\nFour  ")).toEqual([["One"], ["Two", "Three"], ["Four"]]);
  });

  it("leaves markup as text", () => {
    expect(toParagraphs("<script>alert(1)</script>")).toEqual([["<script>alert(1)</script>"]]);
  });
});

describe("quoted", () => {
  it("adds typographic quotes", () => {
    expect(quoted(" Travel slowly. ")).toBe("“Travel slowly.”");
  });

  it("keeps the author's own quote marks", () => {
    expect(quoted("“Already quoted.”")).toBe("“Already quoted.”");
    expect(quoted('"Straight quotes"')).toBe('"Straight quotes"');
    expect(quoted("«Guillemets»")).toBe("«Guillemets»");
  });

  it("is empty for empty input", () => {
    expect(quoted("   ")).toBe("");
  });
});

describe("firstText", () => {
  it("returns the first non-empty candidate, trimmed", () => {
    expect(firstText("", "  ", null, undefined, " second ", "third")).toBe("second");
  });

  it("is empty when nothing is set", () => {
    expect(firstText()).toBe("");
    expect(firstText("", null)).toBe("");
  });
});

describe("excerpt", () => {
  it("returns short text unchanged apart from collapsed whitespace", () => {
    expect(excerpt("A  short\nline.")).toBe("A short line.");
  });

  it("cuts on a word boundary and marks the cut", () => {
    const text = "Private and small-group journeys across the country, from old city walls to mountain villages, led by licensed local guides who know every lane.";
    const result = excerpt(text, 60);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith("…")).toBe(true);
    expect(text.startsWith(result.slice(0, -1))).toBe(true);
    expect(result).toBe("Private and small-group journeys across the country, from…");
  });

  it("cuts mid-word when there is no usable space", () => {
    expect(excerpt("x".repeat(50), 20)).toBe(`${"x".repeat(19)}…`);
  });
});

describe("lgColumns", () => {
  it("matches the item count up to the cap", () => {
    expect(lgColumns(1)).toBe("lg:grid-cols-1");
    expect(lgColumns(3)).toBe("lg:grid-cols-3");
    expect(lgColumns(5)).toBe("lg:grid-cols-5");
    expect(lgColumns(9)).toBe("lg:grid-cols-5");
    expect(lgColumns(9, 4)).toBe("lg:grid-cols-4");
  });

  it("never returns fewer than one column or more than five", () => {
    expect(lgColumns(0)).toBe("lg:grid-cols-1");
    expect(lgColumns(-3)).toBe("lg:grid-cols-1");
    expect(lgColumns(Number.NaN)).toBe("lg:grid-cols-1");
    expect(lgColumns(8, 12)).toBe("lg:grid-cols-5");
    expect(lgColumns(8, 0)).toBe("lg:grid-cols-1");
  });
});

describe("mosaicPlan", () => {
  it("uses the six-photo mosaic when there are enough covers", () => {
    expect(mosaicPlan(6)).toEqual({ take: 6, mosaic: true });
    expect(mosaicPlan(11)).toEqual({ take: 6, mosaic: true });
  });

  it("falls back to an even row of four, or whatever there is", () => {
    expect(mosaicPlan(5)).toEqual({ take: 4, mosaic: false });
    expect(mosaicPlan(4)).toEqual({ take: 4, mosaic: false });
    expect(mosaicPlan(2)).toEqual({ take: 2, mosaic: false });
    expect(mosaicPlan(0)).toEqual({ take: 0, mosaic: false });
    expect(mosaicPlan(-1)).toEqual({ take: 0, mosaic: false });
  });
});
