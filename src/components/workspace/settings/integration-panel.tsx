"use client";

import { ArrowUpRight, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { saveIntegrationAction } from "@/app/workspace/settings/integrations/actions";
import { Field, FormError } from "@/components/form";
import { Panel, Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import type { FieldSpec, IntegrationView } from "@/server/integrations/types";
import { errorFor } from "./errors";
import { buildIntegrationPayload, checkFieldValues, initialFieldValues, keepSecretHint, type AdapterSpec, type FieldValues } from "./integration-form";

export interface PanelTarget {
  adapter: AdapterSpec;
  /** Present when editing an existing connection. */
  existing: IntegrationView | null;
}

interface IntegrationPanelProps {
  target: PanelTarget | null;
  onClose: () => void;
  canSeeBilling: boolean;
}

/** Connect or edit one provider account. The form is built from the adapter's field list. */
export function IntegrationPanel({ target, onClose, canSeeBilling }: IntegrationPanelProps) {
  const title = target ? (target.existing ? `Edit ${target.adapter.name} connection` : `Connect ${target.adapter.name}`) : "Connection";
  return (
    <Panel open={target !== null} onOpenChange={(open) => !open && onClose()} title={title} description={target?.adapter.description}>
      {/* Mounted per opening, so every form starts from the stored values with empty secrets. */}
      {target ? <ConnectionForm key={target.existing?.id ?? target.adapter.id} target={target} onDone={onClose} canSeeBilling={canSeeBilling} /> : null}
    </Panel>
  );
}

interface FormShape {
  label: string;
  values: FieldValues;
}

function ConnectionForm({ target, onDone, canSeeBilling }: { target: PanelTarget; onDone: () => void; canSeeBilling: boolean }) {
  const { adapter, existing } = target;
  const hints = existing?.secretHints ?? {};
  const form = useForm<FormShape>({
    defaultValues: { label: existing?.label ?? "Default", values: initialFieldValues(adapter.fields, existing?.config) },
  });

  const { run, pending, error, fieldErrors } = useAction(saveIntegrationAction, {
    success: (view) => (existing ? `${view.providerName} connection updated` : `${view.providerName} connected. Test it to make sure it works.`),
    toastError: false,
    onSuccess: onDone,
  });
  const [planMessage, setPlanMessage] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async ({ label, values }) => {
    setPlanMessage(null);
    const problems = checkFieldValues(adapter.fields, values, hints);
    const keys = Object.keys(problems);
    if (keys.length > 0) {
      for (const key of keys) form.setError(`values.${key}`, { message: problems[key] });
      form.setFocus(`values.${keys[0]!}`);
      return;
    }
    const payload = buildIntegrationPayload(adapter.fields, values);
    const result = await run({ ...(existing ? { id: existing.id } : {}), provider: adapter.id, label: label.trim() || "Default", ...payload });
    if (!result.ok && result.code === "plan_limit") setPlanMessage(result.error);
  });

  const fieldMessage = (key: string) => form.formState.errors.values?.[key]?.message ?? errorFor(fieldErrors, key);
  const named = adapter.fields.some((field) => errorFor(fieldErrors, field.key));
  const formLevel = error && !named && !planMessage ? error : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-[calc(100%-4.5rem)] flex-col">
      <div className="flex flex-1 flex-col gap-5 px-5 py-5 sm:px-6">
        <p className="text-sm text-muted-foreground">
          Values are encrypted as soon as you save, and only masked hints are shown afterwards.
          {existing ? " Leave a secret field blank to keep its current value." : ""}
        </p>
        {planMessage ? (
          <div role="alert" className="alert alert-warning flex flex-col gap-2">
            <p>{planMessage}</p>
            {canSeeBilling ? (
              <Link href="/workspace/billing" className="font-semibold underline underline-offset-4">
                See plans
              </Link>
            ) : (
              <p>Ask the workspace owner to upgrade the plan.</p>
            )}
          </div>
        ) : null}
        <FormError message={formLevel} />

        <Field label="Connection name" hint="Helps you tell connections apart, e.g. “Main account”." error={form.formState.errors.label?.message ?? null}>
          {(control) => (
            <input
              {...control}
              {...form.register("label", { maxLength: { value: 60, message: "Keep the name under 60 characters." } })}
              className="input"
              autoComplete="off"
            />
          )}
        </Field>

        {adapter.fields.map((field) => (
          <AdapterField key={field.key} field={field} form={form} error={fieldMessage(field.key)} hint={hints[field.key]} />
        ))}

        {adapter.docsUrl ? (
          <a href={adapter.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-eyebrow underline-offset-4 hover:underline">
            Where to find these details in {adapter.name}’s documentation
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </a>
        ) : null}
      </div>

      <div className="safe-b sticky bottom-0 flex flex-col-reverse gap-2 border-t bg-background/95 px-5 pt-3 backdrop-blur sm:flex-row sm:justify-end sm:px-6">
        <button type="button" className="btn btn-outline" onClick={onDone} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="btn btn-default" disabled={pending} aria-busy={pending || undefined}>
          {pending ? <Spinner /> : null}
          {pending ? "Saving…" : existing ? "Save changes" : `Connect ${adapter.name}`}
        </button>
      </div>
    </form>
  );
}

interface AdapterFieldProps {
  field: FieldSpec;
  form: UseFormReturn<FormShape>;
  error: string | null;
  /** Masked preview of the stored secret, when there is one. */
  hint?: string;
}

function AdapterField({ field, form, error, hint }: AdapterFieldProps) {
  const name = `values.${field.key}` as const;
  const note = field.required ? undefined : "optional";

  if (field.type === "boolean") {
    return (
      <Controller
        control={form.control}
        name={name}
        render={({ field: control }) => (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-4">
              <span id={`${field.key}-label`} className="label">
                {field.label}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={control.value === true}
                aria-labelledby={`${field.key}-label`}
                aria-describedby={field.help ? `${field.key}-help` : undefined}
                onClick={() => control.onChange(control.value !== true)}
                className="switch"
              >
                <span className="switch-thumb" />
              </button>
            </div>
            {error ? (
              <span role="alert" className="field-error">
                {error}
              </span>
            ) : null}
            {field.help ? (
              <span id={`${field.key}-help`} className="field-hint">
                {field.help}
              </span>
            ) : null}
          </div>
        )}
      />
    );
  }

  if (field.secret) {
    const keep = keepSecretHint(hint);
    return (
      <Field label={field.label} note={note} hint={[keep ? `${keep}.` : null, field.help].filter(Boolean).join(" ") || undefined} error={error}>
        {(control) => <SecretInput control={control} registration={form.register(name)} placeholder={hint ?? field.placeholder} label={field.label} />}
      </Field>
    );
  }

  if (field.type === "select") {
    return (
      <Field label={field.label} note={note} hint={field.help} error={error}>
        {(control) => (
          <select {...control} {...form.register(name)} className="select">
            {field.required ? null : <option value="">Not set</option>}
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </Field>
    );
  }

  return (
    <Field label={field.label} note={note} hint={field.help} error={error}>
      {(control) => (
        <input
          {...control}
          {...form.register(name)}
          className="input"
          type={field.type === "number" ? "number" : "text"}
          inputMode={field.type === "number" ? "numeric" : undefined}
          placeholder={field.placeholder}
          autoComplete="off"
          spellCheck={false}
        />
      )}
    </Field>
  );
}

interface SecretInputProps {
  control: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined };
  registration: ReturnType<UseFormReturn<FormShape>["register"]>;
  placeholder?: string;
  label: string;
}

/** Password-style input with a show/hide toggle. It never receives a stored value. */
function SecretInput({ control, registration, placeholder, label }: SecretInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <input
        {...control}
        {...registration}
        type={visible ? "text" : "password"}
        className="input pr-12 font-mono"
        placeholder={placeholder}
        autoComplete="new-password"
        autoCapitalize="none"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        aria-pressed={visible}
        className="btn btn-ghost btn-icon absolute right-0.5 top-1/2 -translate-y-1/2"
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </span>
  );
}
