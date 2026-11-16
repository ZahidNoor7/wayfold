import { ArrowRight } from "lucide-react";
import Link from "next/link";

/**
 * 404 for a storefront page. It opens with the hero surface and leaves room
 * for the header, so it reads correctly under both header states: solid on
 * ordinary routes, transparent on the dark-hero routes (an unknown tour, for
 * example, is still a tour route).
 */
export default function SiteNotFound() {
  return (
    <section aria-labelledby="not-found" className="relative flex min-h-[640px] items-end overflow-hidden bg-hero text-hero-foreground lg:min-h-[72vh]">
      <p aria-hidden="true" className="pointer-events-none absolute -right-6 -top-10 select-none font-display text-[260px] leading-none text-highlight/10 sm:text-[420px]">
        404
      </p>
      <div className="container-x relative w-full pb-16 pt-32 lg:pb-24">
        <div className="max-w-2xl">
          <p className="stagger-1 mb-6 flex animate-rise items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-highlight">
            <span aria-hidden="true" className="h-px w-10 shrink-0 bg-highlight" />
            Page not found
          </p>
          <h1 id="not-found" className="stagger-2 animate-rise font-display text-5xl font-medium leading-none sm:text-6xl lg:text-7xl">
            This path leads <em className="text-highlight">nowhere.</em>
          </h1>
          <p className="stagger-3 mt-6 max-w-xl animate-rise text-base leading-relaxed text-hero-foreground/85 sm:text-lg">
            The page may have moved, or the experience is no longer offered. The current experiences are all in one place.
          </p>
          <div className="stagger-4 mt-10 flex animate-rise flex-col gap-3 sm:flex-row">
            <Link href="/experiences" className="btn btn-highlight btn-xl rounded-full">
              Explore experiences
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link href="/" className="btn btn-hero-outline btn-xl rounded-full">
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
