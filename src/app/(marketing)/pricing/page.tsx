import type { Metadata } from "next";
import { Suspense } from "react";
import { SUPPORT_EMAIL, supportMailto } from "@/components/auth/support";
import { Plans, PlansSkeleton } from "@/components/marketing/plans";
import { appUrl } from "@/components/marketing/urls";

const DESCRIPTION = "Wayfold plans for tour guides and small agencies: what each one costs, and how many tours, bookings, team members and how much media it includes.";

export const metadata: Metadata = {
  title: "Pricing",
  description: DESCRIPTION,
  openGraph: { title: "Wayfold pricing", description: DESCRIPTION, type: "website", siteName: "Wayfold" },
};

const ANSWERS = [
  {
    question: "How do I start?",
    answer:
      "Create an account, confirm your e-mail address and create your workspace. A plan marked Free can be chosen right there. Paid plans are switched on by us, once billing is arranged.",
  },
  {
    question: "How do I move to another plan?",
    answer:
      "From Plan & billing in your workspace, ask for the plan you want. We arrange billing with you and switch it on. Your invoices appear in the same place.",
  },
  {
    question: "What happens when I reach a limit?",
    answer:
      "Wayfold tells you at the moment it matters. Publishing one tour too many, or inviting one person too many, is refused with a note about your plan. If a month’s booking allowance runs out, your website stops taking new online requests until the next month or an upgrade. Nothing you already have is removed.",
  },
  {
    question: "Can I use my own domain?",
    answer:
      "On plans that list “Your own domain name”. You add the domain in your workspace and prove it is yours with a DNS record we give you. Until then your site stays at its Wayfold address.",
  },
] as const;

export default function PricingPage() {
  return (
    <>
      <section aria-labelledby="pricing-title" className="bg-hero pb-24 pt-14 text-hero-foreground sm:pt-20 lg:pb-32">
        <div className="container-x">
          <h1 id="pricing-title" className="max-w-3xl animate-rise font-display text-5xl font-medium leading-none sm:text-6xl lg:text-7xl">
            Pricing
          </h1>
          <p className="mt-6 max-w-xl animate-rise text-base leading-relaxed text-hero-foreground/85 stagger-1 sm:text-lg">
            Every plan includes your website, the workspace behind it and all four themes. Pick by how many tours you publish, how many bookings you take and
            how many people work with you.
          </p>
        </div>
      </section>

      <section aria-label="Plans" className="pb-20 lg:pb-28">
        <div className="container-x -mt-12 lg:-mt-16">
          <Suspense fallback={<PlansSkeleton />}>
            <Plans />
          </Suspense>
        </div>
      </section>

      <section aria-labelledby="answers-title" className="bg-secondary/60 py-20 lg:py-28">
        <div className="container-x grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-20">
          <div>
            <h2 id="answers-title" className="font-display text-4xl font-medium leading-tight text-primary sm:text-5xl">
              How plans work
            </h2>
            <p className="mt-5 text-[17px] leading-relaxed text-foreground/85">
              Something else you need to know? Write to{" "}
              <a href={supportMailto("Wayfold plans")} className="break-all font-semibold text-primary underline underline-offset-4">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
            <a href={appUrl("/register")} className="btn btn-default btn-xl mt-8 rounded-full">
              Start free
            </a>
          </div>
          <dl className="flex flex-col">
            {ANSWERS.map((item) => (
              <div key={item.question} className="border-t border-primary/15 py-7 last:border-b">
                <dt className="font-display text-2xl font-semibold leading-tight text-primary">{item.question}</dt>
                <dd className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
