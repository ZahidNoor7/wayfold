import { Mountain } from "lucide-react";
import Image from "next/image";
import { isCloudinaryUrl } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";

interface SiteImageProps {
  /** Cloudinary delivery URL, or nothing when the business has not added a picture. */
  src: string | null | undefined;
  /** Describes the picture. Pass "" for a purely decorative image. */
  alt: string;
  /** Rendered widths, e.g. `(min-width: 1024px) 33vw, 100vw`. */
  sizes: string;
  /** Classes for the image (object-fit, hover zoom, opacity). */
  className?: string;
  /** Preload the image; only for the one picture at the top of a page. */
  preload?: boolean;
  /** Which surface the placeholder sits on. */
  tone?: "light" | "dark";
}

/**
 * Fills its positioned parent (which reserves the space with an aspect or a
 * fixed height) with a tenant image. Without a usable image it draws a quiet
 * block in the theme's own colours instead, so a tour without a cover never
 * shows as broken.
 */
export function SiteImage({ src, alt, sizes, className, preload, tone = "light" }: SiteImageProps) {
  if (isCloudinaryUrl(src)) {
    return <Image src={src} alt={alt} fill sizes={sizes} preload={preload} className={cn("object-cover", className)} />;
  }
  return <ImagePlaceholder tone={tone} />;
}

export function ImagePlaceholder({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute inset-0 flex items-center justify-center",
        tone === "dark"
          ? "bg-gradient-to-br from-hero via-hero to-[color-mix(in_oklab,var(--highlight)_18%,var(--hero))] text-highlight/40"
          : "bg-gradient-to-br from-secondary to-accent text-primary/25",
        className,
      )}
    >
      <Mountain className="size-10" strokeWidth={1.25} />
    </div>
  );
}
