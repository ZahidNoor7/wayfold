"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { resetPasswordAction } from "@/app/(auth)/actions";
import { Field, SubmitButton } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import { TEXT_LINK } from "./auth-card";
import { leaveTo } from "./clear-caches";
import { applyServerErrors } from "./form-utils";
import { loginPathWithNotice } from "./login-notices";
import { PasswordInput } from "./password-input";

interface Values {
  password: string;
}

export function ResetPasswordForm({ token, minPasswordLength }: { token: string; minPasswordLength: number }) {
  const schema = useMemo(
    () => z.object({ password: z.string().min(minPasswordLength, `Use at least ${minPasswordLength} characters.`) }),
    [minPasswordLength],
  );
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "" } });
  const { run, pending } = useAction(resetPasswordAction, { toastError: false });
  const [failure, setFailure] = useState<{ message: string; expired: boolean } | null>(null);
  const [leaving, setLeaving] = useState(false);

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null);
    const result = await run({ token, password: values.password });
    if (result.ok) {
      // Every session was signed out with the old password: start clean.
      setLeaving(true);
      await leaveTo(loginPathWithNotice("password-reset"));
      return;
    }
    if (applyServerErrors(form, result.fieldErrors, ["password"])) return;
    setFailure({ message: result.error, expired: result.code === "invalid_token" });
    form.setFocus("password");
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {failure ? (
        <div role="alert" className="alert alert-destructive">
          {failure.message}{" "}
          {failure.expired ? (
            <Link href="/forgot-password" className="font-semibold underline underline-offset-4">
              Send a new link
            </Link>
          ) : null}
        </div>
      ) : null}
      {/* Lets password managers file the new password under the right account. */}
      <Field
        label="New password"
        error={form.formState.errors.password?.message}
        hint={`At least ${minPasswordLength} characters. A few unrelated words work well.`}
      >
        {(control) => <PasswordInput {...control} {...form.register("password")} autoComplete="new-password" autoFocus />}
      </Field>
      <SubmitButton pending={pending || leaving} pendingLabel="Saving…" className="btn-lg w-full">
        Save new password
      </SubmitButton>
      <p className="text-center text-sm text-muted-foreground">
        Saving signs you out on every device.{" "}
        <Link href="/login" className={TEXT_LINK}>
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
