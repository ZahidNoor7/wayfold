import type { TenantBranding } from "@/server/db/schema";

export type ThemeId = TenantBranding["theme"];
export type ModeId = TenantBranding["mode"];
export type RadiusId = TenantBranding["radius"];
export type FontId = TenantBranding["font"];
export type AppearanceChoice = Pick<TenantBranding, "theme" | "mode" | "radius" | "font">;

/** The four storefront themes, as named in the design. */
export const THEME_OPTIONS: readonly { id: ThemeId; name: string; description: string }[] = [
  { id: "emerald", name: "Emerald & Gold", description: "Deep emerald, ivory and champagne" },
  { id: "caspian", name: "Caspian Blue", description: "Sea blue, sand and copper" },
  { id: "pomegranate", name: "Pomegranate", description: "Garnet red, cream and saffron" },
  { id: "graphite", name: "Graphite", description: "Neutral zinc with amber" },
];

export const MODE_OPTIONS: readonly { id: ModeId; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

/** `px` is the radius the picker glyph draws, as in the design. */
export const RADIUS_OPTIONS: readonly { id: RadiusId; label: string; px: number }[] = [
  { id: "none", label: "Sharp", px: 2 },
  { id: "sm", label: "Subtle", px: 6 },
  { id: "md", label: "Soft", px: 12 },
  { id: "lg", label: "Round", px: 20 },
];

export const FONT_OPTIONS: readonly { id: FontId; label: string }[] = [
  { id: "classic", label: "Classic" },
  { id: "modern", label: "Modern" },
  { id: "sans", label: "Sans" },
];

/** Class that sets light, dark or follow-the-device on a themed element. */
export const MODE_CLASS: Record<ModeId, string> = { light: "light", dark: "dark", system: "mode-system" };

export const DEFAULT_APPEARANCE: AppearanceChoice = { theme: "emerald", mode: "light", radius: "md", font: "classic" };

export function themeName(id: ThemeId): string {
  return THEME_OPTIONS.find((theme) => theme.id === id)?.name ?? id;
}
