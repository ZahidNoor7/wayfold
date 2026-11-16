import type { ReactNode } from "react";
import { PageTransition } from "@/components/motion";

/**
 * Every workspace page arrives with the same slight rise. A template (not a
 * layout) so it replays when the route changes; filter and search changes
 * only touch the query string and do not replay it.
 */
export default function WorkspaceTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
