"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Lock, Minus } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { updatePromotionSettingsAction } from "@/app/workspace/promotions/actions";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import type { PromotionSettings } from "@/server/settings/tenant-settings";
import type { PromotionsContext } from "./promotions-view";
import { AccessNote } from "./shared";

interface SettingsTabProps extends PromotionsContext {
  settings: PromotionSettings;
  /** Pending requests above the saved maximum. */
  overMaximum: number;
}

const maxSchema = z.object({
  maxRequestPercent: z
    .string()
    .trim()
    .regex(/^\d+$/, "Enter a whole number from 1 to 90.")
    .refine((value) => Number(value) >= 1 && Number(value) <= 90, "Enter a whole number from 1 to 90."),
});
type MaxValues = z.infer<typeof maxSchema>;

const SAVED = "Settings saved — live on your website";

export function SettingsTab({ settings, overMaximum, access }: SettingsTabProps) {
  const canManage = access.manage;
  // Which control's change is in flight, so only that one shows it.
  const [saving, setSaving] = useState<keyof PromotionSettings | null>(null);
  const update = useAction(updatePromotionSettingsAction, { success: SAVED, onSuccess: () => setSaving(null) });
  const saveMax = useAction(updatePromotionSettingsAction, { success: SAVED, toastError: false });

  const form = useForm<MaxValues>({ resolver: zodResolver(maxSchema), defaultValues: { maxRequestPercent: String(settings.maxRequestPercent) } });
  const { errors, isDirty } = form.formState;
  const { reset } = form;
  // A save, here or elsewhere, becomes the new starting point.
  useEffect(() => {
    reset({ maxRequestPercent: String(settings.maxRequestPercent) });
  }, [settings.maxRequestPercent, reset]);

  async function change(patch: Partial<PromotionSettings>) {
    setSaving(Object.keys(patch)[0] as keyof PromotionSettings);
    const result = await update.run(patch);
    if (!result.ok) setSaving(null);
  }

  const submitMax = form.handleSubmit(async (values) => {
    const result = await saveMax.run({ maxRequestPercent: Number(values.maxRequestPercent) });
    if (!result.ok) form.setError("maxRequestPercent", { message: result.fieldErrors?.maxRequestPercent?.[0] ?? result.error }, { shouldFocus: true });
  });

  const maxError = errors.maxRequestPercent?.message;
  const togglingRequests = update.pending && saving === "requestsEnabled";

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <section className="card" aria-labelledby="request-settings-title">
        <div className="card-header">
          <h2 id="request-settings-title" className="card-title">
            Customer discount requests
          </h2>
          <p className="card-description">Let customers ask for a special discount when no offer applies.</p>
        </div>
        <div className="card-content flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <span>
              <span id="allow-requests-label" className="block text-sm font-semibold">
                Allow discount requests
              </span>
              <span className="text-xs text-muted-foreground">When off, the request option is hidden on the website.</span>
            </span>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={settings.requestsEnabled}
              aria-labelledby="allow-requests-label"
              aria-busy={togglingRequests || undefined}
              disabled={!canManage || togglingRequests}
              onClick={() => void change({ requestsEnabled: !settings.requestsEnabled })}
            >
              <span className="switch-thumb" />
            </button>
          </div>

          <form onSubmit={submitMax} noValidate className="flex flex-col gap-2 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="max-request-percent" className="label">
                Maximum discount customers can request
              </label>
              <span className="badge badge-outline gap-1">
                <Lock aria-hidden="true" className="size-3" />
                Private · never shown to customers
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="max-request-percent"
                {...form.register("maxRequestPercent")}
                className="input w-24"
                inputMode="numeric"
                disabled={!canManage}
                aria-invalid={Boolean(maxError)}
                aria-describedby={`max-request-help${maxError ? " max-request-error" : ""}`}
              />
              <span className="text-sm text-muted-foreground">% of the trip price · all tours</span>
              <button type="submit" disabled={!canManage || saveMax.pending || !isDirty} className="btn btn-outline btn-sm ml-auto" aria-busy={saveMax.pending || undefined}>
                {saveMax.pending ? <Spinner /> : null}
                Save
              </button>
            </div>
            {maxError ? (
              <span id="max-request-error" role="alert" className="field-error">
                {maxError}
              </span>
            ) : null}
            <p id="max-request-help" className="text-xs leading-relaxed text-muted-foreground">
              Customers never see this number. Fixed-amount requests are converted to a percentage of the trip price and held to the same limit. Larger requests are
              turned away with a general message that doesn’t reveal it.
            </p>
            {overMaximum > 0 ? (
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                {overMaximum} pending {overMaximum === 1 ? "request is" : "requests are"} above this limit — you can approve{" "}
                {overMaximum === 1 ? "it" : "them"} only up to the limit, or reject.
              </p>
            ) : null}
          </form>

          <div className="flex flex-col gap-2">
            <label htmlFor="response-days" className="label">
              Promised response time
            </label>
            <select
              id="response-days"
              className="select"
              value={settings.responseDays}
              disabled={!canManage || (update.pending && saving === "responseDays")}
              aria-describedby="response-days-help"
              onChange={(event) => void change({ responseDays: Number(event.target.value) })}
            >
              <option value={1}>Within 1 day</option>
              <option value={2}>Within 2 days</option>
              <option value={3}>Within 3 days</option>
            </select>
            <span id="response-days-help" className="field-hint">
              Shown to customers when they send a request.
            </span>
          </div>

          {!canManage ? <AccessNote>Only members who can manage discounts can change these settings.</AccessNote> : null}
        </div>
      </section>

      <section className="card" aria-labelledby="rules-title">
        <div className="card-header">
          <h2 id="rules-title" className="card-title">
            Rules & permissions
          </h2>
          <p className="card-description">Who can change pricing, and how discounts combine.</p>
        </div>
        <div className="card-content flex flex-col gap-4">
          <div className="rounded-lg bg-secondary/60 p-4 text-sm">
            <p className="font-semibold">Combining discounts</p>
            <p className="mt-1 text-muted-foreground">
              Never combined. Each booking gets the single best eligible discount — public offer, private offer, personal discount or approved request. Personal and
              approved discounts are spent after one use.
            </p>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">What your role can do here</p>
            <ul className="divide-y rounded-lg border text-sm">
              {[
                { label: "See campaigns, personal discounts and requests", allowed: true },
                { label: "Create and edit campaigns, personal discounts and these settings", allowed: access.manage },
                { label: "Approve or reject discount requests", allowed: access.decide },
              ].map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-3 p-3">
                  <span>{row.label}</span>
                  {row.allowed ? (
                    <span className="badge badge-confirmed shrink-0 gap-1">
                      <Check aria-hidden="true" className="size-3" />
                      Allowed
                    </span>
                  ) : (
                    <span className="badge badge-secondary shrink-0 gap-1">
                      <Minus aria-hidden="true" className="size-3" />
                      Not allowed
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Roles and their permissions are set in Team & roles.</p>
          </div>

          <div className="rounded-lg border p-4 text-sm">
            <p className="font-semibold">How limits are enforced</p>
            <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-muted-foreground">
              <li>Checked when the customer sends the request. Oversized requests are refused with a general message.</li>
              <li>Checked again when you decide: an approval can’t exceed what was asked for or your current maximum.</li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
