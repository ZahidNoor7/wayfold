import type { Metadata } from "next";
import { FoldMotif } from "@/components/auth/wordmark";
import { ThemedRoot, WAYFOLD_APPEARANCE } from "@/components/theme/themed-root";

export const metadata: Metadata = { title: "Page not found" };

/**
 * Shown for any address that matches no page, on every host: the marketing
 * site, the app and tenant websites alike. "/" is the right way back on all
 * three, so the links are plain anchors and the wording names no product.
 */
export default function NotFound() {
  return (
    <ThemedRoot appearance={WAYFOLD_APPEARANCE}>
      <main id="main" className="relative flex min-h-dvh items-center overflow-hidden bg-hero px-5 py-16 text-hero-foreground sm:px-8">
        <FoldMotif className="pointer-events-none absolute inset-0 h-full w-full" />
        <div className="relative mx-auto w-full max-w-2xl">
          <p className="font-display text-[104px] leading-[0.9] text-highlight">404</p>
          <h1 className="mt-6 font-display text-5xl font-medium leading-none sm:text-6xl">This page is not on the map.</h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-hero-foreground/85 sm:text-lg">
            The address may be mistyped, or the page may have moved or been taken down. Nothing is wrong with your account or your booking.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- "/" differs per host (site, app, storefront); a full load lets the proxy decide. */}
            <a href="/" className="btn btn-highlight btn-xl rounded-full">
              Go to the home page
            </a>
          </div>
        </div>
      </main>
    </ThemedRoot>
  );
}
