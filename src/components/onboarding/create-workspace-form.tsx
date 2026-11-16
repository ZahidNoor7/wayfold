"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { checkSlugAction, createWorkspaceAction, suggestSlugAction } from "@/app/workspaces/actions";
import { leaveTo } from "@/components/auth/clear-caches";
import { applyServerErrors } from "@/components/auth/form-utils";
import { Field, FormError, SubmitButton } from "@/components/form";
import type { PlanPrice } from "@/components/marketing/plan-format";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { normaliseSlugInput, SLUG_MAX_LENGTH, slugProblemMessage, type SlugProblem } from "./slug";
import { usePausedTask } from "./use-paused-task";

export interface PlanOption {
  code: string;
  name: string;
  description: string;
  price: PlanPrice;
  limits: string[];
  /** Only free, public plans can be chosen here; the server enforces it. */
  selectable: boolean;
}

const schema = z.object({
  name: z.string().trim().min(2, "Enter your business name.").max(80, "Keep the name under 80 characters."),
  slug: z.string().max(SLUG_MAX_LENGTH),
  planCode: z.string(),
});
type Values = z.infer<typeof schema>;

type AddressStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "unavailable"; reason: SlugProblem | undefined; suggestion?: string };

/** Typing pauses this long before the server is asked: one request per pause, not per key. */
const PAUSE_MS = 350;

interface CreateWorkspaceFormProps {
  plans: PlanOption[];
  rootDomain: string;
}

export function CreateWorkspaceForm({ plans, rootDomain }: CreateWorkspaceFormProps) {
  const selectable = plans.filter((plan) => plan.selectable);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", slug: "", planCode: selectable[0]?.code ?? "" },
  });
  const { run, pending } = useAction(createWorkspaceAction, { toastError: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<AddressStatus>({ kind: "idle" });
  const [leaving, setLeaving] = useState(false);
  // Once the address is typed by hand, the business name stops rewriting it.
  const [addressTyped, setAddressTyped] = useState(false);
  const { schedule: afterPause, cancel: cancelPending } = usePausedTask(PAUSE_MS);
  const statusId = useId();
  const planGroup = useId();

  const slug = useWatch({ control: form.control, name: "slug" });
  const planCode = useWatch({ control: form.control, name: "planCode" });
  const { errors } = form.formState;

  function suggestFrom(name: string) {
    const value = name.trim();
    if (value.length < 2) {
      cancelPending();
      form.setValue("slug", "");
      setStatus({ kind: "idle" });
      return;
    }
    setStatus({ kind: "checking" });
    afterPause(async (isCurrent) => {
      const result = await suggestSlugAction({ name: value }).catch(() => null);
      if (!isCurrent()) return;
      if (result?.ok) {
        form.setValue("slug", result.data.slug);
        form.clearErrors("slug");
        setStatus({ kind: "available" });
      } else {
        setStatus({ kind: "idle" });
      }
    });
  }

  function check(address: string) {
    if (address.length < 3) {
      cancelPending();
      setStatus(address.length === 0 ? { kind: "idle" } : { kind: "unavailable", reason: "invalid" });
      return;
    }
    setStatus({ kind: "checking" });
    afterPause(async (isCurrent) => {
      const result = await checkSlugAction({ slug: address }).catch(() => null);
      if (!isCurrent()) return;
      if (!result?.ok) {
        setStatus({ kind: "idle" });
        return;
      }
      setStatus(result.data.available ? { kind: "available" } : { kind: "unavailable", reason: result.data.reason, suggestion: result.data.suggestion });
    });
  }

  const nameField = form.register("name", {
    onChange: (event: { target: { value: string } }) => {
      if (!addressTyped) suggestFrom(event.target.value);
    },
  });

  const slugField = form.register("slug", {
    onChange: (event: { target: { value: string } }) => {
      const tidy = normaliseSlugInput(event.target.value);
      form.setValue("slug", tidy);
      form.clearErrors("slug");
      // Emptying the field hands the address back to the business name.
      setAddressTyped(tidy.length > 0);
      if (tidy.length === 0) suggestFrom(form.getValues("name"));
      else check(tidy);
    },
  });

  function applySuggestion(suggestion: string) {
    cancelPending();
    setAddressTyped(true);
    form.setValue("slug", suggestion);
    form.clearErrors("slug");
    setStatus({ kind: "available" });
    form.setFocus("slug");
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    if (status.kind === "unavailable") {
      form.setError("slug", { type: "manual", message: slugProblemMessage(status.reason) });
      form.setFocus("slug");
      return;
    }
    cancelPending();
    const result = await run({
      name: values.name,
      ...(values.slug ? { slug: values.slug } : {}),
      ...(values.planCode ? { planCode: values.planCode } : {}),
    });
    if (result.ok) {
      // The new workspace becomes the active one: a workspace switch.
      setLeaving(true);
      await leaveTo(result.data.redirectTo);
      return;
    }
    if (result.fieldErrors?.slug) setStatus({ kind: "idle" });
    if (applyServerErrors(form, result.fieldErrors, ["name", "slug"])) return;
    setFormError(result.fieldErrors?.planCode?.[0] ?? result.error);
    form.setFocus("name");
  });

  const slugError = errors.slug?.message ?? (status.kind === "unavailable" ? slugProblemMessage(status.reason) : null);

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      <FormError message={formError} />

      <Field label="Business name" error={errors.name?.message} hint="The name guests see on your website. You can change it later.">
        {(control) => <input {...control} {...nameField} className="input" autoComplete="organization" />}
      </Field>

      <Field label="Website address" error={slugError}>
        {(control) => (
          <>
            <div className="flex">
              <input
                {...control}
                {...slugField}
                aria-describedby={[control["aria-describedby"], statusId].filter(Boolean).join(" ")}
                className="input min-w-0 rounded-r-none"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={SLUG_MAX_LENGTH}
              />
              <span className="inline-flex max-w-[55%] shrink-0 items-center truncate rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                .{rootDomain}
              </span>
            </div>
            <p id={statusId} aria-live="polite" className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              {status.kind === "checking" ? (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Spinner className="size-3.5" /> Checking the address…
                </span>
              ) : null}
              {status.kind === "available" && slug ? (
                <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-success">
                  <Check aria-hidden="true" className="size-4 shrink-0" />
                  <span className="break-all">
                    {slug}.{rootDomain} is available
                  </span>
                </span>
              ) : null}
              {status.kind === "unavailable" && status.suggestion ? (
                <button type="button" className="btn btn-link px-0 text-[13px]" onClick={() => applySuggestion(status.suggestion!)}>
                  Use {status.suggestion} instead
                </button>
              ) : null}
              {status.kind === "idle" && !slug ? (
                <span className="text-muted-foreground">Type your business name and we will suggest a free address.</span>
              ) : null}
            </p>
          </>
        )}
      </Field>

      {plans.length > 0 ? (
        <fieldset className="min-w-0">
          <legend className="label mb-1">Plan</legend>
          <p className="mb-3 text-xs text-muted-foreground">
            {selectable.length > 0
              ? "Start on a free plan. Paid plans are switched on from Plan & billing in your workspace."
              : "Your workspace starts on the standard plan. You can ask for another from Plan & billing."}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {plans.map((plan) => (
              <label
                key={plan.code}
                className={cn(
                  "relative flex flex-col gap-2 rounded-xl border-2 border-border bg-card p-4 text-card-foreground transition-[border-color,box-shadow,transform] duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                  plan.selectable ? "cursor-pointer hover:border-ring active:scale-[0.99] has-[:checked]:border-primary has-[:checked]:shadow-md" : "opacity-70",
                )}
              >
                <input
                  type="radio"
                  name={planGroup}
                  value={plan.code}
                  checked={planCode === plan.code}
                  disabled={!plan.selectable}
                  onChange={() => form.setValue("planCode", plan.code)}
                  className="sr-only"
                />
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-bold">{plan.name}</span>
                  <span className="shrink-0 text-sm">
                    <span className="font-display text-xl text-primary">{plan.price.amount}</span>
                    {plan.price.period ? <span className="text-muted-foreground"> {plan.price.period}</span> : null}
                  </span>
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{plan.limits.join(", ")}.</span>
                {plan.selectable ? null : <span className="badge badge-outline self-start">Upgrade later</span>}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex justify-end border-t pt-5">
        <SubmitButton pending={pending || leaving} pendingLabel="Creating your workspace…" className="btn-lg w-full sm:w-auto">
          Create workspace
        </SubmitButton>
      </div>
    </form>
  );
}
