import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth/auth-shell";

// Account pages carry tokens in their URLs and have nothing to offer a search engine.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
