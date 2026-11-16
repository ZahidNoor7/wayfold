import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemedRoot, WAYFOLD_APPEARANCE } from "@/components/theme/themed-root";

// The back office is never indexed, on any of its pages.
export const metadata: Metadata = {
  title: { default: "Platform", template: "%s · Wayfold platform" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

/**
 * Wayfold's own surface: always in the Wayfold theme, never a tenant's.
 * Access is decided one level down, where the session is read: the console
 * layout and every page call `platformGuard()`.
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <ThemedRoot appearance={WAYFOLD_APPEARANCE}>{children}</ThemedRoot>;
}
