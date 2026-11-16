"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Pencil } from "lucide-react";
import { useEffect, useRef, useTransition } from "react";
import { Spinner } from "@/components/overlays";
import { SiteImage } from "@/components/storefront/site-image";
import {
  formatMonthYear,
  initials,
  nextShown,
  plural,
  REVIEW_PAGE_STEP,
  REVIEW_SORT_LABELS,
  REVIEW_SORTS,
  reviewsHref,
  showingLine,
  type DistributionRow,
  type ReviewFilters,
  type ReviewSort,
} from "@/lib/review-display";
import { isCloudinaryUrl } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";
import type { PublicReview } from "@/server/content/reviews";
import { ReviewMedia } from "./review-media";
import { Paragraphs, Stars } from "./prose";

/**
 * Filters live in the URL, so a filtered view can be shared and survives a
 * reload. Changing one replaces the address and lets the server send the new
 * list; the old list stays on screen (dimmed) until it arrives.
 */
function useReviewNavigation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = (filters: ReviewFilters) => startTransition(() => router.replace(reviewsHref(filters), { scroll: false }));
  return { pending, go };
}

interface RatingDistributionProps {
  rows: DistributionRow[];
  filters: ReviewFilters;
}

/** The rating distribution. Each row is also a filter: press to show that rating, press again to clear. */
export function RatingDistribution({ rows, filters }: RatingDistributionProps) {
  const { pending, go } = useReviewNavigation();
  return (
    <div className="flex flex-col gap-1" aria-busy={pending || undefined}>
      <p id="rating-distribution-hint" className="mb-2 text-[13px] text-muted-foreground">
        Rating distribution. Select a row to filter.
      </p>
      {rows.map((row) => {
        const on = filters.rating === row.rating;
        return (
          <button
            key={row.rating}
            type="button"
            aria-pressed={on}
            aria-label={`${row.rating} star: ${row.count} ${plural(row.count, "review")}`}
            // A level nobody gave leads nowhere, so it is not offered as a filter.
            disabled={row.count === 0 && !on}
            onClick={() => go({ ...filters, rating: on ? null : row.rating, shown: REVIEW_PAGE_STEP })}
            className="flex min-h-11 items-center gap-4 rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60 disabled:hover:bg-transparent aria-pressed:bg-accent"
          >
            <span className="w-14 text-left font-semibold">{row.rating} star</span>
            <span className="progress flex-1">
              <span className="block h-full rounded-full bg-highlight" style={{ width: `${row.percent}%` }} />
            </span>
            <span className="w-10 text-right tabular-nums text-muted-foreground">{row.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function ReviewCard({ review, index }: { review: PublicReview; index: number }) {
  const meta = [review.country, formatMonthYear(review.reviewedOn)].filter(Boolean).join(", ");
  return (
    // Focusable by script only: "Load more" hands focus to the first new review.
    <article tabIndex={-1} data-review-index={index} className="card flex animate-rise flex-col gap-3 p-6 outline-offset-4">
      <div className="flex items-center gap-3">
        {isCloudinaryUrl(review.avatarUrl) ? (
          <span className="avatar relative h-11 w-11">
            <SiteImage src={review.avatarUrl} alt="" sizes="44px" />
          </span>
        ) : (
          <span aria-hidden="true" className="avatar h-11 w-11">
            {initials(review.customerName)}
          </span>
        )}
        <div className="min-w-0">
          <p className="font-bold">{review.customerName}</p>
          {meta ? <p className="text-[13px] text-muted-foreground">{meta}</p> : null}
        </div>
      </div>
      <Stars rating={review.rating} className="tracking-[2px]" />
      {review.title ? <h3 className="font-display text-2xl font-semibold text-primary">{review.title}</h3> : null}
      <Paragraphs text={review.body} className="gap-3" paragraphClassName="text-[15px] leading-relaxed text-foreground/85" />
      <ReviewMedia items={review.media} customerName={review.customerName} className="mt-1" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        {review.tour ? (
          <Link href={`/experiences/${review.tour.slug}`} className="text-[13px] font-semibold text-eyebrow underline-offset-4 hover:underline">
            {review.tour.title}
          </Link>
        ) : null}
        {review.isVerified ? (
          <span className="badge badge-verified ml-auto">
            <BadgeCheck aria-hidden="true" className="size-3.5" />
            Verified booking
          </span>
        ) : (
          <span className="badge badge-manual ml-auto">
            <Pencil aria-hidden="true" className="size-3" />
            Shared directly
          </span>
        )}
      </div>
    </article>
  );
}

interface ReviewsListProps {
  filters: ReviewFilters;
  /** The reviews revealed so far, in the chosen order. */
  items: PublicReview[];
  /** How many reviews match the filters in total. */
  total: number;
  /** Tours a visitor can filter by. */
  tours: { id: string; title: string }[];
  businessName: string;
}

/** "All reviews": tour and sort controls, the cards, and "Load more" in steps of six. */
export function ReviewsList({ filters, items, total, tours, businessName }: ReviewsListProps) {
  // Two transitions, so "Load more" can show its own progress without dimming the list.
  const filtering = useReviewNavigation();
  const loading = useReviewNavigation();
  const pending = filtering.pending || loading.pending;
  const list = useRef<HTMLDivElement>(null);
  // Set when "Load more" is pressed: the position of the first review still to come.
  const focusFrom = useRef<number | null>(null);

  const go = (next: ReviewFilters) => {
    focusFrom.current = null;
    filtering.go(next);
  };

  useEffect(() => {
    const from = focusFrom.current;
    if (from === null || items.length <= from) return;
    focusFrom.current = null;
    list.current?.querySelector<HTMLElement>(`[data-review-index="${from}"]`)?.focus();
  }, [items.length]);

  const more = nextShown(filters.shown, total);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div>
          <h2 id="all-reviews" className="font-display text-4xl font-medium text-primary">
            All reviews
          </h2>
          <p aria-live="polite" className="mt-1 text-sm text-muted-foreground">
            {showingLine(items.length, total, filters.rating)}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {tours.length > 0 ? (
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="label text-[13px]">Tour</span>
              <select
                className="select w-64 max-w-full"
                value={filters.tourId ?? ""}
                onChange={(event) => go({ ...filters, tourId: event.target.value || null, shown: REVIEW_PAGE_STEP })}
              >
                <option value="">All tours</option>
                {tours.map((tour) => (
                  <option key={tour.id} value={tour.id}>
                    {tour.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <span className="label text-[13px]">Sort</span>
            <select className="select w-40" value={filters.sort} onChange={(event) => go({ ...filters, sort: event.target.value as ReviewSort })}>
              {REVIEW_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {REVIEW_SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <ul className="mb-6 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
        <li>
          <span className="badge badge-verified mr-1">
            <BadgeCheck aria-hidden="true" className="size-3.5" />
            Verified booking
          </span>{" "}
          matched to a completed {businessName} booking
        </li>
        <li>
          <span className="badge badge-manual mr-1">
            <Pencil aria-hidden="true" className="size-3" />
            Shared directly
          </span>{" "}
          sent by email or in person and added by {businessName}
        </li>
      </ul>

      {items.length === 0 ? (
        <div className="card border-dashed p-14 text-center text-muted-foreground">
          No reviews match these filters yet.{" "}
          <button type="button" onClick={() => go({ ...filters, rating: null, tourId: null, shown: REVIEW_PAGE_STEP })} className="btn btn-link">
            Show all reviews
          </button>
        </div>
      ) : (
        <div
          ref={list}
          aria-busy={pending || undefined}
          className={cn("grid items-start gap-5 transition-opacity duration-200 sm:grid-cols-2 lg:grid-cols-3", filtering.pending && "opacity-60")}
        >
          {items.map((review, index) => (
            <ReviewCard key={review.id} review={review} index={index} />
          ))}
        </div>
      )}

      {more !== null && items.length > 0 ? (
        <div className="mt-10 text-center">
          <button
            type="button"
            className="btn btn-outline btn-lg rounded-full"
            disabled={pending}
            aria-busy={loading.pending || undefined}
            onClick={() => {
              focusFrom.current = items.length;
              loading.go({ ...filters, shown: more });
            }}
          >
            {loading.pending ? <Spinner /> : null}
            Load more reviews
          </button>
        </div>
      ) : null}
    </>
  );
}
