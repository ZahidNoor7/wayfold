import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { loadJournal, loadSite, seoMetadata } from "@/components/storefront-content/data";
import {
  categoryCounts,
  destinationStats,
  filterEntries,
  journeyHref,
  parseJourneyFilters,
  type JourneyFilters,
  type JourneyView,
} from "@/components/storefront-content/journey-helpers";
import { JourneyGallery, JourneyPlaces, JourneyTimeline } from "@/components/storefront-content/journey-views";
import { ContentSkeleton } from "@/components/storefront-content/prose";
import { EmptyState } from "@/components/workspace/page-header";
import { plural } from "@/lib/review-display";
import { cn } from "@/lib/utils";
import { inSite } from "@/server/storefront/context";

interface Props {
  params: Promise<{ site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { site } = await params;
  return seoMetadata(site, "journey", "/journey", ({ tenant }) => ({
    title: "Travel journal",
    description: `Stories and photos from the places ${tenant.name} travels to.`,
  }));
}

export default function JourneyPage(props: Props) {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

const VIEW_LABELS: Record<JourneyView, string> = { gallery: "Gallery", timeline: "Timeline", places: "Places" };
const CHIP_ON = "border-primary bg-primary text-primary-foreground hover:bg-primary";
const CHIP_RAIL = "no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0";

function FilterChip({ href, on, label, count }: { href: string; on: boolean; label: string; count: number }) {
  return (
    <li className="shrink-0">
      <Link href={href} scroll={false} aria-current={on ? "true" : undefined} className={cn("chip", on && CHIP_ON)}>
        {label} <span className="tabular-nums opacity-60">{count}</span>
      </Link>
    </li>
  );
}

async function Content({ params, searchParams }: Props) {
  const { site } = await params;
  const requested = parseJourneyFilters(await searchParams);
  const { tenant, shell } = await loadSite(site);
  // Published destinations come with the shell the layout already read.
  const { destinations } = shell;
  const entries = await inSite(tenant, loadJournal);

  // Each filter's counts are taken with the other filter applied, so a chip
  // never promises more entries than choosing it will show.
  const withinCategory = filterEntries(entries, { destination: null, category: requested.category });
  const withinDestination = filterEntries(entries, { destination: requested.destination, category: null });
  const stats = destinationStats(withinCategory);
  const places = destinations.filter((destination) => (stats.get(destination.slug)?.count ?? 0) > 0 || destination.slug === requested.destination);
  const categories = categoryCounts(withinDestination);
  if (requested.category && !categories.some((category) => category.name === requested.category)) {
    categories.push({ name: requested.category, count: 0 });
  }

  const views: JourneyView[] = [
    "gallery",
    ...(entries.some((entry) => entry.visitedOn) ? (["timeline"] as const) : []),
    ...(destinationStats(entries).size > 0 ? (["places"] as const) : []),
  ];
  const filters: JourneyFilters = { ...requested, view: views.includes(requested.view) ? requested.view : "gallery" };
  const visible = filterEntries(entries, filters);
  const filtered = Boolean(filters.destination || filters.category);
  const placeCount = destinationStats(entries).size;

  return (
    <>
      <section className="pb-10 pt-16 lg:pt-24">
        <div className="container-x flex flex-wrap items-end justify-between gap-8">
          <div className="max-w-3xl">
            <p className="eyebrow mb-4 animate-rise">{tenant.name}</p>
            <h1 className="animate-rise font-display text-5xl font-medium leading-[0.98] text-primary stagger-1 sm:text-7xl lg:text-[80px]">Travel journal</h1>
            {entries.length > 0 ? (
              <p className="mt-6 animate-rise text-lg leading-relaxed text-foreground/85 stagger-2">
                {entries.length} {plural(entries.length, "entry", "entries")}
                {placeCount > 0 ? ` from ${placeCount} ${plural(placeCount, "place")}` : ""}, most recent first.
              </p>
            ) : null}
          </div>
          {views.length > 1 ? (
            <nav aria-label="View" className="tabs-list">
              {views.map((view) => {
                const on = view === filters.view;
                return (
                  <Link
                    key={view}
                    href={journeyHref({ ...filters, view })}
                    scroll={false}
                    aria-current={on ? "true" : undefined}
                    className={cn("tabs-trigger px-4", on && "bg-background text-foreground shadow-sm")}
                  >
                    {VIEW_LABELS[view]}
                  </Link>
                );
              })}
            </nav>
          ) : null}
        </div>
      </section>

      {entries.length === 0 ? (
        <section className="pb-28">
          <div className="container-x">
            <EmptyState
              title="No journal entries yet"
              description={`Stories and photos from ${tenant.name} will appear here. In the meantime, see what is on offer.`}
              action={
                <Link href="/experiences" className="btn btn-default btn-lg rounded-full">
                  Browse experiences
                </Link>
              }
            />
          </div>
        </section>
      ) : (
        <>
          {places.length > 1 || categories.length > 1 || filtered ? (
            <section aria-label="Filter journal entries" className="border-b pb-8">
              <div className="container-x flex flex-col gap-3">
                {places.length > 1 || filters.destination ? (
                  <nav aria-label="Destination">
                    <ul className={CHIP_RAIL}>
                      <FilterChip href={journeyHref({ ...filters, destination: null })} on={!filters.destination} label="All places" count={withinCategory.length} />
                      {places.map((destination) => (
                        <FilterChip
                          key={destination.id}
                          href={journeyHref({ ...filters, destination: destination.slug })}
                          on={filters.destination === destination.slug}
                          label={destination.name}
                          count={stats.get(destination.slug)?.count ?? 0}
                        />
                      ))}
                    </ul>
                  </nav>
                ) : null}
                {categories.length > 1 || filters.category ? (
                  <nav aria-label="Category">
                    <ul className={CHIP_RAIL}>
                      <FilterChip href={journeyHref({ ...filters, category: null })} on={!filters.category} label="All categories" count={withinDestination.length} />
                      {categories.map((category) => (
                        <FilterChip
                          key={category.name}
                          href={journeyHref({ ...filters, category: category.name })}
                          on={filters.category === category.name}
                          label={category.name}
                          count={category.count}
                        />
                      ))}
                    </ul>
                  </nav>
                ) : null}
              </div>
            </section>
          ) : null}

          <section aria-label="Journal entries" className="pb-28 pt-10">
            <div className="container-x">
              {filtered ? (
                <p className="mb-8 text-sm text-muted-foreground">
                  Showing {visible.length} of {entries.length} {plural(entries.length, "entry", "entries")}
                </p>
              ) : null}
              {visible.length === 0 ? (
                <div className="card border-dashed p-14 text-center text-muted-foreground">
                  No journal entries match these filters yet.{" "}
                  <Link href={journeyHref({ view: filters.view })} scroll={false} className="btn btn-link">
                    Show all entries
                  </Link>
                </div>
              ) : filters.view === "timeline" ? (
                <JourneyTimeline entries={visible} />
              ) : filters.view === "places" ? (
                <JourneyPlaces
                  destinations={destinations.filter((destination) => (stats.get(destination.slug)?.count ?? 0) > 0)}
                  stats={stats}
                  filters={filters}
                />
              ) : (
                <JourneyGallery entries={visible} />
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
