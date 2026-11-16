"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { updateContactAction } from "@/app/workspace/settings/actions";
import { Field, FormError } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import { errorFor, hasFieldError } from "./errors";
import { SaveBar, useUnsavedChanges } from "./save-bar";

// The same shapes the server accepts, so most mistakes show up while typing.
const HANDLE = /^@?[A-Za-z0-9._-]{1,80}$/;
const WEB_ADDRESS = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:\/[^\s<>"'`]*)?$/i;

const socialLink = z
  .string()
  .trim()
  .max(200, "Keep this under 200 characters.")
  .refine((value) => value === "" || HANDLE.test(value) || WEB_ADDRESS.test(value), "Use a profile name or a web address.");

const contactSchema = z.object({
  email: z
    .string()
    .trim()
    .refine((value) => value === "" || z.email().safeParse(value).success, "Enter a valid email address."),
  phone: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\+?[0-9][0-9 ()./-]{4,28}$/.test(value), "Enter a phone number."),
  address: z.string().trim().max(300, "Keep this under 300 characters."),
  website: z
    .string()
    .trim()
    .max(200, "Keep this under 200 characters.")
    .refine((value) => value === "" || WEB_ADDRESS.test(value), "Enter a web address such as https://example.com."),
  social: z.object({
    instagram: socialLink,
    youtube: socialLink,
    facebook: socialLink,
    tiktok: socialLink,
    whatsapp: z
      .string()
      .trim()
      .refine((value) => value === "" || /^\+?[0-9][0-9 ()-]{5,23}$/.test(value), "Use a phone number with its country code."),
  }),
});
export type ContactValues = z.infer<typeof contactSchema>;

type SocialKey = keyof ContactValues["social"];
const SOCIAL_FIELDS: { key: SocialKey; label: string; placeholder: string; hint?: string }[] = [
  { key: "instagram", label: "Instagram", placeholder: "@yourname" },
  { key: "youtube", label: "YouTube", placeholder: "youtube.com/@yourname" },
  { key: "facebook", label: "Facebook", placeholder: "facebook.com/yourpage" },
  { key: "tiktok", label: "TikTok", placeholder: "@yourname" },
  { key: "whatsapp", label: "WhatsApp number", placeholder: "+44 7700 900123", hint: "With the country code. Powers the WhatsApp buttons on your site." },
];
const FIELDS = ["email", "phone", "address", "website", ...SOCIAL_FIELDS.map((field) => `social.${field.key}`), "social"];

/** How travellers reach the business: header, footer, contact page and WhatsApp buttons. */
export function ContactForm({ initial }: { initial: ContactValues }) {
  const form = useForm<ContactValues>({ resolver: zodResolver(contactSchema), defaultValues: initial });
  const { errors, isDirty } = form.formState;
  const { run, pending, error, fieldErrors } = useAction(updateContactAction, {
    success: "Contact details saved",
    toastError: false,
    onSuccess: (saved) => form.reset(saved),
  });
  useUnsavedChanges(isDirty);

  const message = (name: Exclude<keyof ContactValues, "social">) => errors[name]?.message ?? errorFor(fieldErrors, name);
  const socialMessage = (key: SocialKey) => errors.social?.[key]?.message ?? errorFor(fieldErrors, `social.${key}`);
  const formLevel = error && !hasFieldError(fieldErrors, FIELDS) ? error : null;
  const socialGroup = errorFor(fieldErrors, "social") && !SOCIAL_FIELDS.some((field) => socialMessage(field.key)) ? errorFor(fieldErrors, "social") : null;

  return (
    <form onSubmit={form.handleSubmit((values) => run(values))} noValidate className="flex max-w-4xl flex-col gap-6">
      <FormError message={formLevel} />
      <section className="card" aria-labelledby="contact-details">
        <div className="card-header">
          <h2 id="contact-details" className="card-title">
            Contact details
          </h2>
          <p className="card-description">Used in the header, footer and contact page. Enquiry alerts go to this e-mail address too.</p>
        </div>
        <div className="card-content flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="E-mail" note="optional" error={message("email")}>
              {(control) => <input {...control} {...form.register("email")} className="input" type="email" inputMode="email" autoComplete="email" spellCheck={false} />}
            </Field>
            <Field label="Phone" note="optional" error={message("phone")}>
              {(control) => <input {...control} {...form.register("phone")} className="input" type="tel" inputMode="tel" autoComplete="tel" />}
            </Field>
          </div>
          <Field label="Website" note="optional" hint="Another site of yours, if you have one." error={message("website")}>
            {(control) => (
              <input {...control} {...form.register("website")} className="input" inputMode="url" autoComplete="url" spellCheck={false} placeholder="https://example.com" />
            )}
          </Field>
          <Field label="Address" note="optional" error={message("address")}>
            {(control) => <textarea {...control} {...form.register("address")} rows={2} className="textarea" autoComplete="street-address" />}
          </Field>
        </div>
      </section>

      <section className="card" aria-labelledby="contact-social">
        <div className="card-header">
          <h2 id="contact-social" className="card-title">
            Social profiles
          </h2>
          <p className="card-description">A profile name or a full link. Leave a field empty to hide that icon.</p>
        </div>
        <div className="card-content flex flex-col gap-4">
          {socialGroup ? (
            <span role="alert" className="field-error">
              {socialGroup}
            </span>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SOCIAL_FIELDS.map((field) => (
              <Field key={field.key} label={field.label} hint={field.hint} error={socialMessage(field.key)}>
                {(control) => (
                  <input
                    {...control}
                    {...form.register(`social.${field.key}`)}
                    className="input"
                    placeholder={field.placeholder}
                    inputMode={field.key === "whatsapp" ? "tel" : undefined}
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </Field>
            ))}
          </div>
        </div>
      </section>

      <SaveBar dirty={isDirty} pending={pending} onDiscard={() => form.reset(initial)} saveLabel="Save contact details" savedMessage="Your contact details are saved." />
    </form>
  );
}
