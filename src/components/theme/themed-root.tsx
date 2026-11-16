import type { ReactNode } from "react";
import type { TenantBranding } from "@/server/db/schema";
import { cn } from "@/lib/utils";
import { ThemeSync } from "./theme-sync";

export type Appearance = Pick<TenantBranding, "theme" | "mode" | "radius" | "font">;

export const WAYFOLD_APPEARANCE = { theme: "wayfold", mode: "light", radius: "md", font: "modern" } as const;

const MODE_CLASS = { light: "light", dark: "dark", system: "mode-system" } as const;

interface ThemedRootProps {
  appearance: { theme: string; mode: "light" | "dark" | "system"; radius: string; font: string };
  className?: string;
  children: ReactNode;
}

/**
 * Applies a theme to everything inside it. Rendered on the server, so the
 * first paint is already in the right colours, corner style and heading font;
 * `ThemeSync` then mirrors the same attributes onto <html> so portalled
 * dialogs and the page backdrop match.
 */
export function ThemedRoot({ appearance, className, children }: ThemedRootProps) {
  return (
    <div
      data-theme={appearance.theme}
      data-radius={appearance.radius}
      data-font={appearance.font}
      className={cn(MODE_CLASS[appearance.mode], "min-h-dvh bg-background text-foreground antialiased", className)}
    >
      <ThemeSync theme={appearance.theme} radius={appearance.radius} font={appearance.font} modeClass={MODE_CLASS[appearance.mode]} />
      {children}
    </div>
  );
}
