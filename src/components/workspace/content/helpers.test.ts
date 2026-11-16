import { describe, expect, it } from "vitest";
import {
  countLabel,
  dateToMonth,
  displayHost,
  hasHtmlTag,
  isOverLimit,
  listErrorPath,
  monthToDate,
  moveItem,
  numberToText,
  parseOptionalNumber,
  plainTextField,
  previewText,
  removeAt,
  serverErrorEntries,
  storefrontUrl,
} from "./helpers";

describe("plain text", () => {
  it("detects markup but not angle brackets in prose", () => {
    expect(hasHtmlTag("Hello <b>there</b>")).toBe(true);
    expect(hasHtmlTag("<!-- note -->")).toBe(true);
    expect(hasHtmlTag("Groups < 8 people > fun")).toBe(false);
  });

  it("validates length on the trimmed value and refuses tags", () => {
    const field = plainTextField(5, { min: 2, minMessage: "Too short." });
    expect(field.safeParse("  abc  ").success).toBe(true);
    expect(field.safeParse(" a ").error?.issues[0]?.message).toBe("Too short.");
    expect(field.safeParse("abcdef").error?.issues[0]?.message).toBe("Keep this under 5 characters.");
    expect(field.safeParse("<i>").error?.issues.map((issue) => issue.message)).toContain("Plain text only: HTML tags are not allowed.");
  });

  it("has default minimum messages", () => {
    expect(plainTextField(10, { min: 1 }).safeParse("").error?.issues[0]?.message).toBe("Fill this in or remove the row.");
    expect(plainTextField(10, { min: 3 }).safeParse("a").error?.issues[0]?.message).toBe("Use at least 3 characters.");
    expect(plainTextField(10).safeParse("").success).toBe(true);
  });

  it("counts characters the way the server does", () => {
    expect(countLabel("  hello ", 60)).toBe("5 / 60");
    expect(countLabel(undefined, 60)).toBe("0 / 60");
    expect(isOverLimit("abcd", 3)).toBe(true);
    expect(isOverLimit(null, 3)).toBe(false);
  });
});

describe("list order", () => {
  it("moves an item and leaves the input untouched", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(list, 2, 1)).toEqual(["a", "c", "b"]);
    expect(list).toEqual(["a", "b", "c"]);
  });

  it("ignores moves outside the list", () => {
    expect(moveItem(["a", "b"], 0, 0)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], -1, 1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 0, 2)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("removes by position", () => {
    expect(removeAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(removeAt(["a"], 3)).toEqual(["a"]);
  });
});

describe("months", () => {
  it("converts between dates and month inputs", () => {
    expect(dateToMonth("2026-10-01")).toBe("2026-10");
    expect(dateToMonth(null)).toBe("");
    expect(dateToMonth("Oct 2026")).toBe("");
    expect(monthToDate("2026-10")).toBe("2026-10-01");
    expect(monthToDate(" 2026-01 ")).toBe("2026-01-01");
    expect(monthToDate("")).toBeNull();
    expect(monthToDate(undefined)).toBeNull();
    expect(monthToDate("2026-13")).toBeNull();
    expect(monthToDate("2026-00")).toBeNull();
  });
});

describe("numbers", () => {
  it("parses optional numbers", () => {
    expect(parseOptionalNumber("")).toBeNull();
    expect(parseOptionalNumber(undefined)).toBeNull();
    expect(parseOptionalNumber(" 40.3777 ")).toBe(40.3777);
    expect(parseOptionalNumber("-49,89")).toBe(-49.89);
    expect(parseOptionalNumber(".5")).toBe(0.5);
    expect(parseOptionalNumber("12abc")).toBeUndefined();
    expect(parseOptionalNumber("1e400")).toBeUndefined();
    expect(parseOptionalNumber("9".repeat(400))).toBeUndefined();
  });

  it("prints numbers back for a text box", () => {
    expect(numberToText(12.5)).toBe("12.5");
    expect(numberToText(0)).toBe("0");
    expect(numberToText(null)).toBe("");
    expect(numberToText(undefined)).toBe("");
    expect(numberToText(Number.NaN)).toBe("");
  });
});

describe("server errors", () => {
  it("maps list keys onto the form's rows", () => {
    expect(listErrorPath("3.label")).toBe("items.3.label");
    expect(listErrorPath("3")).toBe("items.3");
    expect(listErrorPath("3", "value")).toBe("items.3.value");
    expect(listErrorPath("2.a.b")).toBe("items.2.a.b");
    expect(listErrorPath("form")).toBe("root");
    expect(listErrorPath("")).toBe("root");
    expect(listErrorPath("title")).toBe("title");
  });

  it("lists the first message per field", () => {
    expect(serverErrorEntries(undefined)).toEqual([]);
    expect(serverErrorEntries({ a: ["one", "two"], b: [], c: ["three"] })).toEqual([
      ["a", "one"],
      ["c", "three"],
    ]);
    expect(serverErrorEntries({ "0.label": ["x"] }, (key) => listErrorPath(key))).toEqual([["items.0.label", "x"]]);
  });
});

describe("previews and links", () => {
  it("truncates on a word boundary", () => {
    expect(previewText("  short   text ", 60)).toBe("short text");
    expect(previewText("one two three four five six", 15)).toBe("one two three…");
    expect(previewText("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi…");
  });

  it("builds storefront URLs", () => {
    expect(displayHost("https://acme.example.com/")).toBe("acme.example.com");
    expect(displayHost("http://acme.localhost:3210")).toBe("acme.localhost:3210");
    expect(storefrontUrl("https://acme.example.com/", "/")).toBe("https://acme.example.com/");
    expect(storefrontUrl("https://acme.example.com", "/journey/autumn")).toBe("https://acme.example.com/journey/autumn");
    expect(storefrontUrl("https://acme.example.com", "about")).toBe("https://acme.example.com/about");
  });
});
