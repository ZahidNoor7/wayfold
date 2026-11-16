import { describe, expect, it } from "vitest";
import { normaliseSlugInput, SLUG_MAX_LENGTH, slugProblemMessage } from "./slug";

describe("normaliseSlugInput", () => {
  it("lower-cases and turns spaces, dots and underscores into hyphens", () => {
    expect(normaliseSlugInput("Sunrise Tours")).toBe("sunrise-tours");
    expect(normaliseSlugInput("north_coast.walks")).toBe("north-coast-walks");
    expect(normaliseSlugInput("a  \t b")).toBe("a-b");
  });

  it("strips accents and characters an address cannot contain", () => {
    expect(normaliseSlugInput("Café Señor!")).toBe("cafe-senor");
    expect(normaliseSlugInput("tours@baku#1")).toBe("toursbaku1");
    expect(normaliseSlugInput("тур")).toBe("");
  });

  it("collapses repeated hyphens and drops leading ones", () => {
    expect(normaliseSlugInput("--old---town--")).toBe("old-town-");
    expect(normaliseSlugInput(" - lead")).toBe("lead");
  });

  it("keeps a trailing hyphen so the next word can be typed", () => {
    expect(normaliseSlugInput("old-")).toBe("old-");
  });

  it("caps the length", () => {
    expect(normaliseSlugInput("a".repeat(80))).toHaveLength(SLUG_MAX_LENGTH);
  });

  it("returns an empty string for empty input", () => {
    expect(normaliseSlugInput("")).toBe("");
  });
});

describe("slugProblemMessage", () => {
  it("explains each reason", () => {
    expect(slugProblemMessage("taken")).toMatch(/already taken/);
    expect(slugProblemMessage("reserved")).toMatch(/reserved/);
    expect(slugProblemMessage("invalid")).toMatch(/3 to 40/);
    expect(slugProblemMessage(undefined)).toMatch(/3 to 40/);
  });
});
