import { ArrowRight, CalendarCheck, Map as MapIcon, Star, Tag, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FoldMotif } from "@/components/auth/wordmark";
import { Plans, PlansSkeleton } from "@/components/marketing/plans";
import { ThemeStudio } from "@/components/marketing/theme-studio";
import { appUrl, rootDomain } from "@/components/marketing/urls";
import { Reveal } from "@/components/motion";

const DESCRIPTION =
  "Wayfold gives independent tour guides and small agencies a booking website under their own name, and one workspace for tours, bookings, customers, reviews and discounts.";

export const metadata: Metadata = {
  title: { absolute: "Wayfold · Booking websites and back office for tour guides" },
  description: DESCRIPTION,
  openGraph: { title: "Wayfold · Booking websites and back office for tour guides", description: DESCRIPTION, type: "website", siteName: "Wayfold" },
};

const WORKSPACE = [
  {
    Icon: MapIcon,
    title: "Tours",
    detail: "Write each tour once: itinerary, photos, prices for adults and children, departure dates and the days you are not available.",
  },
  {
    Icon: CalendarCheck,
    title: "Bookings",
    detail: "Guests send a request from your site. You confirm, reschedule or decline it, and Wayfold warns you when two bookings clash.",
  },
  {
    Icon: Users,
    title: "Customers",
    detail: "Every guest gets a profile with their bookings and your own notes, ready for the next time they write.",
  },
  {
    Icon: Star,
    title: "Reviews",
    detail: "Add the reviews guests give you, choose which ones are published and feature the best on your home page.",
  },
  {
    Icon: Tag,
    title: "Discounts",
    detail: "Run a seasonal offer, give a returning guest a personal discount, or answer discount requests sent from your site.",
  },
] as const;

const STEPS = [
  {
    title: "Create your workspace",
    detail: "Register, name your business and pick the address your website will live at.",
  },
  {
    title: "Add tours and choose a look",
    detail: "Write up your tours, upload photos and pick a theme. Change any of it whenever you like.",
  },
  {
    title: "Share your site, confirm bookings",
    detail: "Guests request dates on your website. You answer from your workspace, on a laptop or a phone.",
  },
] as const;

export default function LandingPage() {
  const register = appUrl("/register");
  const domain = rootDomain();

  return (
    <>
      <ThemeStudio address={`yourname.${domain}`}>
        <p className="mb-6 flex animate-rise items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-highlight stagger-1">
          <span aria-hidden="true" className="h-px w-10 shrink-0 bg-highlight" />
          For independent guides and small agencies
        </p>
        <h1 className="animate-rise font-display text-[44px] font-medium leading-[0.98] text-hero-foreground stagger-2 sm:text-6xl lg:text-[72px]">
          Your own tour website. <em className="block text-highlight">The back office comes with it.</em>
        </h1>
        <p className="mt-7 max-w-xl animate-rise text-base leading-relaxed text-hero-foreground/85 stagger-3 sm:text-lg">
          Wayfold gives you a booking website under your own name, and one workspace for the tours, bookings, customers, reviews and discounts behind it.
        </p>
        <div className="mt-10 flex animate-rise flex-col gap-3 stagger-4 sm:flex-row">
          <a href={register} className="btn btn-highlight btn-xl rounded-full">
            Start free
            <ArrowRight aria-hidden="true" />
          </a>
          <Link href="/pricing" className="btn btn-hero-outline btn-xl rounded-full">
            See pricing
          </Link>
        </div>
      </ThemeStudio>

      <section id="what-you-get" aria-labelledby="what-title" className="bg-secondary/60 py-20 lg:py-32">
        <div className="container-x grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-20">
          <div className="lg:sticky lg:top-32 lg:self-start">
            <h2 id="what-title" className="font-display text-4xl font-medium leading-tight text-primary sm:text-5xl lg:text-[56px]">
              A website for your guests. A workspace for you.
            </h2>
            <p className="mt-6 text-[17px] leading-relaxed text-foreground/85">
              Your site lives at <strong className="break-words font-semibold">yourname.{domain}</strong>, or on your own domain on plans that include it. Guests browse your
              tours, read reviews, see current offers and ask for a date.
            </p>
            <p className="mt-4 text-[17px] leading-relaxed text-foreground/85">
              Everything they send lands in your workspace, where you and your team run the business.
            </p>
          </div>
          <dl className="flex flex-col">
            {WORKSPACE.map(({ Icon, title, detail }) => (
              <div key={title} className="flex gap-5 border-t border-primary/15 py-7 last:border-b sm:gap-6">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-highlight">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0">
                  <dt className="font-display text-[28px] font-semibold leading-tight text-primary">{title}</dt>
                  <dd className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{detail}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="how-it-works" aria-labelledby="how-title" className="py-20 lg:py-32">
        <div className="container-x">
          <h2 id="how-title" className="max-w-2xl font-display text-4xl font-medium leading-tight text-primary sm:text-5xl lg:text-[56px]">
            From sign-up to your first booking request.
          </h2>
          <Reveal>
            <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              {STEPS.map((step, index) => (
                <li key={step.title} className="border-t-2 border-primary pt-6">
                  <span aria-hidden="true" className="font-display text-[64px] leading-none text-eyebrow">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 font-display text-[28px] font-semibold leading-tight text-primary">{step.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{step.detail}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      <section id="plans" aria-labelledby="plans-title" className="bg-secondary/60 py-20 lg:py-32">
        <div className="container-x">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <h2 id="plans-title" className="font-display text-4xl font-medium leading-tight text-primary sm:text-5xl lg:text-[56px]">
                Plans
              </h2>
              <p className="mt-4 text-[17px] leading-relaxed text-foreground/85">
                Every plan includes the website, the workspace and all four themes. They differ in how much you can publish, how many bookings you take each
                month and who can sign in.
              </p>
            </div>
            <Link href="/pricing" className="btn btn-link px-0 text-[15px]">
              How plans work
            </Link>
          </div>
          <Suspense fallback={<PlansSkeleton />}>
            <Plans />
          </Suspense>
        </div>
      </section>

      <section aria-labelledby="start-title" className="relative overflow-hidden bg-hero py-24 text-hero-foreground lg:py-36">
        <FoldMotif className="pointer-events-none absolute inset-0 h-full w-full" />
        <Reveal className="container-x relative max-w-4xl text-center">
          <h2 id="start-title" className="font-display text-5xl font-medium leading-[1.02] sm:text-6xl lg:text-[76px]">
            Give your tours a home of their own.
          </h2>
          <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-hero-foreground/85">
            Create an account, name your business and choose a look. Your first tour can be on your own website today.
          </p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <a href={register} className="btn btn-highlight btn-xl rounded-full">
              Start free
            </a>
            <Link href="/pricing" className="btn btn-hero-outline btn-xl rounded-full">
              See pricing
            </Link>
          </div>
        </Reveal>
      </section>
    </>
  );
}
