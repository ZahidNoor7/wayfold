import type { ReactNode } from "react";
import { PageTransition } from "@/components/motion";

/** Replays the house page entrance on every storefront navigation. */
export default function SiteTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
