import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Reveal } from "@/components/motion";
import { initials, paragraphs } from "@/lib/storefront-format";
import { SiteImage } from "../site-image";

export interface AboutTeaserProps {
  name: string;
  credentialLine: string;
  shortBio: string;
  portrait: { url: string; alt: string } | null;
  /** Language names, e.g. "English". */
  languages: string[];
  /** Areas of expertise. */
  skills: string[];
}

const MICRO_LABEL = "mb-1 text-xs uppercase tracking-widest text-muted-foreground";

/** "About" teaser: portrait (or a monogram on the hero colour), short bio, and the facts the business has filled in. */
export function AboutTeaser({ name, credentialLine, shortBio, portrait, languages, skills }: AboutTeaserProps) {
  const bio = paragraphs(shortBio);
  const facts = [
    languages.length > 0 ? { label: "Languages", value: languages.join(" · ") } : null,
    skills.length > 0 ? { label: "Specialisms", value: skills.slice(0, 3).join(" · ") } : null,
  ].filter((fact) => fact !== null);

  return (
    <section aria-labelledby="about" className="bg-secondary/60 py-20 lg:py-32">
      <div className="container-x grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <Reveal className="relative">
          <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-hero">
            {portrait ? (
              <SiteImage src={portrait.url} alt={portrait.alt || `Portrait of ${name}`} sizes="(min-width: 1024px) 45vw, 100vw" tone="dark" />
            ) : (
              <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-hero-foreground">
                <span className="flex h-32 w-32 items-center justify-center rounded-full border border-highlight font-display text-5xl text-highlight">
                  {initials(name)}
                </span>
              </div>
            )}
          </div>
        </Reveal>
        <Reveal>
          <p className="eyebrow mb-4">About</p>
          <h2 id="about" className="break-words font-display text-5xl font-medium text-primary lg:text-[56px]">
            {name}
          </h2>
          {credentialLine ? <p className="mt-2 font-display text-2xl italic text-eyebrow">{credentialLine}</p> : null}
          <div className="mb-8 mt-7 flex flex-col gap-4">
            {bio.map((paragraph, index) => (
              <p key={index} className="whitespace-pre-line text-[17px] leading-relaxed text-foreground/85">
                {paragraph}
              </p>
            ))}
          </div>
          {facts.length > 0 ? (
            <dl className="mb-9 grid gap-x-8 gap-y-6 border-y py-7 sm:grid-cols-2">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className={MICRO_LABEL}>{fact.label}</dt>
                  <dd className="font-semibold">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <Link href="/about" className="btn btn-default btn-xl rounded-full">
            Read the full story
            <ArrowRight aria-hidden="true" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
