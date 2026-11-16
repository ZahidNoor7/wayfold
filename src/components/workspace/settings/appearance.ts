import type { CSSProperties } from "react";

/**
 * The choices behind the Appearance tab. The ids are the values the server
 * accepts (`updateBrandingSchema`); names and descriptions are the design's.
 */

export type ThemeId = "emerald" | "caspian" | "pomegranate" | "graphite";
export type ModeId = "light" | "dark" | "system";
export type RadiusId = "none" | "sm" | "md" | "lg";
export type FontId = "classic" | "modern" | "sans";

export interface Appearance {
  theme: ThemeId;
  mode: ModeId;
  radius: RadiusId;
  font: FontId;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: "emerald", mode: "light", radius: "md", font: "classic" };

export const THEME_OPTIONS: readonly { id: ThemeId; name: string; description: string }[] = [
  { id: "emerald", name: "Emerald & Gold", description: "Deep emerald, ivory and champagne" },
  { id: "caspian", name: "Caspian Blue", description: "Sea blue, sand and copper" },
  { id: "pomegranate", name: "Pomegranate", description: "Garnet red, cream and saffron" },
  { id: "graphite", name: "Graphite", description: "Neutral zinc grey with amber" },
];

export const MODE_OPTIONS: readonly { id: ModeId; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

/** `glyph` is the radius of the corner drawn on the picker, as in the design. */
export const RADIUS_OPTIONS: readonly { id: RadiusId; label: string; glyph: string }[] = [
  { id: "none", label: "Sharp", glyph: "2px" },
  { id: "sm", label: "Subtle", glyph: "6px" },
  { id: "md", label: "Soft", glyph: "12px" },
  { id: "lg", label: "Round", glyph: "20px" },
];

export const FONT_OPTIONS: readonly { id: FontId; label: string }[] = [
  { id: "classic", label: "Classic" },
  { id: "modern", label: "Modern" },
  { id: "sans", label: "Sans" },
];

const MODE_CLASS: Record<ModeId, string> = { light: "light", dark: "dark", system: "mode-system" };

/** The class that sets light, dark or follow-the-device on a themed surface. */
export function modeClass(mode: ModeId): string {
  return MODE_CLASS[mode];
}

/**
 * The radius scale, re-derived on the element itself. The global tokens are
 * computed once at the root, so a nested `data-radius` alone would change
 * `--radius` but not the `--radius-*` steps that cards and buttons read.
 */
export const RADIUS_SCALE_STYLE = {
  "--radius-sm": "calc(var(--radius) * 0.5)",
  "--radius-md": "calc(var(--radius) * 0.75)",
  "--radius-lg": "var(--radius)",
  "--radius-xl": "calc(var(--radius) * 1.35)",
  "--radius-2xl": "calc(var(--radius) * 1.8)",
} as CSSProperties;

/** Attributes that make an element preview itself in a given look. */
export function themedSurface(appearance: Appearance): {
  "data-theme": ThemeId;
  "data-radius": RadiusId;
  "data-font": FontId;
  className: string;
  style: CSSProperties;
} {
  return {
    "data-theme": appearance.theme,
    "data-radius": appearance.radius,
    "data-font": appearance.font,
    className: modeClass(appearance.mode),
    style: RADIUS_SCALE_STYLE,
  };
}

export function themeName(id: ThemeId): string {
  return THEME_OPTIONS.find((option) => option.id === id)?.name ?? THEME_OPTIONS[0]!.name;
}

export function modeLabel(id: ModeId): string {
  return MODE_OPTIONS.find((option) => option.id === id)?.label ?? MODE_OPTIONS[0]!.label;
}

/** "Caspian Blue · Dark": the badge on the live preview. */
export function appearanceSummary(appearance: Appearance): string {
  return `${themeName(appearance.theme)} · ${modeLabel(appearance.mode)}`;
}

/** Narrows stored branding (which may be older or partial) to a complete, valid look. */
export function toAppearance(value: Partial<Record<keyof Appearance, string>> | null | undefined): Appearance {
  const pick = <T extends string>(options: readonly { id: T }[], candidate: string | undefined, fallback: T): T =>
    options.some((option) => option.id === candidate) ? (candidate as T) : fallback;
  return {
    theme: pick(THEME_OPTIONS, value?.theme, DEFAULT_APPEARANCE.theme),
    mode: pick(MODE_OPTIONS, value?.mode, DEFAULT_APPEARANCE.mode),
    radius: pick(RADIUS_OPTIONS, value?.radius, DEFAULT_APPEARANCE.radius),
    font: pick(FONT_OPTIONS, value?.font, DEFAULT_APPEARANCE.font),
  };
}
