"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { requestPasswordResetAction } from "@/app/(auth)/actions";
import { Field, FormError, SubmitButton } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import { AuthCard, TEXT_LINK } from "./auth-card";
import { applyServerErrors } from "./form-utils";

const schema = z.object({
  email: z.string().trim().min(1, "Enter your e-mail address.").pipe(z.email("Enter a valid e-mail address.")),
});
type Values = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const { run, pending } = useAction(requestPasswordResetAction, { toastError: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await run(values);
    if (result.ok) {
      setSentTo(values.email.trim());
      return;
    }
    if (applyServerErrors(form, result.fieldErrors, ["email"])) return;
    setFormError(result.error);
    form.setFocus("email");
  });

  if (sentTo) {
    return (
      <AuthCard
        announce
        mark={<MailCheck aria-hidden="true" />}
        title="Check your inbox"
        description={
          <>
            If an account exists for <strong className="break-all font-semibold text-foreground">{sentTo}</strong>, a link to choose a new password is on its way.
            It works once and expires in 1 hour.
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Link href="/login" className="btn btn-default btn-lg w-full">
            Back to sign in
          </Link>
          <button
            type="button"
            className="btn btn-ghost w-full"
            onClick={() => {
              setSentTo(null);
              form.reset({ email: "" });
            }}
          >
            Use a different address
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the e-mail address you sign in with and we will send you a link to choose a new password."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className={TEXT_LINK}>
            Back to sign in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <FormError message={formError} />
        <Field label="E-mail" error={form.formState.errors.email?.message}>
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
              autoFocus
            />
          )}
        </Field>
        <SubmitButton pending={pending} pendingLabel="Sending…" className="btn-lg w-full">
          Send reset link
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
