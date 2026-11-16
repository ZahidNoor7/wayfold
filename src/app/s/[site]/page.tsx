import type { Metadata } from "next";
import { Suspense } from "react";
import { AboutTeaser } from "@/components/storefront/home/about-teaser";
import { CtaBand } from "@/components/storefront/home/cta-band";
import { HomeDestinations } from "@/components/storefront/home/destinations";
import { FeaturedExperiences } from "@/components/storefront/home/featured-experiences";
import { HomeHero } from "@/components/storefront/home/hero";
import { JournalTeaser } from "@/components/storefront/home/journal-teaser";
import { PromoStrip } from "@/components/storefront/home/promo-strip";
import { ReviewCarousel } from "@/components/storefront/home/review-carousel";
import { StatsBand } from "@/components/storefront/home/stats-band";
import { ValueProps } from "@/components/storefront/home/value-props";
import { HeroPageSkeleton } from "@/components/storefront/skeletons";
import { bestOffer, heroCopy } from "@/lib/storefront-format";
import { listPublishedTours, type ListPublishedToursInput } from "@/server/catalog/storefront";
import { listPublishedJourneyEntries } from "@/server/content/journey";
import { getReviewSummary, listFeaturedReviews } from "@/server/content/reviews";
import type { TenantScope } from "@/server/db/context";
import { bestPublicPriceFor, listPublicOffers } from "@/server/promotions/offers";
import type { SiteContent } from "@/server/settings/site-content";
import { inSite, requireActiveSite, siteToday } from "@/server/storefront/context";
import { getSiteImage, getStorefrontShell } from "@/server/storefront/shell";

interface HomeProps {
  params: Promise<{ site: string }>;
}

export const metadata: Metadata = { alternates: { canonical: "/" } };

type FeaturedMode = SiteContent["featured"]["mode"];

const FEATURED: Record<FeaturedMode, { heading: string; query: ListPublishedToursInput }> = {
  manual: { heading: "Hand-picked journeys", query: { featuredOnly: true, sort: "popular" } },
  popular: { heading: "The most popular journeys", query: { sort: "popular" } },
  rated: { heading: "The highest-rated journeys", query: { sort: "rating" } },
};

/** Enough tours for the category chips to have something to filter. */
const FEATURED_POOL = 12;

/**
 * The home page's featured tours for the mode the business chose. "Manual"
 * shows the tours it marked as featured; if it has marked none, the most
 * popular ones stand in, so a catalogue is never hidden behind an unset flag.
 */
async function loadFeatured(scope: TenantScope, mode: FeaturedMode) {
  const chosen = await listPublishedTours(scope, { ...FEATURED[mode].query, limit: FEATURED_POOL });
  if (mode !== "manual") return { heading: FEATURED[mode].heading, tours: chosen.items, total: chosen.total };

  const all = await listPublishedTours(scope, { sort: "popular", limit: FEATURED_POOL });
  return chosen.items.length > 0
    ? { heading: FEATURED.manual.heading, tours: chosen.items, total: all.total }
    : { heading: FEATURED.popular.heading, tours: all.items, total: all.total };
}

async function Home({ params }: HomeProps) {
  const { site } = await params;
  const tenant = await requireActiveSite(site);
  const shell = await getStorefrontShell(tenant);
  const { content } = shell;
  const today = siteToday(tenant);

  const data = await inSite(tenant, async (scope) => {
    const featured = await loadFeatured(scope, content.featured.mode);
    return {
      featured,
      prices: await bestPublicPriceFor(
        scope,
        featured.tours.map((tour) => tour.id),
        today,
      ),
      offers: shell.offerCount > 0 ? await listPublicOffers(scope, today) : [],
      portrait: await getSiteImage(scope, content.about.portraitMediaId),
      reviews: await listFeaturedReviews(scope, 6),
      reviewSummary: await getReviewSummary(scope),
      journal: (await listPublishedJourneyEntries(scope, { limit: 4 })).items,
    };
  });

  const copy = heroCopy(content.hero, tenant);
  const hasTours = data.featured.total > 0;
  const promo = bestOffer(data.offers);
  const hasAbout = Boolean(content.about.shortBio || content.about.credentialLine || data.portrait);

  return (
    <>
      <HomeHero {...copy} image={shell.heroImage} nowGuiding={content.hero.nowGuiding} hasTours={hasTours} />

      {content.stats.length > 0 ? <StatsBand stats={content.stats} /> : null}

      {promo ? <PromoStrip offer={promo} offerCount={data.offers.length} currency={tenant.currency} /> : null}

      {data.featured.tours.length > 0 ? (
        <FeaturedExperiences
          heading={data.featured.heading}
          tours={data.featured.tours}
          prices={data.prices}
          currency={tenant.currency}
          total={data.featured.total}
        />
      ) : null}

      {hasAbout ? (
        <AboutTeaser
          name={tenant.name}
          credentialLine={content.about.credentialLine}
          shortBio={content.about.shortBio}
          portrait={data.portrait}
          languages={content.languages.map((language) => language.name)}
          skills={content.skills}
        />
      ) : null}

      {shell.destinations.length > 0 ? <HomeDestinations destinations={shell.destinations} /> : null}

      {content.valueProps.length > 0 ? <ValueProps items={content.valueProps} /> : null}

      {data.journal.length > 0 ? (
        <JournalTeaser
          entries={data.journal.map((entry) => ({
            id: entry.id,
            slug: entry.slug,
            title: entry.title,
            teaser: entry.teaser,
            visitedOn: entry.visitedOn,
            cover: entry.cover,
            photoCount: entry.photos.length,
            relatedTourTitle: entry.relatedTour?.title ?? null,
          }))}
        />
      ) : null}

      {data.reviews.length > 0 && data.reviewSummary.total > 0 ? (
        <ReviewCarousel
          reviews={data.reviews.map((review) => ({
            id: review.id,
            customerName: review.customerName,
            country: review.country,
            rating: review.rating,
            body: review.body,
            reviewedOn: review.reviewedOn,
            tourTitle: review.tour?.title ?? null,
            avatarUrl: review.avatarUrl,
          }))}
          average={data.reviewSummary.average}
          total={data.reviewSummary.total}
        />
      ) : null}

      <CtaBand responseTime={content.contact.responseTime} image={shell.heroImage} hasTours={hasTours} />
    </>
  );
}

/**
 * Storefront home. Every section below the hero appears only when the
 * business has something to put in it, so a new workspace gets a short,
 * finished page rather than empty headings.
 */
export default function HomePage(props: HomeProps) {
  return (
    <Suspense fallback={<HeroPageSkeleton />}>
      <Home {...props} />
    </Suspense>
  );
}
