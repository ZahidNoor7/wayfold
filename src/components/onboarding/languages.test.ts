import { describe, expect, it } from "vitest";
import { addRegions, COMMON_LANGUAGES, languageChoices, MAX_LANGUAGES, MAX_REGIONS, toggleLanguage } from "./languages";

describe("languageChoices", () => {
  it("returns the common list when nothing else is saved", () => {
    expect(languageChoices(["en", "fr"])).toEqual([...COMMON_LANGUAGES]);
  });

  it("appends saved languages that are not on the common list, labelled by code", () => {
    const choices = languageChoices(["en", "pt-BR", "sw"]);
    expect(choices).toHaveLength(COMMON_LANGUAGES.length + 2);
    expect(choices.slice(-2)).toEqual([
      { code: "pt-BR", name: "pt-BR" },
      { code: "sw", name: "sw" },
    ]);
  });
});

describe("toggleLanguage", () => {
  it("adds a language that is not selected", () => {
    expect(toggleLanguage(["en"], "fr")).toEqual(["en", "fr"]);
  });

  it("removes a selected language", () => {
    expect(toggleLanguage(["en", "fr"], "en")).toEqual(["fr"]);
  });

  it("keeps the last language", () => {
    expect(toggleLanguage(["en"], "en")).toEqual(["en"]);
  });

  it("stops adding at the cap", () => {
    const full = Array.from({ length: MAX_LANGUAGES }, (_, index) => `l${index}`);
    expect(toggleLanguage(full, "en")).toEqual(full);
    expect(toggleLanguage(full, "l0")).toHaveLength(MAX_LANGUAGES - 1);
  });

  it("never mutates its input", () => {
    const selected = ["en"];
    toggleLanguage(selected, "fr");
    expect(selected).toEqual(["en"]);
  });
});

describe("addRegions", () => {
  it("adds one region, trimmed and with inner spaces collapsed", () => {
    expect(addRegions([], "  Lake   District ")).toEqual(["Lake District"]);
  });

  it("splits on commas and skips blanks", () => {
    expect(addRegions(["Baku"], "Sheki, , Quba,")).toEqual(["Baku", "Sheki", "Quba"]);
  });

  it("drops repeats, ignoring case", () => {
    expect(addRegions(["Baku"], "baku, BAKU, Sheki, sheki")).toEqual(["Baku", "Sheki"]);
  });

  it("caps each region at 80 characters and the list at the maximum", () => {
    expect(addRegions([], "x".repeat(120))[0]).toHaveLength(80);
    const full = Array.from({ length: MAX_REGIONS }, (_, index) => `Region ${index}`);
    expect(addRegions(full, "One more")).toEqual(full);
    expect(addRegions(full.slice(0, -1), "A, B")).toHaveLength(MAX_REGIONS);
  });

  it("returns a copy when nothing is added", () => {
    const current = ["Baku"];
    const result = addRegions(current, "   ");
    expect(result).toEqual(current);
    expect(result).not.toBe(current);
  });
});
