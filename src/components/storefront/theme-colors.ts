/**
 * The storefront themes as hex, for the places CSS variables cannot reach:
 * the web app manifest and the generated app icons. Values are the tokens of
 * the same name in `src/app/themes.css`, converted from HSL; the unit test
 * beside this file fails if the two ever disagree.
 */
export interface ThemeColors {
  background: string;
  primary: string;
  hero: string;
  highlight: string;
}

export type ThemeName = "emerald" | "caspian" | "pomegranate" | "graphite";
export type ColorScheme = "light" | "dark";

export const DEFAULT_THEME: ThemeName = "emerald";

export const THEME_COLORS: Record<ThemeName, Record<ColorScheme, ThemeColors>> = {
  emerald: {
    light: { background: "#faf8f5", primary: "#163b2f", hero: "#0c221b", highlight: "#d4a649" },
    dark: { background: "#0c1714", primary: "#f1eada", hero: "#07130f", highlight: "#d8ae5a" },
  },
  caspian: {
    light: { background: "#f9f6f1", primary: "#163e5a", hero: "#0b1d2d", highlight: "#d27641" },
    dark: { background: "#0a121a", primary: "#f1e9da", hero: "#061019", highlight: "#db814d" },
  },
  pomegranate: {
    light: { background: "#f9f6f0", primary: "#6b192a", hero: "#2f0e15", highlight: "#f1a522" },
    dark: { background: "#170c0f", primary: "#f2e8d9", hero: "#18070a", highlight: "#f2ad36" },
  },
  graphite: {
    light: { background: "#ffffff", primary: "#18181b", hero: "#131316", highlight: "#f59f0a" },
    dark: { background: "#09090b", primary: "#fafafa", hero: "#070708", highlight: "#f6a61e" },
  },
};

export interface Appearance {
  theme: string;
  mode: string;
}

function isTheme(theme: string): theme is ThemeName {
  return Object.hasOwn(THEME_COLORS, theme);
}

/**
 * Palette for a tenant's appearance. A manifest and an icon cannot follow the
 * visitor's system setting, so "system" resolves to light. An unknown theme
 * resolves to the default one rather than failing a request.
 */
export function themeColors(appearance: Appearance): ThemeColors {
  const theme = isTheme(appearance.theme) ? appearance.theme : DEFAULT_THEME;
  return THEME_COLORS[theme][appearance.mode === "dark" ? "dark" : "light"];
}

/**
 * The dark brand surface an installed app is framed in: the theme's primary
 * colour in light mode, and its hero surface in dark mode (where "primary"
 * is a light tone meant for text).
 */
export function brandSurface(appearance: Appearance): string {
  const colors = themeColors(appearance);
  return appearance.mode === "dark" ? colors.hero : colors.primary;
}

export function manifestColors(appearance: Appearance): { themeColor: string; backgroundColor: string } {
  return { themeColor: brandSurface(appearance), backgroundColor: themeColors(appearance).background };
}

export function iconColors(appearance: Appearance): { background: string; foreground: string } {
  return { background: brandSurface(appearance), foreground: themeColors(appearance).highlight };
}
