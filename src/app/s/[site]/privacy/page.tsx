import type { Metadata } from "next";
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
    title: "Privacy policy",
    description: `How ${data.tenant.name} handles the personal details you send through this website.`,
    path: "/privacy",
  });
}

export default function PrivacyPage(props: Props) {
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
      title="Privacy policy"
      documentName="privacy policy"
      text={content.legal.privacy}
      fallback={
        <>
          <LegalSection title="Who is responsible for your data">
            <p>
              {name} decides how the personal details you send through this website are used, and is the data controller for them. The website and its booking
              software are provided by Wayfold, which stores and processes those details on behalf of {name}.
            </p>
          </LegalSection>

          <LegalSection title="What this website collects">
            <p>Only what you type into its forms:</p>
            <ul>
              <li>
                <strong className="font-semibold text-foreground">Contact form:</strong> your name, email address and message and, if you add them, your phone
                number, the tour you are interested in and the date you would like to travel.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Booking request:</strong> your name, email address and phone number, the tour, date and group
                size, how you prefer to be contacted and, if you add them, your country, preferred language, pick-up place, the names and ages of the people
                travelling, and any notes.
              </li>
            </ul>
          </LegalSection>

          <LegalSection title="What it is used for">
            <p>
              {name} uses these details to answer your message, to arrange and manage your booking, and to contact you about it. A request made through this
              website is sent to {name} and kept with its booking records.
            </p>
          </LegalSection>

          <LegalSection title="Your choices">
            <p>
              You can ask {name} what it holds about you, and ask for it to be corrected or deleted
              {tenant.email ? (
                <>
                  , by writing to{" "}
                  <a href={`mailto:${tenant.email}`} className="font-semibold text-primary underline underline-offset-4">
                    {tenant.email}
                  </a>
                </>
              ) : (
                ", using the contact page"
              )}
              .
            </p>
          </LegalSection>
        </>
      }
    />
  );
}
