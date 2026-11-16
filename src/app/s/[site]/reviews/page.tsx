import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Reveal } from "@/components/motion";
import { SiteImage } from "@/components/storefront/site-image";
import { loadReviews, loadSite, seoMetadata } from "@/components/storefront-content/data";
import { ContentSkeleton, JsonLd, Stars } from "@/components/storefront-content/prose";
import { RatingDistribution, ReviewsList } from "@/components/storefront-content/reviews-browser";
import { excerpt, quoted } from "@/components/storefront-content/text";
import { EmptyState } from "@/components/workspace/page-header";
import { distributionRows, fiveStarShare, formatMonthYear, initials, parseReviewFilters, plural } from "@/lib/review-display";
import { isCloudinaryUrl } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";
import { listPublishedTours } from "@/server/catalog/storefront";
import { getReviewSummary, listFeaturedReviews, type PublicReview } from "@/server/content/reviews";
import { inSite } from "@/server/storefront/context";

interface Props {
  params: Promise<{ site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { site } = await params;
  return seoMetadata(site, "reviews", "/reviews", ({ tenant }) => ({
    title: "Guest reviews",
    description: `What travellers say about their time with ${tenant.name}.`,
  }));
}

export default function ReviewsPage(props: Props) {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

function FeaturedStory({ review, dark }: { review: PublicReview; dark: boolean }) {
  const detail = [review.tour?.title, formatMonthYear(review.reviewedOn)].filter(Boolean).join(", ");
  return (
    <Reveal className="flex">
      <article className={cn("flex flex-1 flex-col gap-5 rounded-2xl p-8 sm:p-10", dark ? "bg-hero text-hero-foreground" : "bg-secondary")}>
        <Stars rating={review.rating} className="tracking-[3px]" />
        <blockquote className="font-display text-2xl italic leading-snug sm:text-3xl">{quoted(excerpt(review.body, 260))}</blockquote>
        <div className="mt-auto flex items-center gap-3">
          {isCloudinaryUrl(review.avatarUrl) ? (
            <span className="avatar relative h-12 w-12">
              <SiteImage src={review.avatarUrl} alt="" sizes="48px" />
            </span>
          ) : (
            <span aria-hidden="true" className={cn("avatar h-12 w-12", dark && "bg-highlight text-highlight-foreground")}>
              {initials(review.customerName)}
            </span>
          )}
          <span className="min-w-0">
            <span className="block font-bold">{[review.customerName, review.country].filter(Boolean).join(", ")}</span>
            {detail ? <span className={cn("block text-sm", dark ? "opacity-80" : "text-muted-foreground")}>{detail}</span> : null}
          </span>
        </div>
      </article>
    </Reveal>
  );
}

async function Content({ params, searchParams }: Props) {
  const { site } = await params;
  const filters = parseReviewFilters(await searchParams);
  const { tenant } = await loadSite(site);

  const { summary, featured, reviews, tours } = await inSite(tenant, async (scope) => {
    const summary = await getReviewSummary(scope);
    // A business with no published reviews needs none of the other reads.
    if (summary.total === 0) return { summary, featured: [], reviews: { items: [], total: 0 }, tours: [] };
    return {
      summary,
      featured: await listFeaturedReviews(scope, 2),
      reviews: await loadReviews(scope, filters),
      tours: (await listPublishedTours(scope, { limit: 100 })).items,
    };
  });

  const share = fiveStarShare(summary);
  const tourOptions = tours.filter((tour) => tour.reviewCount > 0 || tour.id === filters.tourId).map((tour) => ({ id: tour.id, title: tour.title }));

  return (
    <>
      <section className={cn("pt-16 lg:pt-24", summary.total > 0 ? "pb-16" : "pb-28")}>
        <div className="container-x">
          <p className="eyebrow mb-4">Guest reviews</p>
          <h1 className="mb-12 max-w-3xl wrap-break-word font-display text-5xl font-medium leading-none text-primary sm:text-6xl lg:text-7xl">
            What travellers say about {tenant.name}
          </h1>

          {summary.total > 0 ? (
            <div className="card grid gap-8 p-6 sm:p-10 md:grid-cols-[300px_1fr] md:items-center md:gap-14">
              <div className="text-center md:border-r md:pr-10">
                <p className="font-display text-[104px] leading-[.9] text-primary">{summary.average.toFixed(1)}</p>
                <Stars rating={summary.average} label={`Average ${summary.average.toFixed(1)} out of 5`} className="mb-1 mt-3 text-2xl tracking-[3px]" />
                <p className="text-[15px] text-muted-foreground">
                  <strong className="text-foreground">{summary.total}</strong> {plural(summary.total, "review")}
                  {share !== null ? (
                    <>
                      , <strong className="text-foreground">{share}%</strong> five-star
                    </>
                  ) : null}
                </p>
              </div>
              <RatingDistribution rows={distributionRows(summary)} filters={filters} />
            </div>
          ) : (
            <EmptyState
              title="No reviews yet"
              description={`Reviews from travellers will appear here once ${tenant.name} publishes them.`}
              action={
                <Link href="/experiences" className="btn btn-default btn-lg rounded-full">
                  Browse experiences
                </Link>
              }
            />
          )}
        </div>
      </section>

      {featured.length > 0 ? (
        <section aria-labelledby="featured-reviews" className="pb-16">
          <div className="container-x">
            <h2 id="featured-reviews" className="mb-6 font-display text-4xl font-medium text-primary">
              Featured stories
            </h2>
            <div className={cn("grid gap-5", featured.length > 1 && "md:grid-cols-2")}>
              {featured.map((review, index) => (
                <FeaturedStory key={review.id} review={review} dark={index === 0} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {summary.total > 0 ? (
        <section aria-labelledby="all-reviews" className="pb-28">
          <div className="container-x">
            <ReviewsList filters={filters} items={reviews.items} total={reviews.total} tours={tourOptions} businessName={tenant.name} />
          </div>
        </section>
      ) : null}

      {summary.total > 0 ? (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "TravelAgency",
            name: tenant.name,
            ...(tenant.website ? { url: tenant.website } : {}),
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: summary.average,
              reviewCount: summary.total,
              bestRating: 5,
              worstRating: 1,
            },
          }}
        />
      ) : null}
    </>
  );
}
