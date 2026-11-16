import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AccountShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Workspace paused", robots: { index: false, follow: false } };

export default function WorkspaceSuspendedLayout({ children }: { children: ReactNode }) {
  return <AccountShell width="narrow">{children}</AccountShell>;
}
