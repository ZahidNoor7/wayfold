"use client";

import { ArrowUpRight, CheckCircle2, Clock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { addDomainAction, removeDomainAction, setPrimaryDomainAction, verifyDomainAction } from "@/app/workspace/settings/domains/actions";
import { Field, FormError } from "@/components/form";
import { ConfirmDialog, Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import type { DomainView } from "@/server/settings/domains";
import { CopyButton } from "./copy-button";
import { cleanDomainInput, domainInputError, recordHostLabel } from "./domains";
import { errorFor } from "./errors";

interface DomainsManagerProps {
  domains: DomainView[];
  defaultAddress: string;
  defaultUrl: string;
  /** The plan includes custom domains. Removing existing ones works either way. */
  allowed: boolean;
  planName: string;
  canSeeBilling: boolean;
}

export function DomainsManager({ domains, defaultAddress, defaultUrl, allowed, planName, canSeeBilling }: DomainsManagerProps) {
  const customPrimary = domains.find((domain) => domain.isPrimary) ?? null;
  const [removing, setRemoving] = useState<DomainView | null>(null);

  const primary = useAction(setPrimaryDomainAction, {
    success: (data) => (data.id ? "Main address changed" : `${defaultAddress} is your main address again`),
  });
  const remove = useAction(removeDomainAction, {
    success: "Domain removed",
    onSuccess: () => setRemoving(null),
  });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <section className="card" aria-labelledby="domains-default">
        <div className="card-header">
          <h2 id="domains-default" className="card-title">
            Your Wayfold address
          </h2>
          <p className="card-description">Always works, on every plan. Share it until your own domain is connected.</p>
        </div>
        <div className="card-content flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold">{defaultAddress}</span>
            {customPrimary ? null : <span className="badge badge-default">Main address</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={defaultUrl} label="Wayfold address" />
            <a href={defaultUrl} target="_blank" rel="noopener" className="btn btn-outline btn-sm">
              Open
              <ArrowUpRight aria-hidden="true" />
            </a>
            {customPrimary ? (
              <button type="button" className="btn btn-outline btn-sm" disabled={primary.pending} onClick={() => primary.run({ id: null })}>
                {primary.pending ? <Spinner /> : null}
                Make main address
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="domains-custom">
        <div className="card-header">
          <h2 id="domains-custom" className="card-title">
            Your own domain
          </h2>
          <p className="card-description">
            Use an address you own, such as tours.yourcompany.com. You prove it is yours with one DNS record; nothing changes for visitors until it is verified.
          </p>
        </div>
        <div className="card-content flex flex-col gap-5">
          {allowed ? (
            <AddDomainForm />
          ) : (
            <div className="alert alert-warning flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>
                Custom domains are not included in your {planName} plan.
                {domains.length > 0 ? " You can still remove the domains already listed below." : ""}
              </p>
              {canSeeBilling ? (
                <Link href="/workspace/billing" className="btn btn-default btn-sm shrink-0">
                  See plans
                </Link>
              ) : (
                <span className="text-sm">Ask the workspace owner to upgrade the plan.</span>
              )}
            </div>
          )}

          {domains.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No domains connected yet.{allowed ? " Add one above to get the DNS record to publish." : ""}
            </p>
          ) : (
            <ul className="flex flex-col gap-4" aria-label="Connected domains">
              {domains.map((domain) => (
                <DomainRow
                  key={domain.id}
                  domain={domain}
                  allowed={allowed}
                  onRemove={() => setRemoving(domain)}
                  onMakePrimary={() => primary.run({ id: domain.id })}
                  primaryPending={primary.pending}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `Remove ${removing.domain}?` : "Remove domain?"}
        description={
          removing?.isPrimary
            ? `Visitors using ${removing.domain} will no longer reach your website, and ${defaultAddress} becomes your main address again. You can add the domain back later, but you will need to verify it again.`
            : "Visitors using this domain will no longer reach your website. You can add it back later, but you will need to verify it again."
        }
        confirmLabel="Remove domain"
        destructive
        pending={remove.pending}
        onConfirm={() => removing && remove.run({ id: removing.id })}
      />
    </div>
  );
}

function AddDomainForm() {
  const form = useForm<{ domain: string }>({ defaultValues: { domain: "" } });
  const { run, pending, error, fieldErrors } = useAction(addDomainAction, {
    success: (view) => `${view.domain} added. Publish the DNS record below, then verify.`,
    toastError: false,
    onSuccess: () => form.reset({ domain: "" }),
  });
  const typed = useWatch({ control: form.control, name: "domain" });
  const cleaned = cleanDomainInput(typed);
  const fieldError = form.formState.errors.domain?.message ?? errorFor(fieldErrors, "domain");

  return (
    <form onSubmit={form.handleSubmit(({ domain }) => run({ domain: cleanDomainInput(domain) }))} noValidate className="flex flex-col gap-3">
      <FormError message={error && !fieldError ? error : null} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field
          label="Domain"
          className="flex-1"
          hint={cleaned && cleaned !== typed.trim() ? `We will add ${cleaned}.` : "A sub-domain such as tours.example.com is easiest to set up."}
          error={fieldError}
        >
          {(control) => (
            <input
              {...control}
              {...form.register("domain", { validate: (value) => domainInputError(value) ?? true })}
              className="input"
              placeholder="tours.example.com"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          )}
        </Field>
        <button type="submit" className="btn btn-default sm:mt-7" disabled={pending} aria-busy={pending || undefined}>
          {pending ? <Spinner /> : <Plus aria-hidden="true" />}
          Add domain
        </button>
      </div>
    </form>
  );
}

interface DomainRowProps {
  domain: DomainView;
  allowed: boolean;
  onRemove: () => void;
  onMakePrimary: () => void;
  primaryPending: boolean;
}

function DomainRow({ domain, allowed, onRemove, onMakePrimary, primaryPending }: DomainRowProps) {
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const verify = useAction(verifyDomainAction, {
    success: (view) => `${view.domain} is verified`,
    toastError: false,
    onSuccess: () => setFailure(null),
  });

  const runVerify = async () => {
    setFailure(null);
    const result = await verify.run({ id: domain.id });
    if (!result.ok) setFailure({ code: result.code, message: result.error });
  };

  const verified = domain.status === "verified";

  return (
    <li className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-semibold">{domain.domain}</span>
          {verified ? (
            <span className="badge badge-confirmed">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              Verified
            </span>
          ) : (
            <span className="badge badge-pending">
              <Clock aria-hidden="true" className="size-3.5" />
              Waiting for DNS record
            </span>
          )}
          {domain.isPrimary ? <span className="badge badge-default">Main address</span> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {!verified && allowed ? (
            <button type="button" className="btn btn-default btn-sm" onClick={runVerify} disabled={verify.pending} aria-busy={verify.pending || undefined}>
              {verify.pending ? <Spinner /> : <ShieldCheck aria-hidden="true" />}
              {verify.pending ? "Checking…" : "Verify"}
            </button>
          ) : null}
          {verified && !domain.isPrimary && allowed ? (
            <button type="button" className="btn btn-outline btn-sm" onClick={onMakePrimary} disabled={primaryPending}>
              Make main address
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm text-destructive" onClick={onRemove} aria-label={`Remove ${domain.domain}`}>
            <Trash2 aria-hidden="true" />
            Remove
          </button>
        </div>
      </div>

      {domain.verification ? (
        <div className="flex flex-col gap-3 border-t bg-muted/40 p-4 text-sm">
          <p className="font-semibold">Publish this DNS record to prove you own {domain.domain}</p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Sign in where you manage the domain’s DNS (usually where you bought it).</li>
            <li>Add a new record of type TXT with the name and value below.</li>
            <li>Come back here and press Verify.</li>
          </ol>
          <dl className="grid gap-3">
            <RecordLine label="Type" value={domain.verification.type} />
            <RecordLine
              label="Name"
              value={domain.verification.name}
              copyLabel="record name"
              note={`Some DNS providers add the domain for you; then enter only ${recordHostLabel(domain.verification.name, domain.domain)}.`}
            />
            <RecordLine label="Value" value={domain.verification.value} copyLabel="record value" />
          </dl>
          {failure?.code === "domain_not_verified" ? (
            <div role="alert" className="alert alert-warning">
              <p className="font-semibold">We could not find the record yet</p>
              <p className="mt-1">
                New DNS records can take from a few minutes to an hour to appear, sometimes longer. Check that the name and value match exactly,
                then press Verify again.
              </p>
            </div>
          ) : failure ? (
            <div role="alert" className="alert alert-destructive">
              {failure.message}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function RecordLine({ label, value, copyLabel, note }: { label: string; value: string; copyLabel?: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md border bg-background px-3 py-2 font-mono text-[13px]">{value}</code>
          {copyLabel ? <CopyButton value={value} label={copyLabel} /> : null}
        </span>
        {note ? <span className="field-hint">{note}</span> : null}
      </dd>
    </div>
  );
}
