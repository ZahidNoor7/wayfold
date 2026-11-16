"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { changePasswordAction, signOutOthersAction, updateNameAction } from "@/app/workspace/account/actions";
import { Field, FormError, SubmitButton } from "@/components/form";
import { ConfirmDialog } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { applyServerErrors } from "./form-utils";
import { PasswordInput } from "./password-input";

const nameSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80, "Keep your name under 80 characters."),
});
type NameValues = z.infer<typeof nameSchema>;

export function ProfileNameForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const form = useForm<NameValues>({ resolver: zodResolver(nameSchema), defaultValues: { name } });
  const { run, pending } = useAction(updateNameAction, { toastError: false, success: "Name updated" });
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await run(values);
    if (result.ok) {
      form.reset({ name: result.data.name });
      // The name also appears in the workspace menu.
      router.refresh();
      return;
    }
    if (applyServerErrors(form, result.fieldErrors, ["name"])) return;
    setFormError(result.error);
    form.setFocus("name");
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <FormError message={formError} />
      <Field label="Your name" error={form.formState.errors.name?.message} hint="Shown to your team and on notes and actions you take.">
        {(control) => <input {...control} {...form.register("name")} className="input" autoComplete="name" />}
      </Field>
      <div className="flex flex-col gap-2">
        <span className="label">Sign-in e-mail</span>
        <p className="break-all text-sm">{email}</p>
        <p className="field-hint">Your sign-in address cannot be changed here.</p>
      </div>
      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…" disabled={!form.formState.isDirty}>
          Save changes
        </SubmitButton>
      </div>
    </form>
  );
}

interface PasswordValues {
  current: string;
  next: string;
}

export function ChangePasswordForm({ email, minPasswordLength }: { email: string; minPasswordLength: number }) {
  const schema = useMemo(
    () =>
      z
        .object({
          current: z.string().min(1, "Enter your current password."),
          next: z.string().min(minPasswordLength, `Use at least ${minPasswordLength} characters.`),
        })
        .refine((values) => values.current !== values.next, { path: ["next"], message: "Choose a password you are not already using." }),
    [minPasswordLength],
  );
  const form = useForm<PasswordValues>({ resolver: zodResolver(schema), defaultValues: { current: "", next: "" } });
  const { run, pending } = useAction(changePasswordAction, { toastError: false, success: "Password changed" });
  const [formError, setFormError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setChanged(false);
    const result = await run(values);
    if (result.ok) {
      form.reset({ current: "", next: "" });
      setChanged(true);
      return;
    }
    if (applyServerErrors(form, result.fieldErrors, ["current", "next"])) return;
    setFormError(result.error);
    form.setFocus("current");
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <FormError message={formError} />
      {changed ? (
        <p role="status" className="alert">
          Password changed. Every other device was signed out; this one stays signed in.
        </p>
      ) : null}
      {/* Tells password managers which account the new password belongs to. */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field label="Current password" error={errors.current?.message}>
        {(control) => <PasswordInput {...control} {...form.register("current")} autoComplete="current-password" />}
      </Field>
      <Field label="New password" error={errors.next?.message} hint={`At least ${minPasswordLength} characters. A few unrelated words work well.`}>
        {(control) => <PasswordInput {...control} {...form.register("next")} autoComplete="new-password" />}
      </Field>
      <div>
        <SubmitButton pending={pending} pendingLabel="Changing…">
          Change password
        </SubmitButton>
      </div>
    </form>
  );
}

export function SignOutOthers({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const { run, pending } = useAction(signOutOthersAction, { success: "Signed out everywhere else" });

  return (
    <div className="flex flex-col gap-4">
      {done ? (
        <p role="status" className="alert">
          Every other session has been ended. Only this device is signed in.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>
          Sign out everywhere else
        </button>
        {children}
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Sign out everywhere else?"
        description="Every other browser and device signed in to your account will have to sign in again. This device stays signed in."
        confirmLabel="Sign out other sessions"
        pending={pending}
        onConfirm={async () => {
          const result = await run({});
          setOpen(false);
          setDone(result.ok);
        }}
      />
    </div>
  );
}
