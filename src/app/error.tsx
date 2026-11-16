"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import { SUPPORT_EMAIL, supportMailto } from "@/components/auth/support";
import { ThemedRoot, WAYFOLD_APPEARANCE } from "@/components/theme/themed-root";

/** Reference to quote to support; server errors carry one, client errors do not. */
function digestOf(error: unknown): string | null {
  if (error instanceof Error && "digest" in error && typeof error.digest === "string") return error.digest;
  return null;
}

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // The message is already scrubbed for server errors; this is for the browser console.
    console.error(error);
  }, [error]);

  const digest = digestOf(error);

  return (
    <ThemedRoot appearance={WAYFOLD_APPEARANCE} className="bg-muted/40">
      <main id="main" className="flex min-h-dvh items-center justify-center px-5 py-16">
        <div className="card w-full max-w-lg p-8 text-center sm:p-12">
          <h1 className="font-display text-4xl font-semibold leading-tight text-primary">Something went wrong on our side</h1>
          <p className="mx-auto mt-3 max-w-sm leading-relaxed text-muted-foreground">
            This page could not be loaded. Nothing you saved has been lost. Try again, and if it keeps happening, tell us.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <button type="button" className="btn btn-default btn-lg" onClick={() => retry()}>
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load is the point: it leaves the broken state behind. */}
            <a href="/" className="btn btn-outline btn-lg">
              Go to the home page
            </a>
          </div>
          <p className="mt-8 text-[13px] text-muted-foreground">
            Still stuck? Write to{" "}
            <a href={supportMailto(digest ? `Error reference ${digest}` : "A page would not load")} className="font-semibold text-primary underline underline-offset-4">
              {SUPPORT_EMAIL}
            </a>
            {digest ? (
              <>
                {" "}
                and quote reference <span className="font-mono text-foreground">{digest}</span>
              </>
            ) : null}
            .
          </p>
        </div>
      </main>
    </ThemedRoot>
  );
}
