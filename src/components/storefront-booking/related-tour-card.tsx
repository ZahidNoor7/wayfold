import Link from "next/link";
import { SiteImage } from "@/components/storefront/site-image";
import { fromPrice, type OfferRef } from "@/lib/booking-form";
import { formatMoney } from "@/lib/dates";

interface RelatedTourCardProps {
  tour: { slug: string; title: string; categoryName: string | null; durationLabel: string; priceAdult: number; coverUrl: string | null; coverAlt: string | null };
  offer: OfferRef | null;
  currency: string;
}

/** Compact card for the "You may also love" row: a snap carousel on phones, a grid from `md`. */
export function RelatedTourCard({ tour, offer, currency }: RelatedTourCardProps) {
  const price = fromPrice(tour.priceAdult, offer);
  return (
    <Link href={`/experiences/${tour.slug}`} className="card lift group w-[78%] shrink-0 snap-start overflow-hidden md:w-auto">
      <div className="relative aspect-[16/10] overflow-hidden bg-hero">
        <SiteImage src={tour.coverUrl} alt={tour.coverAlt?.trim() || tour.title} sizes="(min-width: 768px) 33vw, 78vw" className="img-zoom" />
      </div>
      <div className="p-5">
        <p className="text-[13px] text-muted-foreground">{[tour.categoryName, tour.durationLabel].filter(Boolean).join(" · ")}</p>
        <p className="font-display text-[26px] font-semibold leading-tight text-primary">{tour.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          from{" "}
          {price.original !== null ? (
            <span className="line-through">
              <span className="sr-only">was </span>
              {formatMoney(price.original, currency)}
            </span>
          ) : null}{" "}
          <strong className="text-foreground">{formatMoney(price.now, currency)}</strong>
        </p>
      </div>
    </Link>
  );
}
