import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Suspense } from "react";
import { Reveal } from "@/components/motion";
import { SiteImage } from "@/components/storefront/site-image";
import { loadSite, seoMetadata } from "@/components/storefront-content/data";
import { ContentSkeleton, Paragraphs } from "@/components/storefront-content/prose";
import { firstText, lgColumns, mosaicPlan, quoted } from "@/components/storefront-content/text";
import { ValuePropIcon } from "@/components/storefront-content/value-prop-icon";
import { cn } from "@/lib/utils";
import { listPublishedJourneyEntries } from "@/server/content/journey";
import { inSite } from "@/server/storefront/context";
import { getSiteImage } from "@/server/storefront/shell";

interface Props {
  params: Promise<{ site: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { site } = await params;
  return seoMetadata(site, "about", "/about", ({ content }) => ({
    title: "About",
    description: firstText(content.about.shortBio, content.about.longBio),
  }));
}

export default function AboutPage(props: Props) {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

const SECTION_HEADING = "font-display text-4xl font-medium text-primary";

async function Content({ params }: Props) {
  const { site } = await params;
  const { tenant, content } = await loadSite(site);
  const { about, stats, languages, skills, qualifications, milestones, valueProps } = content;

  const { portrait, journal } = await inSite(tenant, async (scope) => ({
    portrait: await getSiteImage(scope, about.portraitMediaId),
    journal: (await listPublishedJourneyEntries(scope, { limit: 12 })).items,
  }));

  const bio = firstText(about.longBio, about.shortBio, tenant.description);
  const credentialTitle = firstText(about.credentialLine, about.licenceLine);
  const credentialDetail = about.credentialLine.trim() && about.licenceLine.trim() ? about.licenceLine.trim() : "";
  const quote = quoted(about.philosophyQuote);
  const hasCredentials = qualifications.length > 0 || languages.length > 0 || skills.length > 0;
  const twoCredentialColumns = qualifications.length > 0 && (languages.length > 0 || skills.length > 0);

  const covers = journal.flatMap((entry) => (entry.cover ? [{ slug: entry.slug, title: entry.title, cover: entry.cover }] : []));
  const plan = mosaicPlan(covers.length);
  const gallery = covers.slice(0, plan.take);

  const credential = credentialTitle ? (
    <>
      <span className="avatar h-11 w-11">
        <ShieldCheck aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-bold">{credentialTitle}</span>
        {credentialDetail ? <span className="block text-[13px] text-muted-foreground">{credentialDetail}</span> : null}
      </span>
    </>
  ) : null;

  return (
    <>
      <section className="py-16 lg:py-28">
        <div className={cn("container-x grid items-center gap-12 lg:gap-20", portrait && "lg:grid-cols-[5fr_6fr]")}>
          {portrait ? (
            <div className="relative animate-rise">
              <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-hero">
                <SiteImage src={portrait.url} alt={portrait.alt || tenant.name} preload sizes="(min-width: 1024px) 40vw, 100vw" tone="dark" />
              </div>
              {credential ? (
                <div className="card absolute -bottom-6 left-4 right-4 flex items-center gap-3 p-4 shadow-xl sm:-left-5 sm:right-auto sm:max-w-sm">{credential}</div>
              ) : null}
            </div>
          ) : null}

          <div className={cn(!portrait && "max-w-3xl")}>
            <p className="eyebrow mb-4 animate-rise stagger-1">About</p>
            <h1 className="animate-rise wrap-break-word font-display text-5xl font-medium leading-none text-primary stagger-2 sm:text-6xl lg:text-[76px]">{tenant.name}</h1>
            {tenant.tagline ? (
              <p className="mt-6 animate-rise font-display text-2xl leading-snug text-foreground stagger-3 sm:text-[28px]">{tenant.tagline}</p>
            ) : null}
            {bio ? (
              <Paragraphs text={bio} className="mt-7 animate-rise stagger-3" paragraphClassName="text-[17px] leading-relaxed text-foreground/85" />
            ) : (
              <p className="mt-7 animate-rise text-[17px] leading-relaxed text-muted-foreground stagger-3">
                {tenant.name} has not added its story yet. Browse the experiences on offer, or get in touch with a question.
              </p>
            )}
            {!portrait && credential ? <div className="mt-8 flex animate-rise items-center gap-3 stagger-3">{credential}</div> : null}
            {stats.length > 0 ? (
              <dl className="mt-10 flex animate-rise flex-wrap gap-10 stagger-4">
                {stats.map((stat, index) => (
                  <div key={index} className="flex flex-col-reverse">
                    <dt className="mt-1 text-[13px] text-muted-foreground">{stat.label}</dt>
                    <dd className="font-display text-5xl leading-none text-primary">{stat.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </div>
      </section>

      {quote ? (
        <section className="bg-hero py-24 text-hero-foreground lg:py-32">
          <Reveal className="container-x max-w-4xl text-center">
            <p className="eyebrow mb-6 !text-highlight">Travel philosophy</p>
            <blockquote className="font-display text-3xl italic leading-snug sm:text-[44px]">{quote}</blockquote>
          </Reveal>
        </section>
      ) : null}

      {hasCredentials ? (
        <section className="py-20 lg:py-28">
          <div className={cn("container-x grid gap-14", twoCredentialColumns ? "lg:grid-cols-2" : "max-w-3xl")}>
            {qualifications.length > 0 ? (
              <Reveal>
                <h2 className={cn(SECTION_HEADING, "mb-6")}>Qualifications &amp; certifications</h2>
                <ul className="border-b">
                  {qualifications.map((qualification, index) => (
                    <li key={index} className="flex gap-5 border-t py-4">
                      <span className="w-14 shrink-0 font-display text-2xl text-eyebrow">{qualification.year}</span>
                      <span className="min-w-0">
                        <span className="block font-bold">{qualification.title}</span>
                        {qualification.issuer ? <span className="block text-sm text-muted-foreground">{qualification.issuer}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            ) : null}

            {languages.length > 0 || skills.length > 0 ? (
              <Reveal>
                {languages.length > 0 ? (
                  <>
                    <h2 className={cn(SECTION_HEADING, "mb-6")}>Languages</h2>
                    <ul className={cn("flex flex-col gap-5", skills.length > 0 && "mb-12")}>
                      {languages.map((language, index) => (
                        <li key={index}>
                          <div className="mb-2 flex justify-between gap-4 text-[15px]">
                            <span className="font-bold">{language.name}</span>
                            {/* The level and figure are written out; the bar only repeats them. */}
                            <span className="text-right text-muted-foreground">
                              {language.level ? `${language.level}, ` : ""}
                              <span className="tabular-nums">{language.percent}%</span>
                            </span>
                          </div>
                          <div aria-hidden="true" className="progress h-1.5">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${language.percent}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {skills.length > 0 ? (
                  <>
                    <h2 className={cn(SECTION_HEADING, "mb-5")}>Areas of expertise</h2>
                    <ul className="flex flex-wrap gap-2">
                      {skills.map((skill, index) => (
                        <li key={index} className="badge badge-outline whitespace-normal px-4 py-2 text-sm font-medium">
                          {skill}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </Reveal>
            ) : null}
          </div>
        </section>
      ) : null}

      {milestones.length > 0 ? (
        <section className="bg-secondary/60 py-20 lg:py-28">
          <div className="container-x">
            <Reveal>
              <h2 className="mb-12 text-center font-display text-4xl font-medium text-primary sm:text-5xl">Milestones along the way</h2>
            </Reveal>
            {/* Each item draws its own stretch of the line, so the timeline survives wrapping onto more rows. */}
            <Reveal>
              <ol className={cn("grid gap-y-8 sm:grid-cols-2", lgColumns(milestones.length))}>
                {milestones.map((milestone, index) => (
                  <li key={index} className="relative border-t border-border pr-6 pt-7">
                    <span aria-hidden="true" className="absolute -top-[7px] left-0 h-3.5 w-3.5 rounded-full border-[3px] border-secondary bg-primary" />
                    <p className="font-display text-3xl text-eyebrow">{milestone.year}</p>
                    <p className="mt-1 font-bold">{milestone.title}</p>
                    {milestone.text ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{milestone.text}</p> : null}
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>
      ) : null}

      {valueProps.length > 0 || gallery.length > 0 ? (
        <section className="py-20 lg:py-28">
          <div className="container-x flex flex-col gap-16 lg:gap-20">
            {valueProps.length > 0 ? (
              <div>
                <h2 className="mb-10 max-w-3xl font-display text-4xl font-medium text-primary sm:text-5xl">Why travel with {tenant.name}</h2>
                <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {valueProps.map((valueProp, index) => (
                    <li key={index} className="card p-7">
                      <span className="avatar mb-5 h-11 w-11 bg-secondary text-primary">
                        <ValuePropIcon name={valueProp.icon} className="size-5" />
                      </span>
                      <h3 className="mb-3 font-display text-[28px] font-semibold leading-tight text-primary">{valueProp.title}</h3>
                      <Paragraphs text={valueProp.text} className="gap-3" paragraphClassName="text-[15px] leading-relaxed text-foreground/85" />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {gallery.length > 0 ? (
              <div>
                <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
                  <h2 className="font-display text-4xl font-medium text-primary sm:text-5xl">From the journal</h2>
                  <Link href="/journey" className="btn btn-outline btn-lg rounded-full">
                    Read the travel journal
                  </Link>
                </div>
                <ul
                  className={cn(
                    "grid grid-cols-2 gap-3 md:gap-4",
                    plan.mosaic ? "auto-rows-[200px] md:auto-rows-[220px] md:grid-cols-4" : "auto-rows-[200px] md:auto-rows-[260px]",
                    !plan.mosaic && gallery.length >= 4 && "md:grid-cols-4",
                    !plan.mosaic && gallery.length === 3 && "md:grid-cols-3",
                  )}
                >
                  {gallery.map((item, index) => (
                    <li key={item.slug} className={cn(plan.mosaic && (index === 0 || index === 3) && "row-span-2")}>
                      <Link href={`/journey/${item.slug}`} className="group relative block h-full overflow-hidden rounded-xl bg-muted">
                        <SiteImage src={item.cover.url} alt={item.cover.alt} sizes="(min-width: 768px) 25vw, 50vw" className="img-zoom" />
                        <span className="sr-only">{item.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="bg-hero py-20 text-hero-foreground">
        <div className="container-x flex flex-wrap items-center justify-between gap-8">
          <h2 className="max-w-2xl font-display text-4xl font-medium sm:text-5xl">Plan your trip with {tenant.name}</h2>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link href="/book" className="btn btn-highlight btn-xl rounded-full">
              Book a tour
            </Link>
            <Link href="/contact" className="btn btn-hero-outline btn-xl rounded-full">
              Get in touch
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
