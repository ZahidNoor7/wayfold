import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BookingWizard } from "@/components/storefront-booking/booking-wizard";
import type { BookableTour, TourOffers } from "@/components/storefront-booking/types";
import { prefillFromQuery } from "@/lib/booking-form";
import { addDays } from "@/lib/dates";
import { listPublishedTours } from "@/server/catalog/storefront";
import { bestPublicPriceFor, getPublicRequestSettings } from "@/server/promotions/offers";
import { getBookingSettings } from "@/server/settings/tenant-settings";
import { inSite, requireActiveSite, siteToday } from "@/server/storefront/context";
import { getStorefrontShell } from "@/server/storefront/shell";

interface Props {
  params: Promise<{ site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { site } = await params;
  const tenant = await requireActiveSite(site);
  return {
    title: "Request a booking",
    description: `Choose a tour, a date and your group, and send ${tenant.name} a booking request. No payment is taken online.`,
    alternates: { canonical: "/book" },
    // A form, pre-filled from a query string: nothing here is worth indexing.
    robots: { index: false, follow: true },
  };
}

export default function BookPage(props: Props) {
  return (
    <Suspense fallback={<BookSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

function BookSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="container-x pb-28 pt-10 lg:pt-14">
      <div className="skeleton h-3 w-32" />
      <div className="skeleton mt-4 h-12 w-80 max-w-full" />
      <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
        <div className="skeleton h-[520px] min-w-0 flex-1" />
        <div className="skeleton h-80 w-full lg:w-[380px] lg:shrink-0" />
      </div>
    </div>
  );
}

async function Content({ params, searchParams }: Props) {
  const { site } = await params;
  const query = await searchParams;
  const tenant = await requireActiveSite(site);
  const today = siteToday(tenant);
  const shell = await getStorefrontShell(tenant);

  const data = await inSite(tenant, async (scope) => {
    const { items } = await listPublishedTours(scope, { limit: 100 });
    const settings = await getBookingSettings(scope);
    const prices = await bestPublicPriceFor(
      scope,
      items.map((tour) => tour.id),
      today,
    );
    const requests = await getPublicRequestSettings(scope);
    return { items, settings, prices, requests };
  });

  if (data.items.length === 0) {
    return (
      <div className="container-x pb-28 pt-10 lg:pt-14">
        <p className="eyebrow mb-3">Booking request</p>
        <h1 className="mb-8 font-display text-5xl font-medium leading-none text-primary lg:text-6xl">Reserve your journey</h1>
        <div className="card flex flex-col items-center border-dashed p-10 text-center sm:p-14">
          <p className="font-display text-3xl text-primary">No tours can be booked online yet</p>
          <p className="mt-2 max-w-md text-muted-foreground">{tenant.name} has not published any tours here so far. Get in touch and ask what is running.</p>
          <Link href="/contact" className="btn btn-default btn-lg mt-6 rounded-full">
            Contact {tenant.name}
          </Link>
        </div>
      </div>
    );
  }

  const tours: BookableTour[] = data.items.map((tour) => ({
    id: tour.id,
    slug: tour.slug,
    title: tour.title,
    kind: tour.kind,
    durationDays: tour.durationDays,
    durationLabel: tour.durationLabel,
    priceAdult: tour.priceAdult,
    childPricePercent: tour.childPricePercent,
    // Lists do not carry the age limit; the tour page states it.
    childMaxAge: 0,
    minGroupSize: tour.minGroupSize,
    maxGroupSize: tour.maxGroupSize,
    categoryName: tour.categoryName,
    coverUrl: tour.coverUrl,
    coverAlt: tour.coverAlt,
  }));
  const offers: TourOffers = Object.fromEntries(tours.map((tour) => [tour.id, data.prices[tour.id]?.offer ?? null]));

  return (
    <BookingWizard
      tours={tours}
      offers={offers}
      currency={tenant.currency}
      timezone={tenant.timezone}
      calendar={{ today, maxDate: addDays(today, data.settings.horizonDays) }}
      holdHours={data.settings.holdHours}
      contact={{ name: tenant.name, whatsapp: shell.whatsapp?.url ?? null }}
      languages={tenant.languages}
      prefill={prefillFromQuery(query)}
      requestsEnabled={shell.promotionsEnabled && data.requests.requestsEnabled}
    />
  );
}
