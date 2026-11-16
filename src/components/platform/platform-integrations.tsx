"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Field, firstError, FormError, SubmitButton } from "@/components/form";
import { ConfirmDialog, Panel, Spinner } from "@/components/overlays";
import { Toggle } from "@/components/platform/controls";
import { Details, HealthMark, Section } from "@/components/platform/ui";
import { useAction } from "@/hooks/use-action";
import { formatDateTime, integrationFormDefaults, splitIntegrationForm, type ConnectionStatus, type HealthState } from "@/lib/platform-display";
import {
  deletePlatformIntegrationAction,
  savePlatformIntegrationAction,
  setPlatformIntegrationEnabledAction,
  testPlatformIntegrationAction,
} from "@/app/platform/(console)/integrations/actions";
import type { FieldSpec } from "@/server/integrations/types";

export interface AdapterInfo {
  id: string;
  name: string;
  description: string;
  docsUrl?: string;
  fields: FieldSpec[];
}

export interface ConnectionInfo {
  provider: string;
  providerName: string;
  status: ConnectionStatus;
  /** Non-secret settings only. */
  config: Record<string, unknown>;
  /** Masked previews keyed by secret field. Never the value itself. */
  secretHints: Record<string, string>;
  lastTestedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

export interface CategoryInfo {
  category: "media" | "email";
  title: string;
  purpose: string;
  /** What is true while nothing is connected. */
  withoutIt: string;
  adapters: AdapterInfo[];
  connection: ConnectionInfo | null;
}

const STATE: Record<ConnectionStatus, { state: HealthState; label: string }> = {
  connected: { state: "ok", label: "Connected" },
  error: { state: "fail", label: "Last test failed" },
  untested: { state: "unknown", label: "Saved, not tested yet" },
  disabled: { state: "unknown", label: "Disabled" },
};

type FormValues = Record<string, string | boolean>;

/* ------------------------------------------------------------------ form */

function ConnectionForm({ info, onDone }: { info: CategoryInfo; onDone: () => void }) {
  const { connection, adapters } = info;
  const [providerId, setProviderId] = useState(connection?.provider ?? adapters[0]?.id ?? "");
  const adapter = adapters.find((entry) => entry.id === providerId);
  // Stored secrets carry over only while the provider stays the same.
  const hints = connection && connection.provider === providerId ? connection.secretHints : {};
  const stored = Object.keys(hints);

  const form = useForm<FormValues>({
    defaultValues: adapter ? integrationFormDefaults(adapter.fields, connection?.provider === providerId ? connection.config : {}) : {},
  });
  const action = useAction(savePlatformIntegrationAction, {
    toastError: false,
    success: (data) => `${data.providerName} settings saved. Test the connection to confirm they work.`,
  });

  function changeProvider(next: string) {
    setProviderId(next);
    const nextAdapter = adapters.find((entry) => entry.id === next);
    form.reset(nextAdapter ? integrationFormDefaults(nextAdapter.fields, connection?.provider === next ? connection.config : {}) : {});
    action.reset();
  }

  const submit = form.handleSubmit(async (values) => {
    if (!adapter) return;
    const { config, secrets, missing } = splitIntegrationForm(adapter.fields, values, stored);
    if (missing.length > 0) {
      for (const key of missing) form.setError(key, { message: "This field is required." });
      form.setFocus(missing[0]!);
      return;
    }
    const result = await action.run({ provider: adapter.id, config, secrets });
    if (result.ok) onDone();
  });

  if (!adapter) {
    return <p className="p-5 text-sm text-muted-foreground sm:p-6">No provider is available for this connection.</p>;
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5 p-5 sm:p-6">
      <FormError message={action.fieldErrors ? (firstError(action.fieldErrors, "form") ?? "Some fields need attention. They are marked below.") : action.error} />

      {adapters.length > 1 ? (
        <Field label="Provider" hint={connection && connection.provider !== providerId ? "Changing provider replaces the current connection and needs every credential again." : undefined}>
          {(control) => (
            <select {...control} className="select" value={providerId} onChange={(event) => changeProvider(event.target.value)}>
              {adapters.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}

      {adapter.fields.map((field) => {
        const error = (form.formState.errors[field.key]?.message as string | undefined) ?? firstError(action.fieldErrors, field.key);

        if (field.type === "boolean") {
          return (
            <Controller
              key={field.key}
              control={form.control}
              name={field.key}
              render={({ field: input }) => <Toggle label={field.label} hint={field.help} checked={input.value === true} onChange={input.onChange} />}
            />
          );
        }

        if (field.secret) {
          const hint = hints[field.key];
          return (
            <Field
              key={field.key}
              label={field.label}
              note={field.required ? undefined : "optional"}
              error={error}
              hint={hint ? `${field.help ? `${field.help} ` : ""}A value is stored. Leave this blank to keep it.` : field.help}
            >
              {(control) => (
                // Always a password box, always empty: the stored value never reaches the browser.
                <input
                  {...control}
                  {...form.register(field.key)}
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={hint ?? field.placeholder}
                />
              )}
            </Field>
          );
        }

        return (
          <Field key={field.key} label={field.label} note={field.required ? undefined : "optional"} error={error} hint={field.help}>
            {(control) =>
              field.type === "select" ? (
                <select {...control} {...form.register(field.key)} className="select">
                  {field.required ? null : <option value="">Not set</option>}
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  {...control}
                  {...form.register(field.key)}
                  className="input"
                  inputMode={field.type === "number" ? "numeric" : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={field.placeholder}
                />
              )
            }
          </Field>
        );
      })}

      {adapter.docsUrl ? (
        <p className="text-[13px] text-muted-foreground">
          Where to find these values:{" "}
          <a href={adapter.docsUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
            {adapter.name} documentation<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-outline" onClick={onDone} disabled={action.pending}>
          Cancel
        </button>
        <SubmitButton pending={action.pending} pendingLabel="Saving">
          Save settings
        </SubmitButton>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ card */

function ConnectionCard({ info }: { info: CategoryInfo }) {
  const { connection } = info;
  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [removing, setRemoving] = useState(false);
  const test = useAction(testPlatformIntegrationAction);
  const toggle = useAction(setPlatformIntegrationEnabledAction, {
    success: (data) => (data.status === "disabled" ? `${data.providerName} disabled` : `${data.providerName} enabled. Test the connection to confirm it works.`),
  });
  const remove = useAction(deletePlatformIntegrationAction, { success: "Connection removed" });
  const adapter = info.adapters.find((entry) => entry.id === connection?.provider);

  function openForm() {
    setFormKey((key) => key + 1);
    setFormOpen(true);
  }

  async function runTest() {
    const result = await test.run({ category: info.category });
    if (!result.ok) return;
    if (result.data.lastError) toast.error(`${result.data.providerName} test failed. The reason is shown on the card.`);
    else toast.success(`${result.data.providerName} connection works`);
  }

  const settings =
    connection && adapter
      ? adapter.fields.map((field) => ({
          label: field.label,
          value: field.secret
            ? connection.secretHints[field.key]
              ? "Stored, encrypted"
              : "Not set"
            : field.type === "boolean"
              ? connection.config[field.key] === true
                ? "On"
                : "Off"
              : String(connection.config[field.key] ?? "") || "Not set",
        }))
      : [];

  return (
    <Section
      id={`integration-${info.category}`}
      title={info.title}
      description={info.purpose}
      actions={connection ? <HealthMark state={STATE[connection.status].state}>{STATE[connection.status].label}</HealthMark> : <HealthMark state="unknown">Not connected</HealthMark>}
    >
      <div className="card-content flex flex-col gap-5">
        {connection ? (
          <>
            {connection.lastError ? (
              <div role="status" className="alert alert-destructive">
                <p className="font-semibold">The last test failed</p>
                <p className="mt-0.5 break-words">{connection.lastError}</p>
              </div>
            ) : null}
            {connection.status === "disabled" ? (
              <p className="alert alert-warning">This connection is switched off. Its settings are kept, but nothing uses it until it is enabled again.</p>
            ) : null}
            <Details
              items={[
                { label: "Provider", value: connection.providerName },
                ...settings,
                { label: "Last tested", value: connection.lastTestedAt ? formatDateTime(connection.lastTestedAt) : "Never" },
                { label: "Last changed", value: formatDateTime(connection.updatedAt) },
              ]}
            />
            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <button type="button" className="btn btn-default btn-sm" onClick={runTest} disabled={test.pending} aria-busy={test.pending || undefined}>
                {test.pending ? <Spinner /> : null}
                {test.pending ? "Testing" : "Test connection"}
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={openForm}>
                Edit settings
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={toggle.pending}
                aria-busy={toggle.pending || undefined}
                onClick={() => toggle.run({ category: info.category, enabled: connection.status === "disabled" })}
              >
                {toggle.pending ? <Spinner /> : null}
                {connection.status === "disabled" ? "Enable" : "Disable"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm text-destructive" onClick={() => setRemoving(true)}>
                Remove
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-muted-foreground">{info.withoutIt}</p>
            <div>
              <button type="button" className="btn btn-default" onClick={openForm} disabled={info.adapters.length === 0}>
                Set up {info.adapters.length === 1 ? info.adapters[0]!.name : "a provider"}
              </button>
            </div>
          </>
        )}
      </div>

      <Panel
        open={formOpen}
        onOpenChange={setFormOpen}
        title={connection ? `Edit ${info.title.toLowerCase()}` : `Set up ${info.title.toLowerCase()}`}
        description="Credentials are encrypted before they are stored and are never shown again."
      >
        <ConnectionForm key={formKey} info={info} onDone={() => setFormOpen(false)} />
      </Panel>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${info.title.toLowerCase()}?`}
        description={`The stored credentials are deleted. ${info.withoutIt} To pause it without losing the settings, disable it instead.`}
        confirmLabel="Remove connection"
        destructive
        pending={remove.pending}
        onConfirm={async () => {
          await remove.run({ category: info.category });
          setRemoving(false);
        }}
      />
    </Section>
  );
}

export function PlatformIntegrations({ categories }: { categories: CategoryInfo[] }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {categories.map((info) => (
        <ConnectionCard key={info.category} info={info} />
      ))}
    </div>
  );
}
