import type { Metadata } from "next";
import { Check, MapPin, X } from "lucide-react";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { isHeroRoute } from "@/components/storefront/hero-routes";
import { RatingFigure, Stars } from "@/components/storefront-booking/rating";
import { RelatedTourCard } from "@/components/storefront-booking/related-tour-card";
import { ShareButton } from "@/components/storefront-booking/share-button";
import { TourFaq, TourItinerary } from "@/components/storefront-booking/tour-accordions";
import { TourBooking, TourBookingAside, TourBookingBar } from "@/components/storefront-booking/tour-booking";
import { TourGallery } from "@/components/storefront-booking/tour-gallery";
import type { BookableTour } from "@/components/storefront-booking/types";
import { currencyDigits, durationText, fromPrice, guestRange, initials, mapsHref, partyLimits, type DayInfo, type OfferRef } from "@/lib/booking-form";
import { addDays } from "@/lib/dates";
import { formatMonthYear, isCloudinaryUrl, paragraphs, languageName } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";
import { getTourAvailability, MAX_AVAILABILITY_DAYS } from "@/server/bookings/availability";
import { getPublishedTourBySlug, listPublishedTours, type PublicTourDetail } from "@/server/catalog/storefront";
import { listPublishedReviews } from "@/server/content/reviews";
import { ReviewMedia } from "@/components/storefront-content/review-media";
import type { TenantScope } from "@/server/db/context";
import { env } from "@/server/env";
import { NotFoundError } from "@/server/errors";
import { bestPublicPriceFor, getPublicRequestSettings } from "@/server/promotions/offers";
import { getBookingSettings } from "@/server/settings/tenant-settings";
import { inSite, requireActiveSite, siteToday } from "@/server/storefront/context";
import { getStorefrontShell, originFromHeaders } from "@/server/storefront/shell";

interface Props {
  params: Promise<{ site: string; slug: string }>;
}

/**
 * The tour and its tenant, read once per request and shared by the page and
 * its metadata. A draft, an archived tour and an unknown slug are all a 404.
 */
const loadTour = cache(async (site: string, rawSlug: string) => {
  const tenant = await requireActiveSite(site);
  const today = siteToday(tenant);
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    notFound();
  }
  try {
    const tour = await inSite(tenant, (scope) => getPublishedTourBySlug(scope, slug, { today }));
    return { tenant, today, tour };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});

function summaryOf(tour: PublicTourDetail): string {
  const text = (tour.summary || paragraphs(tour.description)[0] || "").replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 197).trimEnd()}…` : text;
}

function photosOf(tour: PublicTourDetail): Array<{ url: string; alt: string }> {
  const photos = tour.media.filter((item) => item.resourceType === "image" && isCloudinaryUrl(item.url)).map((item) => ({ url: item.url, alt: item.alt }));
  if (photos.length === 0 && isCloudinaryUrl(tour.coverUrl)) return [{ url: tour.coverUrl, alt: tour.coverAlt ?? "" }];
  return photos;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { site, slug } = await params;
  const { tour } = await loadTour(site, slug);
  const description = summaryOf(tour);
  const image = photosOf(tour)[0];
  return {
    title: tour.title,
    ...(description ? { description } : {}),
    alternates: { canonical: `/experiences/${tour.slug}` },
    openGraph: {
      type: "website",
      title: tour.title,
      ...(description ? { description } : {}),
      url: `/experiences/${tour.slug}`,
      ...(image ? { images: [{ url: image.url, alt: image.alt || tour.title }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title: tour.title, ...(description ? { description } : {}) },
  };
}

/** The shell decides which routes sit under its transparent header; this page adapts to either answer. */
const OVER_HERO = isHeroRoute("/experiences/tour");

export default function TourPage(props: Props) {
  return (
    <Suspense fallback={<TourSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

function TourSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <div className={cn(OVER_HERO ? "bg-hero pb-10 pt-28" : "pt-8")}>
        <div className="container-x">
          <div className={cn("h-3 w-56 rounded-full", OVER_HERO ? "bg-hero-foreground/15" : "skeleton")} />
          <div className={cn("mt-6 h-12 w-4/5 max-w-xl rounded-lg sm:h-14", OVER_HERO ? "bg-hero-foreground/15" : "skeleton")} />
          <div className={cn("mt-4 h-4 w-72 max-w-full rounded-full", OVER_HERO ? "bg-hero-foreground/10" : "skeleton")} />
        </div>
      </div>
      <div className={cn("container-x", OVER_HERO ? "pt-8" : "pt-7")}>
        <div className="skeleton aspect-[16/10] w-full md:aspect-auto md:h-[492px]" />
      </div>
      <div className="container-x flex flex-col gap-14 pb-24 pt-12 lg:flex-row lg:gap-16">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="skeleton h-24" />
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-4" />
          <div className="skeleton h-4" />
          <div className="skeleton h-4 w-2/3" />
        </div>
        <div className="skeleton hidden h-[520px] w-[380px] shrink-0 lg:block" />
      </div>
    </div>
  );
}

/** Every upcoming departure of a departure tour, with its live state from the availability service. */
async function departureDays(scope: TenantScope, tour: PublicTourDetail, today: string, maxDate: string): Promise<DayInfo[]> {
  const dates = tour.departures
    .map((departure) => departure.startDate)
    .filter((date) => date >= today && date <= maxDate)
    .sort();
  if (dates.length === 0) return [];

  const byDate = new Map<string, DayInfo>();
  // The service answers a bounded window per call; a long season is read in steps.
  for (let from = dates[0]!; from <= dates.at(-1)!; from = addDays(from, MAX_AVAILABILITY_DAYS)) {
    const to = [addDays(from, MAX_AVAILABILITY_DAYS - 1), dates.at(-1)!].sort()[0]!;
    const window = await getTourAvailability(scope, tour.id, { from, to, today });
    for (const day of window.days) byDate.set(day.date, day);
  }
  return dates
    .map((date) => byDate.get(date))
    .filter((day): day is DayInfo => day !== undefined && day.state !== "past")
    .map(({ date, endDate, state, reason, seatsLeft, capacity, slots }) => ({ date, endDate, state, reason, seatsLeft, capacity, slots }));
}

const FACT_COLUMNS: Record<number, string> = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" };
const SECTION_HEADING = "font-display text-4xl font-medium text-primary";

async function Content({ params }: Props) {
  const { site, slug } = await params;
  const { tenant, today, tour } = await loadTour(site, slug);
  const shell = await getStorefrontShell(tenant);
  const currency = tenant.currency;

  const data = await inSite(tenant, async (scope) => {
    const settings = await getBookingSettings(scope);
    const maxDate = addDays(today, settings.horizonDays);
    const reviews = await listPublishedReviews(scope, { tourId: tour.id, sort: "newest", limit: 4 });

    // Same category first; a tour alone in its category borrows from the rest of the catalogue.
    const sameCategory = tour.categorySlug ? (await listPublishedTours(scope, { category: tour.categorySlug, limit: 4 })).items : [];
    let related = sameCategory.filter((other) => other.id !== tour.id).slice(0, 3);
    if (related.length === 0) related = (await listPublishedTours(scope, { limit: 4 })).items.filter((other) => other.id !== tour.id).slice(0, 3);

    const prices = await bestPublicPriceFor(scope, [tour.id, ...related.map((other) => other.id)], today);
    const requests = await getPublicRequestSettings(scope);
    const departures = tour.kind === "departure" ? await departureDays(scope, tour, today, maxDate) : null;
    return { maxDate, reviews, related, prices, requests, departures };
  });

  const offer: OfferRef | null = data.prices[tour.id]?.offer ?? null;
  const price = fromPrice(tour.priceAdult, offer);
  const photos = photosOf(tour);
  // Without a long description, the summary is the overview: never an empty page.
  const overview = paragraphs(tour.description).length > 0 ? paragraphs(tour.description) : paragraphs(tour.summary);
  const limits = partyLimits(tour);
  const languages = tour.languages.length > 0 ? tour.languages : tenant.languages;
  const mapLink = mapsHref(tour.meetingLatitude, tour.meetingLongitude);
  const hasReviews = tour.reviewCount > 0 && tour.ratingAverage !== null;
  const origin = originFromHeaders(await headers(), env().APP_URL.startsWith("https://") ? "https" : "http");
  const url = `${origin ?? ""}/experiences/${tour.slug}`;

  const facts = [
    { label: "Duration", value: durationText(tour.durationDays, tour.durationLabel) },
    { label: "Group size", value: guestRange(limits) },
    ...(tour.meetingPoint ? [{ label: "Meeting point", value: tour.meetingPoint }] : []),
    ...(languages.length > 0 ? [{ label: "Languages", value: languages.map((language) => languageName(language)).join(" · ") }] : []),
  ];

  const bookable: BookableTour = {
    id: tour.id,
    slug: tour.slug,
    title: tour.title,
    kind: tour.kind,
    durationDays: tour.durationDays,
    durationLabel: tour.durationLabel,
    priceAdult: tour.priceAdult,
    childPricePercent: tour.childPricePercent,
    childMaxAge: tour.childMaxAge,
    minGroupSize: tour.minGroupSize,
    maxGroupSize: tour.maxGroupSize,
    categoryName: tour.categoryName,
    coverUrl: tour.coverUrl,
    coverAlt: tour.coverAlt,
  };

  // A tour is both a trip and something with a price and ratings, so it is
  // described as both: search engines read the offer and the rating from Product.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": ["TouristTrip", "Product"],
    name: tour.title,
    description: summaryOf(tour) || undefined,
    url,
    image: photos.length > 0 ? photos.slice(0, 6).map((photo) => photo.url) : undefined,
    category: tour.categoryName ?? undefined,
    brand: { "@type": "Organization", name: tenant.name },
    provider: { "@type": "TravelAgency", name: tenant.name, ...(origin ? { url: origin } : {}) },
    offers: {
      "@type": "Offer",
      url,
      price: (price.now / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency)),
      priceCurrency: currency,
      availability: "https://schema.org/InStock",
    },
    ...(hasReviews ? { aggregateRating: { "@type": "AggregateRating", ratingValue: tour.ratingAverage, reviewCount: tour.reviewCount, bestRating: 5, worstRating: 1 } } : {}),
    ...(tour.itinerary.length > 0
      ? {
          itinerary: {
            "@type": "ItemList",
            numberOfItems: tour.itinerary.length,
            itemListElement: tour.itinerary.map((day, index) => ({
              "@type": "ListItem",
              position: index + 1,
              item: { "@type": "TouristAttraction", name: day.title, ...(day.description ? { description: day.description } : {}) },
            })),
          },
        }
      : {}),
  };

  const crumb = OVER_HERO ? "hover:text-hero-foreground" : "hover:text-foreground";

  return (
    <TourBooking
      tour={bookable}
      offer={offer}
      currency={currency}
      calendar={{ today, maxDate: data.maxDate }}
      departures={data.departures}
      contact={{ name: tenant.name, whatsapp: shell.whatsapp?.url ?? null }}
      requestsEnabled={shell.promotionsEnabled && data.requests.requestsEnabled}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <div className={cn(OVER_HERO ? "bg-hero pb-10 pt-28 text-hero-foreground" : "pt-8")}>
        <div className="container-x">
          <nav aria-label="Breadcrumb" className={cn("breadcrumb mb-5", OVER_HERO && "!text-hero-foreground/75")}>
            <Link href="/" className={crumb}>
              Home
            </Link>
            <span aria-hidden="true">/</span>
            <Link href="/experiences" className={crumb}>
              Experiences
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className={OVER_HERO ? "text-hero-foreground" : "text-foreground"}>
              {tour.title}
            </span>
          </nav>
          <div className={cn("flex flex-wrap items-end justify-between gap-6", !OVER_HERO && "mb-7")}>
            <div className="min-w-0">
              {tour.isFeatured || tour.categoryName ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {tour.isFeatured ? <span className={cn("badge uppercase tracking-wider", OVER_HERO ? "badge-highlight" : "badge-default")}>Featured</span> : null}
                  {tour.categoryName ? (
                    <span className={cn("badge badge-outline uppercase tracking-wider", OVER_HERO && "border-hero-foreground/30 text-hero-foreground")}>{tour.categoryName}</span>
                  ) : null}
                </div>
              ) : null}
              <h1 className={cn("wrap-break-word font-display text-[44px] font-medium leading-none sm:text-6xl", OVER_HERO ? "text-hero-foreground" : "text-primary")}>
                {tour.title}
              </h1>
              <p className={cn("mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[15px]", OVER_HERO ? "text-hero-foreground/75" : "text-muted-foreground")}>
                {tour.place ? <span>{tour.place}</span> : null}
                {hasReviews ? (
                  <span className={cn("inline-flex items-center gap-1.5 font-semibold", OVER_HERO ? "text-hero-foreground" : "text-foreground")}>
                    <RatingFigure average={tour.ratingAverage!} />
                    <a href="#reviews" className={cn("font-normal underline underline-offset-4", OVER_HERO ? "text-hero-foreground/75" : "text-muted-foreground")}>
                      {tour.reviewCount} {tour.reviewCount === 1 ? "review" : "reviews"}
                    </a>
                  </span>
                ) : null}
                <span>Hosted by {tenant.name}</span>
              </p>
            </div>
            <div className="flex gap-2">
              <ShareButton title={tour.title} className={OVER_HERO ? "btn-hero-outline" : "btn-outline"} />
            </div>
          </div>
        </div>
      </div>

      {photos.length > 0 ? (
        <div className={cn("container-x", OVER_HERO && "pt-8")}>
          <TourGallery photos={photos} tourTitle={tour.title} />
        </div>
      ) : null}

      <div className="container-x pb-24 pt-12 lg:pt-14">
        <div className="flex flex-col gap-14 lg:flex-row lg:items-start lg:gap-16">
          <div className="min-w-0 flex-1">
            <dl className={cn("card mb-14 grid grid-cols-2 gap-px overflow-hidden bg-border", FACT_COLUMNS[facts.length])}>
              {facts.map((fact, index) => (
                <div key={fact.label} className={cn("bg-card p-5", facts.length % 2 === 1 && index === facts.length - 1 && "col-span-2 sm:col-span-1")}>
                  <dt className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">{fact.label}</dt>
                  <dd className="line-clamp-3 font-display text-2xl leading-tight text-primary">{fact.value}</dd>
                </div>
              ))}
            </dl>

            {overview.length > 0 ? (
              <section aria-labelledby="overview" className="mb-14">
                <h2 id="overview" className={cn(SECTION_HEADING, "mb-4")}>
                  Overview
                </h2>
                {overview.map((paragraph, index) => (
                  <p key={index} className="mb-4 max-w-[75ch] whitespace-pre-line text-[17px] leading-relaxed text-foreground/85 last:mb-0">
                    {paragraph}
                  </p>
                ))}
              </section>
            ) : null}

            {tour.highlights.length > 0 ? (
              <section aria-labelledby="highlights" className="mb-14">
                <h2 id="highlights" className={cn(SECTION_HEADING, "mb-5")}>
                  Highlights
                </h2>
                <ul className="grid gap-4 sm:grid-cols-2">
                  {tour.highlights.map((highlight, index) => (
                    <li key={index} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
                      </span>
                      <span className="text-base leading-relaxed text-foreground/85">{highlight}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {tour.itinerary.length > 0 ? (
              <section aria-labelledby="itinerary" className="mb-14">
                <TourItinerary days={tour.itinerary} headingId="itinerary" />
              </section>
            ) : null}

            {tour.inclusions.length > 0 || tour.exclusions.length > 0 ? (
              <section aria-label="Inclusions" className="mb-14 grid gap-5 sm:grid-cols-2">
                {tour.inclusions.length > 0 ? (
                  <div className="card p-7">
                    <h2 className="mb-4 font-display text-3xl font-medium text-primary">What’s included</h2>
                    <ul className="flex flex-col gap-3 text-[15px]">
                      {tour.inclusions.map((item, index) => (
                        <li key={index} className="flex gap-2.5">
                          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" strokeWidth={2.6} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {tour.exclusions.length > 0 ? (
                  <div className="card p-7">
                    <h2 className="mb-4 font-display text-3xl font-medium text-primary">Not included</h2>
                    <ul className="flex flex-col gap-3 text-[15px]">
                      {tour.exclusions.map((item, index) => (
                        <li key={index} className="flex gap-2.5">
                          <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" strokeWidth={2.6} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}

            {tour.goodToKnow.length > 0 ? (
              <section aria-labelledby="good-to-know" className="mb-14 rounded-xl bg-secondary/70 p-7">
                <h2 id="good-to-know" className="mb-3 font-display text-3xl font-medium text-primary">
                  Good to know
                </h2>
                <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-foreground/85">
                  {tour.goodToKnow.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {tour.meetingPoint ? (
              <section aria-labelledby="meeting-point" className="mb-14">
                <h2 id="meeting-point" className={cn(SECTION_HEADING, "mb-4")}>
                  Meeting point
                </h2>
                <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
                  <p className="flex min-w-0 items-start gap-3 text-[17px] leading-relaxed text-foreground/85">
                    <MapPin aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" />
                    <span className="whitespace-pre-line">{tour.meetingPoint}</span>
                  </p>
                  {mapLink ? (
                    <a href={mapLink} target="_blank" rel="noopener noreferrer" className="btn btn-outline rounded-full">
                      Open in Maps
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : null}
                </div>
              </section>
            ) : null}

            {tour.faq.length > 0 ? (
              <section aria-labelledby="faq" className="mb-14">
                <h2 id="faq" className={cn(SECTION_HEADING, "mb-3")}>
                  Frequently asked
                </h2>
                <TourFaq items={tour.faq} />
              </section>
            ) : null}

            {tour.cancellationPolicy ? (
              <section aria-labelledby="cancellation" className="mb-14">
                <h2 id="cancellation" className={cn(SECTION_HEADING, "mb-4")}>
                  Cancellation policy
                </h2>
                {paragraphs(tour.cancellationPolicy).map((paragraph, index) => (
                  <p key={index} className="mb-3 max-w-[75ch] whitespace-pre-line text-[15px] leading-relaxed text-foreground/85 last:mb-0">
                    {paragraph}
                  </p>
                ))}
              </section>
            ) : null}

            {hasReviews && data.reviews.items.length > 0 ? (
              <section id="reviews" aria-labelledby="reviews-heading">
                <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
                  <h2 id="reviews-heading" className={cn(SECTION_HEADING, "flex flex-wrap items-baseline gap-x-3")}>
                    <RatingFigure average={tour.ratingAverage!} />
                    <span>
                      · {tour.reviewCount} {tour.reviewCount === 1 ? "review" : "reviews"}
                    </span>
                  </h2>
                  <Link href="/reviews" className="btn btn-link px-0">
                    See all reviews
                  </Link>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  {data.reviews.items.map((review) => (
                    <article key={review.id} className="card p-6">
                      <div className="mb-3 flex items-center gap-3">
                        <span className="avatar relative" aria-hidden="true">
                          {isCloudinaryUrl(review.avatarUrl) ? (
                            <Image src={review.avatarUrl} alt="" fill sizes="40px" className="object-cover" />
                          ) : (
                            initials(review.customerName)
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-bold">{review.customerName}</p>
                          <p className="text-[13px] text-muted-foreground">{[review.country, formatMonthYear(review.reviewedOn)].filter(Boolean).join(" · ")}</p>
                        </div>
                      </div>
                      <Stars rating={review.rating} className="mb-2" />
                      {review.title ? <p className="mb-1 font-semibold">{review.title}</p> : null}
                      <p className="whitespace-pre-line text-[15px] leading-relaxed text-foreground/85">{review.body}</p>
                      <ReviewMedia items={review.media} customerName={review.customerName} visible={3} thumbClassName="size-14" className="mt-3" />
                      {review.isVerified ? (
                        <span className="badge badge-verified mt-4">
                          <Check aria-hidden="true" className="size-3" />
                          Verified booking
                        </span>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <TourBookingAside />
        </div>
      </div>

      {data.related.length > 0 ? (
        <section aria-labelledby="related" className="bg-secondary/60 py-20">
          <div className="container-x">
            <h2 id="related" className={cn(SECTION_HEADING, "mb-8")}>
              You may also love
            </h2>
            <div className="no-scrollbar -mx-5 flex snap-x gap-5 overflow-x-auto px-5 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
              {data.related.map((other) => (
                <RelatedTourCard key={other.id} tour={other} offer={data.prices[other.id]?.offer ?? null} currency={currency} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <TourBookingBar />
    </TourBooking>
  );
}
