"use client";

import { ArrowLeft, ArrowRight, Images, X } from "lucide-react";
import Image from "next/image";
import { Dialog } from "radix-ui";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

export interface GalleryPhoto {
  url: string;
  alt: string;
}

interface TourGalleryProps {
  photos: GalleryPhoto[];
  /** Used when a photo has no description of its own. */
  tourTitle: string;
}

const MOSAIC_LIMIT = 5;

/** Mosaic shape by how many photos there are, so one or two photos still fill the block. */
function mosaic(count: number): { grid: string; tile: (index: number) => string } {
  if (count === 1) return { grid: "grid", tile: () => "aspect-[16/10] md:aspect-[21/9]" };
  if (count === 2) return { grid: "grid gap-3 md:grid-cols-2 md:grid-rows-[420px]", tile: () => "aspect-[16/10] md:aspect-auto" };
  const grid = "grid grid-cols-2 gap-3 md:grid-cols-4 md:grid-rows-[240px_240px]";
  const lead = "col-span-2 aspect-[16/10] md:row-span-2 md:aspect-auto";
  if (count === 3) return { grid, tile: (index) => (index === 0 ? lead : "aspect-[4/3] md:col-span-2 md:aspect-auto") };
  if (count === 4) {
    return { grid, tile: (index) => (index === 0 ? lead : index === 1 ? "col-span-2 aspect-[16/10] md:aspect-auto" : "aspect-[4/3] md:aspect-auto") };
  }
  return { grid, tile: (index) => (index === 0 ? lead : "aspect-[4/3] md:aspect-auto") };
}

const LIGHTBOX_BUTTON = "btn btn-icon-lg rounded-full border border-white/40 text-white hover:bg-white/10";

/**
 * Photo mosaic that opens a full-screen gallery. The gallery is a modal
 * dialog: focus is trapped and returns to the photo that opened it, Escape
 * and the close button dismiss it, the arrow keys and a horizontal swipe move
 * between photos, and the position is announced.
 */
export function TourGallery({ photos, tourTitle }: TourGalleryProps) {
  const [index, setIndex] = useState<number | null>(null);
  const swipeStart = useRef<number | null>(null);
  const total = photos.length;
  if (total === 0) return null;

  const describe = (photo: GalleryPhoto, position: number) => photo.alt.trim() || `${tourTitle}, photo ${position + 1}`;
  const tiles = photos.slice(0, MOSAIC_LIMIT);
  const hidden = total - tiles.length;
  const layout = mosaic(tiles.length);
  const open = index !== null;
  const current = open ? photos[index]! : null;

  const step = (delta: number) => setIndex((value) => (value === null ? value : (value + delta + total) % total));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (total < 2) return;
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
      <div className={layout.grid}>
        {tiles.map((photo, position) => (
          <button
            key={`${photo.url}-${position}`}
            type="button"
            aria-label={`Open photo ${position + 1} of ${total}: ${describe(photo, position)}`}
            className={cn("group relative overflow-hidden rounded-xl bg-hero", layout.tile(position))}
            onClick={() => setIndex(position)}
          >
            <Image
              src={photo.url}
              alt=""
              fill
              preload={position === 0}
              sizes={position === 0 ? "(min-width: 1280px) 620px, (min-width: 768px) 50vw, 100vw" : "(min-width: 1280px) 310px, (min-width: 768px) 25vw, 50vw"}
              className="img-zoom object-cover"
            />
            {hidden > 0 && position === tiles.length - 1 ? (
              <span className="absolute inset-0 flex items-center justify-center gap-2 bg-black/55 text-sm font-semibold text-white">
                <Images aria-hidden="true" className="size-5" />+{hidden} more
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">
        Select a photo to open the gallery · {total} {total === 1 ? "photo" : "photos"}
      </p>

      <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : setIndex(null))}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay z-[60] bg-black/90" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-[60] flex animate-fade-in flex-col items-center justify-center p-4 outline-none sm:p-8"
            onKeyDown={onKeyDown}
            onClick={(event) => {
              // The content covers the scrim, so a click on its empty area is the "click outside".
              if (event.target === event.currentTarget) setIndex(null);
            }}
          >
            <Dialog.Title className="sr-only">Photo gallery: {tourTitle}</Dialog.Title>
            <Dialog.Close className={cn(LIGHTBOX_BUTTON, "absolute right-5 top-5")} aria-label="Close gallery">
              <X aria-hidden="true" />
            </Dialog.Close>
            {current ? (
              <>
                <div
                  className="relative h-[72vh] w-full max-w-5xl touch-pan-y"
                  onPointerDown={(event) => {
                    swipeStart.current = event.clientX;
                  }}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => {
                    swipeStart.current = null;
                  }}
                >
                  <Image
                    key={current.url}
                    src={current.url}
                    alt={describe(current, index!)}
                    fill
                    sizes="(min-width: 1024px) 1024px, 100vw"
                    className="animate-fade-in rounded-xl object-contain"
                    draggable={false}
                  />
                </div>
                <div className="mt-6 flex items-center gap-5 text-white">
                  {total > 1 ? (
                    <button type="button" className={LIGHTBOX_BUTTON} aria-label="Previous photo" onClick={() => step(-1)}>
                      <ArrowLeft aria-hidden="true" />
                    </button>
                  ) : null}
                  <p className="min-w-0 max-w-[60vw] text-center text-sm sm:min-w-[220px]" aria-live="polite" aria-atomic="true">
                    {describe(current, index!)} · {index! + 1} / {total}
                  </p>
                  {total > 1 ? (
                    <button type="button" className={LIGHTBOX_BUTTON} aria-label="Next photo" onClick={() => step(1)}>
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
