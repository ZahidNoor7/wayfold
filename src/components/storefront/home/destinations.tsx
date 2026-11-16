import Link from "next/link";
import { Reveal } from "@/components/motion";
import { experiencesHref, pluralize } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";
import { SiteImage } from "../site-image";

export interface HomeDestination {
  id: string;
  name: string;
  slug: string;
  region: string;
  tagline: string;
  coverUrl: string | null;
  tourCount: number;
}

/** The design's bento holds five tiles; a longer list is still reachable from the footer and the Experiences filter. */
const MAX_TILES = 5;

// Grid shape per tile count from `md` up. Five is the design's bento (one
// large tile and four small); fewer tiles get a shape that leaves no hole.
const GRID: Record<number, string> = {
  1: "md:grid-cols-1 md:grid-rows-[420px]",
  2: "md:grid-cols-2 md:grid-rows-[420px]",
  3: "md:grid-cols-3 md:grid-rows-[420px]",
  4: "md:grid-cols-4 md:grid-rows-[280px_280px]",
  5: "md:grid-cols-4 md:grid-rows-[280px_280px]",
};

function span(count: number, index: number): string {
  if (count >= 4 && index === 0) return "md:col-span-2 md:row-span-2";
  if (count === 4 && index === 1) return "md:col-span-2";
  return "";
}

/** Destination tiles: a snap rail on phones, a bento grid from `md`. Each tile opens Experiences filtered to that place. */
export function HomeDestinations({ destinations }: { destinations: HomeDestination[] }) {
  const tiles = destinations.slice(0, MAX_TILES);
  return (
    <section id="destinations" aria-labelledby="destinations-title" className="py-20 lg:py-32">
      <div className="container-x">
        <Reveal className="mx-auto mb-12 max-w-2xl text-center">
          <p className="eyebrow mb-4">Destinations</p>
          <h2 id="destinations-title" className="font-display text-4xl font-medium leading-tight text-primary sm:text-5xl lg:text-[56px]">
            Where the journeys go
          </h2>
        </Reveal>
        <div className={cn("no-scrollbar -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 md:mx-0 md:grid md:gap-5 md:overflow-visible md:px-0", GRID[tiles.length])}>
          {tiles.map((destination, index) => {
            const meta = [destination.region, destination.tourCount > 0 ? `${destination.tourCount} ${pluralize(destination.tourCount, "tour", "tours")}` : ""].filter(Boolean);
            return (
              <Link
                key={destination.id}
                href={experiencesHref({ destination: destination.slug })}
                className={cn(
                  "group relative block h-[420px] shrink-0 snap-start overflow-hidden rounded-xl bg-hero text-hero-foreground md:h-auto md:w-auto",
                  tiles.length > 1 ? "w-[78%]" : "w-full",
                  span(tiles.length, index),
                )}
              >
                <SiteImage
                  src={destination.coverUrl}
                  alt=""
                  sizes={index === 0 && tiles.length >= 4 ? "(min-width: 768px) 50vw, 78vw" : "(min-width: 768px) 33vw, 78vw"}
                  className="img-zoom"
                  tone="dark"
                />
                <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-hero/90" />
                <div className="absolute inset-x-6 bottom-6">
                  {meta.length > 0 ? <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-highlight">{meta.join(" · ")}</p> : null}
                  <p className="font-display text-[32px] leading-tight">{destination.name}</p>
                  {destination.tagline ? <p className="mt-1 text-sm opacity-90">{destination.tagline}</p> : null}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
