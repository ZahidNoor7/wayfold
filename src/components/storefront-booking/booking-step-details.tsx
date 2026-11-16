"use client";

import { Check } from "lucide-react";
import { useId, useMemo } from "react";
import type { UseFormRegister } from "react-hook-form";
import { Field } from "@/components/form";
import { CONTACT_METHODS, countries, dialCodeOf, diallingCodes, type BookingDraft, type ContactMethod, type DetailsErrors } from "@/lib/booking-form";

interface BookingStepDetailsProps {
  draft: BookingDraft;
  register: UseFormRegister<BookingDraft>;
  /** Runs on every keystroke in a registered field: clears stale server messages. */
  onEdit: () => void;
  onChange: (patch: Partial<BookingDraft>) => void;
  errors: DetailsErrors & Partial<Record<"country" | "language" | "pickup" | "notes" | "contactMethod", string>>;
  /** Languages the business guides in; the field is left out when none are listed. */
  languages: string[];
  /** "Personal discount found for this email: 10% off", once the server has matched one. */
  emailNote: string | null;
}

/** Step 2: who is travelling and how to reach them. */
export function BookingStepDetails({ draft, register, onEdit, onChange, errors, languages, emailNote }: BookingStepDetailsProps) {
  const ids = useId();
  const countryList = useMemo(() => countries(), []);
  const codes = useMemo(() => diallingCodes(countryList), [countryList]);
  const field = (name: "name" | "email" | "phone" | "pickup" | "notes") => register(name, { onChange: onEdit });

  function onCountry(country: string) {
    const dial = dialCodeOf(countryList, country);
    // The calling code follows the country until the visitor has typed a number of their own.
    onChange(dial && (!draft.phoneCode || !draft.phone.trim()) ? { country, phoneCode: dial } : { country });
  }

  return (
    <>
      <Field label="Full name" error={errors.name}>
        {(control) => <input {...control} {...field("name")} className="input" autoComplete="name" maxLength={120} />}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Field label="Email address" error={errors.email}>
            {(control) => (
              <input {...control} {...field("email")} className="input" type="email" inputMode="email" autoComplete="email" spellCheck={false} autoCapitalize="none" maxLength={254} />
            )}
          </Field>
          {emailNote ? (
            <span role="status" className="flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2 text-[13px] font-semibold text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200">
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {emailNote}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-phone`} className="label">
            Phone number
          </label>
          <div className="flex gap-2">
            <select
              className="select w-28 shrink-0"
              aria-label="Country calling code"
              autoComplete="tel-country-code"
              value={draft.phoneCode}
              onChange={(event) => onChange({ phoneCode: event.target.value })}
            >
              <option value="">Code</option>
              {codes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <input
              id={`${ids}-phone`}
              {...field("phone")}
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              maxLength={32}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? `${ids}-phone-error` : undefined}
            />
          </div>
          {errors.phone ? (
            <span id={`${ids}-phone-error`} role="alert" className="field-error">
              {errors.phone}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Country" note="(optional)" error={errors.country}>
          {(control) => (
            <select {...control} className="select" autoComplete="country-name" value={draft.country} onChange={(event) => onCountry(event.target.value)}>
              <option value="">Choose a country</option>
              {countryList.map((country) => (
                <option key={country.code} value={country.name}>
                  {country.name}
                </option>
              ))}
              <option value="Other">Other</option>
            </select>
          )}
        </Field>
        {languages.length > 0 ? (
          <Field label="Preferred language" note="(optional)" error={errors.language}>
            {(control) => (
              <select {...control} className="select" value={draft.language} onChange={(event) => onChange({ language: event.target.value })}>
                <option value="">No preference</option>
                {languages.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </div>

      <Field label="Pickup location" note="(optional)" error={errors.pickup} hint="A hotel or an address, if you would like to be collected.">
        {(control) => <input {...control} {...field("pickup")} className="input" maxLength={200} autoComplete="off" />}
      </Field>

      <fieldset>
        <legend className="label mb-3">Preferred contact method</legend>
        <div className="flex flex-wrap gap-2">
          {CONTACT_METHODS.map((method) => (
            <label
              key={method.value}
              className="chip cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="radio"
                name={`${ids}-method`}
                value={method.value}
                className="sr-only"
                checked={draft.contactMethod === method.value}
                onChange={() => onChange({ contactMethod: method.value as ContactMethod })}
              />
              {method.label}
            </label>
          ))}
        </div>
        {errors.contactMethod ? (
          <span role="alert" className="field-error mt-2 block">
            {errors.contactMethod}
          </span>
        ) : null}
      </fieldset>

      <Field label="Special requests" note="(optional)" error={errors.notes}>
        {(control) => <textarea {...control} {...field("notes")} className="textarea" rows={4} maxLength={2000} placeholder="Dietary needs, celebrations, mobility, interests…" />}
      </Field>
    </>
  );
}
