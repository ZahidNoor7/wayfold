"use client";

import { useSelectedLayoutSegments } from "next/navigation";
import { isHeroRoute, pathFromSegments } from "./hero-routes";

function CardSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="skeleton aspect-[4/3] rounded-none" />
      <div className="flex flex-col gap-3 p-6">
        <div className="skeleton h-3 w-1/3" />
        <div className="skeleton h-7 w-4/5" />
        <div className="skeleton h-3 w-full" />
        <div className="skeleton h-3 w-2/3" />
      </div>
    </div>
  );
}

export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-7">
      {Array.from({ length: cards }, (_, index) => (
        <CardSkeleton key={index} />
      ))}
    </div>
  );
}

/** Stands in for a page that opens with the dark hero, so the transparent header keeps a dark surface under it. */
export function HeroPageSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <div className="flex min-h-[640px] items-end bg-hero lg:h-[92vh] lg:max-h-[960px]">
        <div className="container-x w-full pb-16 pt-32 lg:pb-24">
          <div className="h-3 w-40 rounded-full bg-hero-foreground/15" />
          <div className="mt-6 h-14 w-4/5 max-w-2xl rounded-lg bg-hero-foreground/15 sm:h-20" />
          <div className="mt-4 h-14 w-3/5 max-w-xl rounded-lg bg-hero-foreground/10 sm:h-20" />
          <div className="mt-8 h-4 w-full max-w-md rounded-full bg-hero-foreground/10" />
        </div>
      </div>
      <div className="container-x py-20">
        <CardGridSkeleton cards={3} />
      </div>
    </div>
  );
}

/** Stands in for a page with the compact page hero (Experiences and the other listing pages). */
export function PageHeroSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <div className="bg-hero">
        <div className="container-x pb-24 pt-16 lg:pb-28 lg:pt-24">
          <div className="h-3 w-32 rounded-full bg-hero-foreground/15" />
          <div className="mt-6 h-12 w-3/5 max-w-xl rounded-lg bg-hero-foreground/15 sm:h-16" />
          <div className="mt-5 h-4 w-full max-w-md rounded-full bg-hero-foreground/10" />
        </div>
      </div>
      <div className="container-x -mt-10 pb-28">
        <div className="card p-4 shadow-xl sm:p-6">
          <div className="skeleton h-11 w-full" />
          <div className="mt-4 flex gap-2">
            <div className="skeleton h-9 w-24 rounded-full" />
            <div className="skeleton h-9 w-20 rounded-full" />
            <div className="skeleton h-9 w-28 rounded-full" />
          </div>
        </div>
        <div className="mt-12">
          <CardGridSkeleton />
        </div>
      </div>
    </div>
  );
}

/** A quiet content skeleton for pages on a light surface. */
export function ContentSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="container-x py-16 lg:py-24">
      <div className="skeleton h-3 w-28" />
      <div className="skeleton mt-5 h-12 w-3/5 max-w-xl" />
      <div className="mt-8 flex max-w-2xl flex-col gap-3">
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-11/12" />
        <div className="skeleton h-4 w-2/3" />
      </div>
      <div className="mt-14">
        <CardGridSkeleton cards={3} />
      </div>
    </div>
  );
}

/**
 * Route-aware fallback for the storefront's `loading.tsx`: a page listed in
 * `hero-routes.ts` gets the dark hero stand-in, every other page a plain one.
 */
export function StorefrontSkeleton() {
  const path = pathFromSegments(useSelectedLayoutSegments());
  return isHeroRoute(path) ? <HeroPageSkeleton /> : <ContentSkeleton />;
}
