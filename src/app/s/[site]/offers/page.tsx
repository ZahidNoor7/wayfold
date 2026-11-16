import type { Metadata } from "next";
import { Check } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { SiteImage } from "@/components/storefront/site-image";
import { DiscountDesk } from "@/components/storefront-booking/discount-desk";
import { OfferCard } from "@/components/storefront-booking/offer-card";
import { prefillFromQuery } from "@/lib/booking-form";
import { formatDate } from "@/lib/calendar";
import { listPublishedTours } from "@/server/catalog/storefront";
import { getPublicRequestSettings, listPublicOffers } from "@/server/promotions/offers";
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
    title: "Special offers",
    description: `Current offers from ${tenant.name}, applied automatically when you book. Ask for a personal discount or check on a request.`,
    alternates: { canonical: "/offers" },
  };
}

export default function OffersPage(props: Props) {
  return (
    <Suspense fallback={<OffersSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

function OffersSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <div className="bg-hero">
        <div className="container-x pb-20 pt-16 lg:pb-24 lg:pt-24">
          <div className="h-3 w-40 rounded-full bg-hero-foreground/15" />
          <div className="mt-6 h-12 w-4/5 max-w-2xl rounded-lg bg-hero-foreground/15 sm:h-16" />
          <div className="mt-5 h-4 w-full max-w-md rounded-full bg-hero-foreground/10" />
        </div>
      </div>
      <div className="container-x grid gap-6 py-16 lg:grid-cols-2 lg:py-24">
        <div className="skeleton h-72" />
        <div className="skeleton h-72" />
      </div>
    </div>
  );
}

const BULLETS = [
  "No obligation — your booking request stays separate",
  "You get a reference and an access code to check the answer here",
  "Approved discounts apply automatically when you book with the same email address",
];

async function Content({ params, searchParams }: Props) {
  const { site } = await params;
  const query = await searchParams;
  const tenant = await requireActiveSite(site);
  const today = siteToday(tenant);
  const shell = await getStorefrontShell(tenant);

  const data = await inSite(tenant, async (scope) => {
    // A plan without promotions has no offers to show, whatever is stored.
    const offers = shell.promotionsEnabled ? await listPublicOffers(scope, today) : [];
    const tours = (await listPublishedTours(scope, { limit: 100 })).items;
    const requests = await getPublicRequestSettings(scope);
    return { offers, tours, requests };
  });

  const { offers, tours } = data;
  const coverOf = new Map(tours.map((tour) => [tour.id, tour.coverUrl]));
  const offerImage = (offer: (typeof offers)[number]) => offer.tours.map((tour) => coverOf.get(tour.id)).find(Boolean) ?? null;
  const heroImage = offers.map(offerImage).find(Boolean) ?? tours.find((tour) => tour.coverUrl)?.coverUrl ?? null;
  const requestsOpen = shell.promotionsEnabled && data.requests.requestsEnabled;
  const responseDays = data.requests.responseDays;
  const prefill = prefillFromQuery(query);

  return (
    <>
      <section className="relative overflow-hidden bg-hero">
        {heroImage ? (
          <div className="absolute inset-0 opacity-40">
            <SiteImage src={heroImage} alt="" sizes="100vw" preload tone="dark" />
          </div>
        ) : null}
        <div className="container-x relative pb-20 pt-16 text-hero-foreground lg:pb-24 lg:pt-24">
          <nav aria-label="Breadcrumb" className="breadcrumb mb-6 !text-hero-foreground/75">
            <Link href="/" className="hover:text-hero-foreground">
              Home
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="text-hero-foreground">
              Special offers
            </span>
          </nav>
          <h1 className="animate-rise font-display text-5xl font-medium leading-none sm:text-6xl lg:text-7xl">
            Special offers &amp; <em className="text-highlight">seasonal savings</em>
          </h1>
          <p className="stagger-1 mt-5 max-w-xl animate-rise text-base leading-relaxed text-hero-foreground/85 sm:text-lg">
            Current promotions, applied automatically when you book. Offers don’t combine — we always apply the single best one for your trip.
          </p>
          <div className="stagger-2 mt-8 flex animate-rise flex-wrap gap-3">
            <span className="badge border-transparent bg-highlight px-4 py-1.5 text-sm text-highlight-foreground">
              {offers.length === 0 ? "No offers running right now" : `${offers.length} ${offers.length === 1 ? "offer" : "offers"} live now`}
            </span>
            <span className="badge border-hero-foreground/30 px-4 py-1.5 text-sm text-hero-foreground">Updated {formatDate(today)}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="live" className="py-16 lg:py-24">
        <div className="container-x">
          <h2 id="live" className="sr-only">
            Active offers
          </h2>
          {offers.length > 0 ? (
            <div className="grid gap-6 lg:grid-cols-2">
              {offers.map((offer) => (
                <OfferCard key={offer.id} offer={offer} currency={tenant.currency} today={today} imageUrl={offerImage(offer)} />
              ))}
            </div>
          ) : (
            <div className="card flex flex-col items-center border-dashed p-14 text-center">
              <p className="font-display text-3xl text-primary">No offers running right now</p>
              <p className="mt-2 max-w-md text-muted-foreground">New seasonal offers are announced here first. Every tour shows its current price in the meantime.</p>
              <Link href="/experiences" className="btn btn-default btn-lg mt-6 rounded-full">
                Browse experiences
              </Link>
            </div>
          )}
        </div>
      </section>

      <DiscountDesk
        tours={tours.map(({ id, slug, title, minGroupSize, maxGroupSize }) => ({ id, slug, title, minGroupSize, maxGroupSize }))}
        currency={tenant.currency}
        timezone={tenant.timezone}
        requestsOpen={requestsOpen}
        prefill={{ tour: prefill.tour, adults: prefill.adults, children: prefill.children }}
        intro={
          <>
            <p className="eyebrow mb-3">Something special in mind?</p>
            <h2 id="request-heading" className="font-display text-4xl font-medium text-primary sm:text-5xl">
              Request a personal discount
            </h2>
            <p className="mt-4 max-w-[60ch] text-[17px] leading-relaxed text-foreground/85">
              Celebrating, travelling as a student, or coming back for a second trip? If no current offer covers your journey, tell {tenant.name} and your request is
              reviewed personally — usually within {responseDays} {responseDays === 1 ? "day" : "days"}.
            </p>
            <ul className="mt-6 flex flex-col gap-2 text-[15px]">
              {BULLETS.map((bullet) => (
                <li key={bullet} className="flex gap-2.5">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" strokeWidth={2.6} />
                  {bullet}
                </li>
              ))}
            </ul>
          </>
        }
        trackerIntro={
          <>
            <p className="eyebrow mb-3">Already asked?</p>
            <h2 id="track-heading" className="font-display text-4xl font-medium text-primary sm:text-5xl">
              Check a discount request
            </h2>
            <p className="mt-4 max-w-[60ch] text-[17px] leading-relaxed text-foreground/85">
              Enter the reference of your request, for example DR-1043, and the access code you saved when you sent it. Both are needed, so nobody else can look up
              your request.
            </p>
          </>
        }
      />

      <section aria-labelledby="terms" className="border-t py-14">
        <div className="container-x">
          <h2 id="terms" className="mb-4 text-lg font-bold">
            Offer terms
          </h2>
          <ul className="grid list-disc gap-x-10 gap-y-2 pl-5 text-sm text-muted-foreground md:grid-cols-2">
            <li>One discount per booking — the best eligible offer is applied automatically.</li>
            <li>Offers apply to new booking requests made during the offer period.</li>
            <li>Percentage offers apply to the full trip price; fixed offers apply once per booking.</li>
            <li>Personal and approved discounts are linked to the email used to book, and can be used once.</li>
            <li>Expired offers are removed automatically and can’t be applied.</li>
            <li>Final prices are confirmed by {tenant.name} together with availability.</li>
          </ul>
        </div>
      </section>
    </>
  );
}
