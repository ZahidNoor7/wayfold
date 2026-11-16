"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Field, firstError, FormError, SubmitButton } from "@/components/form";
import { ConfirmDialog, Modal } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { formatMoney } from "@/lib/dates";
import { decimalToMinor, formatDate, isCurrencyCode, slugProblem } from "@/lib/platform-display";
import {
  activateTenantAction,
  cancelSubscriptionAction,
  changeTenantPlanAction,
  issueInvoiceAction,
  renewSubscriptionAction,
  requestSupportAccessAction,
  setTenantOwnerAction,
  suspendTenantAction,
  updateTenantAction,
} from "@/app/platform/(console)/tenants/actions";

type Cycle = "monthly" | "yearly";

function FormFooter({ pending, onCancel, label, pendingLabel }: { pending: boolean; onCancel: () => void; label: string; pendingLabel: string }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" className="btn btn-outline" onClick={onCancel} disabled={pending}>
        Cancel
      </button>
      <SubmitButton pending={pending} pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
    </div>
  );
}

/* ------------------------------------------------------------------ edit */

const editSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name.").max(80, "Keep the name under 80 characters."),
  slug: z
    .string()
    .trim()
    .min(1, "Enter the workspace address.")
    .superRefine((value, context) => {
      const problem = slugProblem(value);
      if (problem) context.addIssue({ code: "custom", message: problem });
    }),
});
type EditValues = z.infer<typeof editSchema>;

export function EditTenantButton({ tenantId, name, slug, rootDomain }: { tenantId: string; name: string; slug: string; rootDomain: string }) {
  const [open, setOpen] = useState(false);
  const form = useForm<EditValues>({ resolver: zodResolver(editSchema), defaultValues: { name, slug } });
  const { errors } = form.formState;
  const action = useAction(updateTenantAction, { toastError: false, success: "Tenant details saved" });
  const typedSlug = useWatch({ control: form.control, name: "slug" }).trim().toLowerCase();

  function change(next: boolean) {
    setOpen(next);
    if (next) form.reset({ name, slug });
    else action.reset();
  }

  const submit = form.handleSubmit(async (values) => {
    const result = await action.run({ tenantId, name: values.name, slug: values.slug.toLowerCase() });
    if (result.ok) setOpen(false);
  });

  return (
    <>
      <button type="button" className="btn btn-outline" onClick={() => change(true)}>
        Edit details
      </button>
      <Modal open={open} onOpenChange={change} title="Edit tenant details">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <FormError message={action.fieldErrors ? null : action.error} />
          <Field label="Business name" error={errors.name?.message ?? firstError(action.fieldErrors, "name")}>
            {(control) => <input {...control} {...form.register("name")} className="input" autoComplete="off" />}
          </Field>
          <Field
            label="Workspace address"
            error={errors.slug?.message ?? firstError(action.fieldErrors, "slug")}
            hint={
              typedSlug !== slug
                ? `The storefront moves to ${typedSlug || "…"}.${rootDomain}. Links to ${slug}.${rootDomain} stop working.`
                : `The storefront is at ${slug}.${rootDomain}.`
            }
          >
            {(control) => (
              <input
                {...control}
                {...form.register("slug", { onChange: () => void form.trigger("slug") })}
                className="input"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            )}
          </Field>
          <FormFooter pending={action.pending} onCancel={() => change(false)} label="Save changes" pendingLabel="Saving" />
        </form>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------ suspend/activate */

export function SuspendTenantButton({ tenantId, name }: { tenantId: string; name: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const action = useAction(suspendTenantAction, { toastError: false, success: "Workspace suspended" });
  const error = problem ?? firstError(action.fieldErrors, "reason") ?? (action.fieldErrors ? null : action.error);

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setReason("");
      setProblem(null);
      action.reset();
    }
  }

  async function confirm() {
    const text = reason.trim();
    if (text.length < 3) {
      setProblem("Say why the workspace is being suspended.");
      document.getElementById(id)?.focus();
      return;
    }
    setProblem(null);
    const result = await action.run({ tenantId, reason: text });
    if (result.ok) change(false);
  }

  return (
    <>
      <button type="button" className="btn btn-destructive" onClick={() => setOpen(true)}>
        Suspend
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={change}
        title={`Suspend ${name}?`}
        description={
          <div className="flex flex-col gap-4">
            <p>Everyone in this workspace is locked out and its storefront goes offline until it is activated again. Nothing is deleted.</p>
            <div className="flex flex-col gap-2 text-foreground">
              <label htmlFor={id} className="label">
                Reason
              </label>
              <textarea
                id={id}
                className="textarea"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (problem) setProblem(null);
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : `${id}-hint`}
                placeholder="For example: invoice INV-2026-000012 unpaid after two reminders"
              />
              {error ? (
                <span id={`${id}-error`} role="alert" className="field-error">
                  {error}
                </span>
              ) : (
                <span id={`${id}-hint`} className="field-hint">
                  Recorded in the audit log and shown on this page.
                </span>
              )}
            </div>
          </div>
        }
        confirmLabel="Suspend workspace"
        destructive
        pending={action.pending}
        onConfirm={confirm}
      />
    </>
  );
}

export function ActivateTenantButton({ tenantId, name }: { tenantId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const action = useAction(activateTenantAction, { success: "Workspace activated" });

  return (
    <>
      <button type="button" className="btn btn-default" onClick={() => setOpen(true)}>
        Activate
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Activate ${name}?`}
        description="Members can sign in again and the storefront comes back online straight away."
        confirmLabel="Activate workspace"
        pending={action.pending}
        onConfirm={async () => {
          await action.run({ tenantId });
          setOpen(false);
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ plan */

export interface PlanChoice {
  id: string;
  name: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
}

export function ChangePlanButton({ tenantId, plans, currentPlanId, currentCycle }: { tenantId: string; plans: PlanChoice[]; currentPlanId: string; currentCycle: Cycle | null }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState(currentPlanId);
  const [cycle, setCycle] = useState<Cycle>(currentCycle ?? "monthly");
  const action = useAction(changeTenantPlanAction, { toastError: false, success: "Plan changed" });
  const chosen = plans.find((plan) => plan.id === planId);
  const unchanged = planId === currentPlanId && cycle === (currentCycle ?? "monthly");

  function change(next: boolean) {
    setOpen(next);
    if (next) {
      setPlanId(currentPlanId);
      setCycle(currentCycle ?? "monthly");
    } else action.reset();
  }

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => change(true)}>
        Change plan
      </button>
      <Modal open={open} onOpenChange={change} title="Change plan" description="The new limits and features apply immediately. No invoice is issued by this change.">
        <form
          className="flex flex-col gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await action.run({ tenantId, planId, cycle });
            if (result.ok) setOpen(false);
          }}
        >
          <FormError message={action.error} />
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-plan`} className="label">
              Plan
            </label>
            <select id={`${id}-plan`} className="select" value={planId} onChange={(event) => setPlanId(event.target.value)}>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                  {plan.id === currentPlanId ? " (current)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-cycle`} className="label">
              Billing cycle
            </label>
            <select id={`${id}-cycle`} className="select" value={cycle} onChange={(event) => setCycle(event.target.value as Cycle)}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            {chosen ? (
              <span className="field-hint">
                {chosen.name}: {formatMoney(cycle === "yearly" ? chosen.priceYearly : chosen.priceMonthly, chosen.currency)} per {cycle === "yearly" ? "year" : "month"}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-outline" onClick={() => change(false)} disabled={action.pending}>
              Cancel
            </button>
            <SubmitButton pending={action.pending} pendingLabel="Changing" disabled={unchanged}>
              Change plan
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

/* --------------------------------------------------------------- invoice */

const invoiceSchema = z
  .object({
    description: z.string().trim().min(3, "Describe what is being invoiced.").max(200, "Keep the description under 200 characters."),
    amount: z.string().trim().min(1, "Enter the amount."),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isCurrencyCode, "Use a three-letter currency code, such as USD."),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the first day of the period."),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the last day of the period."),
  })
  .superRefine((values, context) => {
    if (isCurrencyCode(values.currency)) {
      const minor = decimalToMinor(values.amount, values.currency);
      if (minor === null) context.addIssue({ code: "custom", path: ["amount"], message: `Enter an amount ${values.currency} can express, such as 29 or 29.50.` });
      else if (minor < 1) context.addIssue({ code: "custom", path: ["amount"], message: "The amount must be more than zero." });
    }
    if (values.start && values.end && values.end < values.start) {
      context.addIssue({ code: "custom", path: ["end"], message: "The period cannot end before it starts." });
    }
  });
type InvoiceValues = z.infer<typeof invoiceSchema>;

export function IssueInvoiceButton({ tenantId, currency, periodStart, periodEnd }: { tenantId: string; currency: string; periodStart: string; periodEnd: string }) {
  const [open, setOpen] = useState(false);
  const defaults: InvoiceValues = { description: "", amount: "", currency, start: periodStart, end: periodEnd };
  const form = useForm<InvoiceValues>({ resolver: zodResolver(invoiceSchema), defaultValues: defaults });
  const { errors } = form.formState;
  const action = useAction(issueInvoiceAction, { toastError: false, success: (data) => `Invoice ${data.number} issued` });

  function change(next: boolean) {
    setOpen(next);
    if (next) form.reset(defaults);
    else action.reset();
  }

  const submit = form.handleSubmit(async (values) => {
    const amount = decimalToMinor(values.amount, values.currency);
    if (amount === null) return;
    const result = await action.run({
      tenantId,
      description: values.description,
      amount,
      currency: values.currency,
      period: { start: values.start, end: values.end },
    });
    if (result.ok) setOpen(false);
  });

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => change(true)}>
        Issue invoice
      </button>
      <Modal open={open} onOpenChange={change} title="Issue invoice" description="Creates an open invoice for this workspace. Mark it paid in Billing once the money arrives.">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <FormError message={action.fieldErrors ? null : action.error} />
          <Field label="Description" error={errors.description?.message ?? firstError(action.fieldErrors, "description")}>
            {(control) => <input {...control} {...form.register("description")} className="input" autoComplete="off" placeholder="Onboarding and data import" />}
          </Field>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="Amount" error={errors.amount?.message ?? firstError(action.fieldErrors, "amount")}>
              {(control) => <input {...control} {...form.register("amount")} className="input" inputMode="decimal" autoComplete="off" placeholder="0.00" />}
            </Field>
            <Field label="Currency" error={errors.currency?.message ?? firstError(action.fieldErrors, "currency")}>
              {(control) => <input {...control} {...form.register("currency")} className="input uppercase" maxLength={3} autoComplete="off" spellCheck={false} />}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Period start" error={errors.start?.message ?? firstError(action.fieldErrors, "period")}>
              {(control) => <input {...control} {...form.register("start")} className="input" type="date" />}
            </Field>
            <Field label="Period end" error={errors.end?.message}>
              {(control) => <input {...control} {...form.register("end")} className="input" type="date" />}
            </Field>
          </div>
          <FormFooter pending={action.pending} onCancel={() => change(false)} label="Issue invoice" pendingLabel="Issuing" />
        </form>
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------- subscription */

export function RenewSubscriptionButton({ tenantId, cycle, periodEnd }: { tenantId: string; cycle: Cycle; periodEnd: Date }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<Cycle>(cycle);
  const action = useAction(renewSubscriptionAction, {
    toastError: false,
    success: (data) =>
      data.invoiceNumber
        ? `Subscription renewed to ${formatDate(data.periodEnd)}. Invoice ${data.invoiceNumber} issued.`
        : `Subscription renewed to ${formatDate(data.periodEnd)}. Nothing to invoice.`,
  });

  function change(value: boolean) {
    setOpen(value);
    if (value) setNext(cycle);
    else action.reset();
  }

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => change(true)}>
        Renew
      </button>
      <Modal
        open={open}
        onOpenChange={change}
        title="Renew subscription"
        description={`Starts the next period after ${formatDate(periodEnd)} (or today, if that has passed), re-activates the subscription and issues an invoice for a paid plan.`}
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await action.run({ tenantId, cycle: next });
            if (result.ok) setOpen(false);
          }}
        >
          <FormError message={action.error} />
          <div className="flex flex-col gap-2">
            <label htmlFor={id} className="label">
              Billing cycle for the new period
            </label>
            <select id={id} className="select" value={next} onChange={(event) => setNext(event.target.value as Cycle)}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <FormFooter pending={action.pending} onCancel={() => change(false)} label="Renew subscription" pendingLabel="Renewing" />
        </form>
      </Modal>
    </>
  );
}

export function CancelSubscriptionButton({ tenantId, name, periodEnd }: { tenantId: string; name: string; periodEnd: Date }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [immediately, setImmediately] = useState(false);
  const action = useAction(cancelSubscriptionAction, {
    success: (data) => (data.status === "cancelled" ? "Subscription cancelled" : `Subscription will end on ${formatDate(data.periodEnd)}`),
  });

  function change(next: boolean) {
    setOpen(next);
    if (!next) setImmediately(false);
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm text-destructive" onClick={() => setOpen(true)}>
        Cancel subscription
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={change}
        title={`Cancel the subscription of ${name}?`}
        description={
          <div className="flex flex-col gap-3">
            <p>
              {immediately
                ? "The subscription ends now. The workspace keeps its data."
                : `The subscription runs until ${formatDate(periodEnd)} and is not renewed after that. The workspace keeps its data.`}
            </p>
            <label htmlFor={id} className="flex min-h-11 items-center gap-2.5 text-foreground">
              <input id={id} type="checkbox" className="checkbox" checked={immediately} onChange={(event) => setImmediately(event.target.checked)} />
              End it now instead of at the end of the paid period
            </label>
          </div>
        }
        confirmLabel={immediately ? "Cancel now" : "Cancel at period end"}
        cancelLabel="Keep subscription"
        destructive
        pending={action.pending}
        onConfirm={async () => {
          await action.run({ tenantId, immediately });
          change(false);
        }}
      />
    </>
  );
}

/* --------------------------------------------------------------- support */

const supportSchema = z.object({
  reason: z.string().trim().min(10, "Explain why access is needed (at least 10 characters).").max(500, "Keep the reason under 500 characters."),
});
type SupportValues = z.infer<typeof supportSchema>;

export function RequestSupportButton({ tenantId, name }: { tenantId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<SupportValues>({ resolver: zodResolver(supportSchema), defaultValues: { reason: "" } });
  const action = useAction(requestSupportAccessAction, { toastError: false });

  function change(next: boolean) {
    setOpen(next);
    if (next) form.reset({ reason: "" });
    else action.reset();
  }

  const submit = form.handleSubmit(async (values) => {
    const result = await action.run({ tenantId, reason: values.reason });
    if (!result.ok) return;
    setOpen(false);
    toast.success(
      result.data.notified > 0
        ? `Support access requested. ${result.data.notified} ${result.data.notified === 1 ? "person was" : "people were"} e-mailed to decide.`
        : "Support access requested. Nobody could be e-mailed, so ask the owner to open Settings, Support access.",
    );
    router.push("/platform/support");
  });

  return (
    <>
      <button type="button" className="btn btn-outline" onClick={() => change(true)}>
        Request support access
      </button>
      <Modal
        open={open}
        onOpenChange={change}
        title={`Request access to ${name}`}
        description="Nothing happens until someone in the workspace approves. Approved access is view-only, lasts a limited time, and is shown to the workspace throughout."
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <FormError message={action.fieldErrors ? null : action.error} />
          <Field
            label="Reason"
            error={form.formState.errors.reason?.message ?? firstError(action.fieldErrors, "reason")}
            hint="The workspace's owners read this when they decide. Say what you need to look at and why."
          >
            {(control) => <textarea {...control} {...form.register("reason")} className="textarea" rows={4} maxLength={500} />}
          </Field>
          <FormFooter pending={action.pending} onCancel={() => change(false)} label="Send request" pendingLabel="Sending" />
        </form>
      </Modal>
    </>
  );
}

/* ----------------------------------------------------------------- owner */

const ownerSchema = z.object({ email: z.string().trim().pipe(z.email("Enter a valid e-mail address.")) });
type OwnerValues = z.infer<typeof ownerSchema>;

export function TransferOwnerButton({ tenantId, name, administrators }: { tenantId: string; name: string; administrators: { name: string; email: string }[] }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const form = useForm<OwnerValues>({ resolver: zodResolver(ownerSchema), defaultValues: { email: "" } });
  const action = useAction(setTenantOwnerAction, { toastError: false, success: "Ownership transferred" });
  const serverError = firstError(action.fieldErrors, "email") ?? firstError(action.fieldErrors, "userId");

  function change(next: boolean) {
    setOpen(next);
    if (next) form.reset({ email: "" });
    else action.reset();
  }

  const submit = form.handleSubmit(async (values) => {
    const result = await action.run({ tenantId, email: values.email });
    if (result.ok) setOpen(false);
  });

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => change(true)}>
        Transfer ownership
      </button>
      <Modal
        open={open}
        onOpenChange={change}
        title={`Transfer ownership of ${name}`}
        description="The account you name becomes the owner. Current owners stay in the workspace as administrators."
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <FormError message={serverError ? null : action.error} />
          <Field
            label="New owner's e-mail"
            error={form.formState.errors.email?.message ?? serverError}
            hint="Must belong to an existing Wayfold account. They do not need to be a member of this workspace yet."
          >
            {(control) => <input {...control} {...form.register("email")} className="input" type="email" autoComplete="off" spellCheck={false} list={listId} />}
          </Field>
          <datalist id={listId}>
            {administrators.map((person) => (
              <option key={person.email} value={person.email}>
                {person.name}
              </option>
            ))}
          </datalist>
          <FormFooter pending={action.pending} onCancel={() => change(false)} label="Transfer ownership" pendingLabel="Transferring" />
        </form>
      </Modal>
    </>
  );
}
