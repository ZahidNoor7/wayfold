"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { loginAction } from "@/app/(auth)/actions";
import { Field, FormError, SubmitButton } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import { TEXT_LINK } from "./auth-card";
import { leaveTo } from "./clear-caches";
import { applyServerErrors } from "./form-utils";
import { PasswordInput } from "./password-input";

const schema = z.object({
  email: z.string().trim().min(1, "Enter your e-mail address.").pipe(z.email("Enter a valid e-mail address.")),
  password: z.string().min(1, "Enter your password."),
});
type Values = z.infer<typeof schema>;

interface LoginFormProps {
  /** Already checked on the server; checked again by the action. */
  next: string | null;
  defaultEmail?: string;
}

export function LoginForm({ next, defaultEmail = "" }: LoginFormProps) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: defaultEmail, password: "" } });
  const { run, pending } = useAction(loginAction, { toastError: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await run({ ...values, ...(next ? { next } : {}) });
    if (result.ok) {
      setLeaving(true);
      await leaveTo(result.data.redirectTo);
      return;
    }
    if (applyServerErrors(form, result.fieldErrors, ["email", "password"])) return;
    setFormError(result.error);
    // Wrong credentials: keep the address, retype the password.
    form.setFocus(result.code === "invalid_credentials" ? "password" : "email", { shouldSelect: true });
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <FormError message={formError} />
      <Field label="E-mail" error={errors.email?.message}>
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
            autoFocus={!defaultEmail}
          />
        )}
      </Field>
      <Field label="Password" error={errors.password?.message}>
        {(control) => <PasswordInput {...control} {...form.register("password")} autoComplete="current-password" autoFocus={Boolean(defaultEmail)} />}
      </Field>
      <div className="-mt-2 text-right text-sm">
        <Link href="/forgot-password" className={TEXT_LINK}>
          Forgot your password?
        </Link>
      </div>
      <SubmitButton pending={pending || leaving} pendingLabel="Signing in…" className="btn-lg w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}
