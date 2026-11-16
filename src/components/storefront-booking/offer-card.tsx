import { Clock } from "lucide-react";
import Link from "next/link";
import { Reveal } from "@/components/motion";
import { SiteImage } from "@/components/storefront/site-image";
import { bookHref, discountLabel, offerAudience, offerCountdown, offerValidity, offerValue, type DiscountType } from "@/lib/booking-form";
import { formatMoney } from "@/lib/dates";

export interface OfferCardData {
  id: string;
  name: string;
  blurb: string;
  type: DiscountType;
  value: number;
  startsOn: string;
  endsOn: string;
  minGuests: number;
  minChildren: number;
  bookAheadDays: number;
  isConditional: boolean;
  tours: Array<{ id: string; slug: string; title: string; priceAdult: number; discountedPriceAdult: number | null }>;
}

interface OfferCardProps {
  offer: OfferCardData;
  currency: string;
  today: string;
  /** Cover of the first tour the offer covers. */
  imageUrl: string | null;
}

/**
 * One live offer: what it is worth, who it is for, how long it runs and what
 * each covered tour costs with it. A per-adult price is only shown struck
 * through when every visitor gets it; conditional and fixed offers say what
 * they take off instead.
 */
export function OfferCard({ offer, currency, today, imageUrl }: OfferCardProps) {
  const first = offer.tours[0];
  return (
    <Reveal className="flex">
      <article className="card flex w-full flex-col overflow-hidden lg:flex-row">
        <div className="relative h-52 shrink-0 bg-hero lg:h-auto lg:w-56">
          <SiteImage src={imageUrl} alt="" sizes="(min-width: 1024px) 224px, 100vw" tone="dark" />
          <span className="absolute left-4 top-4 rounded-lg bg-highlight px-3 py-2 font-display text-3xl font-semibold leading-none text-highlight-foreground shadow-lg">
            <span className="sr-only">Save </span>
            {offerValue(offer.type, offer.value, currency)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge badge-confirmed">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              Active
            </span>
            <span className="text-xs font-semibold text-muted-foreground">{offerValidity(offer.startsOn, offer.endsOn, today)}</span>
          </div>
          <h3 className="font-display text-3xl font-semibold leading-tight text-primary">{offer.name}</h3>
          {offer.blurb ? <p className="text-[15px] leading-relaxed text-muted-foreground">{offer.blurb}</p> : null}
          <p className="text-[13px]">
            <span className="font-semibold">Who it’s for:</span> {offerAudience(offer)}
          </p>
          <ul className="mt-1 flex flex-col divide-y rounded-lg border" aria-label={`Tours covered by ${offer.name}`}>
            {offer.tours.map((tour) => (
              <li key={tour.id}>
                <Link href={`/experiences/${tour.slug}`} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-muted/50">
                  <span className="min-w-0">
                    <span className="font-semibold">{tour.title}</span>
                    {offer.type === "percent" && tour.discountedPriceAdult === null ? (
                      <span className="block text-xs text-muted-foreground">{discountLabel(offer.type, offer.value, currency)} when your group qualifies</span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
                    {offer.type === "fixed" ? (
                      <>
                        <span className="font-display text-xl font-semibold text-primary">−{formatMoney(offer.value, currency)}</span>
                        <span className="text-xs text-muted-foreground">per booking</span>
                      </>
                    ) : tour.discountedPriceAdult !== null ? (
                      <>
                        <span className="text-muted-foreground line-through">
                          <span className="sr-only">Was </span>
                          {formatMoney(tour.priceAdult, currency)}
                        </span>
                        <span className="font-display text-xl font-semibold text-primary">{formatMoney(tour.discountedPriceAdult, currency)}</span>
                        <span className="text-xs text-muted-foreground">/ adult</span>
                      </>
                    ) : (
                      <>
                        <span className="font-display text-xl font-semibold text-primary">{formatMoney(tour.priceAdult, currency)}</span>
                        <span className="text-xs text-muted-foreground">/ adult</span>
                      </>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
            <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Clock aria-hidden="true" className="size-4" />
              {offerCountdown(offer.endsOn, today)}
            </span>
            {first ? (
              <Link href={bookHref({ tour: first.slug })} className="btn btn-default rounded-full">
                Book with this offer
              </Link>
            ) : null}
          </div>
        </div>
      </article>
    </Reveal>
  );
}
