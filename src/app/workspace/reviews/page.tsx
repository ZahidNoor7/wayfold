import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  hasReviewFilters,
  parseReviewParams,
  reviewPageOutOfRange,
  REVIEWS_PAGE_SIZE,
  reviewsListHref,
  toReviewQuery,
  type ReviewListParams,
} from "@/components/workspace/content/reviews/params";
import { ReviewsBoard } from "@/components/workspace/content/reviews/reviews-board";
import { ReviewsToolbar } from "@/components/workspace/content/reviews/reviews-toolbar";
import type { ReviewItem, TourOption } from "@/components/workspace/content/reviews/types";
import { PageSkeleton } from "@/components/workspace/page-header";
import { formatCount, pageCount, pageSummary, type SearchParams } from "@/lib/booking-display";
import { todayIn } from "@/lib/dates";
import { distributionRows, plural, starLabel, starString, type RatingSummary } from "@/lib/review-display";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import type { TenantScope } from "@/server/db/context";
import { listTours } from "@/server/catalog/tours";
import { getReviewSummary, listReviews, type ReviewView } from "@/server/content/reviews";

export const metadata = { title: "Reviews" };

export default function ReviewsPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={6} />}>
      <Content {...props} />
    </Suspense>
  );
}

/** Every tour, for the filter and the review form. Paged because the catalogue caps a page at 100. */
async function allTours(scope: TenantScope): Promise<TourOption[]> {
  const out: TourOption[] = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const { items, total } = await listTours(scope, { limit: 100, offset });
    out.push(...items.map((tour) => ({ id: tour.id, title: tour.title })));
    if (items.length === 0 || out.length >= total) break;
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

function toItem(review: ReviewView): ReviewItem {
  return {
    id: review.id,
    customerName: review.customerName,
    country: review.country,
    rating: review.rating,
    title: review.title,
    body: review.body,
    reviewedOn: review.reviewedOn,
    isVerified: review.isVerified,
    isFeatured: review.isFeatured,
    isPublished: review.isPublished,
    tour: review.tour,
    avatar: review.avatar,
    media: review.media.map(({ id, url, alt, resourceType }) => ({ id, url, alt, resourceType })),
  };
}

async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const workspace = await requireWorkspace("reviews.manage");
  const params = parseReviewParams(await searchParams);
  const filtered = hasReviewFilters(params);

  const { page, totalAll, summary, tours } = await inWorkspace(workspace, async (scope) => {
    const page = await listReviews(scope, toReviewQuery(params));
    // With filters on, the empty state still needs to know whether any review exists at all.
    const totalAll = filtered ? (await listReviews(scope, { limit: 1 })).total : page.total;
    const summary = await getReviewSummary(scope);
    const tours = await allTours(scope);
    return { page, totalAll, summary, tours };
  });

  const lastPage = reviewPageOutOfRange(params.page, page.total);
  if (lastPage !== null && page.total > 0) redirect(reviewsListHref({ ...params, page: lastPage }));

  return (
    <ReviewsBoard
      items={page.items.map(toItem)}
      totalAll={totalAll}
      filtered={filtered}
      tours={tours}
      today={todayIn(workspace.tenant.timezone)}
      canUpload={can(workspace, "media.manage")}
      summary={<SummaryStrip summary={summary} />}
      toolbar={<ReviewsToolbar params={params} tours={tours} />}
      footer={page.total > 0 ? <Pagination params={params} total={page.total} /> : null}
    />
  );
}

function SummaryStrip({ summary }: { summary: RatingSummary }) {
  const rows = distributionRows(summary);
  return (
    <section aria-labelledby="review-summary" className="card mb-6 grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-10 sm:p-6">
      <div>
        <h2 id="review-summary" className="text-[13px] text-muted-foreground">
          Published reviews
        </h2>
        {summary.total > 0 ? (
          <>
            <p className="mt-1 font-display text-5xl font-semibold leading-none text-primary">{summary.average.toFixed(1)}</p>
            <p className="mt-2 tracking-wider text-highlight" role="img" aria-label={`Average ${starLabel(summary.average)}`}>
              {starString(summary.average)}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              From {formatCount(summary.total)} published {plural(summary.total, "review")}
            </p>
          </>
        ) : (
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">None published yet. Publish a review to show your rating on the website.</p>
        )}
      </div>
      {summary.total > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Rating breakdown">
          {rows.map((row) => (
            <li key={row.rating} className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-3 text-[13px]">
              <span className="text-muted-foreground">{row.rating === 1 ? "1 star" : `${row.rating} stars`}</span>
              <span className="progress h-1.5" aria-hidden="true">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${row.percent}%` }} />
              </span>
              <span className="text-right font-semibold">
                {formatCount(row.count)}
                <span className="sr-only"> {plural(row.count, "review")}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Pagination({ params, total }: { params: ReviewListParams; total: number }) {
  const pages = pageCount(total, REVIEWS_PAGE_SIZE);
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
      <span>{pageSummary(params.page, REVIEWS_PAGE_SIZE, total)} reviews</span>
      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center gap-2">
          {params.page > 1 ? (
            <Link href={reviewsListHref({ ...params, page: params.page - 1 })} className="btn btn-outline btn-sm">
              Previous
            </Link>
          ) : (
            <span className="btn btn-outline btn-sm" aria-disabled="true">
              Previous
            </span>
          )}
          <span aria-current="page">
            Page {params.page} of {pages}
          </span>
          {params.page < pages ? (
            <Link href={reviewsListHref({ ...params, page: params.page + 1 })} className="btn btn-outline btn-sm">
              Next
            </Link>
          ) : (
            <span className="btn btn-outline btn-sm" aria-disabled="true">
              Next
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
