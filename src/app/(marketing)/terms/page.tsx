import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/components/auth/support";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms for using Wayfold to run a tour business's website and workspace.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      intro="These terms cover your use of Wayfold: the workspace where you run your business and the website it publishes for you."
      sections={[
        {
          heading: "Your account and workspace",
          body: (
            <>
              <p>You need an account with a confirmed e-mail address. Each business gets its own workspace; you decide who joins it and what each person may do.</p>
              <p>Keep your password private. You are responsible for what happens in workspaces you own.</p>
            </>
          ),
        },
        {
          heading: "Your content and your customers",
          body: (
            <>
              <p>Tours, photos, reviews, texts and customer records you add stay yours. Wayfold stores and displays them only to run your workspace and website.</p>
              <p>You are responsible for the accuracy of your tours, prices and availability, for confirming bookings, and for your own obligations to your customers.</p>
            </>
          ),
        },
        {
          heading: "Connected services",
          body: (
            <p>
              When you connect your own accounts (for example Cloudinary, an e-mail server, Stripe or Google Maps), Wayfold uses them on your behalf. Their own
              terms and charges apply to you directly. Your credentials are stored encrypted and are never shown back in full.
            </p>
          ),
        },
        {
          heading: "Plans and limits",
          body: (
            <p>
              Each plan sets limits on published tours, team members, storage and monthly bookings. Reaching a limit stops the next addition; nothing you already
              have is removed. Paid plans are billed as agreed with you.
            </p>
          ),
        },
        {
          heading: "Support access",
          body: (
            <p>
              Wayfold staff can only enter your workspace after you approve a request, for the time you choose. Every visit is view-only and recorded in your
              activity log.
            </p>
          ),
        },
        {
          heading: "Ending your use",
          body: (
            <p>
              You can stop using Wayfold at any time. A workspace may be suspended for non-payment or misuse; you will be told why. Contact {SUPPORT_EMAIL} to
              have a workspace and its data deleted.
            </p>
          ),
        },
      ]}
    />
  );
}
