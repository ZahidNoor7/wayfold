import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buildMetadata, loadSite } from "@/components/storefront-content/data";
import { LegalPage, LegalSection } from "@/components/storefront-content/legal-page";
import { ContentSkeleton } from "@/components/storefront-content/prose";

interface Props {
  params: Promise<{ site: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { site } = await params;
  const data = await loadSite(site);
  return buildMetadata(data, {
    title: "Terms and conditions",
    description: `The terms that apply when you request a booking with ${data.tenant.name}.`,
    path: "/terms",
  });
}

export default function TermsPage(props: Props) {
  return (
    <Suspense fallback={<ContentSkeleton variant="narrow" />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: Props) {
  const { site } = await params;
  const { tenant, content } = await loadSite(site);
  const name = tenant.name;

  return (
    <LegalPage
      businessName={name}
      title="Terms and conditions"
      documentName="terms and conditions"
      text={content.legal.terms}
      fallback={
        <>
          <LegalSection title="Booking requests">
            <p>
              Sending a booking request through this website does not confirm a booking. {name} reviews each request and confirms it with you directly, or
              lets you know if the date is not available.
            </p>
          </LegalSection>

          <LegalSection title="Prices and dates">
            <p>
              Prices and available dates are shown on each tour&apos;s page. The price and date of your trip are the ones {name} confirms with your booking.
            </p>
          </LegalSection>

          <LegalSection title="Changes and cancellations">
            <p>
              Where a tour has a cancellation policy, it is shown on that tour&apos;s page. To change or cancel a booking, contact {name} as early as you can.
            </p>
          </LegalSection>

          <LegalSection title="Your details">
            <p>
              The details you send with a request are handled as described in the{" "}
              <Link href="/privacy" className="font-semibold text-primary underline underline-offset-4">
                privacy policy
              </Link>
              .
            </p>
          </LegalSection>
        </>
      }
    />
  );
}
