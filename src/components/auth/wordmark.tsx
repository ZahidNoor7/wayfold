import { cn } from "@/lib/utils";

interface WordmarkProps {
  /** `hero` for dark hero-coloured surfaces, `default` for page backgrounds. */
  tone?: "default" | "hero";
  className?: string;
}

/**
 * The Wayfold wordmark: the name set in the display face beside a small
 * folded-corner mark, the same fold the app icon carries.
 */
export function Wordmark({ tone = "default", className }: WordmarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 shrink-0">
        <path d="M3 6.5 9 4v13.5L3 20z" className={tone === "hero" ? "fill-hero-foreground/90" : "fill-primary"} />
        <path d="M9 4l6 2.5V20l-6-2.5z" className={tone === "hero" ? "fill-hero-foreground/45" : "fill-primary/45"} />
        <path d="M15 6.5 21 4v13.5L15 20z" className="fill-highlight" />
      </svg>
      <span className={cn("font-display text-[24px] font-semibold leading-none sm:text-[26px]", tone === "hero" ? "text-hero-foreground" : "text-primary")}>
        Wayfold
      </span>
    </span>
  );
}

interface FoldMotifProps {
  className?: string;
  /**
   * Draws a dotted route to a pin across the right half. Only for surfaces
   * whose text keeps to the left: the route must never run under words.
   */
  route?: boolean;
}

/**
 * Decorative folded-map artwork for hero-coloured surfaces: accordion panels
 * with faint contour lines. Purely ornamental, so hidden from assistive
 * technology.
 */
export function FoldMotif({ className, route = false }: FoldMotifProps) {
  return (
    <svg viewBox="0 0 480 360" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid slice" className={className}>
      <g className="text-hero-foreground">
        <path d="M0 40 96 0v320L0 360z" fill="currentColor" fillOpacity="0.07" />
        <path d="M96 0l96 40v320l-96-40z" fill="currentColor" fillOpacity="0.03" />
        <path d="M192 40 288 0v320l-96 40z" fill="currentColor" fillOpacity="0.07" />
        <path d="M288 0l96 40v320l-96-40z" fill="currentColor" fillOpacity="0.03" />
        <path d="M384 40 480 0v320l-96 40z" fill="currentColor" fillOpacity="0.07" />
        <path d="M96 0v320M192 40v320M288 0v320M384 40v320" stroke="currentColor" strokeOpacity="0.14" />
        <path d="M0 150c60-30 80 20 140 0s70-60 130-40 60 70 120 50 60-50 90-60" stroke="currentColor" strokeOpacity="0.1" />
        <path d="M0 230c50 20 90-30 150-10s80 50 140 30 80-60 190-30" stroke="currentColor" strokeOpacity="0.1" />
      </g>
      {route ? (
        <>
          <path d="M268 270c20-40 64-26 86-62s8-68 70-108" className="stroke-highlight" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 9" />
          <circle cx="268" cy="270" r="6" className="fill-highlight" />
          <path d="M424 100c-9-12-14-20-14-28a14 14 0 0 1 28 0c0 8-5 16-14 28z" className="fill-highlight" />
          <circle cx="424" cy="72" r="5" className="fill-hero" />
        </>
      ) : null}
    </svg>
  );
}
