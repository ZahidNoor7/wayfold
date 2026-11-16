import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ExperienceFilterBar } from "@/components/storefront/experiences/filter-bar";
import { ClearFiltersButton, ExperienceFilterProvider, ResultsRegion } from "@/components/storefront/experiences/filter-state";
import { PageHeroSkeleton } from "@/components/storefront/skeletons";
import { TourCard } from "@/components/storefront/tour-card";
import {
  EXPERIENCES_PAGE_SIZE,
  catalogueQuery,
  experiencesHref,
  formatCount,
  hasActiveFilters,
  isCloudinaryUrl,
  paginate,
  parseExperienceFilters,
  pluralize,
  priceBandLabels,
  priceThresholds,
  type CatalogueQuery,
  type ExperienceFilters,
} from "@/lib/storefront-format";
import { listCategoriesInUse, listPublishedTours, type PublicTourCard } from "@/server/catalog/storefront";
import type { TenantScope } from "@/server/db/context";
import { bestPublicPriceFor, type PublicTourPrice } from "@/server/promotions/offers";
import { inSite, requireActiveSite, siteToday } from "@/server/storefront/context";
import { getStorefrontShell } from "@/server/storefront/shell";

interface ExperiencesProps {
  params: Promise<{ site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Pick<ExperiencesProps, "params">): Promise<Metadata> {
  const { site } = await params;
  const tenant = await requireActiveSite(site);
  const { content } = await getStorefrontShell(tenant);
  const seo = content.seo.experiences;
  const description = seo.description || `Tours and experiences from ${tenant.name}: compare length, price and reviews, then book online.`;
  return {
    title: seo.title || "Experiences",
    description,
    // Filtered and sorted views are the same page.
    alternates: { canonical: "/experiences" },
    openGraph: { title: seo.title || `Experiences — ${tenant.name}`, description, url: "/experiences" },
  };
}

/** The catalogue service returns at most this many tours per call. */
const BATCH = 100;
/** Upper bound on the tours read to answer one "On offer" request. */
const ON_OFFER_SCAN_LIMIT = 1000;

interface Results {
  tours: PublicTourCard[];
  prices: Record<string, PublicTourPrice>;
  total: number;
  page: number;
  pages: number;
}

/**
 * One page of results. "On offer" is decided by the promotions module, not by
 * the catalogue query, so that view reads every match, keeps the discounted
 * tours and pages them here; every other view is paged by the database.
 */
async function loadResults(scope: TenantScope, query: CatalogueQuery, filters: ExperienceFilters, today: string): Promise<Results> {
  if (filters.onOffer) {
    const matches: PublicTourCard[] = [];
    for (let offset = 0, total = Infinity; offset < total && offset < ON_OFFER_SCAN_LIMIT; offset += BATCH) {
      const batch = await listPublishedTours(scope, { ...query, limit: BATCH, offset });
      matches.push(...batch.items);
      total = batch.total;
    }
    const prices = await bestPublicPriceFor(
      scope,
      matches.map((tour) => tour.id),
      today,
    );
    const discounted = matches.filter((tour) => prices[tour.id]?.offer);
    const { page, pages, offset } = paginate(discounted.length, filters.page);
    return { tours: discounted.slice(offset, offset + EXPERIENCES_PAGE_SIZE), prices, total: discounted.length, page, pages };
  }

  let found = await listPublishedTours(scope, { ...query, limit: EXPERIENCES_PAGE_SIZE, offset: (filters.page - 1) * EXPERIENCES_PAGE_SIZE });
  const { page, pages, offset } = paginate(found.total, filters.page);
  // A page number past the end shows the last page instead of nothing.
  if (page !== filters.page) found = await listPublishedTours(scope, { ...query, limit: EXPERIENCES_PAGE_SIZE, offset });
  const prices = await bestPublicPriceFor(
    scope,
    found.items.map((tour) => tour.id),
    today,
  );
  return { tours: found.items, prices, total: found.total, page, pages };
}

async function Experiences({ params, searchParams }: ExperiencesProps) {
  const { site } = await params;
  const tenant = await requireActiveSite(site);
  const shell = await getStorefrontShell(tenant);
  const filters = parseExperienceFilters(await searchParams);
  const today = siteToday(tenant);

  const data = await inSite(tenant, async (scope) => {
    // The cheapest and dearest list price size the budget bands, and the
    // first of the two calls also counts the whole catalogue.
    const cheapest = await listPublishedTours(scope, { sort: "price_asc", limit: 1 });
    const dearest = cheapest.total > 1 ? await listPublishedTours(scope, { sort: "price_desc", limit: 1 }) : cheapest;
    const thresholds = priceThresholds(cheapest.items[0]?.priceAdult ?? 0, dearest.items[0]?.priceAdult ?? 0, tenant.currency);
    return {
      catalogueSize: cheapest.total,
      thresholds,
      categories: await listCategoriesInUse(scope),
      results: await loadResults(scope, catalogueQuery(filters, thresholds), filters, today),
    };
  });

  const { results, catalogueSize } = data;
  const shownFilters: ExperienceFilters = { ...filters, page: results.page };
  const filtered = hasActiveFilters(filters);
  const backdrop = shell.heroImage && isCloudinaryUrl(shell.heroImage.url) ? shell.heroImage : null;

  return (
    <ExperienceFilterProvider filters={shownFilters}>
      <section className="relative overflow-hidden bg-hero">
        {backdrop ? <Image src={backdrop.url} alt="" fill preload sizes="100vw" className="object-cover opacity-45" /> : null}
        <div className="container-x relative pb-24 pt-16 text-hero-foreground lg:pb-28 lg:pt-24">
          <nav aria-label="Breadcrumb" className="breadcrumb mb-6 !text-hero-foreground/75">
            <Link href="/" className="hover:text-hero-foreground">
              Home
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="text-hero-foreground">
              Experiences
            </span>
          </nav>
          <h1 className="animate-rise font-display text-5xl font-medium leading-none sm:text-6xl lg:text-7xl">
            Experiences &amp; <em className="text-highlight">tour packages</em>
          </h1>
          <p className="stagger-1 mt-5 max-w-xl animate-rise text-base leading-relaxed text-hero-foreground/85 sm:text-lg">
            {catalogueSize > 0
              ? `${formatCount(catalogueSize)} ${pluralize(catalogueSize, "experience", "experiences")} from ${tenant.name}. Search by place, or narrow the list by length and budget.`
              : `${tenant.name} is preparing its first experiences.`}
          </p>
        </div>
      </section>

      {catalogueSize > 0 ? (
        <section aria-label="Search and filter" className="relative -mt-10">
          <div className="container-x">
            <ExperienceFilterBar
              categories={data.categories.map(({ slug, name }) => ({ slug, name }))}
              // A destination without tours is offered only while it is the one selected (a footer link can select it).
              destinations={shell.destinations
                .filter((destination) => destination.tourCount > 0 || destination.slug === filters.destination)
                .map(({ slug, name }) => ({ slug, name }))}
              priceLabels={data.thresholds ? priceBandLabels(data.thresholds, tenant.currency) : null}
              showOffers={shell.offerCount > 0}
              total={results.total}
            />
          </div>
        </section>
      ) : null}

      <section aria-label="Results" className="pb-28 pt-12">
        <div className="container-x">
          {catalogueSize > 0 ? (
            <div className="mb-6 flex min-h-9 flex-wrap items-center justify-between gap-3">
              <p aria-live="polite" className="text-[15px] text-muted-foreground">
                <strong className="text-foreground">{formatCount(results.total)}</strong> {pluralize(results.total, "experience", "experiences")}
                {results.pages > 1 ? `, page ${results.page} of ${results.pages}` : ""}
              </p>
              {filtered ? (
                <ClearFiltersButton className="btn btn-ghost btn-sm" showIcon>
                  Clear all filters
                </ClearFiltersButton>
              ) : null}
            </div>
          ) : null}

          <ResultsRegion>
            {results.tours.length > 0 ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-7">
                {results.tours.map((tour) => (
                  <TourCard key={tour.id} tour={tour} price={results.prices[tour.id]} currency={tenant.currency} className="animate-rise" />
                ))}
              </div>
            ) : catalogueSize > 0 ? (
              <div className="card flex flex-col items-center border-dashed px-6 py-16 text-center">
                <Search aria-hidden="true" className="mb-4 size-10 text-eyebrow" strokeWidth={1.4} />
                <h2 className="font-display text-3xl text-primary">No experiences match those filters</h2>
                <p className="mb-6 mt-2 max-w-md text-muted-foreground">Try a different length or budget, or ask for a trip planned around you.</p>
                <div className="flex flex-wrap justify-center gap-3">
                  <ClearFiltersButton className="btn btn-outline btn-lg rounded-full">Clear filters</ClearFiltersButton>
                  <Link href="/contact" className="btn btn-default btn-lg rounded-full">
                    Request a custom trip
                  </Link>
                </div>
              </div>
            ) : (
              <div className="card flex flex-col items-center border-dashed px-6 py-16 text-center">
                <h2 className="font-display text-3xl text-primary">Nothing to book just yet</h2>
                <p className="mb-6 mt-2 max-w-md text-muted-foreground">
                  The first experiences are on their way. In the meantime, say where you would like to go and when.
                </p>
                <Link href="/contact" className="btn btn-default btn-lg rounded-full">
                  Get in touch
                </Link>
              </div>
            )}
          </ResultsRegion>

          {results.pages > 1 ? (
            <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-3">
              {results.page > 1 ? (
                <Link href={experiencesHref({ ...filters, page: results.page - 1 })} className="btn btn-outline rounded-full">
                  <ArrowLeft aria-hidden="true" />
                  Previous
                </Link>
              ) : null}
              <span className="px-2 text-sm text-muted-foreground">
                Page {results.page} of {results.pages}
              </span>
              {results.page < results.pages ? (
                <Link href={experiencesHref({ ...filters, page: results.page + 1 })} className="btn btn-outline rounded-full">
                  Next
                  <ArrowRight aria-hidden="true" />
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </section>
    </ExperienceFilterProvider>
  );
}

/**
 * Experiences catalogue. Search, category, destination, length, budget,
 * "On offer", sort order and page all live in the URL, so any view can be
 * shared and the footer's destination links land on a filtered list.
 */
export default function ExperiencesPage(props: ExperiencesProps) {
  return (
    <Suspense fallback={<PageHeroSkeleton />}>
      <Experiences {...props} />
    </Suspense>
  );
}
