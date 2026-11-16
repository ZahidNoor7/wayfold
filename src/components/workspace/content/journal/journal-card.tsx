"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { deleteJourneyEntryAction, setJourneyEntryPublishedAction } from "@/app/workspace/journal/actions";
import { ConfirmDialog } from "@/components/overlays";
import { MediaThumb } from "@/components/workspace/media/media-picker";
import { useAction } from "@/hooks/use-action";
import { entryHref, entryLiveUrl, entryMeta } from "./journal-model";

export interface JournalCardEntry {
  id: string;
  title: string;
  slug: string;
  location: string;
  visitedOn: string | null;
  photoCount: number;
  coverUrl: string | null;
  isPublished: boolean;
}

interface JournalCardProps {
  entry: JournalCardEntry;
  /** Storefront origin, for the live link of a published entry. */
  origin: string;
}

/** One journal entry in the list: cover, place and date, publish switch, edit and delete. */
export function JournalCard({ entry, origin }: JournalCardProps) {
  const [published, setPublished] = useState(entry.isPublished);
  const [applied, setApplied] = useState(entry.isPublished);
  const [confirming, setConfirming] = useState(false);

  // The list was refreshed from the server: show what it says.
  if (entry.isPublished !== applied) {
    setApplied(entry.isPublished);
    setPublished(entry.isPublished);
  }

  const toggle = useAction(setJourneyEntryPublishedAction, {
    success: (saved) => (saved.isPublished ? "Entry published" : "Entry moved to drafts"),
    onSuccess: (saved) => setPublished(saved.isPublished),
  });
  const remove = useAction(deleteJourneyEntryAction, {
    success: `Deleted ${entry.title}`,
    onSuccess: () => setConfirming(false),
  });

  return (
    <article className="card flex w-full flex-col overflow-hidden">
      <Link href={entryHref(entry.id)} tabIndex={-1} aria-hidden="true">
        <MediaThumb media={entry.coverUrl ? { url: entry.coverUrl } : null} alt="" className="h-36 w-full rounded-none" sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw" />
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="text-xs text-muted-foreground">{entryMeta(entry)}</p>
        <h2 className="font-display text-xl font-semibold text-primary">
          <Link href={entryHref(entry.id)} className="underline-offset-4 hover:underline">
            {entry.title}
          </Link>
        </h2>
        {published ? (
          <a
            href={entryLiveUrl(origin, entry.slug)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 text-[13px] font-semibold text-primary underline-offset-4 hover:underline"
          >
            View on website
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={published}
              aria-label={`Published: ${entry.title}`}
              aria-busy={toggle.pending || undefined}
              disabled={toggle.pending}
              onClick={() => void toggle.run({ id: entry.id, published: !published })}
            >
              <span className="switch-thumb" />
            </button>
            {published ? "Published" : "Draft"}
          </span>
          <span className="flex gap-1.5">
            <Link href={entryHref(entry.id)} className="btn btn-outline btn-sm" aria-label={`Edit ${entry.title}`}>
              Edit
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-sm text-destructive hover:text-destructive"
              aria-label={`Delete ${entry.title}`}
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
          </span>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !remove.pending && setConfirming(open)}
        title={`Delete “${entry.title}”?`}
        description="This removes the entry from your website immediately. Its photos stay in your media library. This can’t be undone."
        confirmLabel="Delete entry"
        cancelLabel="Keep it"
        destructive
        pending={remove.pending}
        onConfirm={() => void remove.run({ id: entry.id })}
      />
    </article>
  );
}
