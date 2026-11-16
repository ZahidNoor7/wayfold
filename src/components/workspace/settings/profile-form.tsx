"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { updateProfileAction } from "@/app/workspace/settings/actions";
import { Field, FormError } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import { errorFor, hasFieldError } from "./errors";
import { SaveBar, useUnsavedChanges } from "./save-bar";
import { TagInput } from "./tag-input";
import { canonicalLanguage, currencyName, languageName } from "./tags";
import { TimezoneCombobox } from "./timezone-combobox";

// Immediate feedback only; the server checks everything again with its own rules.
const profileSchema = z.object({
  name: z.string().trim().min(2, "Add your business name.").max(80, "Keep this under 80 characters."),
  tagline: z.string().trim().max(160, "Keep this under 160 characters."),
  description: z.string().trim().max(2000, "Keep this under 2000 characters."),
  languages: z.array(z.string()).min(1, "Keep at least one language.").max(12, "List up to 12 languages."),
  regions: z.array(z.string().max(80, "Keep each region under 80 characters.")).max(30, "List up to 30 regions."),
  currency: z.string().min(3, "Choose a currency."),
  timezone: z.string().min(1, "Choose a time zone."),
});
type ProfileValues = z.infer<typeof profileSchema>;
const FIELDS = Object.keys(profileSchema.shape) as (keyof ProfileValues)[];

interface ProfileFormProps {
  initial: ProfileValues;
  currencies: readonly string[];
  timezones: readonly string[];
}

/** Who the business is and where it works: shown across the public site. */
export function ProfileForm({ initial, currencies, timezones }: ProfileFormProps) {
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: initial });
  const { errors, isDirty } = form.formState;
  const { run, pending, error, fieldErrors } = useAction(updateProfileAction, {
    success: "Business profile saved",
    toastError: false,
    onSuccess: (saved) => form.reset(saved),
  });
  useUnsavedChanges(isDirty);

  const message = (name: keyof ProfileValues) => errors[name]?.message ?? errorFor(fieldErrors, name);
  const formLevel = error && !hasFieldError(fieldErrors, FIELDS) ? error : null;
  const descriptionLength = useWatch({ control: form.control, name: "description" }).length;

  return (
    <form onSubmit={form.handleSubmit((values) => run(values))} noValidate className="flex max-w-4xl flex-col gap-6">
      <FormError message={formLevel} />
      <section className="card" aria-labelledby="profile-business">
        <div className="card-header">
          <h2 id="profile-business" className="card-title">
            Business profile
          </h2>
          <p className="card-description">Shown on your homepage, About page and in search results.</p>
        </div>
        <div className="card-content flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" error={message("name")}>
              {(control) => <input {...control} {...form.register("name")} className="input" autoComplete="organization" />}
            </Field>
            <Field label="Tagline" note="optional" hint="One short line under your name." error={message("tagline")}>
              {(control) => <input {...control} {...form.register("tagline")} className="input" autoComplete="off" />}
            </Field>
          </div>
          <Field
            label="Description"
            note={`${descriptionLength} / 2000`}
            hint="A few sentences about what you offer and what makes your tours yours."
            error={message("description")}
          >
            {(control) => <textarea {...control} {...form.register("description")} rows={5} className="textarea" />}
          </Field>
        </div>
      </section>

      <section className="card" aria-labelledby="profile-region">
        <div className="card-header">
          <h2 id="profile-region" className="card-title">
            Languages and regions
          </h2>
          <p className="card-description">Which languages you guide in and where your tours run.</p>
        </div>
        <div className="card-content flex flex-col gap-4">
          <Field label="Languages" hint="Type a language code such as en, de or pt-BR and press Enter." error={message("languages")}>
            {(control) => (
              <Controller
                control={form.control}
                name="languages"
                render={({ field }) => (
                  <TagInput
                    control={control}
                    value={field.value}
                    onChange={field.onChange}
                    display={(tag) => `${languageName(tag)} (${tag})`}
                    normalise={canonicalLanguage}
                    max={12}
                    placeholder="Add a language"
                  />
                )}
              />
            )}
          </Field>
          <Field label="Regions" note="optional" hint="Places or areas you cover. Press Enter after each one." error={message("regions")}>
            {(control) => (
              <Controller
                control={form.control}
                name="regions"
                render={({ field }) => (
                  <TagInput control={control} value={field.value} onChange={field.onChange} max={30} placeholder="Add a region" />
                )}
              />
            )}
          </Field>
        </div>
      </section>

      <section className="card" aria-labelledby="profile-money">
        <div className="card-header">
          <h2 id="profile-money" className="card-title">
            Currency and time zone
          </h2>
          <p className="card-description">Prices are shown in this currency. Dates, holds and “today” follow this time zone.</p>
        </div>
        <div className="card-content grid gap-4 sm:grid-cols-2">
          <Field label="Currency" hint="Changing it does not convert prices you have already entered." error={message("currency")}>
            {(control) => (
              <select {...control} {...form.register("currency")} className="select">
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {currencyName(code)} ({code})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Time zone" error={message("timezone")}>
            {(control) => (
              <Controller
                control={form.control}
                name="timezone"
                render={({ field }) => <TimezoneCombobox control={control} zones={timezones} value={field.value} onChange={field.onChange} />}
              />
            )}
          </Field>
        </div>
      </section>

      <SaveBar dirty={isDirty} pending={pending} onDiscard={() => form.reset(initial)} saveLabel="Save profile" savedMessage="Your profile is saved." />
    </form>
  );
}
