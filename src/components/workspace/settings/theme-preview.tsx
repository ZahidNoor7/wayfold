import Image from "next/image";
import { cn } from "@/lib/utils";
import { appearanceSummary, themedSurface, type Appearance } from "./appearance";

export interface PreviewBrand {
  name: string;
  tagline: string;
  logoUrl: string | null;
}

export interface PreviewHero {
  kicker: string;
  headline: string;
  emphasis: string;
  imageUrl: string | null;
}

/** "Caspian Trails": the last word in the highlight colour, as the design's wordmark does. */
export function Wordmark({ name, className }: { name: string; className?: string }) {
  const words = name.trim().split(/\s+/);
  const tail = words.length > 1 ? words.pop() : null;
  return (
    <span className={cn("font-display leading-none", className)}>
      {words.join(" ")}
      {tail ? <span className="text-highlight"> {tail}</span> : null}
    </span>
  );
}

/** The miniature on each theme option: hero strip and colour swatches, in that theme. */
export function ThemeSwatch({ appearance, name }: { appearance: Appearance; name: string }) {
  const surface = themedSurface(appearance);
  return (
    <div {...surface} className={cn(surface.className, "overflow-hidden rounded-lg border bg-background")}>
      <div className="flex h-14 items-end bg-hero p-3">
        <Wordmark name={name} className="truncate text-lg text-hero-foreground" />
      </div>
      <div className="flex items-center gap-2 p-3">
        <span className="h-7 flex-1 rounded-md bg-primary" />
        <span className="h-7 w-10 rounded-md bg-highlight" />
        <span className="h-7 w-10 rounded-md bg-secondary" />
        <span className="h-7 w-10 rounded-md border bg-card" />
      </div>
    </div>
  );
}

interface StorefrontPreviewProps {
  appearance: Appearance;
  brand: PreviewBrand;
  hero: PreviewHero | null;
}

/**
 * The public site's header and hero in the look being edited. It themes
 * itself, so it shows the new choice before it is saved.
 */
export function StorefrontPreview({ appearance, brand, hero }: StorefrontPreviewProps) {
  const surface = themedSurface(appearance);
  const headline = hero?.headline || brand.name;
  const emphasis = hero?.headline ? hero.emphasis : brand.tagline;

  return (
    <aside className="card h-fit overflow-hidden 2xl:sticky 2xl:top-8" aria-label="Live preview">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <span className="text-sm font-semibold">Live preview</span>
        <span className="badge badge-outline">{appearanceSummary(appearance)}</span>
      </div>
      <div {...surface} className={cn(surface.className, "bg-background text-foreground")} aria-hidden="true">
        <div className="flex h-12 items-center justify-between gap-3 border-b bg-background/90 px-4">
          {brand.logoUrl ? (
            <span className="relative block h-7 w-28">
              <Image src={brand.logoUrl} alt="" fill sizes="112px" className="object-contain object-left" />
            </span>
          ) : (
            <Wordmark name={brand.name} className="truncate text-lg font-semibold text-primary" />
          )}
          <span className="btn btn-highlight btn-sm">Book a tour</span>
        </div>
        <div className="relative h-48 overflow-hidden bg-hero">
          {hero?.imageUrl ? (
            <Image src={hero.imageUrl} alt="" fill sizes="(min-width: 1536px) 420px, (min-width: 1024px) 60vw, 100vw" className="object-cover opacity-60" />
          ) : null}
          <div className="relative flex h-full flex-col justify-end p-5 text-hero-foreground">
            {hero?.kicker ? <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-highlight">{hero.kicker}</p> : null}
            <p className="font-display text-3xl leading-none">
              {headline}
              {emphasis ? <em className="text-highlight"> {emphasis}</em> : null}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap gap-2">
            <span className="btn btn-highlight btn-sm">Book a tour</span>
            <span className="btn btn-default btn-sm">Explore</span>
            <span className="btn btn-outline btn-sm">Contact</span>
          </div>
          <div className="card flex flex-col gap-1 p-4">
            <span className="font-display text-xl font-semibold text-primary">Headings look like this</span>
            <span className="text-xs text-muted-foreground">Body text stays Manrope in every theme.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="badge badge-default">Featured</span>
            <span className="badge badge-secondary">New</span>
            <span className="badge badge-pending">Pending</span>
            <span className="badge badge-confirmed">Confirmed</span>
          </div>
          <span className="flex flex-col gap-1.5">
            <span className="label">Email</span>
            <span className="input flex items-center text-muted-foreground">name@example.com</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
