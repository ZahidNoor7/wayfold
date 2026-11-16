"use client";

import { ArrowLeft, ArrowRight, Play, X } from "lucide-react";
import Image from "next/image";
import { Dialog } from "radix-ui";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { videoPosterUrl } from "@/lib/media-upload";
import { describeReviewFile, playableReviewFiles, type ReviewFile } from "@/lib/review-display";
import { isCloudinaryUrl } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";

interface ReviewMediaProps {
  items: readonly ReviewFile[];
  /** The reviewer's name, used to describe files without their own description. */
  customerName: string;
  /** How many thumbnails to show before "+N"; the rest stay reachable in the viewer. */
  visible?: number;
  /** Thumbnail size classes. */
  thumbClassName?: string;
  /** Viewer surfaces sit on a dark scrim; the strip itself follows the page. */
  className?: string;
}

const VIEWER_BUTTON = "btn btn-icon-lg rounded-full border border-white/40 text-white hover:bg-white/10";

/**
 * The photos and videos a customer shared with their review: a row of small
 * thumbnails that open a full-screen viewer. The viewer is a modal dialog
 * (focus trapped and returned, Escape closes); arrow keys and a horizontal
 * swipe move between files, and videos play with the browser's own controls.
 */
export function ReviewMedia({ items, customerName, visible = 4, thumbClassName = "size-16 sm:size-[72px]", className }: ReviewMediaProps) {
  const files = playableReviewFiles(items, isCloudinaryUrl);
  const [index, setIndex] = useState<number | null>(null);
  const swipeStart = useRef<number | null>(null);
  const total = files.length;
  if (total === 0) return null;

  const shown = files.slice(0, Math.max(1, visible));
  const hidden = total - shown.length;
  const current = index === null ? null : (files[index] ?? null);
  const step = (delta: number) => setIndex((value) => (value === null ? value : (value + delta + total) % total));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (total < 2 || event.target instanceof HTMLVideoElement) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    }
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start === null || total < 2) return;
    const travelled = event.clientX - start;
    if (Math.abs(travelled) > 48) step(travelled < 0 ? 1 : -1);
  }

  return (
    <>
      <ul className={cn("flex flex-wrap gap-2", className)} aria-label={`Photos and videos from ${customerName}`}>
        {shown.map((item, position) => {
          const more = hidden > 0 && position === shown.length - 1;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={cn(
                  "group relative block overflow-hidden rounded-lg bg-muted outline-offset-2 transition-transform duration-100 active:scale-[0.97]",
                  thumbClassName,
                )}
                aria-label={`Open ${describeReviewFile(item, position, total, customerName)}${more ? `, and ${hidden} more` : ""}`}
                onClick={() => setIndex(position)}
              >
                <Image
                  src={item.resourceType === "video" ? videoPosterUrl(item.url) : item.url}
                  alt=""
                  fill
                  sizes="72px"
                  className="img-zoom object-cover"
                />
                {item.resourceType === "video" ? (
                  <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-black/25">
                    <span className="flex size-7 items-center justify-center rounded-full bg-black/60 text-white">
                      <Play className="size-3 translate-x-px fill-current" />
                    </span>
                  </span>
                ) : null}
                {more ? (
                  <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-bold text-white">
                    +{hidden}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog.Root open={current !== null} onOpenChange={(next) => (next ? undefined : setIndex(null))}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay z-[60] bg-black/90" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-[60] flex animate-fade-in flex-col items-center justify-center p-4 outline-none sm:p-8"
            onKeyDown={onKeyDown}
            onClick={(event) => {
              if (event.target === event.currentTarget) setIndex(null);
            }}
          >
            <Dialog.Title className="sr-only">Photos and videos from {customerName}</Dialog.Title>
            <Dialog.Close className={cn(VIEWER_BUTTON, "absolute right-5 top-5")} aria-label="Close viewer">
              <X aria-hidden="true" />
            </Dialog.Close>
            {current && index !== null ? (
              <>
                <div
                  className="relative flex h-[72vh] w-full max-w-5xl touch-pan-y items-center justify-center"
                  onPointerDown={(event) => {
                    if (!(event.target instanceof HTMLVideoElement)) swipeStart.current = event.clientX;
                  }}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => {
                    swipeStart.current = null;
                  }}
                >
                  {current.resourceType === "video" ? (
                    <video
                      key={current.url}
                      src={current.url}
                      poster={videoPosterUrl(current.url)}
                      controls
                      playsInline
                      preload="metadata"
                      aria-label={describeReviewFile(current, index, total, customerName)}
                      className="max-h-full max-w-full animate-fade-in rounded-xl bg-black"
                    />
                  ) : (
                    <Image
                      key={current.url}
                      src={current.url}
                      alt={describeReviewFile(current, index, total, customerName)}
                      fill
                      sizes="(min-width: 1024px) 1024px, 100vw"
                      className="animate-fade-in rounded-xl object-contain"
                      draggable={false}
                    />
                  )}
                </div>
                <div className="mt-6 flex items-center gap-5 text-white">
                  {total > 1 ? (
                    <button type="button" className={VIEWER_BUTTON} aria-label="Previous file" onClick={() => step(-1)}>
                      <ArrowLeft aria-hidden="true" />
                    </button>
                  ) : null}
                  <p className="min-w-0 max-w-[60vw] text-center text-sm tabular-nums sm:min-w-[160px]" aria-live="polite" aria-atomic="true">
                    {index + 1} / {total}
                  </p>
                  {total > 1 ? (
                    <button type="button" className={VIEWER_BUTTON} aria-label="Next file" onClick={() => step(1)}>
                      <ArrowRight aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
