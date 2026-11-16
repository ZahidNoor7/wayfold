"use client";

import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FocusEvent } from "react";
import { SwapIn } from "@/components/motion";
import { ReviewMedia } from "@/components/storefront-content/review-media";
import type { ReviewFile } from "@/lib/review-display";
import { formatCount, formatMonthYear, initials, isCloudinaryUrl, pluralize } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";

export interface CarouselReview {
  id: string;
  customerName: string;
  country: string;
  rating: number;
  body: string;
  reviewedOn: string;
  tourTitle: string | null;
  avatarUrl: string | null;
  /** Photos and videos shared with the review, in display order. */
  media: ReviewFile[];
}

export interface ReviewCarouselProps {
  reviews: CarouselReview[];
  /** Mean of all published reviews, and how many there are. */
  average: number;
  total: number;
}

const ROTATE_EVERY_MS = 8000;

/**
 * Featured reviews, one at a time. It advances by itself every eight seconds
 * unless the visitor asked for reduced motion, paused it, or is pointing at
 * or focused inside it. While it advances by itself it is not a live region,
 * so a screen reader is not interrupted every eight seconds; once it is
 * still, a manual change is announced.
 */
export function ReviewCarousel({ reviews, average, total }: ReviewCarouselProps) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // The viewer lives in a portal, outside the carousel, so focus leaving for it must not restart rotation.
  const [viewing, setViewing] = useState(false);

  const count = reviews.length;
  const canRotate = count > 1 && !reduce;
  const rotating = canRotate && !paused && !hovered && !focused && !viewing;

  useEffect(() => {
    if (!rotating) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % count), ROTATE_EVERY_MS);
    return () => clearInterval(timer);
  }, [rotating, count]);

  const review = reviews[Math.min(index, count - 1)];
  if (!review) return null;

  const stars = Math.min(5, Math.max(0, Math.round(review.rating)));
  const date = formatMonthYear(review.reviewedOn, "long");
  const context = [review.tourTitle, date].filter(Boolean).join(" · ");
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  };

  return (
    <section aria-labelledby="reviews" className="bg-secondary/60 py-20 lg:py-32">
      <div className="container-x max-w-4xl text-center">
        <p className="eyebrow mb-4">Guest stories</p>
        <h2 id="reviews" className="mb-12 font-display text-4xl font-medium text-primary">
          {average.toFixed(1)} average from {formatCount(total)} {pluralize(total, "review", "reviews")}
        </h2>

        <div
          role="group"
          aria-roledescription="carousel"
          aria-label="Guest reviews"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={onBlur}
        >
          <div aria-live={rotating ? "off" : "polite"} aria-atomic="true" className="min-h-[300px]">
            <SwapIn key={review.id}>
              <div role="group" aria-roledescription="slide" aria-label={`Review ${index + 1} of ${count}`}>
                <p role="img" aria-label={`${stars} out of 5 stars`} className="mb-7 text-xl tracking-[4px] text-highlight">
                  {"★".repeat(stars)}
                  <span className="text-muted-foreground/40">{"★".repeat(5 - stars)}</span>
                </p>
                <blockquote className="font-display text-2xl italic leading-snug sm:text-[34px]">“{review.body}”</blockquote>
                <ReviewMedia
                  items={review.media}
                  customerName={review.customerName}
                  visible={4}
                  thumbClassName="size-16 sm:size-20"
                  className="mt-8 justify-center"
                  onViewerChange={setViewing}
                />
                <div className="mt-10 flex items-center justify-center gap-4">
                  {isCloudinaryUrl(review.avatarUrl) ? (
                    <Image src={review.avatarUrl} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span aria-hidden="true" className="avatar h-14 w-14">
                      {initials(review.customerName)}
                    </span>
                  )}
                  <div className="text-left">
                    <p className="font-bold">
                      {review.customerName}
                      {review.country ? <span className="font-normal text-muted-foreground"> · {review.country}</span> : null}
                    </p>
                    {context ? <p className="text-sm text-muted-foreground">{context}</p> : null}
                  </div>
                </div>
              </div>
            </SwapIn>
          </div>

          {count > 1 ? (
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <button type="button" onClick={() => setIndex((index + count - 1) % count)} aria-label="Previous review" className="btn btn-outline btn-icon-lg rounded-full">
                <ArrowLeft aria-hidden="true" />
              </button>
              <div className="flex gap-1">
                {reviews.map((item, position) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Show review ${position + 1}`}
                    aria-current={position === index ? "true" : undefined}
                    onClick={() => setIndex(position)}
                    className="flex h-11 w-7 items-center justify-center"
                  >
                    <span className={cn("block h-2.5 rounded-full transition-all", position === index ? "w-7 bg-primary" : "w-2.5 bg-muted-foreground/40")} />
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setIndex((index + 1) % count)} aria-label="Next review" className="btn btn-outline btn-icon-lg rounded-full">
                <ArrowRight aria-hidden="true" />
              </button>
              {canRotate ? (
                <button
                  type="button"
                  onClick={() => setPaused(!paused)}
                  aria-label={paused ? "Play reviews" : "Pause reviews"}
                  className="btn btn-outline btn-icon-lg rounded-full"
                >
                  {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <Link href="/reviews" className="btn btn-link mt-6 text-[15px]">
          {total > 1 ? `Read all ${formatCount(total)} reviews` : "Read the review"}
        </Link>
      </div>
    </section>
  );
}
