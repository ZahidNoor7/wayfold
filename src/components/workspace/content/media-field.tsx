"use client";

import { ImagePlus, X } from "lucide-react";
import { useId, useState } from "react";
import { MediaPicker, MediaThumb } from "@/components/workspace/media/media-picker";
import { cn } from "@/lib/utils";

/** What a single-image field holds: enough to show a thumbnail and send the id. */
export interface MediaChoice {
  id: string;
  url: string;
  alt?: string | null;
}

interface MediaFieldProps {
  label: string;
  note?: string;
  hint?: string;
  error?: string | null;
  value: MediaChoice | null;
  onChange: (value: MediaChoice | null) => void;
  /** Size and shape of the preview, e.g. `aspect-[4/5] w-32`. */
  previewClassName?: string;
  /** Pass `can(workspace, "media.manage")`. */
  canUpload?: boolean;
  pickerTitle?: string;
  disabled?: boolean;
}

/** One image from the media library: preview, choose or replace, and remove. */
export function MediaField({
  label,
  note,
  hint,
  error,
  value,
  onChange,
  previewClassName = "aspect-[4/3] w-32",
  canUpload = true,
  pickerTitle,
  disabled,
}: MediaFieldProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="flex flex-col gap-2">
      <span id={`${id}-label`} className="label">
        {label}
        {note ? <span className="ml-1.5 font-normal text-muted-foreground">{note}</span> : null}
      </span>
      <div className="flex flex-wrap items-center gap-4">
        <MediaThumb media={value} alt={value?.alt ?? ""} className={cn("shrink-0 rounded-lg border", previewClassName)} sizes="160px" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline btn-sm" disabled={disabled} onClick={() => setOpen(true)}>
            <ImagePlus aria-hidden="true" />
            {value ? "Replace image" : "Choose image"}
          </button>
          {value ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => onChange(null)}>
              <X aria-hidden="true" />
              Remove
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <span id={errorId} role="alert" className="field-error">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      ) : null}
      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        resourceType="image"
        title={pickerTitle ?? label}
        selectedIds={value ? [value.id] : []}
        canUpload={canUpload}
        onSelect={([asset]) => onChange(asset ? { id: asset.id, url: asset.url, alt: asset.alt } : null)}
      />
    </div>
  );
}
