"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { updateCustomerAction } from "@/app/workspace/customers/actions";
import { Field, firstError, FormError, SubmitButton } from "@/components/form";
import { useAction } from "@/hooks/use-action";

// Immediate feedback only; the server validates again with its own schema.
const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's full name.").max(120, "Keep the name under 120 characters."),
  email: z.string().trim().max(254, "Enter a valid email, e.g. name@example.com.").pipe(z.email("Enter a valid email, e.g. name@example.com.")),
  phone: z.string().trim().max(40, "Keep the phone number under 40 characters."),
  country: z.string().trim().max(80, "Keep the country under 80 characters."),
  language: z.string().trim().max(40, "Keep the language under 40 characters."),
});
type ProfileValues = z.infer<typeof profileSchema>;

interface CustomerProfileFormProps {
  customer: { id: string } & ProfileValues;
}

/** Edits who the customer is. Past bookings keep the details entered when they were made. */
export function CustomerProfileForm({ customer }: CustomerProfileFormProps) {
  const { id, ...defaults } = customer;
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: defaults });
  const { errors, isDirty } = form.formState;

  const { run, pending, error, fieldErrors } = useAction(updateCustomerAction, {
    success: "Profile saved",
    toastError: false,
    onSuccess: (saved) => form.reset({ name: saved.name, email: saved.email, phone: saved.phone, country: saved.country, language: saved.language }),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await run({ id, ...values });
    // The address belongs to another profile: say so at the field, not only above the form.
    if (!result.ok && result.code === "email_taken") form.setError("email", { message: result.error }, { shouldFocus: true });
  });

  const message = (name: keyof ProfileValues) => errors[name]?.message ?? firstError(fieldErrors, name);
  const formLevel = error && !fieldErrors && !errors.email ? error : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError message={formLevel} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={message("name")}>
          {(control) => <input {...control} {...form.register("name")} className="input" autoComplete="off" />}
        </Field>
        <Field label="Email" error={message("email")}>
          {(control) => <input {...control} {...form.register("email")} className="input" type="email" inputMode="email" autoComplete="off" spellCheck={false} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Phone" note="optional" error={message("phone")}>
          {(control) => <input {...control} {...form.register("phone")} className="input" type="tel" inputMode="tel" autoComplete="off" />}
        </Field>
        <Field label="Country" note="optional" error={message("country")}>
          {(control) => <input {...control} {...form.register("country")} className="input" autoComplete="off" />}
        </Field>
        <Field label="Language" note="optional" error={message("language")}>
          {(control) => <input {...control} {...form.register("language")} className="input" autoComplete="off" />}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={pending} pendingLabel="Saving…" disabled={!isDirty}>
          Save profile
        </SubmitButton>
        <p className="field-hint">Bookings already made keep the contact details entered at the time.</p>
      </div>
    </form>
  );
}
