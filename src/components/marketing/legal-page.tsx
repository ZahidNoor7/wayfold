import type { ReactNode } from "react";

interface LegalSection {
  heading: string;
  body: ReactNode;
}

interface LegalPageProps {
  title: string;
  intro: string;
  sections: LegalSection[];
}

/**
 * Wayfold's own legal pages. The wording states plainly what the product
 * does; it is a starting point the platform operator must have reviewed for
 * their jurisdiction before launch, and the page says so.
 */
export function LegalPage({ title, intro, sections }: LegalPageProps) {
  return (
    <article className="container-x max-w-3xl py-20 lg:py-28">
      <h1 className="font-display text-5xl font-medium leading-none text-primary sm:text-6xl">{title}</h1>
      <p className="mt-6 text-[17px] leading-relaxed text-foreground/85">{intro}</p>
      <div role="note" className="alert alert-warning mt-8">
        This page describes how Wayfold works. It has not yet been reviewed by a lawyer for any particular country, and
        the operator of this service is responsible for having it reviewed before relying on it.
      </div>
      <div className="mt-12 flex flex-col gap-10">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-display text-2xl font-semibold text-primary">{section.heading}</h2>
            <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-foreground/85">{section.body}</div>
          </section>
        ))}
      </div>
    </article>
  );
}
