"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Field, firstError, FormError, SubmitButton } from "@/components/form";
import { ConfirmDialog, Panel } from "@/components/overlays";
import { LimitField, Toggle } from "@/components/platform/controls";
import { PlatformHeader } from "@/components/platform/ui";
import { useAction } from "@/hooks/use-action";
import { formatMoney } from "@/lib/dates";
import {
  decimalToMinor,
  formatBytes,
  formatCount,
  isCurrencyCode,
  LIMIT_KEYS,
  LIMIT_LABELS,
  limitDraft,
  limitsFromDrafts,
  minorToDecimal,
  type LimitDrafts,
  type LimitKey,
} from "@/lib/platform-display";
import { createPlanAction, deletePlanAction, updatePlanAction } from "@/app/platform/(console)/plans/actions";

export interface PlanItem {
  id: string;
  code: string;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  maxTeamMembers: number | null;
  maxPublishedTours: number | null;
  maxStorageMb: number | null;
  maxBookingsPerMonth: number | null;
  features: { customDomain: boolean; integrations: string[]; platformStorage: boolean; promotions: boolean; removeBranding: boolean };
  isPublic: boolean;
  isDefault: boolean;
  sortOrder: number;
  tenantCount: number;
}

interface PlanManagerProps {
  plans: PlanItem[];
  /** Integration categories a plan may allow, e.g. `{ id: "payments", label: "Payments" }`. */
  categories: { id: string; label: string }[];
  /** Only platform owners may change plans. */
  canEdit: boolean;
}

const schema = z
  .object({
    name: z.string().trim().min(2, "Enter a plan name.").max(60, "Keep the name under 60 characters."),
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_-]{1,30}$/, "Use 2 to 31 lower-case letters, digits, hyphens or underscores, starting with a letter."),
    description: z.string().trim().max(500, "Keep the description under 500 characters."),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isCurrencyCode, "Use a three-letter currency code, such as USD."),
    priceMonthly: z.string().trim().min(1, "Enter the monthly price. Use 0 for a free plan."),
    priceYearly: z.string().trim().min(1, "Enter the yearly price. Use 0 for a free plan."),
    sortOrder: z
      .string()
      .trim()
      .refine((value) => /^-?\d{1,4}$/.test(value) && Math.abs(Number(value)) <= 1000, "Enter a whole number from -1000 to 1000."),
    customDomain: z.boolean(),
    platformStorage: z.boolean(),
    promotions: z.boolean(),
    removeBranding: z.boolean(),
    integrations: z.array(z.string()),
    isPublic: z.boolean(),
    isDefault: z.boolean(),
  })
  .superRefine((values, context) => {
    if (!isCurrencyCode(values.currency)) return;
    for (const key of ["priceMonthly", "priceYearly"] as const) {
      if (values[key] !== "" && decimalToMinor(values[key], values.currency) === null) {
        context.addIssue({ code: "custom", path: [key], message: `Enter a price ${values.currency} can express, such as 29 or 29.50.` });
      }
    }
  });
type FormValues = z.infer<typeof schema>;

const FEATURE_TOGGLES: { name: "customDomain" | "platformStorage" | "promotions" | "removeBranding"; label: string; hint: string }[] = [
  { name: "customDomain", label: "Custom domain", hint: "The storefront can be served from the business's own domain." },
  { name: "platformStorage", label: "Platform media storage", hint: "Uploads use Wayfold's storage when the workspace has not connected its own." },
  { name: "promotions", label: "Discounts and offers", hint: "Campaigns, promo codes and discount requests." },
  { name: "removeBranding", label: "Remove Wayfold branding", hint: "Hides the Wayfold credit on the storefront." },
];

function blankValues(): FormValues {
  return {
    name: "",
    code: "",
    description: "",
    currency: "USD",
    priceMonthly: "0",
    priceYearly: "0",
    sortOrder: "0",
    customDomain: false,
    platformStorage: true,
    promotions: false,
    removeBranding: false,
    integrations: ["media", "email"],
    isPublic: true,
    isDefault: false,
  };
}

function valuesFrom(plan: PlanItem): FormValues {
  return {
    name: plan.name,
    code: plan.code,
    description: plan.description,
    currency: plan.currency,
    priceMonthly: minorToDecimal(plan.priceMonthly, plan.currency),
    priceYearly: minorToDecimal(plan.priceYearly, plan.currency),
    sortOrder: String(plan.sortOrder),
    customDomain: plan.features.customDomain,
    platformStorage: plan.features.platformStorage,
    promotions: plan.features.promotions,
    removeBranding: plan.features.removeBranding,
    integrations: plan.features.integrations,
    isPublic: plan.isPublic,
    isDefault: plan.isDefault,
  };
}

function draftsFrom(plan: PlanItem | null): LimitDrafts {
  return Object.fromEntries(LIMIT_KEYS.map((key) => [key, limitDraft(plan ? plan[key] : undefined)])) as LimitDrafts;
}

function limitsSummary(plan: PlanItem): string {
  const count = (value: number | null, one: string, many: string) => (value === null ? `unlimited ${many}` : `${formatCount(value)} ${value === 1 ? one : many}`);
  return [
    count(plan.maxTeamMembers, "member", "members"),
    count(plan.maxPublishedTours, "tour", "tours"),
    plan.maxStorageMb === null ? "unlimited storage" : `${formatBytes(plan.maxStorageMb * 1024 * 1024)} storage`,
    `${count(plan.maxBookingsPerMonth, "booking", "bookings")} a month`,
  ].join(", ");
}

/* ------------------------------------------------------------------ form */

function PlanForm({ plan, categories, onDone }: { plan: PlanItem | null; categories: PlanManagerProps["categories"]; onDone: () => void }) {
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: plan ? valuesFrom(plan) : blankValues() });
  const { errors } = form.formState;
  const [drafts, setDrafts] = useState<LimitDrafts>(() => draftsFrom(plan));
  const [limitErrors, setLimitErrors] = useState<Partial<Record<LimitKey, string>>>({});
  const create = useAction(createPlanAction, { toastError: false, success: (data) => `${data.name} plan created` });
  const update = useAction(updatePlanAction, { toastError: false, success: (data) => `${data.name} plan saved` });
  const action = plan ? update : create;
  const serverError = (name: string) => firstError(action.fieldErrors, name);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const limits = limitsFromDrafts(drafts);
    setLimitErrors(limits.ok ? {} : limits.errors);

    void form.handleSubmit(async (values) => {
      if (!limits.ok) return;
      const priceMonthly = decimalToMinor(values.priceMonthly, values.currency);
      const priceYearly = decimalToMinor(values.priceYearly, values.currency);
      if (priceMonthly === null || priceYearly === null) return;

      const fields = {
        name: values.name,
        description: values.description,
        priceMonthly,
        priceYearly,
        currency: values.currency,
        ...limits.limits,
        features: {
          customDomain: values.customDomain,
          integrations: values.integrations,
          platformStorage: values.platformStorage,
          promotions: values.promotions,
          removeBranding: values.removeBranding,
        },
        isPublic: values.isPublic,
        isDefault: values.isDefault,
        sortOrder: Number(values.sortOrder),
      };
      const result = plan ? await update.run({ planId: plan.id, changes: fields }) : await create.run({ code: values.code, ...fields });
      if (result.ok) onDone();
    })(event);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6 p-5 sm:p-6">
      <FormError message={action.fieldErrors ? "Some fields need attention. They are marked below." : action.error} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" error={errors.name?.message ?? serverError("name")}>
          {(control) => <input {...control} {...form.register("name")} className="input" autoComplete="off" />}
        </Field>
        <Field
          label="Code"
          error={errors.code?.message ?? serverError("code")}
          hint={plan ? "The code identifies the plan in sign-up links and cannot be changed." : "A short identifier used in sign-up links. It cannot be changed later."}
        >
          {(control) => (
            // Read-only rather than disabled, so the form still carries the value.
            <input
              {...control}
              {...form.register("code")}
              className={plan ? "input bg-muted text-muted-foreground" : "input"}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              readOnly={Boolean(plan)}
            />
          )}
        </Field>
      </div>

      <Field label="Description" note="optional" error={errors.description?.message ?? serverError("description")} hint="Shown to businesses choosing a plan.">
        {(control) => <textarea {...control} {...form.register("description")} className="textarea" rows={2} maxLength={500} />}
      </Field>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-xs font-semibold text-muted-foreground">Price</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_110px]">
          <Field label="Monthly" error={errors.priceMonthly?.message ?? serverError("priceMonthly")}>
            {(control) => <input {...control} {...form.register("priceMonthly")} className="input" inputMode="decimal" autoComplete="off" />}
          </Field>
          <Field label="Yearly" error={errors.priceYearly?.message ?? serverError("priceYearly")}>
            {(control) => <input {...control} {...form.register("priceYearly")} className="input" inputMode="decimal" autoComplete="off" />}
          </Field>
          <Field label="Currency" className="col-span-2 sm:col-span-1" error={errors.currency?.message ?? serverError("currency")}>
            {(control) => <input {...control} {...form.register("currency")} className="input uppercase" maxLength={3} autoComplete="off" spellCheck={false} />}
          </Field>
        </div>
        <p className="field-hint">Enter prices as decimals, for example 29 or 29.50. Use 0 for a free plan.</p>
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-3 text-xs font-semibold text-muted-foreground">Limits</legend>
        {LIMIT_KEYS.map((key) => (
          <LimitField
            key={key}
            label={LIMIT_LABELS[key].label}
            hint={`In ${LIMIT_LABELS[key].unit}. Switch on Unlimited for no cap.`}
            draft={drafts[key]}
            error={limitErrors[key] ?? serverError(key) ?? undefined}
            onChange={(draft) => {
              setDrafts((previous) => ({ ...previous, [key]: draft }));
              if (limitErrors[key]) setLimitErrors((previous) => ({ ...previous, [key]: undefined }));
            }}
          />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-xs font-semibold text-muted-foreground">Features</legend>
        {FEATURE_TOGGLES.map((feature) => (
          <Controller
            key={feature.name}
            control={form.control}
            name={feature.name}
            render={({ field }) => <Toggle label={feature.label} hint={feature.hint} checked={field.value} onChange={field.onChange} />}
          />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-3 text-xs font-semibold text-muted-foreground">Integrations a workspace may connect</legend>
        {categories.map((category) => (
          <label key={category.id} className="flex min-h-11 items-center gap-2.5 text-sm">
            <input type="checkbox" className="checkbox" value={category.id} {...form.register("integrations")} />
            {category.label}
          </label>
        ))}
        {serverError("features") ? (
          <span role="alert" className="field-error">
            {serverError("features")}
          </span>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-xs font-semibold text-muted-foreground">Availability</legend>
        <Controller
          control={form.control}
          name="isPublic"
          render={({ field }) => (
            <Toggle label="Public" hint="Offered to businesses when they sign up or change plan. Hidden plans can still be assigned here." checked={field.value} onChange={field.onChange} />
          )}
        />
        <Controller
          control={form.control}
          name="isDefault"
          render={({ field }) => (
            <Toggle
              label="Default plan"
              hint={
                plan?.isDefault
                  ? "New workspaces start on this plan. To change that, make another plan the default."
                  : "New workspaces start on the default plan. Switching this on replaces the current default."
              }
              checked={field.value}
              disabled={plan?.isDefault}
              onChange={field.onChange}
            />
          )}
        />
        <Field label="Sort order" error={errors.sortOrder?.message ?? serverError("sortOrder")} hint="Lower numbers are listed first.">
          {(control) => <input {...control} {...form.register("sortOrder")} className="input sm:w-32" inputMode="numeric" autoComplete="off" />}
        </Field>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-outline" onClick={onDone} disabled={action.pending}>
          Cancel
        </button>
        <SubmitButton pending={action.pending} pendingLabel={plan ? "Saving" : "Creating"}>
          {plan ? "Save changes" : "Create plan"}
        </SubmitButton>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ list */

export function PlanManager({ plans, categories, canEdit }: PlanManagerProps) {
  /** What the panel shows: a new plan or one being edited. Kept while the panel closes, so it does not empty mid-exit. */
  const [editing, setEditing] = useState<PlanItem | "new" | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  /** Bumped on every open, so the form always starts from the plan's saved values. */
  const [formKey, setFormKey] = useState(0);
  const [deleting, setDeleting] = useState<PlanItem | null>(null);
  const remove = useAction(deletePlanAction, { toastError: false, success: "Plan deleted" });

  function edit(target: PlanItem | "new") {
    setEditing(target);
    setFormKey((key) => key + 1);
    setPanelOpen(true);
  }

  function closeDelete(open: boolean) {
    if (open) return;
    setDeleting(null);
    remove.reset();
  }

  const flags = (plan: PlanItem) => (
    <>
      {plan.isDefault ? <span className="badge badge-default">Default</span> : null}
      {plan.isPublic ? null : <span className="badge badge-outline">Hidden</span>}
    </>
  );
  const price = (plan: PlanItem) =>
    plan.priceMonthly === 0 && plan.priceYearly === 0
      ? "Free"
      : `${formatMoney(plan.priceMonthly, plan.currency)} a month, ${formatMoney(plan.priceYearly, plan.currency)} a year`;
  const rowActions = (plan: PlanItem) => (
    <span className="flex justify-end gap-2">
      <button type="button" className="btn btn-outline btn-sm" aria-label={`Edit ${plan.name}`} onClick={() => edit(plan)}>
        Edit
      </button>
      <button type="button" className="btn btn-ghost btn-sm text-destructive" aria-label={`Delete ${plan.name}`} onClick={() => setDeleting(plan)}>
        Delete
      </button>
    </span>
  );
  const tenants = (plan: PlanItem) =>
    plan.tenantCount > 0 ? (
      <Link href={`/platform/tenants?plan=${plan.id}`} className="text-primary underline-offset-4 hover:underline">
        {formatCount(plan.tenantCount)} {plan.tenantCount === 1 ? "tenant" : "tenants"}
      </Link>
    ) : (
      <span className="text-muted-foreground">No tenants</span>
    );

  return (
    <>
      <PlatformHeader
        kicker="What each subscription costs, allows and includes."
        title="Plans"
        actions={
          canEdit ? (
            <button type="button" className="btn btn-default" onClick={() => edit("new")}>
              <Plus aria-hidden="true" />
              New plan
            </button>
          ) : null
        }
      />

      <div className="card overflow-hidden">
        {plans.length === 0 ? (
          <div className="p-14 text-center">
            <p className="font-bold">No plans yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canEdit ? "Businesses cannot sign up until a plan exists. The first plan you create becomes the default." : "A platform owner has to create the first plan."}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="table min-w-[860px]">
                <thead>
                  <tr>
                    <th scope="col" className="pl-6">
                      Plan
                    </th>
                    <th scope="col">Price</th>
                    <th scope="col">Limits</th>
                    <th scope="col">In use</th>
                    {canEdit ? (
                      <th scope="col" className="pr-6">
                        <span className="sr-only">Actions</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id}>
                      <td className="pl-6">
                        <span className="flex flex-wrap items-center gap-2 font-bold">
                          {plan.name}
                          {flags(plan)}
                        </span>
                        <span className="text-xs text-muted-foreground">{plan.code}</span>
                      </td>
                      <td className="whitespace-nowrap">{price(plan)}</td>
                      <td className="max-w-[280px] text-muted-foreground">{limitsSummary(plan)}</td>
                      <td className="whitespace-nowrap">{tenants(plan)}</td>
                      {canEdit ? <td className="pr-6">{rowActions(plan)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y md:hidden">
              {plans.map((plan) => (
                <li key={plan.id} className="flex flex-col gap-1.5 p-4">
                  <span className="flex flex-wrap items-center gap-2 font-bold">
                    {plan.name}
                    {flags(plan)}
                  </span>
                  <span className="text-sm">{price(plan)}</span>
                  <span className="text-[13px] text-muted-foreground">{limitsSummary(plan)}</span>
                  <span className="flex items-center justify-between gap-3 pt-1 text-[13px]">
                    {tenants(plan)}
                    {canEdit ? rowActions(plan) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="border-t px-6 py-3 text-[13px] text-muted-foreground">
          {plans.length} {plans.length === 1 ? "plan" : "plans"}. Changing a plan&apos;s limits applies to every workspace on it straight away.
        </div>
      </div>

      <Panel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title={editing === "new" ? "New plan" : editing ? `Edit ${editing.name}` : "Plan"}
        description={editing === "new" ? "Prices are per workspace. Limits can be raised for a single workspace later." : undefined}
      >
        {editing !== null ? (
          <PlanForm key={formKey} plan={editing === "new" ? null : editing} categories={categories} onDone={() => setPanelOpen(false)} />
        ) : null}
      </Panel>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={closeDelete}
        title={deleting ? `Delete the ${deleting.name} plan?` : "Delete plan?"}
        description={
          <div className="flex flex-col gap-3">
            <p>The plan is removed for good. A plan that still has workspaces on it, or is the default, cannot be deleted.</p>
            {remove.error ? (
              <p role="alert" className="alert alert-destructive">
                {remove.error}
              </p>
            ) : null}
          </div>
        }
        confirmLabel="Delete plan"
        destructive
        pending={remove.pending}
        onConfirm={async () => {
          if (!deleting) return;
          const result = await remove.run({ planId: deleting.id });
          if (result.ok) closeDelete(false);
        }}
      />
    </>
  );
}
