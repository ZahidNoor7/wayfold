"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import { SUPPORT_EMAIL, supportMailto } from "@/components/auth/support";
import "./globals.css";

/**
 * Last resort: replaces the root layout when it fails, so it brings its own
 * document, stylesheet and theme attributes. It depends on nothing that could
 * be the thing that broke (no fonts, no providers, no data).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" data-theme="wayfold" data-radius="md" data-font="modern" className="light">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <title>Something went wrong · Wayfold</title>
        <main className="flex min-h-dvh items-center justify-center bg-hero px-5 py-16 text-hero-foreground">
          <div className="w-full max-w-lg">
            <p className="font-display text-2xl font-semibold">Wayfold</p>
            <h1 className="mt-8 font-display text-5xl font-medium leading-none sm:text-6xl">Something went wrong on our side.</h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-hero-foreground/85">
              The page could not be shown. Nothing you saved has been lost. Try again in a moment.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <button type="button" className="btn btn-highlight btn-xl rounded-full" onClick={() => retry()}>
                Try again
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the router may be what failed; use a full load. */}
              <a href="/" className="btn btn-hero-outline btn-xl rounded-full">
                Go to the home page
              </a>
            </div>
            <p className="mt-10 text-[13px] text-hero-foreground/70">
              Keeps happening? Write to{" "}
              <a href={supportMailto("Wayfold is not loading")} className="font-semibold text-hero-foreground underline underline-offset-4">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
