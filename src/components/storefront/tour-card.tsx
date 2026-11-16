import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { cardPrice, formatCount, pluralize, type CardPriceInput } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";
import { SiteImage } from "./site-image";

/**
 * The fields a card reads. `PublicTourCard` from
 * `@/server/catalog/storefront` satisfies this, so the rows returned by
 * `listPublishedTours` can be passed straight in.
 */
export interface TourCardTour {
  slug: string;
  title: string;
  summary: string;
  place: string;
  destinationName: string | null;
  categoryName: string | null;
  durationLabel: string;
  /** Adult list price in minor units. */
  priceAdult: number;
  coverUrl: string | null;
  coverAlt: string | null;
  /** Null when the tour has no published reviews; the rating is then not shown. */
  ratingAverage: number | null;
  reviewCount: number;
}

export interface TourCardProps {
  tour: TourCardTour;
  /**
   * The tour's entry from `bestPublicPriceFor(...)`, i.e.
   * `prices[tour.id]`. Omit it (or pass null) to show the list price.
   */
  price?: CardPriceInput | null;
  /** The tenant's ISO currency code, e.g. `tenant.currency`. */
  currency: string;
  /**
   * `catalogue` (default) is the Experiences grid card: an `h2` title and the
   * offer's name and end date under the price. `featured` is the roomier Home
   * card: an `h3` title and no offer line.
   */
  variant?: "catalogue" | "featured";
  /** `sizes` for the cover image. Defaults to a three-column grid. */
  sizes?: string;
  /** Extra classes for the card link, e.g. carousel widths or `animate-rise`. */
  className?: string;
}

const DEFAULT_SIZES = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

/**
 * A tour as a card: cover (or a themed placeholder), category, offer badge,
 * place, rating, title, summary, length and "from" price. The whole card
 * links to `/experiences/{slug}`.
 */
export function TourCard({ tour, price, currency, variant = "catalogue", sizes = DEFAULT_SIZES, className }: TourCardProps) {
  const featured = variant === "featured";
  const shown = cardPrice(tour.priceAdult, price, currency);
  const place = tour.place || tour.destinationName || "";
  const Title = featured ? "h3" : "h2";

  return (
    <Link href={`/experiences/${tour.slug}`} className={cn("card lift group flex flex-col overflow-hidden", className)}>
      <div className="relative aspect-[4/3] overflow-hidden">
        <SiteImage src={tour.coverUrl} alt={tour.coverAlt || tour.title} sizes={sizes} className="img-zoom" />
        {tour.categoryName ? <span className="badge badge-overlay absolute left-4 top-4">{tour.categoryName}</span> : null}
        {shown.badge ? <span className="badge badge-highlight absolute right-4 top-4 text-sm">{shown.badge}</span> : null}
      </div>
      <div className={cn("flex flex-1 flex-col p-6", featured ? "gap-3" : "gap-2.5")}>
        <div className="flex justify-between gap-3 text-[13px] text-muted-foreground">
          <span>{place}</span>
          {tour.ratingAverage !== null && tour.reviewCount > 0 ? (
            <span className="shrink-0 font-semibold text-foreground">
              <span aria-hidden="true">★ </span>
              <span className="sr-only">Rated </span>
              {tour.ratingAverage.toFixed(1)}
              <span className="sr-only"> out of 5 from</span>{" "}
              <span className="font-normal text-muted-foreground">
                <span aria-hidden="true">(</span>
                {formatCount(tour.reviewCount)}
                <span aria-hidden="true">)</span>
                <span className="sr-only"> {pluralize(tour.reviewCount, "review", "reviews")}</span>
              </span>
            </span>
          ) : null}
        </div>
        {/* Size before leading: the class merger drops a line-height that precedes a font size. */}
        <Title className={cn("font-display font-semibold text-primary", featured ? "text-[28px] leading-tight" : "text-[27px] leading-tight")}>{tour.title}</Title>
        {tour.summary ? <p className={cn("text-muted-foreground", featured ? "text-[15px] leading-relaxed" : "text-sm leading-relaxed")}>{tour.summary}</p> : null}
        <div className="mt-auto flex items-center justify-between gap-3 border-t pt-4">
          <span className="text-[13px] text-muted-foreground">{tour.durationLabel}</span>
          <span className="text-right text-[13px] text-muted-foreground">
            from{" "}
            {shown.original ? (
              <span className="mr-1 line-through">
                <span className="sr-only">was </span>
                {shown.original}
              </span>
            ) : null}
            {shown.original ? <span className="sr-only">now </span> : null}
            <strong className="font-display text-2xl text-primary">{shown.now}</strong>
          </span>
        </div>
        {!featured && shown.offerLine ? <p className="-mt-1 text-xs font-semibold text-success">{shown.offerLine}</p> : null}
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-eyebrow">
          View details
          <ArrowRight aria-hidden="true" className="size-4" />
        </span>
      </div>
    </Link>
  );
}
