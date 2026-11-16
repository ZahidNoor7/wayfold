import type { ReactNode } from "react";
import { marketingUrl } from "@/components/marketing/urls";
import { ThemedRoot, WAYFOLD_APPEARANCE } from "@/components/theme/themed-root";
import { cn } from "@/lib/utils";
import { SignOutButton } from "./sign-out-button";
import { SUPPORT_EMAIL, supportMailto } from "./support";
import { FoldMotif, Wordmark } from "./wordmark";

/**
 * Frame for sign-in, registration and the other single-form account pages:
 * the form on the page background, beside a hero-coloured panel on wide
 * screens and under a slim hero bar on phones.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const home = marketingUrl("/");
  return (
    <ThemedRoot appearance={WAYFOLD_APPEARANCE}>
      <div className="grid min-h-dvh lg:grid-cols-[5fr_7fr]">
        <aside className="relative hidden overflow-hidden bg-hero text-hero-foreground lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
          <FoldMotif className="pointer-events-none absolute inset-0 h-full w-full" />
          <a href={home} aria-label="Wayfold home" className="relative self-start rounded-md">
            <Wordmark tone="hero" />
          </a>
          <div className="relative max-w-md">
            <p className="font-display text-5xl font-medium leading-[1.02] xl:text-6xl">Your tours, your website, one workspace.</p>
            <p className="mt-6 text-[15px] leading-relaxed text-hero-foreground/80">
              Publish tours on a booking website under your own name, and handle the requests, customers, reviews and discounts behind it.
            </p>
          </div>
          <p className="relative text-[13px] text-hero-foreground/70">
            Need a hand?{" "}
            <a href={supportMailto()} className="font-semibold text-hero-foreground underline-offset-4 hover:underline">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </aside>

        <div className="flex min-h-dvh min-w-0 flex-col">
          <header className="flex h-16 shrink-0 items-center bg-hero px-5 lg:hidden">
            <a href={home} aria-label="Wayfold home" className="rounded-md">
              <Wordmark tone="hero" />
            </a>
          </header>
          <main id="main" className="flex flex-1 items-start justify-center px-5 py-10 sm:items-center sm:px-8 sm:py-16">
            <div className="w-full max-w-md">{children}</div>
          </main>
        </div>
      </div>
    </ThemedRoot>
  );
}

interface AccountShellProps {
  children: ReactNode;
  /** Shown beside the sign-out button once the session is known. */
  user?: ReactNode;
  width?: "narrow" | "wide";
}

/**
 * Frame for the signed-in pages that sit outside any one workspace (workspace
 * list, first-run setup, suspended notice): a hero bar with the wordmark and
 * sign-out, then the page.
 */
export function AccountShell({ children, user, width = "wide" }: AccountShellProps) {
  return (
    <ThemedRoot appearance={WAYFOLD_APPEARANCE} className="bg-muted/40">
      <header className="bg-hero text-hero-foreground">
        <div className={cn("mx-auto flex h-16 w-full items-center justify-between gap-4 px-5 sm:px-8", width === "wide" ? "max-w-5xl" : "max-w-2xl")}>
          <Wordmark tone="hero" />
          <div className="flex min-w-0 items-center gap-3">
            {user}
            <SignOutButton className="btn btn-hero-outline btn-sm rounded-full" />
          </div>
        </div>
      </header>
      <main id="main" className={cn("mx-auto w-full px-5 py-10 sm:px-8 sm:py-14", width === "wide" ? "max-w-5xl" : "max-w-2xl")}>
        {children}
      </main>
    </ThemedRoot>
  );
}
