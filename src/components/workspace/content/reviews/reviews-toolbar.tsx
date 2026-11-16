"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { BottomSheet, Spinner } from "@/components/overlays";
import { RATINGS } from "@/lib/review-display";
import {
  activeFilterCount,
  MAX_REVIEW_SEARCH,
  ratingParam,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUSES,
  reviewsListHref,
  type ReviewListParams,
} from "./params";
import type { TourOption } from "./types";

const SEARCH_DELAY_MS = 300;

interface ReviewsToolbarProps {
  /** The view the server rendered the list with. */
  params: ReviewListParams;
  tours: TourOption[];
}

/**
 * Search and filters for the reviews list. Everything lives in the URL:
 * typing replaces the history entry, choosing a filter adds one. On phones
 * the filters move into a bottom sheet; search stays on screen.
 */
export function ReviewsToolbar({ params, tours }: ReviewsToolbarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(params.q);
  const [appliedQ, setAppliedQ] = useState(params.q);
  const [sheetOpen, setSheetOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The URL changed underneath us (Back, a shared link): show what it says.
  if (params.q !== appliedQ) {
    setAppliedQ(params.q);
    if (params.q !== text.trim()) setText(params.q);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function cancelTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function go(next: Partial<ReviewListParams>, replace = false) {
    cancelTimer();
    // Any change of view starts on the first page.
    const href = reviewsListHref({ ...params, q: text.trim(), ...next, page: 1 });
    startTransition(() => (replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false })));
  }

  function applySearch(value: string) {
    if (value.trim() === params.q) return;
    go({ q: value.trim() }, true);
  }

  function onSearchInput(value: string) {
    setText(value);
    cancelTimer();
    timer.current = setTimeout(() => applySearch(value), SEARCH_DELAY_MS);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applySearch(text);
  }

  const count = activeFilterCount(params);
  const filters = <ReviewFilters params={params} tours={tours} onChange={go} />;

  return (
    <div className="mb-4 flex flex-col gap-3" aria-busy={pending || undefined}>
      <div className="flex items-center gap-2">
        <form role="search" onSubmit={onSubmit} className="relative flex-1 md:max-w-sm">
          <label htmlFor="review-search" className="sr-only">
            Search reviews
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
          <input
            id="review-search"
            className="input pl-9 pr-9"
            type="search"
            name="q"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={MAX_REVIEW_SEARCH}
            placeholder="Search name, title or text…"
            value={text}
            onChange={(event) => onSearchInput(event.target.value)}
          />
          {pending ? (
            <span className="pointer-events-none absolute right-3 top-3.5 text-muted-foreground">
              <Spinner className="size-4" />
              <span className="sr-only" role="status">
                Updating the list
              </span>
            </span>
          ) : null}
        </form>
        <button type="button" className="btn btn-outline md:hidden" aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal aria-hidden="true" />
          Filters
          {count > 0 ? <span className="badge badge-default ml-0.5 px-1.5">{count}</span> : null}
        </button>
      </div>

      <div className="hidden md:block">{filters}</div>

      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Filter reviews"
        footer={
          <div className="flex gap-2 pb-1">
            {count > 0 ? (
              <button type="button" className="btn btn-outline flex-1" onClick={() => go({ status: "all", featured: false, rating: null, tour: null })}>
                Clear filters
              </button>
            ) : null}
            <button type="button" className="btn btn-default flex-1" onClick={() => setSheetOpen(false)}>
              Show reviews
            </button>
          </div>
        }
      >
        {filters}
      </BottomSheet>
    </div>
  );
}

interface ReviewFiltersProps {
  params: ReviewListParams;
  tours: TourOption[];
  onChange: (next: Partial<ReviewListParams>) => void;
}

function ReviewFilters({ params, tours, onChange }: ReviewFiltersProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-center md:gap-3">
      <div role="group" aria-label="Visibility" className="flex flex-wrap gap-2">
        {REVIEW_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className="chip h-9 px-3.5 text-[13px]"
            aria-pressed={params.status === status}
            onClick={() => onChange({ status })}
          >
            {REVIEW_STATUS_LABELS[status]}
          </button>
        ))}
        <button type="button" className="chip h-9 px-3.5 text-[13px]" aria-pressed={params.featured} onClick={() => onChange({ featured: !params.featured })}>
          Featured only
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 md:flex md:gap-3">
        <label className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-2">
          <span className="text-[13px] font-medium text-muted-foreground">Rating</span>
          <select className="select md:w-36" value={params.rating ?? ""} onChange={(event) => onChange({ rating: ratingParam(event.target.value) })}>
            <option value="">Any rating</option>
            {RATINGS.map((rating) => (
              <option key={rating} value={rating}>
                {rating === 1 ? "1 star" : `${rating} stars`}
              </option>
            ))}
          </select>
        </label>
        {tours.length > 0 ? (
          <label className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-2">
            <span className="text-[13px] font-medium text-muted-foreground">Tour</span>
            <select className="select md:w-56" value={params.tour ?? ""} onChange={(event) => onChange({ tour: event.target.value || null })}>
              <option value="">All tours</option>
              {tours.map((tour) => (
                <option key={tour.id} value={tour.id}>
                  {tour.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </div>
  );
}
