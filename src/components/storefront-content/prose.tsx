import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { starLabel, starString } from "@/lib/review-display";
import { toParagraphs } from "./text";

interface ParagraphsProps {
  /** Plain text as written in the dashboard. Rendered as text, never as markup. */
  text: string | null | undefined;
  className?: string;
  paragraphClassName?: string;
}

/** Plain text as paragraphs: a blank line starts a new one, a single line break is kept. */
export function Paragraphs({ text, className, paragraphClassName }: ParagraphsProps) {
  const paragraphs = toParagraphs(text);
  if (paragraphs.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {paragraphs.map((lines, index) => (
        <p key={index} className={paragraphClassName}>
          {lines.map((line, lineIndex) => (
            <Fragment key={lineIndex}>
              {lineIndex > 0 ? <br /> : null}
              {line}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

interface StarsProps {
  rating: number;
  /** Overrides the spoken label, e.g. "Average 4.9 out of 5". */
  label?: string;
  className?: string;
}

/** A star rating: the glyphs for the eye, the label for everyone else. */
export function Stars({ rating, label, className }: StarsProps) {
  return (
    <span role="img" aria-label={label ?? starLabel(rating)} className={cn("block text-highlight", className)}>
      {starString(rating)}
    </span>
  );
}

/**
 * Structured data for search engines. `<` is escaped so text written by a
 * business can never close the script element.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

/** Holds a content page's shape while its data loads. */
export function ContentSkeleton({ variant = "page" }: { variant?: "page" | "narrow" }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="pb-28 pt-16 lg:pt-24">
      <div className={cn("container-x flex flex-col gap-10", variant === "narrow" && "max-w-3xl")}>
        <div className="flex flex-col gap-4">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton h-14 w-full max-w-2xl sm:h-16" />
          <div className="skeleton h-5 w-full max-w-xl" />
        </div>
        {variant === "narrow" ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="skeleton h-4" />
            ))}
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="skeleton h-56" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
