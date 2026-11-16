"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Storefront error page. It sits inside the storefront layout, so the
 * business's header, footer and theme are still around it. It opens with a
 * hero-coloured block so pages that expect a transparent header over a dark
 * hero still read correctly.
 */
export default function StorefrontError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The digest lets the operator find the server log line; the message
    // itself is never shown to visitors.
    console.error("Storefront error", error.digest ?? "");
  }, [error]);

  return (
    <section className="bg-hero pb-24 pt-36 text-hero-foreground">
      <div className="container-x max-w-2xl text-center">
        <h1 className="font-display text-4xl font-medium leading-tight sm:text-5xl">This page did not load</h1>
        <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-hero-foreground/80">
          Something went wrong on our side while preparing it. Please try again; if it keeps happening, the contact page
          has other ways to reach us.
        </p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <button type="button" onClick={reset} className="btn btn-highlight btn-xl rounded-full">
            Try again
          </button>
          <Link href="/contact" className="btn btn-hero-outline btn-xl rounded-full">
            Contact us
          </Link>
        </div>
      </div>
    </section>
  );
}
