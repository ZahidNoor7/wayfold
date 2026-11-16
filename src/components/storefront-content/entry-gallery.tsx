"use client";

import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { SiteImage } from "@/components/storefront/site-image";
import { cn } from "@/lib/utils";

export interface GalleryItem {
  url: string;
  alt: string;
  kind: "image" | "video";
}

interface EntryGalleryProps {
  /** Names the gallery and fills in for photos without their own description. */
  title: string;
  items: GalleryItem[];
}

/**
 * The entry's photos: one large view with previous/next (which wrap around),
 * a position counter, and a thumbnail strip to jump to any photo. Arrow keys
 * work while focus is inside the gallery.
 */
export function EntryGallery({ title, items }: EntryGalleryProps) {
  const [index, setIndex] = useState(0);
  const total = items.length;
  const current = items[Math.min(index, total - 1)];
  if (!current) return null;

  const position = Math.min(index, total - 1);
  const step = (delta: number) => setIndex((position + delta + total) % total);
  const label = (item: GalleryItem, at: number) => item.alt || `${title}, photo ${at + 1} of ${total}`;

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

  return (
    <div role="group" aria-roledescription="gallery" aria-label={`Photos: ${title}`} onKeyDown={onKeyDown}>
      <div className="relative h-72 overflow-hidden rounded-2xl bg-hero sm:h-[440px]">
        {current.kind === "video" ? (
          <video key={current.url} src={current.url} controls playsInline preload="metadata" aria-label={label(current, position)} className="h-full w-full object-contain" />
        ) : (
          <SiteImage
            key={current.url}
            src={current.url}
            alt={label(current, position)}
            preload={position === 0}
            sizes="(min-width: 1024px) 960px, 100vw"
            className="animate-fade-in"
            tone="dark"
          />
        )}
        {total > 1 ? (
          <div className={cn("absolute right-4 flex items-center gap-2", current.kind === "video" ? "top-4" : "bottom-4")}>
            <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="btn btn-icon-lg rounded-full bg-background/95 hover:bg-background">
              <ChevronLeft aria-hidden="true" />
            </button>
            <span aria-live="polite" className="badge border-transparent bg-hero/85 px-3 py-1.5 tabular-nums text-hero-foreground">
              <span className="sr-only">Photo </span>
              {position + 1} / {total}
            </span>
            <button type="button" onClick={() => step(1)} aria-label="Next photo" className="btn btn-icon-lg rounded-full bg-background/95 hover:bg-background">
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {total > 1 ? (
        <ul className="mt-2.5 grid grid-cols-4 gap-2.5 sm:grid-cols-6 lg:grid-cols-8">
          {items.map((item, at) => (
            <li key={item.url}>
              <button
                type="button"
                onClick={() => setIndex(at)}
                aria-label={`Show photo ${at + 1}`}
                aria-current={at === position ? "true" : undefined}
                className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg border-2 border-transparent bg-muted aria-[current=true]:border-primary"
              >
                {item.kind === "video" ? (
                  <span className="flex h-full w-full items-center justify-center bg-hero text-hero-foreground">
                    <Play aria-hidden="true" className="size-4 fill-current" />
                  </span>
                ) : (
                  <SiteImage src={item.url} alt="" sizes="(min-width: 1024px) 120px, 25vw" />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
