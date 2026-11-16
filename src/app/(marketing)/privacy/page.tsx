import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/components/auth/support";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What personal data Wayfold handles, why, and how each business's data is kept apart.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro="Wayfold handles two kinds of personal data: about the people who use the workspace, and about the guests who contact or book with a business through its website."
      sections={[
        {
          heading: "People who use the workspace",
          body: (
            <p>
              We keep your name, e-mail address, a one-way hash of your password, your sessions and a record of important actions (the activity log). We use them to
              sign you in, keep your workspace secure and show your team who did what.
            </p>
          ),
        },
        {
          heading: "Guests of a business",
          body: (
            <>
              <p>
                When a guest sends a booking request, an enquiry or a discount request on a business&rsquo;s website, the details they enter go to that business.
                The business is responsible for that data; Wayfold processes it on the business&rsquo;s behalf to run its website and workspace.
              </p>
              <p>Each business&rsquo;s data is kept separate from every other business&rsquo;s, and no business can see another&rsquo;s guests.</p>
            </>
          ),
        },
        {
          heading: "E-mail and connected services",
          body: (
            <p>
              Booking and enquiry e-mails are sent through the e-mail account the business connects. Photos are stored in the media account the business connects,
              or in Wayfold-managed storage where the plan includes it.
            </p>
          ),
        },
        {
          heading: "Cookies and offline use",
          body: (
            <p>
              The workspace uses one essential cookie to keep you signed in. Business websites set no tracking cookies. The installable app caches only
              Wayfold&rsquo;s own program files, never pages with your data, and clears them when you sign out.
            </p>
          ),
        },
        {
          heading: "Your choices",
          body: (
            <p>
              You can correct your details in your account settings. To get a copy of your data or have it deleted, write to {SUPPORT_EMAIL}. Guests should contact
              the business they booked with.
            </p>
          ),
        },
      ]}
    />
  );
}
