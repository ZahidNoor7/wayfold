import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AccountShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Set up your workspace", robots: { index: false, follow: false } };

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
