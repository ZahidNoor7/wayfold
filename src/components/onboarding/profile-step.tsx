"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { saveOnboardingProfileAction } from "@/app/onboarding/actions";
import { applyServerErrors } from "@/components/auth/form-utils";
import { Field, FormError, SubmitButton } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import { addRegions, languageChoices, MAX_LANGUAGES, MAX_REGIONS, toggleLanguage } from "./languages";

export interface ProfileValues {
  tagline: string;
  description: string;
  email: string;
  phone: string;
  address: string;
  currency: string;
  timezone: string;
  languages: string[];
  regions: string[];
}

const schema = z.object({
  tagline: z.string().trim().max(160, "Keep this under 160 characters."),
  description: z.string().trim().max(2000, "Keep this under 2,000 characters."),
  email: z.string().trim().pipe(z.union([z.literal(""), z.email("Enter a valid e-mail address.")])),
  phone: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\+?[0-9][0-9 ()./-]{4,28}$/.test(value), "Enter a phone number, with its country code if you have guests from abroad."),
  address: z.string().trim().max(300, "Keep this under 300 characters."),
  currency: z.string().min(1, "Choose a currency."),
  timezone: z.string().min(1, "Choose a time zone."),
  languages: z.array(z.string()).min(1, "Keep at least one language."),
  regions: z.array(z.string()),
});

const ORDER = ["tagline", "description", "email", "phone", "address", "currency", "timezone"] as const;

interface ProfileStepProps {
  initial: ProfileValues;
  currencies: { code: string; name: string }[];
  timezones: string[];
  /** Offer this browser's time zone in place of the default. Only before anything was saved. */
  detectTimezone: boolean;
  onSaved: (values: ProfileValues) => void;
  onSkip: () => void;
}

export function ProfileStep({ initial, currencies, timezones, detectTimezone, onSaved, onSkip }: ProfileStepProps) {
  const form = useForm<ProfileValues>({ resolver: zodResolver(schema), defaultValues: initial });
  const { run, pending } = useAction(saveOnboardingProfileAction, { toastError: false, success: "Business profile saved" });
  const [formError, setFormError] = useState<string | null>(null);
  const [regionDraft, setRegionDraft] = useState("");
  const languagesLabel = useId();
  const regionsId = useId();
  const { errors } = form.formState;

  const languages = useWatch({ control: form.control, name: "languages" });
  const regions = useWatch({ control: form.control, name: "regions" });
  const descriptionLength = useWatch({ control: form.control, name: "description" }).length;

  // A new workspace is on UTC: offer the zone this browser is in instead.
  useEffect(() => {
    if (!detectTimezone) return;
    try {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (local && timezones.includes(local)) form.setValue("timezone", local);
    } catch {
      // No zone information: UTC stays selected.
    }
  }, [form, detectTimezone, timezones]);

  function commitRegions() {
    if (!regionDraft.trim()) return;
    form.setValue("regions", addRegions(form.getValues("regions"), regionDraft), { shouldDirty: true });
    setRegionDraft("");
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    // Anything still typed in the regions box counts.
    const withDraft = { ...values, regions: addRegions(values.regions, regionDraft) };
    // The select only offers supported currencies; the server checks it again.
    const result = await run(withDraft as Parameters<typeof saveOnboardingProfileAction>[0]);
    if (result.ok) {
      onSaved(withDraft);
      return;
    }
    const fieldErrors = result.fieldErrors;
    if (fieldErrors?.languages) form.setError("languages", { type: "server", message: fieldErrors.languages[0] });
    if (fieldErrors?.regions) form.setError("regions", { type: "server", message: fieldErrors.regions[0] });
    if (applyServerErrors(form, fieldErrors, ORDER)) return;
    if (fieldErrors?.languages || fieldErrors?.regions) {
      if (fieldErrors.regions) document.getElementById(regionsId)?.focus();
      return;
    }
    setFormError(result.error);
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      <FormError message={formError} />

      <Field label="Tagline" note="optional" error={errors.tagline?.message} hint="One line under your name, such as what you do and where.">
        {(control) => <input {...control} {...form.register("tagline")} className="input" maxLength={160} />}
      </Field>

      <Field label="About your business" note="optional" error={errors.description?.message} hint={`${descriptionLength.toLocaleString("en-US")} / 2,000`}>
        {(control) => <textarea {...control} {...form.register("description")} className="textarea min-h-[120px]" maxLength={2000} />}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Contact e-mail" error={errors.email?.message} hint="Shown on your website. Enquiry alerts go here too.">
          {(control) => (
            <input
              {...control}
              {...form.register("email")}
              type="email"
              className="input"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
            />
          )}
        </Field>
        <Field label="Phone" note="optional" error={errors.phone?.message}>
          {(control) => <input {...control} {...form.register("phone")} type="tel" className="input" autoComplete="tel" inputMode="tel" />}
        </Field>
      </div>

      <Field label="Address" note="optional" error={errors.address?.message} hint="Where you are based, or where tours usually start.">
        {(control) => <textarea {...control} {...form.register("address")} className="textarea min-h-[72px]" autoComplete="street-address" maxLength={300} />}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Currency" error={errors.currency?.message} hint="Tour prices are shown in this currency.">
          {(control) => (
            <select {...control} {...form.register("currency")} className="select">
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} · {currency.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Time zone" error={errors.timezone?.message} hint="Used for tour dates and booking deadlines.">
          {(control) => (
            <select {...control} {...form.register("timezone")} className="select">
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <span id={languagesLabel} className="label">
          Languages you guide in
        </span>
        <div role="group" aria-labelledby={languagesLabel} className="flex flex-wrap gap-2">
          {languageChoices(initial.languages).map((language) => {
            const selected = languages.includes(language.code);
            return (
              <button
                key={language.code}
                type="button"
                className="chip"
                aria-pressed={selected}
                disabled={!selected && languages.length >= MAX_LANGUAGES}
                onClick={() => {
                  form.setValue("languages", toggleLanguage(form.getValues("languages"), language.code), { shouldDirty: true });
                  form.clearErrors("languages");
                }}
              >
                {language.name}
              </button>
            );
          })}
        </div>
        {errors.languages?.message ? (
          <span role="alert" className="field-error">
            {errors.languages.message}
          </span>
        ) : (
          <span className="field-hint">At least one. Guests see these on your website.</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={regionsId} className="label">
          Regions you cover
          <span className="ml-1.5 font-normal text-muted-foreground">optional</span>
        </label>
        <div className="flex gap-2">
          <input
            id={regionsId}
            className="input min-w-0"
            value={regionDraft}
            aria-invalid={Boolean(errors.regions)}
            aria-describedby={`${regionsId}-hint`}
            disabled={regions.length >= MAX_REGIONS}
            onChange={(event) => setRegionDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              // Enter adds the region instead of submitting the whole step.
              event.preventDefault();
              commitRegions();
            }}
          />
          <button type="button" className="btn btn-outline h-11 shrink-0" onClick={commitRegions} disabled={!regionDraft.trim()}>
            <Plus aria-hidden="true" />
            Add
          </button>
        </div>
        {errors.regions?.message ? (
          <span role="alert" className="field-error">
            {errors.regions.message}
          </span>
        ) : null}
        <span id={`${regionsId}-hint`} className="field-hint">
          Cities or areas, one at a time or separated by commas.
        </span>
        {regions.length > 0 ? (
          <ul aria-label="Regions added" className="flex flex-wrap gap-2">
            {regions.map((region) => (
              <li key={region} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-secondary/60 py-1 pl-3.5 pr-1 text-sm font-medium">
                <span className="min-w-0 truncate">{region}</span>
                <button
                  type="button"
                  className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors after:absolute after:-inset-1.5 hover:bg-accent hover:text-foreground"
                  aria-label={`Remove ${region}`}
                  onClick={() => {
                    form.setValue(
                      "regions",
                      form.getValues("regions").filter((item) => item !== region),
                      { shouldDirty: true },
                    );
                    form.clearErrors("regions");
                  }}
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-ghost btn-lg" onClick={onSkip} disabled={pending}>
          Skip for now
        </button>
        <SubmitButton pending={pending} pendingLabel="Saving…" className="btn-lg">
          Save and continue
        </SubmitButton>
      </div>
    </form>
  );
}
