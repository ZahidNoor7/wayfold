import Image from "next/image";
import { ImageOff, Play } from "lucide-react";
import { kindFromUrl, thumbnailUrl, type MediaKind } from "@/lib/media-upload";
import { cn } from "@/lib/utils";

export interface MediaThumbProps {
  /** The library file to show. A video is shown as its poster frame with a play mark. `null` renders a placeholder. */
  media: { url: string; alt?: string | null; resourceType?: MediaKind } | null | undefined;
  /**
   * Size and shape of the box: the image fills it and is cropped to cover.
   * Give it an aspect ratio or fixed size, e.g. `aspect-[4/3] w-full` or `h-11 w-16`.
   */
  className?: string;
  /** `sizes` for next/image. Describe how wide the box renders; defaults to a small thumbnail. */
  sizes?: string;
  /** Overrides the file's own description. Pass `""` when the thumbnail sits beside its title. */
  alt?: string;
  /** Load eagerly. Use only for the first image above the fold. */
  eager?: boolean;
}

/** A cropped preview of a library image or video, with space reserved before it loads. */
export function MediaThumb({ media, className, sizes = "160px", alt, eager }: MediaThumbProps) {
  // Callers that only know the address (a tour's cover) still get a poster for a video.
  const kind = media ? (media.resourceType ?? kindFromUrl(media.url)) : "image";
  return (
    <span className={cn("relative block shrink-0 overflow-hidden rounded-md bg-muted", className)}>
      {media ? (
        <>
          <Image
            src={thumbnailUrl({ url: media.url, resourceType: kind })}
            alt={alt ?? media.alt ?? ""}
            fill
            sizes={sizes}
            loading={eager ? "eager" : "lazy"}
            className="object-cover"
          />
          {kind === "video" ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/20" aria-hidden="true">
              <span className="flex size-8 items-center justify-center rounded-full bg-black/60 text-white">
                <Play className="size-3.5 translate-x-px fill-current" />
              </span>
            </span>
          ) : null}
        </>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground/60" aria-hidden="true">
          <ImageOff className="size-4" />
        </span>
      )}
    </span>
  );
}
