"use client";

import { ArrowUpRight, ImagePlus, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { updateBrandingAction } from "@/app/workspace/settings/actions";
import { FormError } from "@/components/form";
import { MediaPicker } from "@/components/workspace/media/media-picker";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import {
  DEFAULT_APPEARANCE,
  FONT_OPTIONS,
  MODE_OPTIONS,
  RADIUS_OPTIONS,
  THEME_OPTIONS,
  toAppearance,
  type Appearance,
  type ModeId,
} from "./appearance";
import { errorFor } from "./errors";
import { SaveBar, useUnsavedChanges } from "./save-bar";
import { StorefrontPreview, ThemeSwatch, type PreviewBrand, type PreviewHero } from "./theme-preview";

interface AppearanceValues extends Appearance {
  logoMediaId: string | null;
}

interface AppearanceFormProps {
  initial: Appearance & { logo: { id: string; url: string } | null };
  brand: Omit<PreviewBrand, "logoUrl">;
  hero: PreviewHero | null;
  storefrontUrl: string;
  /** May browse the media library (`media.view`) and upload to it (`media.manage`). */
  media: { canBrowse: boolean; canUpload: boolean };
}

const MODE_ICONS: Record<ModeId, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

/** Shared look of every option card; the hidden radio inside carries state and keyboard support. */
const OPTION =
  "relative cursor-pointer border-2 border-border transition-[border-color,box-shadow,background-color] duration-200 hover:border-ring has-checked:border-primary has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background active:scale-[0.98] motion-reduce:active:scale-100";

export function AppearanceForm({ initial, brand, hero, storefrontUrl, media }: AppearanceFormProps) {
  const defaults: AppearanceValues = { ...toAppearance(initial), logoMediaId: initial.logo?.id ?? null };
  const form = useForm<AppearanceValues>({ defaultValues: defaults });
  const { isDirty } = form.formState;
  const [logoUrls, setLogoUrls] = useState<Record<string, string>>(() => (initial.logo ? { [initial.logo.id]: initial.logo.url } : {}));
  const [pickerOpen, setPickerOpen] = useState(false);

  const [theme, mode, radius, font, logoMediaId] = useWatch({ control: form.control, name: ["theme", "mode", "radius", "font", "logoMediaId"] });
  const values = { theme, mode, radius, font, logoMediaId };
  const appearance = toAppearance(values);
  const logoUrl = values.logoMediaId ? (logoUrls[values.logoMediaId] ?? null) : null;

  const { run, pending, error, fieldErrors } = useAction(updateBrandingAction, {
    success: "Appearance saved. Your website and dashboard now use it.",
    toastError: false,
    onSuccess: (saved) => form.reset({ ...toAppearance(saved), logoMediaId: saved.logoMediaId }),
  });
  useUnsavedChanges(isDirty);

  const onSubmit = form.handleSubmit((data) => run(data));
  const logoError = errorFor(fieldErrors, "logoMediaId");
  const formLevel = error && !logoError ? error : null;

  const resetToDefault = () => {
    for (const key of ["theme", "mode", "radius", "font"] as const) {
      form.setValue(key, DEFAULT_APPEARANCE[key], { shouldDirty: true });
    }
  };

  return (
    <>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <FormError message={formLevel} />
        <div className="grid gap-6 2xl:grid-cols-[1fr_420px]">
          <div className="flex min-w-0 flex-col gap-6">
            <section className="card" aria-labelledby="appearance-theme">
              <div className="card-header">
                <h2 id="appearance-theme" className="card-title">
                  Theme
                </h2>
                <p className="card-description">Your brand colours across the public website and this dashboard.</p>
              </div>
              <div className="card-content">
                <div role="radiogroup" aria-labelledby="appearance-theme" className="grid gap-4 sm:grid-cols-2">
                  {THEME_OPTIONS.map((theme) => {
                    const checked = values.theme === theme.id;
                    return (
                      <label key={theme.id} className={cn(OPTION, "group flex flex-col gap-3 rounded-xl p-3 text-left has-checked:shadow-md")}>
                        <input type="radio" value={theme.id} {...form.register("theme")} className="sr-only" />
                        <ThemeSwatch appearance={{ ...appearance, theme: theme.id }} name={brand.name} />
                        <span className="flex items-center justify-between gap-2">
                          <span>
                            <span className="block font-bold">{theme.name}</span>
                            <span className="text-xs text-muted-foreground">{theme.description}</span>
                          </span>
                          <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-primary">
                            {checked ? <span className="size-2.5 rounded-full bg-primary" /> : null}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="card" aria-labelledby="appearance-mode">
              <div className="card-header">
                <h2 id="appearance-mode" className="card-title">
                  Colour scheme
                </h2>
                <p className="card-description">Light, dark, or follow each visitor’s device setting.</p>
              </div>
              <div className="card-content">
                <div role="radiogroup" aria-labelledby="appearance-mode" className="grid grid-cols-3 gap-3">
                  {MODE_OPTIONS.map((mode) => {
                    const Icon = MODE_ICONS[mode.id];
                    return (
                      <label key={mode.id} className={cn(OPTION, "flex flex-col items-center gap-2 rounded-lg p-4 text-sm font-semibold has-checked:bg-accent")}>
                        <input type="radio" value={mode.id} {...form.register("mode")} className="sr-only" />
                        <Icon aria-hidden="true" className="size-5" />
                        {mode.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            </section>

            <div className="grid gap-6 md:grid-cols-2">
              <section className="card" aria-labelledby="appearance-radius">
                <div className="card-header">
                  <h2 id="appearance-radius" className="card-title">
                    Corner style
                  </h2>
                  <p className="card-description">Buttons, cards and inputs.</p>
                </div>
                <div className="card-content">
                  <div role="radiogroup" aria-labelledby="appearance-radius" className="grid grid-cols-4 gap-2">
                    {RADIUS_OPTIONS.map((radius) => (
                      <label key={radius.id} className={cn(OPTION, "flex flex-col items-center gap-2 rounded-lg p-3 text-xs font-semibold has-checked:bg-accent")}>
                        <input type="radio" value={radius.id} {...form.register("radius")} className="sr-only" />
                        <span
                          aria-hidden="true"
                          className="h-7 w-9 border-2 border-b-transparent border-l-primary border-r-transparent border-t-primary"
                          style={{ borderTopLeftRadius: radius.glyph }}
                        />
                        {radius.label}
                      </label>
                    ))}
                  </div>
                </div>
              </section>
              <section className="card" aria-labelledby="appearance-font">
                <div className="card-header">
                  <h2 id="appearance-font" className="card-title">
                    Heading font
                  </h2>
                  <p className="card-description">Body text stays Manrope.</p>
                </div>
                <div className="card-content">
                  <div role="radiogroup" aria-labelledby="appearance-font" className="grid grid-cols-3 gap-2">
                    {FONT_OPTIONS.map((font) => (
                      <label key={font.id} className={cn(OPTION, "flex flex-col items-center gap-1 rounded-lg p-3 has-checked:bg-accent")}>
                        <input type="radio" value={font.id} {...form.register("font")} className="sr-only" />
                        <span aria-hidden="true" data-font={font.id} className="font-display text-3xl leading-none">
                          Aa
                        </span>
                        <span className="text-xs font-semibold">{font.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            <section className="card" aria-labelledby="appearance-logo">
              <div className="card-header">
                <h2 id="appearance-logo" className="card-title">
                  Logo
                </h2>
                <p className="card-description">Shown in your website header in place of your business name. A wide image with a transparent background works best.</p>
              </div>
              <div className="card-content flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="relative flex h-16 w-40 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
                    {logoUrl ? (
                      <Image src={logoUrl} alt="Your logo" fill sizes="160px" className="object-contain p-2" />
                    ) : (
                      <span className="text-xs text-muted-foreground">No logo</span>
                    )}
                  </span>
                  {media.canBrowse ? (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-outline" onClick={() => setPickerOpen(true)}>
                        <ImagePlus aria-hidden="true" />
                        {values.logoMediaId ? "Change logo" : "Choose logo"}
                      </button>
                      {values.logoMediaId ? (
                        <button type="button" className="btn btn-ghost" onClick={() => form.setValue("logoMediaId", null, { shouldDirty: true })}>
                          <Trash2 aria-hidden="true" />
                          Remove logo
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="field-hint max-w-xs">Choosing a logo needs access to the media library. Ask the workspace owner to give your role media access.</p>
                  )}
                </div>
                {logoError ? (
                  <span role="alert" className="field-error">
                    {logoError}
                  </span>
                ) : null}
              </div>
            </section>

            <div className="flex flex-wrap gap-2">
              <a href={storefrontUrl} target="_blank" rel="noopener" className="btn btn-default">
                Preview website
                <ArrowUpRight aria-hidden="true" />
              </a>
              <button type="button" onClick={resetToDefault} className="btn btn-outline">
                Reset to default
              </button>
            </div>
          </div>

          <StorefrontPreview appearance={appearance} brand={{ ...brand, logoUrl }} hero={hero} />
        </div>

        <SaveBar
          dirty={isDirty}
          pending={pending}
          onDiscard={() => form.reset(defaults)}
          saveLabel="Save appearance"
          savedMessage="Your website and dashboard use this look."
        />
      </form>

      {/* Outside the form: events from the portalled picker must not submit it. */}
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        resourceType="image"
        title="Choose your logo"
        selectedIds={values.logoMediaId ? [values.logoMediaId] : []}
        canUpload={media.canUpload}
        onSelect={([asset]) => {
          if (!asset) return;
          setLogoUrls((current) => ({ ...current, [asset.id]: asset.url }));
          form.setValue("logoMediaId", asset.id, { shouldDirty: true });
        }}
      />
    </>
  );
}
