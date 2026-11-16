"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { registerAction } from "@/app/(auth)/actions";
import { Field, FormError, SubmitButton } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import { AuthCard, TEXT_LINK } from "./auth-card";
import { applyServerErrors } from "./form-utils";
import { PasswordInput } from "./password-input";
import { withNext } from "./safe-next";

interface Values {
  name: string;
  email: string;
  password: string;
  terms: boolean;
}

function buildSchema(minPasswordLength: number) {
  return z.object({
    name: z.string().trim().min(2, "Enter your name.").max(80, "Keep your name under 80 characters."),
    email: z.string().trim().min(1, "Enter your e-mail address.").pipe(z.email("Enter a valid e-mail address.")),
    password: z.string().min(minPasswordLength, `Use at least ${minPasswordLength} characters.`),
    terms: z.boolean().refine((value) => value, "Accept the terms to create your account."),
  });
}

interface RegisterFormProps {
  /** Absolute links to Wayfold's terms and privacy pages on the marketing site. */
  legal: { terms: string; privacy: string };
  minPasswordLength: number;
  /** Already checked on the server. Carried to sign-in after confirmation. */
  next: string | null;
  defaultEmail?: string;
  /** Workspace name when arriving from an invitation. */
  invitedTo?: string | null;
  /** Shown above the form, e.g. the invitation summary. */
  notice?: ReactNode;
}

export function RegisterForm({ minPasswordLength, next, defaultEmail = "", invitedTo = null, notice, legal }: RegisterFormProps) {
  const schema = useMemo(() => buildSchema(minPasswordLength), [minPasswordLength]);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "", email: defaultEmail, password: "", terms: false } });
  const { run, pending } = useAction(registerAction, { toastError: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const termsId = useId();
  const { errors } = form.formState;
  const passwordLength = useWatch({ control: form.control, name: "password" }).length;
  const signInHref = withNext("/login", next);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await run({ name: values.name, email: values.email, password: values.password, terms: true });
    if (result.ok) {
      setSentTo(values.email.trim());
      return;
    }
    if (applyServerErrors(form, result.fieldErrors, ["name", "email", "password", "terms"])) return;
    setFormError(result.error);
    form.setFocus("name");
  });

  if (sentTo) {
    return (
      <AuthCard
        announce
        mark={<MailCheck aria-hidden="true" />}
        title="Check your inbox"
        description={
          <>
            If <strong className="break-all font-semibold text-foreground">{sentTo}</strong> can be used for a new account, a confirmation link is on its way. It
            works once and expires in 24 hours.
          </>
        }
      >
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
          {invitedTo
            ? `After confirming, sign in from this page, or open the invitation link again, to join ${invitedTo}.`
            : "Nothing after a few minutes? Check your spam folder, or sign in and we can send the link again."}
        </p>
        <Link href={signInHref} className="btn btn-default btn-lg mt-7 w-full">
          Go to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      description={invitedTo ? `Set up your account to join ${invitedTo}.` : "One account for every workspace you run or belong to."}
      footer={
        <>
          Already have an account?{" "}
          <Link href={signInHref} className={TEXT_LINK}>
            Sign in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        {notice}
        <FormError message={formError} />
        <Field label="Your name" error={errors.name?.message}>
          {(control) => <input {...control} {...form.register("name")} className="input" autoComplete="name" autoFocus />}
        </Field>
        <Field
          label="E-mail"
          error={errors.email?.message}
          hint={invitedTo ? "Use the address your invitation was sent to." : "You will confirm this address before signing in."}
        >
          {(control) => (
            <input
              {...control}
              {...form.register("email")}
              type="email"
              className="input"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
            />
          )}
        </Field>
        <Field
          label="Password"
          error={errors.password?.message}
          hint={
            passwordLength > 0 && passwordLength < minPasswordLength
              ? `At least ${minPasswordLength} characters: ${minPasswordLength - passwordLength} more to go.`
              : `At least ${minPasswordLength} characters. A few unrelated words work well.`
          }
        >
          {(control) => <PasswordInput {...control} {...form.register("password")} autoComplete="new-password" />}
        </Field>

        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-3">
            <input
              id={termsId}
              type="checkbox"
              className="checkbox mt-0.5 size-5"
              aria-invalid={Boolean(errors.terms)}
              aria-describedby={errors.terms ? `${termsId}-error` : undefined}
              {...form.register("terms")}
            />
            <label htmlFor={termsId} className="text-sm leading-relaxed text-foreground/85">
              I agree to Wayfold&rsquo;s{" "}
              <a href={legal.terms} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                terms of service
              </a>{" "}
              and{" "}
              <a href={legal.privacy} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                privacy policy
              </a>
              .
            </label>
          </div>
          {errors.terms ? (
            <span id={`${termsId}-error`} role="alert" className="field-error">
              {errors.terms.message}
            </span>
          ) : null}
        </div>

        <SubmitButton pending={pending} pendingLabel="Creating your account…" className="btn-lg w-full">
          Create account
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
