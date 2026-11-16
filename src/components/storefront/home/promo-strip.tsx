import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { discountLabel, formatDayMonth, offerCoverage, pluralize, type DiscountKind } from "@/lib/storefront-format";

export interface PromoStripProps {
  offer: {
    name: string;
    type: DiscountKind;
    value: number;
    endsOn: string;
    appliesToAllTours: boolean;
    tours: readonly { title: string }[];
  };
  /** All live public offers, for the link. */
  offerCount: number;
  currency: string;
}

/** One line under the highlights band advertising the best live offer. */
export function PromoStrip({ offer, offerCount, currency }: PromoStripProps) {
  const ends = formatDayMonth(offer.endsOn);
  return (
    <section aria-label="Current offer" className="border-b bg-highlight/15">
      <div className="container-x flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="badge badge-highlight px-3 py-1 text-sm">{discountLabel(offer.type, offer.value, currency)}</span>
          <span>
            <strong>{offer.name}</strong> — {offerCoverage(offer)}
          </span>
          {ends ? <span className="text-muted-foreground">Ends {ends}</span> : null}
        </p>
        <Link href="/offers" className="btn btn-outline btn-sm shrink-0 rounded-full">
          {offerCount > 1 ? `See all ${offerCount} ${pluralize(offerCount, "offer", "offers")}` : "See the offer"}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
