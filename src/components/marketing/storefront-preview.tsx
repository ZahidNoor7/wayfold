import { FoldMotif } from "@/components/auth/wordmark";
import { MODE_CLASS, themeName, type AppearanceChoice } from "@/components/onboarding/appearance-options";
import { cn } from "@/lib/utils";

interface StorefrontPreviewProps {
  appearance: AppearanceChoice;
  /** Business name shown in the miniature header. */
  name: string;
  /** Address shown in the miniature address bar, e.g. `yourname.wayfold.com`. */
  address: string;
  className?: string;
}

/**
 * A miniature storefront drawn entirely from theme tokens. It carries its own
 * `data-theme`, mode class, `data-radius` and `data-font`, so it shows a theme
 * exactly as a real site would render it, whatever the page around it uses.
 * The words inside are example content, so the whole thing is one image to
 * assistive technology.
 */
export function StorefrontPreview({ appearance, name, address, className }: StorefrontPreviewProps) {
  return (
    <div
      role="img"
      aria-label={`Preview of a tour website in the ${themeName(appearance.theme)} theme`}
      data-theme={appearance.theme}
      data-radius={appearance.radius}
      data-font={appearance.font}
      className={cn(
        MODE_CLASS[appearance.mode],
        "select-none overflow-hidden rounded-xl border bg-background text-foreground shadow-xl transition-colors duration-300",
        className,
      )}
    >
      <div aria-hidden="true">
        <div className="flex items-center gap-3 border-b bg-muted px-3 py-2">
          <span className="flex gap-1.5">
            <span className="size-2 rounded-full bg-border" />
            <span className="size-2 rounded-full bg-border" />
            <span className="size-2 rounded-full bg-border" />
          </span>
          <span className="min-w-0 flex-1 truncate rounded-md bg-background px-3 py-1 text-center text-[11px] text-muted-foreground">{address}</span>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0 truncate font-display text-lg font-semibold leading-none text-primary">{name}</span>
          <span className="hidden shrink-0 gap-4 text-[11px] font-semibold text-foreground/70 sm:flex">
            <span>Experiences</span>
            <span>Offers</span>
            <span>Reviews</span>
          </span>
          <span className="shrink-0 rounded-md bg-highlight px-3 py-1.5 text-[11px] font-semibold text-highlight-foreground">Book a tour</span>
        </div>

        <div className="relative overflow-hidden bg-hero px-4 py-7 text-hero-foreground sm:px-6 sm:py-9">
          <FoldMotif route className="absolute inset-0 h-full w-full opacity-70" />
          <p className="relative text-[9px] font-semibold uppercase tracking-[0.24em] text-highlight">Private and small-group tours</p>
          <p className="relative mt-2.5 max-w-[15ch] font-display text-[26px] font-medium leading-[1.02] sm:text-[32px]">
            See the city with someone who lives here.
          </p>
          <div className="relative mt-5 flex flex-wrap gap-2">
            <span className="rounded-md bg-highlight px-3 py-2 text-[11px] font-semibold text-highlight-foreground">Explore experiences</span>
            <span className="rounded-md border border-hero-foreground/40 px-3 py-2 text-[11px] font-semibold">Request a date</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 p-4">
          {[
            { category: "Historical", title: "Old town on foot", detail: "Half day" },
            { category: "Food & Local", title: "Market and tasting", detail: "Evening" },
          ].map((tour) => (
            <div key={tour.title} className="overflow-hidden rounded-lg border bg-card text-card-foreground">
              <div className="flex h-14 items-start bg-secondary p-2">
                <span className="rounded-full bg-background/90 px-2 py-0.5 text-[9px] font-semibold">{tour.category}</span>
              </div>
              <div className="p-3">
                <p className="font-display text-[15px] font-semibold leading-tight text-primary">{tour.title}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{tour.detail}</p>
                <span className="mt-2.5 inline-block rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground">View details</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
