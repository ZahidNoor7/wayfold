import Link from "next/link";
import type { ReactNode } from "react";
import { Paragraphs } from "./prose";

interface LegalPageProps {
  businessName: string;
  title: string;
  /** The business's own text. Plain text; rendered as paragraphs, never as markup. */
  text: string;
  /** What kind of document this is, for the notice shown with the standard text ("privacy policy"). */
  documentName: string;
  /** The standard text, shown only while the business has not written its own. */
  fallback: ReactNode;
}

/** A legal page: the business's text when it has written one, otherwise a clearly marked standard notice. */
export function LegalPage({ businessName, title, text, documentName, fallback }: LegalPageProps) {
  const own = text.trim();
  return (
    <section className="pb-28 pt-16 lg:pt-24">
      <div className="container-x max-w-3xl">
        <p className="eyebrow mb-4">{businessName}</p>
        <h1 className="mb-10 font-display text-5xl font-medium leading-none text-primary sm:text-6xl">{title}</h1>
        {own ? (
          <Paragraphs text={own} className="gap-5" paragraphClassName="text-[17px] leading-relaxed text-foreground/85" />
        ) : (
          <>
            <p role="note" className="alert alert-warning mb-10">
              <strong className="font-semibold">Standard notice.</strong> {businessName} has not published its own {documentName} yet. This general text describes
              how this website works and applies until {businessName} replaces it with its own.
            </p>
            <div className="flex flex-col gap-10">{fallback}</div>
          </>
        )}
        <p className="mt-12 border-t pt-6 text-sm text-muted-foreground">
          Questions about this page?{" "}
          <Link href="/contact" className="font-semibold text-primary underline underline-offset-4">
            Contact {businessName}
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

/** One titled block of the standard text. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 font-display text-3xl font-medium text-primary">{title}</h2>
      <div className="flex flex-col gap-4 text-[17px] leading-relaxed text-foreground/85 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
