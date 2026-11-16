import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Five stars, the first `rating` of them filled. The number is spoken, not the glyphs. */
export function Stars({ rating, className }: { rating: number; className?: string }) {
  const filled = Math.min(5, Math.max(0, Math.round(rating)));
  return (
    <span role="img" aria-label={`${filled} out of 5 stars`} className={cn("inline-flex items-center gap-0.5 text-highlight", className)}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} aria-hidden="true" className="size-4" fill={index < filled ? "currentColor" : "none"} />
      ))}
    </span>
  );
}

/** "4.9" beside a single filled star, for headings and meta lines. */
export function RatingFigure({ average, className }: { average: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Star aria-hidden="true" className="size-[0.8em] text-highlight" fill="currentColor" />
      <span>
        <span className="sr-only">Rated </span>
        {average.toFixed(1)}
        <span className="sr-only"> out of 5</span>
      </span>
    </span>
  );
}
