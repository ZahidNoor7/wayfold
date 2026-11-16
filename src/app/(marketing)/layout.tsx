import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { ThemedRoot, WAYFOLD_APPEARANCE } from "@/components/theme/themed-root";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <ThemedRoot appearance={WAYFOLD_APPEARANCE} className="overflow-x-clip">
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </ThemedRoot>
  );
}
