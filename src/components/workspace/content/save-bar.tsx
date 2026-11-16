"use client";

import { ExternalLink } from "lucide-react";
import { Spinner } from "@/components/overlays";
import { cn } from "@/lib/utils";

interface SaveBarProps {
  pending: boolean;
  dirty: boolean;
  /** Button label, e.g. "Save hero". */
  label?: string;
  /** Absolute storefront URL of the page this form changes. */
  viewHref?: string;
  viewLabel?: string;
  /** Extra controls on the left, e.g. "Discard changes". */
  onDiscard?: () => void;
  className?: string;
}

/**
 * Sticky footer of an editor form. It sticks to the bottom of the screen
 * while its form is on screen, says whether there are unsaved changes, and
 * keeps the save button within thumb reach on phones.
 */
export function SaveBar({ pending, dirty, label = "Save changes", viewHref, viewLabel = "View on website", onDiscard, className }: SaveBarProps) {
  return (
    <div
      className={cn(
        "safe-b sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t bg-card/95 px-5 pt-3 backdrop-blur sm:px-6",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <p role="status" className={cn("text-[13px]", dirty ? "font-semibold text-foreground" : "text-muted-foreground")}>
          {pending ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
        </p>
        {viewHref ? (
          <a href={viewHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary underline-offset-4 hover:underline">
            {viewLabel}
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
      </div>
      <div className="flex gap-2">
        {onDiscard && dirty ? (
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={onDiscard}>
            Discard
          </button>
        ) : null}
        <button type="submit" className="btn btn-default" disabled={pending || !dirty} aria-busy={pending || undefined}>
          {pending ? <Spinner /> : null}
          {label}
        </button>
      </div>
    </div>
  );
}
