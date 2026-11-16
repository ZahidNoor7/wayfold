import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { isCloudinaryUrl } from "@/lib/storefront-format";

export interface HomeHeroProps {
  kicker: string;
  headline: string;
  /** Italic tail of the headline, in the highlight colour. */
  emphasis: string;
  body: string;
  image: { url: string; alt: string } | null;
  /** "Now guiding" caption; hidden when empty. */
  nowGuiding: string;
  /** Without published tours there is nothing to explore or book yet. */
  hasTours: boolean;
}

/**
 * Home hero. With a cover image it is the design's full-bleed photograph
 * under a scrim; without one it is the same composition set on the theme's
 * hero colour, carried by the type alone.
 */
export function HomeHero({ kicker, headline, emphasis, body, image, nowGuiding, hasTours }: HomeHeroProps) {
  const photo = image && isCloudinaryUrl(image.url) ? image : null;

  return (
    <section aria-label="Introduction" className="relative flex min-h-[640px] items-end overflow-hidden bg-hero lg:h-[92vh] lg:max-h-[960px]">
      {photo ? (
        <>
          {/* Parallax on the frame, the slow zoom on the picture: one transform each. */}
          <div className="parallax absolute inset-0">
            <Image src={photo.url} alt={photo.alt} fill preload sizes="100vw" className="animate-hero-zoom object-cover" />
          </div>
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-hero/60 via-hero/10 to-hero/90" />
        </>
      ) : (
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
          <div className="absolute -right-40 -top-40 size-[640px] rounded-full border border-highlight/25" />
          <div className="absolute -right-72 -top-72 size-[960px] rounded-full border border-highlight/10" />
        </div>
      )}
      <div className="container-x relative w-full pb-16 pt-32 lg:pb-24">
        <div className="max-w-3xl">
          {kicker ? (
            <p className="stagger-1 mb-6 flex animate-rise items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-highlight">
              <span aria-hidden="true" className="h-px w-10 shrink-0 bg-highlight" />
              {kicker}
            </p>
          ) : null}
          <h1 className="stagger-2 animate-rise break-words font-display text-[52px] font-medium leading-[0.98] text-hero-foreground sm:text-7xl lg:text-[92px]">
            {headline}
            {emphasis ? (
              <>
                {" "}
                <em className="text-highlight">{emphasis}</em>
              </>
            ) : null}
          </h1>
          {body ? <p className="stagger-3 mt-7 max-w-xl animate-rise text-base leading-relaxed text-hero-foreground/85 sm:text-lg">{body}</p> : null}
          <div className="stagger-4 mt-10 flex animate-rise flex-col gap-3 sm:flex-row">
            {hasTours ? (
              <>
                <Link href="/experiences" className="btn btn-highlight btn-xl rounded-full">
                  Explore experiences
                  <ArrowRight aria-hidden="true" />
                </Link>
                <Link href="/book" className="btn btn-hero-outline btn-xl rounded-full">
                  Book a tour
                </Link>
              </>
            ) : (
              <Link href="/contact" className="btn btn-highlight btn-xl rounded-full">
                Get in touch
                <ArrowRight aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
        {nowGuiding ? (
          <div className="absolute bottom-24 right-10 hidden max-w-xs text-right text-hero-foreground/85 lg:block">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-highlight">Now guiding</p>
            <p className="mt-1 font-display text-2xl">{nowGuiding}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
