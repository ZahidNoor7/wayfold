"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  deleteReviewAction,
  setReviewFeaturedAction,
  setReviewPublishedAction,
} from "@/app/workspace/reviews/actions";
import { ConfirmDialog, Panel, Spinner } from "@/components/overlays";
import { MediaThumb } from "@/components/workspace/media/media-picker";
import { EmptyState, PageHeader } from "@/components/workspace/page-header";
import { useAction } from "@/hooks/use-action";
import { formatDate } from "@/lib/booking-display";
import { initials, starLabel, starString } from "@/lib/review-display";
import { reviewsListHref } from "./params";
import { ReviewForm } from "./review-form";
import { describeReviewMedia } from "./review-media";
import type { ReviewItem, TourOption } from "./types";

interface ReviewsBoardProps {
  items: ReviewItem[];
  /** Reviews in the workspace at all; 0 shows the first-review empty state. */
  totalAll: number;
  /** True when the list is narrowed by search or filters. */
  filtered: boolean;
  tours: TourOption[];
  today: string;
  canUpload: boolean;
  summary?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
}

type Editing = { mode: "new" } | { mode: "edit"; review: ReviewItem } | null;
type Busy = { id: string; kind: "publish" | "feature" } | null;

/** The reviews screen: header, list of cards, the add/edit panel and delete confirmation. */
export function ReviewsBoard({ items, totalAll, filtered, tours, today, canUpload, summary, toolbar, footer }: ReviewsBoardProps) {
  const [editing, setEditing] = useState<Editing>(null);
  // Bumped per opening so the form always starts from the review as it is now.
  const [formKey, setFormKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [deleting, setDeleting] = useState<ReviewItem | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const publish = useAction(setReviewPublishedAction, {
    success: (data) => (data.isPublished ? "Review published" : "Review hidden from site"),
  });
  const feature = useAction(setReviewFeaturedAction, {
    success: (data) => (data.isFeatured ? "Added to featured testimonials" : "Removed from featured"),
  });
  const remove = useAction(deleteReviewAction, {
    success: () => `Deleted review by ${deleting?.customerName ?? "customer"}`,
    onSuccess: () => setDeleting(null),
  });

  function open(next: Exclude<Editing, null>) {
    setEditing(next);
    setFormKey((key) => key + 1);
    setPanelOpen(true);
  }

  async function toggle(review: ReviewItem, kind: "publish" | "feature") {
    setBusy({ id: review.id, kind });
    if (kind === "publish") await publish.run({ id: review.id, published: !review.isPublished });
    else await feature.run({ id: review.id, featured: !review.isFeatured });
    setBusy(null);
  }

  const addButton = (
    <button type="button" className="btn btn-default" onClick={() => open({ mode: "new" })}>
      <Plus aria-hidden="true" />
      Add review
    </button>
  );

  return (
    <>
      <PageHeader
        title="Reviews"
        description="Reviews you add appear as “Added by guide” unless linked to a completed booking. Published reviews show on your website."
        actions={totalAll > 0 ? addButton : null}
      />

      {totalAll === 0 ? (
        <EmptyState
          title="No reviews yet"
          description="Add what your guests have said about their trips. Published reviews appear on your website’s reviews page, and featured ones on your homepage."
          action={addButton}
        />
      ) : (
        <>
          {summary}
          {toolbar}
          {items.length === 0 && filtered ? (
            <div className="card p-14 text-center">
              <p className="font-bold">No reviews match</p>
              <p className="text-sm text-muted-foreground">Try a different search or fewer filters.</p>
              <Link href={reviewsListHref()} className="btn btn-outline btn-sm mt-4">
                Clear filters
              </Link>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((review) => (
                <li key={review.id} className="flex">
                  <ReviewCard
                    review={review}
                    busy={busy?.id === review.id ? busy.kind : null}
                    onEdit={() => open({ mode: "edit", review })}
                    onTogglePublish={() => void toggle(review, "publish")}
                    onToggleFeature={() => void toggle(review, "feature")}
                    onDelete={() => setDeleting(review)}
                  />
                </li>
              ))}
            </ul>
          )}
          {footer}
        </>
      )}

      <Panel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title={editing?.mode === "edit" ? "Edit review" : "Add review"}
        description={editing?.mode === "edit" ? `Review by ${editing.review.customerName}` : "Add a review a guest sent you."}
      >
        {editing ? (
          <ReviewForm
            key={formKey}
            review={editing.mode === "edit" ? editing.review : null}
            tours={tours}
            today={today}
            canUpload={canUpload}
            onCancel={() => setPanelOpen(false)}
            onSaved={() => setPanelOpen(false)}
          />
        ) : null}
      </Panel>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next && !remove.pending) setDeleting(null);
        }}
        title={`Delete review by ${deleting?.customerName ?? ""}?`}
        description="This removes it from your website immediately. This can’t be undone."
        confirmLabel="Delete review"
        cancelLabel="Keep it"
        destructive
        pending={remove.pending}
        onConfirm={() => {
          if (deleting) void remove.run({ id: deleting.id });
        }}
      />
    </>
  );
}

interface ReviewCardProps {
  review: ReviewItem;
  busy: "publish" | "feature" | null;
  onEdit: () => void;
  onTogglePublish: () => void;
  onToggleFeature: () => void;
  onDelete: () => void;
}

function ReviewCard({ review, busy, onEdit, onTogglePublish, onToggleFeature, onDelete }: ReviewCardProps) {
  const meta = [review.country, review.tour?.title ?? "General review", formatDate(review.reviewedOn)].filter(Boolean).join(" · ");

  return (
    <article className="card flex w-full flex-col gap-2.5 p-5" aria-busy={busy ? true : undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          {review.avatar ? (
            <MediaThumb media={review.avatar} alt="" className="size-9 shrink-0 rounded-full" sizes="36px" />
          ) : (
            <span aria-hidden="true" className="avatar h-9 w-9 shrink-0 text-xs">
              {initials(review.customerName)}
            </span>
          )}
          <span className="truncate font-bold">{review.customerName}</span>
        </span>
        <span className="shrink-0 tracking-wider text-highlight" role="img" aria-label={starLabel(review.rating)}>
          {starString(review.rating)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{meta}</p>
      {review.title ? <p className="font-display text-xl font-semibold text-primary">{review.title}</p> : null}
      <p className="line-clamp-6 whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">{review.body}</p>

      {review.media.length > 0 ? (
        <ul className="flex gap-1.5" aria-label={`Attached: ${describeReviewMedia(review.media)}`}>
          {review.media.slice(0, 4).map((item, index) => (
            <li key={item.id} className="relative">
              <MediaThumb media={item} alt="" className="size-12 rounded-md border" sizes="48px" />
              {index === 3 && review.media.length > 4 ? (
                <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center rounded-md bg-black/55 text-xs font-bold text-white">
                  +{review.media.length - 4}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {review.isVerified ? <span className="badge badge-verified">Verified booking</span> : <span className="badge badge-manual">Added by guide</span>}
        {review.isFeatured ? <span className="badge badge-default">Featured</span> : null}
        {!review.isPublished ? <span className="badge badge-secondary">Unpublished</span> : null}
      </div>

      <div className="mt-auto flex flex-wrap gap-1.5 border-t pt-3">
        <button type="button" className="btn btn-outline btn-sm" aria-label={`Edit review by ${review.customerName}`} onClick={onEdit}>
          Edit
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={busy !== null}
          aria-busy={busy === "publish" || undefined}
          aria-label={`${review.isPublished ? "Unpublish" : "Publish"} review by ${review.customerName}`}
          onClick={onTogglePublish}
        >
          {busy === "publish" ? <Spinner /> : null}
          {review.isPublished ? "Unpublish" : "Publish"}
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={busy !== null}
          aria-busy={busy === "feature" || undefined}
          aria-label={`${review.isFeatured ? "Unfeature" : "Feature"} review by ${review.customerName}`}
          onClick={onToggleFeature}
        >
          {busy === "feature" ? <Spinner /> : null}
          {review.isFeatured ? "Unfeature" : "Feature"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm text-destructive hover:text-destructive"
          aria-label={`Delete review by ${review.customerName}`}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
