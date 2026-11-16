"use client";

import { useState, type ReactNode } from "react";
import { DEFAULT_APPEARANCE, themeName, type AppearanceChoice } from "@/components/onboarding/appearance-options";
import { FontPicker, ModePicker, RadiusPicker, ThemePicker } from "@/components/onboarding/appearance-pickers";
import { StorefrontPreview } from "./storefront-preview";

interface ThemeStudioProps {
  /** The hero's headline, paragraph and buttons, rendered on the server. */
  children: ReactNode;
  /** Example address for the preview's address bar, e.g. `yourname.wayfold.com`. */
  address: string;
}

/**
 * The landing page's hero and its one interactive piece: the same four
 * themes, colour schemes, corner styles and heading fonts a workspace can
 * choose, wired to a live miniature storefront. Nothing is saved; it is a
 * fitting room.
 */
export function ThemeStudio({ children, address }: ThemeStudioProps) {
  const [choice, setChoice] = useState<AppearanceChoice>(DEFAULT_APPEARANCE);
  const preview = <StorefrontPreview appearance={choice} name="Your business" address={address} />;

  return (
    <>
      <section aria-label="Introduction" className="relative overflow-hidden bg-hero text-hero-foreground">
        <div className="container-x grid items-center gap-12 pb-32 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16 lg:pb-44 lg:pt-20">
          <div className="min-w-0">{children}</div>
          <div className="hidden min-w-0 animate-rise stagger-3 lg:block">
            {preview}
            <p className="mt-4 text-[13px] text-hero-foreground/70">
              Showing {themeName(choice.theme)}. Change it below.
            </p>
          </div>
        </div>
      </section>

      <section id="themes" aria-labelledby="themes-title" className="relative pb-20 lg:pb-28">
        <div className="container-x -mt-20 lg:-mt-28">
          <div className="card p-5 shadow-xl sm:p-8 lg:p-10">
            <div className="mb-7 max-w-2xl">
              <h2 id="themes-title" className="font-display text-3xl font-medium leading-tight text-primary sm:text-4xl">
                Try a look on.
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                Every workspace chooses from these four themes, in light or dark, with its own corner style and heading font. Pick one and the preview follows.
              </p>
            </div>

            <ThemePicker
              hideLegend
              columns="four"
              value={choice.theme}
              mode={choice.mode}
              brand={["Your", "Tours"]}
              onChange={(theme) => setChoice((current) => ({ ...current, theme }))}
            />

            <div className="mt-6 lg:hidden">{preview}</div>

            <div className="mt-7 grid gap-7 border-t pt-7 md:grid-cols-3">
              <ModePicker value={choice.mode} onChange={(mode) => setChoice((current) => ({ ...current, mode }))} />
              <RadiusPicker value={choice.radius} onChange={(radius) => setChoice((current) => ({ ...current, radius }))} />
              <FontPicker value={choice.font} onChange={(font) => setChoice((current) => ({ ...current, font }))} />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
