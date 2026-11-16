"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, Plus } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { useController, useFieldArray, useForm, useWatch, type Control, type FieldValues, type Path } from "react-hook-form";
import { z } from "zod";
import { Field } from "@/components/form";
import { cn } from "@/lib/utils";
import { displayHost, parseOptionalNumber, PLAIN_LINE_HINT, PLAIN_TEXT_HINT, previewText, storefrontUrl } from "../helpers";
import { MediaField, type MediaChoice } from "../media-field";
import { RowControls } from "../row-controls";
import { CountedField } from "./counted-field";
import { SectionCard, useSectionSave } from "./section-form";
import {
  ABOUT_LIMITS,
  aboutSchema,
  CONTACT_LIMITS,
  contactErrorPath,
  contactSchema,
  contactToInput,
  contactToValues,
  FEATURED_MODES,
  FOOTER_LIMIT,
  footerSchema,
  HERO_LIMITS,
  heroSchema,
  LEGAL_LIMIT,
  legalSchema,
  objectErrorPath,
  pagesWithErrors,
  SEO_LIMITS,
  SEO_SHOWN,
  seoPageInfo,
  seoSchema,
  type ContactValues,
  type FeaturedMode,
  type StoredContact,
} from "./site-model";

const mediaChoice = z.custom<MediaChoice | null>((value) => value === null || (typeof value === "object" && value !== null && "id" in value));

/** Single image field bound to a form value. */
function ImageController<V extends FieldValues>({ control, name, ...props }: { control: Control<V>; name: Path<V> } & Omit<Parameters<typeof MediaField>[0], "value" | "onChange" | "error">) {
  const { field, fieldState } = useController({ control, name });
  return <MediaField {...props} value={(field.value as MediaChoice | null) ?? null} onChange={field.onChange} error={fieldState.error?.message ?? null} />;
}

/* ------------------------------------------------------------------- hero */

export interface StoredHero {
  kicker: string;
  headline: string;
  headlineEmphasis: string;
  body: string;
  imageMediaId: string | null;
  nowGuiding: string;
}

const heroForm = heroSchema.extend({ image: mediaChoice });
type HeroValues = z.input<typeof heroForm>;

export function HeroForm({ initial, image, origin, canUpload }: { initial: StoredHero; image: MediaChoice | null; origin: string; canUpload: boolean }) {
  const form = useForm<HeroValues>({
    resolver: zodResolver(heroForm),
    defaultValues: {
      kicker: initial.kicker,
      headline: initial.headline,
      headlineEmphasis: initial.headlineEmphasis,
      body: initial.body,
      nowGuiding: initial.nowGuiding,
      image,
    },
  });
  const { onSubmit, pending, formError } = useSectionSave({
    section: "hero",
    form,
    toInput: ({ image: chosen, ...text }) => ({ ...text, imageMediaId: chosen?.id ?? null }),
    fromSaved: (saved) => {
      const hero = saved as StoredHero;
      const chosen = form.getValues("image");
      return { ...hero, image: hero.imageMediaId && chosen?.id === hero.imageMediaId ? chosen : null };
    },
    errorPath: (key) => (key === "imageMediaId" ? "image" : objectErrorPath(key)),
    success: "Home introduction saved",
  });
  const [kicker, headline, emphasis] = useWatch({ control: form.control, name: ["kicker", "headline", "headlineEmphasis"] });

  return (
    <SectionCard
      id="section-hero"
      title="Introduction"
      description="The first thing visitors see on your home page."
      onSubmit={onSubmit}
      pending={pending}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset()}
      formError={formError}
      rootError={form.formState.errors.root?.message}
      origin={origin}
      path="/"
      saveLabel="Save introduction"
    >
      <CountedField form={form} name="kicker" label="Small line above the headline" max={HERO_LIMITS.kicker} placeholder="Private & small-group journeys" />
      <div className="grid gap-4 sm:grid-cols-2">
        <CountedField form={form} name="headline" label="Headline" max={HERO_LIMITS.headline} placeholder="Discover the world" />
        <CountedField
          form={form}
          name="headlineEmphasis"
          label="Emphasised ending"
          max={HERO_LIMITS.headlineEmphasis}
          placeholder="through local eyes."
          hint="Shown in italics, in your highlight colour, right after the headline."
        />
      </div>
      {headline || emphasis || kicker ? (
        <div aria-label="Headline preview" role="img" className="rounded-lg border bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">Preview</p>
          {kicker ? <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-eyebrow">{kicker}</p> : null}
          <p className="mt-1 text-pretty font-display text-2xl font-medium leading-tight text-primary">
            {headline}
            {headline && emphasis ? " " : null}
            {emphasis ? <em className="text-eyebrow">{emphasis}</em> : null}
          </p>
        </div>
      ) : null}
      <CountedField form={form} name="body" label="Introduction text" max={HERO_LIMITS.body} multiline rows={3} hint={PLAIN_TEXT_HINT} />
      <ImageController
        control={form.control}
        name="image"
        label="Background photo"
        hint="A wide landscape photo works best. It sits behind the headline, darkened for legibility."
        previewClassName="aspect-video w-40"
        canUpload={canUpload}
        pickerTitle="Choose the introduction photo"
        disabled={pending}
      />
      <CountedField
        form={form}
        name="nowGuiding"
        label="“Now guiding” line"
        note="optional"
        max={HERO_LIMITS.nowGuiding}
        placeholder="Sheki, Greater Caucasus"
        hint="Where you are guiding at the moment. Shown in the corner of the introduction on large screens; leave blank to hide it."
      />
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ about */

export interface StoredAbout {
  portraitMediaId: string | null;
  credentialLine: string;
  shortBio: string;
  longBio: string;
  philosophyQuote: string;
  licenceLine: string;
}

const aboutForm = aboutSchema.extend({ portrait: mediaChoice });
type AboutValues = z.input<typeof aboutForm>;

export function AboutForm({ initial, portrait, origin, canUpload }: { initial: StoredAbout; portrait: MediaChoice | null; origin: string; canUpload: boolean }) {
  const form = useForm<AboutValues>({
    resolver: zodResolver(aboutForm),
    defaultValues: {
      credentialLine: initial.credentialLine,
      shortBio: initial.shortBio,
      longBio: initial.longBio,
      philosophyQuote: initial.philosophyQuote,
      licenceLine: initial.licenceLine,
      portrait,
    },
  });
  const { onSubmit, pending, formError } = useSectionSave({
    section: "about",
    form,
    toInput: ({ portrait: chosen, ...text }) => ({ ...text, portraitMediaId: chosen?.id ?? null }),
    fromSaved: (saved) => {
      const about = saved as StoredAbout;
      const chosen = form.getValues("portrait");
      return { ...about, portrait: about.portraitMediaId && chosen?.id === about.portraitMediaId ? chosen : null };
    },
    errorPath: (key) => (key === "portraitMediaId" ? "portrait" : objectErrorPath(key)),
    success: "About you saved",
  });

  return (
    <SectionCard
      id="section-about"
      title="About you"
      description="Your portrait and story, shown on the About page and in the “Your guide” part of the home page."
      onSubmit={onSubmit}
      pending={pending}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset()}
      formError={formError}
      rootError={form.formState.errors.root?.message}
      origin={origin}
      path="/about"
      saveLabel="Save about you"
    >
      <ImageController
        control={form.control}
        name="portrait"
        label="Portrait"
        hint="A portrait-format photo of you (4:5)."
        previewClassName="aspect-[4/5] w-28"
        canUpload={canUpload}
        pickerTitle="Choose your portrait"
        disabled={pending}
      />
      <CountedField form={form} name="credentialLine" label="Credentials" max={ABOUT_LIMITS.credentialLine} placeholder="Licensed guide · Art historian · Mountain leader" />
      <CountedField form={form} name="shortBio" label="Short introduction" max={ABOUT_LIMITS.shortBio} multiline rows={4} hint={`Used on the home page. ${PLAIN_TEXT_HINT}`} />
      <CountedField form={form} name="longBio" label="Your story" max={ABOUT_LIMITS.longBio} multiline rows={8} hint={`Used on the About page. Leave an empty line between paragraphs. ${PLAIN_TEXT_HINT}`} />
      <CountedField form={form} name="philosophyQuote" label="Travel philosophy" note="optional" max={ABOUT_LIMITS.philosophyQuote} multiline rows={3} hint="Shown as a large quote on the About page." />
      <CountedField
        form={form}
        name="licenceLine"
        label="Licence"
        note="optional"
        max={ABOUT_LIMITS.licenceLine}
        placeholder="Tourism Board · No. 2014-318"
        hint="Issuing body and licence number, shown beside your portrait."
      />
    </SectionCard>
  );
}

/* ---------------------------------------------------------------- contact */

export function ContactForm({ initial, origin }: { initial: StoredContact; origin: string }) {
  const form = useForm<ContactValues>({ resolver: zodResolver(contactSchema), defaultValues: contactToValues(initial) });
  const { fields, append, move, remove } = useFieldArray({ control: form.control, name: "serviceLocations" });
  const locations = useWatch({ control: form.control, name: "serviceLocations" }) ?? [];
  const [latitude, longitude] = useWatch({ control: form.control, name: ["mapLatitude", "mapLongitude"] });
  const addRef = useRef<HTMLButtonElement>(null);
  const { onSubmit, pending, formError } = useSectionSave({
    section: "contact",
    form,
    toInput: contactToInput,
    fromSaved: (saved) => contactToValues(saved as StoredContact),
    errorPath: contactErrorPath,
    success: "Contact details saved",
  });

  const lat = parseOptionalNumber(latitude);
  const lng = parseOptionalNumber(longitude);
  const mapHref = typeof lat === "number" && typeof lng === "number" ? `https://www.google.com/maps?q=${lat},${lng}` : null;
  const errors = form.formState.errors;
  const full = fields.length >= CONTACT_LIMITS.maxLocations;

  return (
    <SectionCard
      id="section-contact"
      title="Contact page extras"
      description="Opening hours, how fast you reply, where you work and the map on your contact page. Your e-mail, phone and social links are under Settings."
      onSubmit={onSubmit}
      pending={pending}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset()}
      formError={formError}
      rootError={errors.root?.message}
      origin={origin}
      path="/contact"
      saveLabel="Save contact extras"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <CountedField form={form} name="hours" label="Working hours" max={CONTACT_LIMITS.hours} multiline rows={3} placeholder={"Mon – Sat · 9:00 – 19:00\nSunday · WhatsApp only"} hint="One line per period." />
        <CountedField form={form} name="responseTime" label="Reply promise" max={CONTACT_LIMITS.responseTime} placeholder="I reply personally within 24 hours." hint={PLAIN_LINE_HINT} />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="label mb-2">Map location <span className="font-normal text-muted-foreground">optional</span></legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Latitude" hint="Decimal degrees, e.g. 40.3777" error={errors.mapLatitude?.message ?? null}>
            {(control) => <input {...control} {...form.register("mapLatitude")} className="input" inputMode="decimal" autoComplete="off" />}
          </Field>
          <Field label="Longitude" hint="Decimal degrees, e.g. 49.8920" error={errors.mapLongitude?.message ?? null}>
            {(control) => <input {...control} {...form.register("mapLongitude")} className="input" inputMode="decimal" autoComplete="off" />}
          </Field>
        </div>
        {mapHref ? (
          <a href={mapHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-[13px] font-semibold text-primary underline-offset-4 hover:underline">
            Check this point on Google Maps
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <p className="field-hint">Leave both blank to hide the map. Tip: right-click a place in Google Maps to copy its coordinates.</p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="label mb-2">
          Service locations <span className="font-normal text-muted-foreground">· {fields.length} of {CONTACT_LIMITS.maxLocations}</span>
        </legend>
        {fields.length > 0 ? (
          <ol className="flex flex-col gap-2">
            {fields.map((field, index) => {
              const name = locations[index]?.value?.trim();
              const label = name ? `location ${index + 1}: ${name}` : `location ${index + 1}`;
              const error = errors.serviceLocations?.[index]?.value?.message;
              return (
                <li key={field.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`location-${field.id}`}>
                      Location {index + 1}
                    </label>
                    <input
                      id={`location-${field.id}`}
                      {...form.register(`serviceLocations.${index}.value`)}
                      className="input min-w-0 flex-1"
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `location-${field.id}-error` : undefined}
                      autoComplete="off"
                    />
                    <RowControls
                      index={index}
                      count={fields.length}
                      label={label}
                      disabled={pending}
                      onMove={(from, to) => move(from, to)}
                      onRemove={(at) => {
                        remove(at);
                        requestAnimationFrame(() => addRef.current?.focus());
                      }}
                    />
                  </div>
                  {error ? (
                    <span id={`location-${field.id}-error`} role="alert" className="field-error">
                      {error}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="field-hint">No locations yet. Add the towns and regions you guide in.</p>
        )}
        {errors.serviceLocations?.message || errors.serviceLocations?.root?.message ? (
          <p role="alert" className="field-error">
            {errors.serviceLocations?.message ?? errors.serviceLocations?.root?.message}
          </p>
        ) : null}
        <button ref={addRef} type="button" className="btn btn-outline btn-sm self-start" disabled={full || pending} onClick={() => append({ value: "" })}>
          <Plus aria-hidden="true" />
          Add location
        </button>
      </fieldset>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------- seo */

type SeoValues = Record<string, { title: string; description: string }>;

export function SeoForm({ initial, pages, origin }: { initial: SeoValues; pages: readonly string[]; origin: string }) {
  const form = useForm<SeoValues>({ resolver: zodResolver(seoSchema(pages)), defaultValues: initial });
  const [active, setActive] = useState(pages[0] ?? "home");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const { onSubmit, pending, formError } = useSectionSave({
    section: "seo",
    form,
    toInput: (values) => values,
    fromSaved: (saved) => saved as SeoValues,
    errorPath: (key) => {
      const path = objectErrorPath(key);
      const page = path.split(".")[0];
      if (page && pages.includes(page)) setActive(page);
      return path;
    },
    success: "Search engine settings saved",
  });
  const errored = pagesWithErrors(form.formState.errors as Record<string, unknown>, pages);
  const info = seoPageInfo(active);

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? pages.length - 1 : delta ? (index + delta + pages.length) % pages.length : null;
    if (target === null) return;
    event.preventDefault();
    const page = pages[target]!;
    setActive(page);
    tabRefs.current[page]?.focus();
  }

  return (
    <SectionCard
      id="section-seo"
      title="Search results"
      description="How each page of your website appears in Google and when shared. Leave a field blank to use the standard text for that page."
      onSubmit={onSubmit}
      pending={pending}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset()}
      formError={formError}
      rootError={form.formState.errors.root?.message}
      origin={origin}
      path={info.path}
      viewLabel={`View the ${info.label} page`}
      saveLabel="Save search settings"
    >
      <div role="tablist" aria-label="Website page" className="tabs-list no-scrollbar max-w-full justify-start overflow-x-auto">
        {pages.map((page, index) => (
          <button
            key={page}
            ref={(node) => {
              tabRefs.current[page] = node;
            }}
            type="button"
            role="tab"
            id={`seo-tab-${page}`}
            aria-selected={active === page}
            aria-controls={`seo-panel-${page}`}
            tabIndex={active === page ? 0 : -1}
            className="tabs-trigger"
            onClick={() => setActive(page)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            {seoPageInfo(page).label}
            {errored.includes(page) ? (
              <>
                <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
                <span className="sr-only">(has errors)</span>
              </>
            ) : null}
          </button>
        ))}
      </div>
      {pages.map((page) => (
        <div key={page} role="tabpanel" id={`seo-panel-${page}`} aria-labelledby={`seo-tab-${page}`} hidden={active !== page} className="flex flex-col gap-4">
          <CountedField
            form={form}
            name={`${page}.title`}
            label="Page title"
            max={SEO_SHOWN.title}
            hint={`Search engines show about ${SEO_SHOWN.title} characters; up to ${SEO_LIMITS.title} are allowed.`}
          />
          <CountedField
            form={form}
            name={`${page}.description`}
            label="Description"
            max={SEO_SHOWN.description}
            multiline
            rows={2}
            hint={`Search engines show about ${SEO_SHOWN.description} characters; up to ${SEO_LIMITS.description} are allowed.`}
          />
          <SearchPreview control={form.control} page={page} host={displayHost(storefrontUrl(origin, seoPageInfo(page).path))} />
        </div>
      ))}
    </SectionCard>
  );
}

function SearchPreview({ control, page, host }: { control: Control<SeoValues>; page: string; host: string }) {
  const value = useWatch({ control, name: page }) as { title?: string; description?: string } | undefined;
  const title = value?.title?.trim() ?? "";
  const description = value?.description?.trim() ?? "";
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <p className="text-xs text-muted-foreground">Search preview</p>
      <p className={cn("mt-1 text-[17px]", title ? "text-sky-700 dark:text-sky-400" : "italic text-muted-foreground")}>
        {title ? previewText(title, SEO_SHOWN.title) : "Standard title for this page"}
      </p>
      <p className="break-all text-xs text-emerald-700 dark:text-emerald-400">{host.replace(/\/$/, "")}</p>
      <p className={cn("mt-0.5 text-[13px]", description ? "text-muted-foreground" : "italic text-muted-foreground")}>
        {description ? previewText(description, SEO_SHOWN.description) : "Standard description for this page"}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- featured */

const featuredSchema = z.object({ mode: z.enum(["manual", "popular", "rated"]) });
type FeaturedValues = z.input<typeof featuredSchema>;

export function FeaturedForm({ initial, origin }: { initial: { mode: FeaturedMode }; origin: string }) {
  const form = useForm<FeaturedValues>({ resolver: zodResolver(featuredSchema), defaultValues: initial });
  const { onSubmit, pending, formError } = useSectionSave({
    section: "featured",
    form,
    toInput: (values) => values,
    fromSaved: (saved) => saved as FeaturedValues,
    errorPath: objectErrorPath,
    success: "Featured tours setting saved",
  });
  const mode = useWatch({ control: form.control, name: "mode" });

  return (
    <SectionCard
      id="section-featured"
      title="Featured tours"
      description="Which tours the home page shows under “Featured experiences”."
      onSubmit={onSubmit}
      pending={pending}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset()}
      formError={formError}
      rootError={form.formState.errors.root?.message}
      origin={origin}
      path="/"
      saveLabel="Save featured tours"
    >
      <Field label="Home page featured tours" hint={FEATURED_MODES.find((option) => option.value === mode)?.hint} error={form.formState.errors.mode?.message ?? null}>
        {(control) => (
          <select {...control} {...form.register("mode")} className="select sm:max-w-sm">
            {FEATURED_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </Field>
    </SectionCard>
  );
}

/* ----------------------------------------------------------------- footer */

export function FooterForm({ initial, origin }: { initial: { blurb: string }; origin: string }) {
  const form = useForm<{ blurb: string }>({ resolver: zodResolver(footerSchema), defaultValues: initial });
  const { onSubmit, pending, formError } = useSectionSave({
    section: "footer",
    form,
    toInput: (values) => values,
    fromSaved: (saved) => saved as { blurb: string },
    errorPath: objectErrorPath,
    success: "Footer saved",
  });
  return (
    <SectionCard
      id="section-footer"
      title="Footer"
      description="The short description in the footer of every page."
      onSubmit={onSubmit}
      pending={pending}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset()}
      formError={formError}
      rootError={form.formState.errors.root?.message}
      origin={origin}
      path="/"
      saveLabel="Save footer"
    >
      <CountedField form={form} name="blurb" label="Footer description" max={FOOTER_LIMIT} multiline rows={3} hint={PLAIN_TEXT_HINT} placeholder="Private and small-group journeys, guided by a local." />
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ legal */

export function LegalForm({ initial, origin }: { initial: { privacy: string; terms: string }; origin: string }) {
  const form = useForm<{ privacy: string; terms: string }>({ resolver: zodResolver(legalSchema), defaultValues: initial });
  const { onSubmit, pending, formError } = useSectionSave({
    section: "legal",
    form,
    toInput: (values) => values,
    fromSaved: (saved) => saved as { privacy: string; terms: string },
    errorPath: objectErrorPath,
    success: "Legal pages saved",
  });
  return (
    <SectionCard
      id="section-legal"
      title="Privacy policy and terms"
      description="The text of your Privacy and Terms pages. Write in plain paragraphs; leave an empty line between them."
      onSubmit={onSubmit}
      pending={pending}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset()}
      formError={formError}
      rootError={form.formState.errors.root?.message}
      origin={origin}
      path="/privacy"
      viewLabel="View privacy page"
      saveLabel="Save legal pages"
      extraLinks={
        <a href={storefrontUrl(origin, "/terms")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-[13px] font-semibold text-primary underline-offset-4 hover:underline">
          View terms page
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      }
    >
      <CountedField form={form} name="privacy" label="Privacy policy" max={LEGAL_LIMIT} multiline rows={12} hint={`${PLAIN_TEXT_HINT} Headings and bold text from a word processor are not kept.`} />
      <CountedField form={form} name="terms" label="Terms and conditions" max={LEGAL_LIMIT} multiline rows={12} hint={PLAIN_TEXT_HINT} />
    </SectionCard>
  );
}
