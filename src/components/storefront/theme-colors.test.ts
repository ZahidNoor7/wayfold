import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_COLORS, brandSurface, iconColors, manifestColors, themeColors, type ColorScheme, type ThemeColors, type ThemeName } from "./theme-colors";

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${[channel(0), channel(8), channel(4)].map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Reads one token's light/dark pair for a theme straight from the stylesheet. */
function tokenFromCss(css: string, theme: string, token: string): Record<ColorScheme, string> {
  const start = css.indexOf(`[data-theme="${theme}"] {`);
  expect(start, `theme ${theme} in themes.css`).toBeGreaterThan(-1);
  const block = css.slice(start, css.indexOf("}", start));
  const match = new RegExp(`--${token}: light-dark\\(hsl\\(([\\d.]+) ([\\d.]+)% ([\\d.]+)%\\), hsl\\(([\\d.]+) ([\\d.]+)% ([\\d.]+)%\\)\\)`).exec(block);
  expect(match, `--${token} of ${theme}`).not.toBeNull();
  const n = match!.slice(1).map(Number) as [number, number, number, number, number, number];
  return { light: hslToHex(n[0], n[1], n[2]), dark: hslToHex(n[3], n[4], n[5]) };
}

describe("THEME_COLORS", () => {
  const css = readFileSync(path.resolve(__dirname, "../../app/themes.css"), "utf8");

  it("matches the tokens in themes.css for every theme and scheme", () => {
    for (const theme of Object.keys(THEME_COLORS) as ThemeName[]) {
      for (const token of ["background", "primary", "hero", "highlight"] as (keyof ThemeColors)[]) {
        const expected = tokenFromCss(css, theme, token);
        expect(THEME_COLORS[theme].light[token], `${theme} light ${token}`).toBe(expected.light);
        expect(THEME_COLORS[theme].dark[token], `${theme} dark ${token}`).toBe(expected.dark);
      }
    }
  });

  it("covers the four tenant themes", () => {
    expect(Object.keys(THEME_COLORS).sort()).toEqual(["caspian", "emerald", "graphite", "pomegranate"]);
  });
});

describe("themeColors", () => {
  it("resolves the scheme from the mode, with system as light", () => {
    expect(themeColors({ theme: "caspian", mode: "light" })).toBe(THEME_COLORS.caspian.light);
    expect(themeColors({ theme: "caspian", mode: "dark" })).toBe(THEME_COLORS.caspian.dark);
    expect(themeColors({ theme: "caspian", mode: "system" })).toBe(THEME_COLORS.caspian.light);
  });

  it("falls back to the default theme for an unknown name", () => {
    expect(themeColors({ theme: "neon", mode: "light" })).toBe(THEME_COLORS.emerald.light);
    expect(themeColors({ theme: "toString", mode: "dark" })).toBe(THEME_COLORS.emerald.dark);
  });
});

describe("manifest and icon colours", () => {
  it("frames a light storefront in its primary colour", () => {
    const appearance = { theme: "pomegranate", mode: "light" };
    expect(brandSurface(appearance)).toBe("#6b192a");
    expect(manifestColors(appearance)).toEqual({ themeColor: "#6b192a", backgroundColor: "#f9f6f0" });
    expect(iconColors(appearance)).toEqual({ background: "#6b192a", foreground: "#f1a522" });
  });

  it("frames a dark storefront in its hero surface", () => {
    const appearance = { theme: "graphite", mode: "dark" };
    expect(brandSurface(appearance)).toBe("#070708");
    expect(manifestColors(appearance)).toEqual({ themeColor: "#070708", backgroundColor: "#09090b" });
    expect(iconColors(appearance)).toEqual({ background: "#070708", foreground: "#f6a61e" });
  });
});
