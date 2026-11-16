"use client";

import { ImagePlus } from "lucide-react";
import { useId, useState } from "react";
import { MediaPicker, MediaThumb } from "@/components/workspace/media/media-picker";
import { RowControls } from "../row-controls";
import { describeReviewMedia, moveReviewMedia, pickedReviewMedia, REVIEW_MEDIA_LIMIT, type ReviewMediaChoice } from "./review-media";

interface ReviewMediaFieldProps {
  value: ReviewMediaChoice[];
  onChange: (value: ReviewMediaChoice[]) => void;
  error?: string | null;
  /** Pass `can(workspace, "media.manage")`. */
  canUpload?: boolean;
  disabled?: boolean;
}

/**
 * Photos and videos the customer shared with their review: choose from the
 * media library (or upload), put them in order, and remove them.
 */
export function ReviewMediaField({ value, onChange, error, canUpload = true, disabled }: ReviewMediaFieldProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={errorId ?? `${id}-hint`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span id={`${id}-label`} className="label">
          Customer photos and videos
          <span className="ml-1.5 font-normal text-muted-foreground">
            optional · {value.length} / {REVIEW_MEDIA_LIMIT}
          </span>
        </span>
        <button type="button" className="btn btn-outline btn-sm" disabled={disabled} onClick={() => setOpen(true)}>
          <ImagePlus aria-hidden="true" />
          {value.length > 0 ? "Add or remove files" : "Attach photos or videos"}
        </button>
      </div>

      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
          Add the photos or videos the customer sent with their review. They appear with the review on your website.
        </p>
      ) : (
        <ol className="grid grid-cols-3 gap-3 sm:grid-cols-4" aria-label={describeReviewMedia(value)}>
          {value.map((item, index) => (
            <li key={item.id} className="flex flex-col gap-1">
              <MediaThumb media={item} className="aspect-square w-full rounded-lg border" sizes="(min-width: 640px) 120px, 30vw" />
              <RowControls
                index={index}
                count={value.length}
                label={`${item.resourceType === "video" ? "video" : "photo"} ${index + 1}`}
                disabled={disabled}
                onMove={(from, to) => onChange(moveReviewMedia(value, from, to))}
                onRemove={(position) => onChange(value.filter((_, other) => other !== position))}
              />
            </li>
          ))}
        </ol>
      )}

      {error ? (
        <span id={errorId} role="alert" className="field-error">
          {error}
        </span>
      ) : (
        <span id={`${id}-hint`} className="field-hint">
          Only add files the customer shared and agreed to show. {describeReviewMedia(value)}.
        </span>
      )}

      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        multiple
        max={REVIEW_MEDIA_LIMIT}
        title="Attach photos or videos to this review"
        selectedIds={value.map((item) => item.id)}
        canUpload={canUpload}
        onSelect={(assets) => onChange(pickedReviewMedia(assets))}
      />
    </div>
  );
}
