import Link from "next/link";
import { Play } from "lucide-react";
import { SiteImage } from "@/components/storefront/site-image";
import { formatMonthYear, plural } from "@/lib/review-display";
import { cn } from "@/lib/utils";
import type { PublicDestination } from "@/server/catalog/storefront";
import type { PublicJourneyEntry } from "@/server/content/journey";
import { groupByYear, journeyHref, projectPins, tileRatioClass, type DestinationStats, type JourneyFilters } from "./journey-helpers";

const entryHref = (entry: Pick<PublicJourneyEntry, "slug">) => `/journey/${entry.slug}`;

/** The masonry of entries: columns, so tiles keep their own proportions. */
export function JourneyGallery({ entries }: { entries: PublicJourneyEntry[] }) {
  return (
    <ul className="columns-1 gap-6 sm:columns-2 lg:columns-3">
      {entries.map((entry, index) => {
        const date = formatMonthYear(entry.visitedOn);
        return (
          <li key={entry.id} className="mb-7 break-inside-avoid">
            <Link href={entryHref(entry)} className="group block w-full animate-rise text-left">
              {entry.cover ? (
                <span className={cn("relative block overflow-hidden rounded-xl bg-muted", tileRatioClass(entry.cover.width, entry.cover.height, index))}>
                  <SiteImage src={entry.cover.url} alt={entry.cover.alt} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="img-zoom" />
                  {entry.category ? <span className="badge badge-overlay absolute left-3.5 top-3.5">{entry.category}</span> : null}
                  {entry.hasVideo ? (
                    <span className="absolute right-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-full bg-hero/85 text-hero-foreground">
                      <Play aria-hidden="true" className="size-3.5 fill-current" />
                      <span className="sr-only">Includes video</span>
                    </span>
                  ) : null}
                </span>
              ) : entry.category ? (
                <span className="badge badge-outline">{entry.category}</span>
              ) : null}
              {entry.location || date ? (
                <span className="mt-4 flex justify-between gap-3 text-[13px] text-muted-foreground">
                  <span>{entry.location}</span>
                  <span>{date}</span>
                </span>
              ) : null}
              <span className="mt-1 block font-display text-[26px] font-semibold leading-tight text-primary underline-offset-4 group-hover:underline">
                {entry.title}
              </span>
              {entry.teaser ? <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{entry.teaser}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Entries along a line, grouped by the year of the visit. */
export function JourneyTimeline({ entries }: { entries: PublicJourneyEntry[] }) {
  return (
    <div className="mx-auto max-w-4xl">
      {groupByYear(entries).map((group) => (
        <section key={group.year ?? "undated"} aria-label={group.year ?? "Undated entries"} className="mb-6 flex gap-5 sm:gap-8">
          <p className="w-16 shrink-0 font-display text-4xl leading-none text-eyebrow sm:w-24 sm:text-5xl">
            {group.year ?? <span className="text-xl sm:text-2xl">Undated</span>}
          </p>
          <ul className="flex flex-1 flex-col gap-5 border-l pb-4 pl-6 sm:pl-8">
            {group.items.map((entry) => {
              const meta = [formatMonthYear(entry.visitedOn), entry.location].filter(Boolean).join(", ");
              return (
                <li key={entry.id}>
                  <Link href={entryHref(entry)} className="group relative flex items-center gap-4 text-left sm:gap-5">
                    <span
                      aria-hidden="true"
                      className="absolute -left-[31px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-[3px] border-background bg-primary sm:-left-[39px]"
                    />
                    {entry.cover ? (
                      <span className="relative block h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-muted sm:h-24 sm:w-36">
                        <SiteImage src={entry.cover.url} alt={entry.cover.alt} sizes="144px" className="img-zoom" />
                      </span>
                    ) : null}
                    <span className="min-w-0">
                      {meta ? <span className="block text-[13px] text-muted-foreground">{meta}</span> : null}
                      <span className="block font-display text-2xl font-semibold text-primary underline-offset-4 group-hover:underline">{entry.title}</span>
                      {entry.teaser ? <span className="hidden text-sm text-muted-foreground sm:block">{entry.teaser}</span> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface PlacesProps {
  /** Published destinations that have journal entries under the current category filter. */
  destinations: PublicDestination[];
  stats: Map<string, DestinationStats>;
  filters: JourneyFilters;
}

function placeSummary(stats: DestinationStats | undefined): string {
  const count = stats?.count ?? 0;
  const visited = formatMonthYear(stats?.lastVisited);
  return `${count} journal ${plural(count, "entry", "entries")}${visited ? `, last visited ${visited}` : ""}`;
}

function PlaceCard({ destination, stats, filters, className }: { destination: PublicDestination; stats: DestinationStats | undefined; filters: JourneyFilters; className?: string }) {
  return (
    <article className={cn("card overflow-hidden", className)}>
      {destination.coverUrl ? (
        <div className="relative h-48 w-full bg-muted">
          <SiteImage src={destination.coverUrl} alt="" sizes="(min-width: 1024px) 320px, 100vw" />
        </div>
      ) : null}
      <div className="p-6">
        {destination.region ? <p className="eyebrow">{destination.region}</p> : null}
        <h2 className="mb-2 mt-1 font-display text-3xl text-primary">{destination.name}</h2>
        <p className="mb-5 text-[15px] text-muted-foreground">{placeSummary(stats)}</p>
        <Link href={journeyHref({ destination: destination.slug, category: filters.category })} className="btn btn-default btn-lg w-full rounded-full">
          Show these entries
        </Link>
      </div>
    </article>
  );
}

/**
 * Where the journal has been. Follows the destination filter: with one chosen,
 * its pin is the selected one and the summary is about that place only. The
 * schematic is drawn only when destinations carry coordinates; otherwise the
 * places are a plain list.
 */
export function JourneyPlaces({ destinations, stats, filters }: PlacesProps) {
  const pins = projectPins(destinations);
  const selected = destinations.find((destination) => destination.slug === filters.destination) ?? null;
  const shown = selected ? [selected] : destinations;

  if (pins.length === 0) {
    return (
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((destination) => (
          <li key={destination.id}>
            <PlaceCard destination={destination} stats={stats.get(destination.slug)} filters={filters} className="h-full" />
          </li>
        ))}
      </ul>
    );
  }

  const bySlug = new Map(destinations.map((destination) => [destination.slug, destination]));
  const unplaced = destinations.filter((destination) => !pins.some((pin) => pin.slug === destination.slug));

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="relative aspect-[4/3] min-w-0 flex-1 overflow-hidden rounded-2xl bg-hero">
        <svg viewBox="0 0 800 600" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full">
          {[100, 200, 300, 400, 500].map((y) => (
            <path key={`h${y}`} d={`M0 ${y} H800`} fill="none" stroke="var(--hero-foreground)" strokeOpacity=".08" strokeDasharray="4 6" />
          ))}
          {[160, 320, 480, 640].map((x) => (
            <path key={`v${x}`} d={`M${x} 0 V600`} fill="none" stroke="var(--hero-foreground)" strokeOpacity=".08" strokeDasharray="4 6" />
          ))}
          <rect x="24" y="24" width="752" height="552" rx="18" fill="none" stroke="var(--highlight)" strokeOpacity=".3" strokeWidth="1.2" />
        </svg>
        <p className="absolute left-6 top-5 text-xs font-semibold uppercase tracking-[0.24em] text-highlight">Places in the journal</p>
        <p className="absolute bottom-5 right-6 text-xs text-hero-foreground/60">Positions are relative, not to scale</p>
        <ul>
          {pins.map((pin) => {
            const destination = bySlug.get(pin.slug)!;
            const count = stats.get(pin.slug)?.count ?? 0;
            const on = pin.slug === selected?.slug;
            return (
              <li key={pin.slug}>
                <Link
                  href={journeyHref({ ...filters, view: "places", destination: on ? null : pin.slug })}
                  scroll={false}
                  aria-current={on ? "true" : undefined}
                  aria-label={`${destination.name}, ${count} ${plural(count, "entry", "entries")}`}
                  className="group absolute flex min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 p-1.5"
                  style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                >
                  <span
                    className={
                      on
                        ? "block h-5 w-5 rounded-full bg-highlight ring-8 ring-highlight/30 transition-all"
                        : "block h-3.5 w-3.5 rounded-full bg-hero-foreground ring-4 ring-highlight/20 transition-all group-hover:scale-125"
                    }
                  />
                  <span
                    className={
                      on ? "whitespace-nowrap text-xs font-bold text-highlight" : "hidden whitespace-nowrap text-xs font-semibold text-hero-foreground sm:block"
                    }
                  >
                    {destination.name}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {selected ? (
        <PlaceCard destination={selected} stats={stats.get(selected.slug)} filters={filters} className="w-full self-start lg:w-80" />
      ) : (
        <div className="card w-full self-start p-6 lg:w-80">
          <h2 className="mb-1 font-display text-3xl text-primary">All places</h2>
          <p className="mb-4 text-[15px] text-muted-foreground">Choose a place to see its journal entries.</p>
          <ul className="flex flex-col">
            {destinations.map((destination) => {
              const count = stats.get(destination.slug)?.count ?? 0;
              return (
                <li key={destination.id} className="border-t">
                  <Link
                    href={journeyHref({ ...filters, view: "places", destination: destination.slug })}
                    scroll={false}
                    className="flex min-h-11 items-center justify-between gap-4 py-2.5 text-[15px] font-semibold underline-offset-4 hover:underline"
                  >
                    <span>{destination.name}</span>
                    <span className="font-normal tabular-nums text-muted-foreground">
                      {count} {plural(count, "entry", "entries")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {unplaced.length > 0 ? (
            <p className="mt-4 text-[13px] text-muted-foreground">
              Not on the map: {unplaced.map((destination) => destination.name).join(", ")}.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
