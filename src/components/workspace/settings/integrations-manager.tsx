"use client";

import { CheckCircle2, Pencil, Plus, Power, Star, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  deleteIntegrationAction,
  setDefaultIntegrationAction,
  setIntegrationEnabledAction,
  testIntegrationAction,
} from "@/app/workspace/settings/integrations/actions";
import { ConfirmDialog, Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { formatDateTime } from "@/lib/booking-display";
import type { IntegrationCategory, IntegrationView } from "@/server/integrations/types";
import { CATEGORY_DEPENDENTS, deleteConsequence, groupIntegrations, STATUS_META, type AdapterSpec } from "./integration-form";
import { IntegrationPanel, type PanelTarget } from "./integration-panel";

export interface CategoryInfo {
  id: IntegrationCategory;
  label: string;
  /** Included in the workspace's plan. */
  allowed: boolean;
}

interface IntegrationsManagerProps {
  categories: CategoryInfo[];
  integrations: IntegrationView[];
  adapters: AdapterSpec[];
  canManage: boolean;
  canSeeBilling: boolean;
  planName: string;
  timezone: string;
  /** The plan includes Wayfold-managed media storage, used when no own media account is connected. */
  managedStorage: boolean;
}

type Confirm = { kind: "delete" | "disable"; view: IntegrationView } | null;

export function IntegrationsManager(props: IntegrationsManagerProps) {
  const { categories, integrations, adapters, canManage, canSeeBilling, planName, timezone, managedStorage } = props;
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const remove = useAction(deleteIntegrationAction, {
    success: () => `${confirm?.view.providerName ?? "Connection"} removed`,
    onSuccess: () => setConfirm(null),
  });
  const toggle = useAction(setIntegrationEnabledAction, {
    success: (view) => (view.status === "disabled" ? `${view.providerName} turned off` : `${view.providerName} turned on. Test it to confirm it works.`),
    onSuccess: () => setConfirm(null),
  });

  const categoryLabel = (id: IntegrationCategory) => categories.find((category) => category.id === id)?.label ?? id;
  const usableOthers = (view: IntegrationView) =>
    integrations.filter((item) => item.category === view.category && item.id !== view.id && item.status !== "disabled").length;
  const fallbackFor = (view: IntegrationView) =>
    view.category === "media" && managedStorage
      ? "New uploads will go to the Wayfold-managed storage included in your plan. Files already uploaded stay in your Cloudinary account."
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      {groupIntegrations(
        categories.map((category) => category.id),
        integrations,
      ).map(({ category, items }) => {
        const info = categories.find((item) => item.id === category)!;
        const available = adapters.filter((adapter) => adapter.category === category);
        return (
          <section key={category} className="card" aria-labelledby={`integrations-${category}`}>
            <div className="card-header">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`integrations-${category}`} className="card-title">
                  {info.label}
                </h2>
                {items.length === 0 ? <span className="badge badge-outline">Not connected</span> : null}
              </div>
              <p className="card-description">
                {CATEGORY_DEPENDENTS[category]}.
                {category === "media" && managedStorage && !items.some((item) => item.status !== "disabled")
                  ? " Until you connect your own account, your plan’s Wayfold-managed storage is used."
                  : ""}
              </p>
            </div>
            <div className="card-content flex flex-col gap-4">
              {items.length > 0 ? (
                <ul className="flex flex-col gap-3" aria-label={`${info.label} connections`}>
                  {items.map((view) => (
                    <ConnectionRow
                      key={view.id}
                      view={view}
                      timezone={timezone}
                      canManage={canManage}
                      onEdit={() => {
                        const adapter = adapters.find((item) => item.id === view.provider);
                        if (adapter) setPanel({ adapter, existing: view });
                      }}
                      onDelete={() => setConfirm({ kind: "delete", view })}
                      onToggle={() =>
                        view.status === "disabled"
                          ? toggle.run({ id: view.id, enabled: true })
                          : view.isDefault
                            ? setConfirm({ kind: "disable", view })
                            : toggle.run({ id: view.id, enabled: false })
                      }
                      togglePending={toggle.pending}
                    />
                  ))}
                </ul>
              ) : null}

              {!info.allowed ? (
                <div className="alert alert-warning flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p>This integration is not included in your {planName} plan.</p>
                  {canSeeBilling ? (
                    <Link href="/workspace/billing" className="btn btn-default btn-sm shrink-0">
                      See plans
                    </Link>
                  ) : null}
                </div>
              ) : canManage ? (
                <div className="flex flex-col gap-2">
                  {available.map((adapter) => (
                    <div key={adapter.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4">
                      <div className="min-w-0">
                        <p className="font-semibold">{adapter.name}</p>
                        <p className="text-sm text-muted-foreground">{adapter.description}</p>
                      </div>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setPanel({ adapter, existing: null })}>
                        <Plus aria-hidden="true" />
                        {items.some((item) => item.provider === adapter.id) ? "Add another account" : `Connect ${adapter.name}`}
                      </button>
                    </div>
                  ))}
                </div>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing is connected yet. A member who can manage integrations can connect an account.</p>
              ) : null}
            </div>
          </section>
        );
      })}

      <IntegrationPanel target={panel} onClose={() => setPanel(null)} canSeeBilling={canSeeBilling} />

      <ConfirmDialog
        open={confirm?.kind === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? `Remove ${confirm.view.providerName} (${confirm.view.label})?` : "Remove connection?"}
        description={
          confirm
            ? `The stored credentials are deleted and cannot be recovered. ${deleteConsequence(confirm.view, usableOthers(confirm.view), fallbackFor(confirm.view))}`
            : null
        }
        confirmLabel="Remove connection"
        destructive
        pending={remove.pending}
        onConfirm={() => confirm && remove.run({ id: confirm.view.id })}
      />

      <ConfirmDialog
        open={confirm?.kind === "disable"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? `Turn off ${confirm.view.providerName}?` : "Turn off connection?"}
        description={
          confirm
            ? `It is your default connection for ${categoryLabel(confirm.view.category).toLowerCase()}. ${CATEGORY_DEPENDENTS[confirm.view.category]} stops until you turn it back on or make another connection the default.`
            : null
        }
        confirmLabel="Turn off"
        pending={toggle.pending}
        onConfirm={() => confirm && toggle.run({ id: confirm.view.id, enabled: false })}
      />
    </div>
  );
}

interface ConnectionRowProps {
  view: IntegrationView;
  timezone: string;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  togglePending: boolean;
}

function ConnectionRow({ view, timezone, canManage, onEdit, onDelete, onToggle, togglePending }: ConnectionRowProps) {
  const [tested, setTested] = useState<{ ok: boolean; message: string } | null>(null);
  const test = useAction(testIntegrationAction, {
    toastError: false,
    // A turned-off connection keeps its status when tested, so the outcome is read from the error.
    onSuccess: (result) => setTested(result.lastError ? { ok: false, message: result.lastError } : { ok: true, message: "Connection works." }),
  });
  const makeDefault = useAction(setDefaultIntegrationAction, { success: `${view.providerName} (${view.label}) is now the default` });

  const runTest = async () => {
    setTested(null);
    const result = await test.run({ id: view.id });
    if (!result.ok) setTested({ ok: false, message: result.error });
  };

  const status = STATUS_META[view.status];
  const disabled = view.status === "disabled";
  // A fresh test result replaces the stored error, so the two never disagree on screen.
  const storedError = !tested && view.status === "error" ? view.lastError : null;

  return (
    <li className="rounded-lg border">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{view.providerName}</span>
              <span className="text-sm text-muted-foreground">{view.label}</span>
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className={`badge ${status.badge}`}>{status.label}</span>
              {view.isDefault ? (
                <span className="badge badge-default">
                  <Star aria-hidden="true" className="size-3" />
                  Default
                </span>
              ) : null}
            </p>
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-outline btn-sm" onClick={runTest} disabled={test.pending} aria-busy={test.pending || undefined}>
                {test.pending ? <Spinner /> : <Zap aria-hidden="true" />}
                {test.pending ? "Testing…" : "Test connection"}
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={onEdit} aria-label={`Edit ${view.providerName} ${view.label}`}>
                <Pencil aria-hidden="true" />
                Edit
              </button>
            </div>
          ) : null}
        </div>

        <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="flex gap-1.5">
            <dt>Last tested:</dt>
            <dd className="text-foreground">{view.lastTestedAt ? formatDateTime(view.lastTestedAt, timezone) : "Never"}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Credentials changed:</dt>
            <dd className="text-foreground">{view.rotatedAt ? formatDateTime(view.rotatedAt, timezone) : "Not since connecting"}</dd>
          </div>
        </dl>

        <div aria-live="polite">
          {tested ? (
            tested.ok ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-success">
                <CheckCircle2 aria-hidden="true" className="size-4" />
                {tested.message}
              </p>
            ) : (
              <div role="alert" className="alert alert-destructive">
                <p className="font-semibold">The test failed</p>
                <p className="mt-1">{tested.message}</p>
              </div>
            )
          ) : storedError ? (
            <div className="alert alert-destructive">
              <p className="font-semibold">The last test failed</p>
              <p className="mt-1">{storedError}</p>
            </div>
          ) : null}
        </div>

        {canManage ? (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {!view.isDefault && !disabled ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => makeDefault.run({ id: view.id })} disabled={makeDefault.pending}>
                {makeDefault.pending ? <Spinner /> : <Star aria-hidden="true" />}
                Make default
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle} disabled={togglePending}>
              <Power aria-hidden="true" />
              {disabled ? "Turn on" : "Turn off"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm text-destructive" onClick={onDelete}>
              <Trash2 aria-hidden="true" />
              Remove
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
