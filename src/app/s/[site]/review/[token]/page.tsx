import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CustomerReviewForm } from "@/components/storefront-content/customer-review-form";
import { loadSite } from "@/components/storefront-content/data";
import { ContentSkeleton } from "@/components/storefront-content/prose";
import { formatDate } from "@/lib/booking-display";
import { CUSTOMER_REVIEW_MEDIA_MAX, openReviewLink } from "@/server/content/review-requests";
import { inSite } from "@/server/storefront/context";

interface Props {
  params: Promise<{ site: string; token: string }>;
}

// A private page: never indexed, and the token never leaves in a Referer.
export const metadata: Metadata = {
  title: "Review your tour",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ReviewPage(props: Props) {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

const CLOSED: Record<"used" | "expired" | "invalid", { title: string; body: string }> = {
  used: { title: "Your review has been sent", body: "Thank you! This link has already been used to send a review." },
  expired: { title: "This review link has expired", body: "Ask us for a new link and we will gladly send one." },
  invalid: { title: "This review link does not work", body: "It may have been replaced by a newer link. Check your latest e-mail from us, or ask for a new one." },
};

async function Content({ params }: Props) {
  const { site, token } = await params;
  const { tenant } = await loadSite(site);
  const link = await inSite(tenant, (scope) => openReviewLink(scope, token));

  if (link.state !== "open") {
    const copy = CLOSED[link.state];
    return (
      <section className="pb-28 pt-16 lg:pt-24">
        <div className="container-x max-w-2xl">
          <h1 className="mb-5 font-display text-4xl font-medium leading-tight text-primary sm:text-5xl">{copy.title}</h1>
          <p className="mb-8 text-lg leading-relaxed text-muted-foreground">{copy.body}</p>
          <Link href="/contact" className="btn btn-outline btn-lg rounded-full">
            Contact {tenant.name}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="pb-28 pt-16 lg:pt-24">
      <div className="container-x max-w-3xl">
        <p className="eyebrow mb-4">Your review</p>
        <h1 className="mb-4 wrap-break-word font-display text-4xl font-medium leading-tight text-primary sm:text-5xl lg:text-6xl">How was {link.tourTitle}?</h1>
        <p className="mb-10 max-w-xl text-lg leading-relaxed text-muted-foreground">
          You travelled with {tenant.name} on {formatDate(link.startDate, "long")}. A few honest words help other travellers choose, and help us get better.
        </p>
        <CustomerReviewForm
          token={token}
          businessName={tenant.name}
          tourTitle={link.tourTitle}
          defaultName={link.customerName}
          defaultCountry={link.country}
          canUpload={link.canUpload}
          maxFiles={CUSTOMER_REVIEW_MEDIA_MAX}
        />
      </div>
    </section>
  );
}
