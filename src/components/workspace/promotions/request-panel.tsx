"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { approveDiscountRequestAction, rejectDiscountRequestAction } from "@/app/workspace/promotions/actions";
import { Field, FormError } from "@/components/form";
import { Panel, Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { firstName, formatDateTime, formatGuests, mailtoLink } from "@/lib/booking-display";
import { formatMoney } from "@/lib/dates";
import {
  approvalError,
  approvalHint,
  defaultLowerApproval,
  discountAmount,
  discountInputValue,
  formatDiscountLabel,
  isOverMaximum,
  nextTabIndex,
  parseDiscountValue,
  priceAfter,
  REQUEST_STATUS_BADGES,
  REQUEST_STATUS_LABELS,
  valueFieldLabel,
  type DiscountType,
} from "@/lib/promotion-display";
import { cn } from "@/lib/utils";
import type { PromotionsContext, RequestDetail, RequestItem } from "./promotions-view";
import { AccessNote } from "./shared";

interface RequestPanelProps extends PromotionsContext {
  request: RequestItem | null;
  onClose: () => void;
}

/** The request detail and decision panel. Keeps showing the last request while it slides away. */
export function RequestPanel({ request, onClose, ...context }: RequestPanelProps) {
  const [last, setLast] = useState(request);
  if (request && request !== last) setLast(request);
  const shown = request ?? last;

  return (
    <Panel
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={shown ? shown.name : "Discount request"}
      description={shown ? `${shown.reference} · received ${formatDateTime(shown.createdAt, context.timezone)}` : undefined}
    >
      {shown ? <RequestBody key={shown.id} request={shown} onClose={onClose} {...context} /> : null}
    </Panel>
  );
}

type Mode = "full" | "lower" | "reject";

const MODES: { key: Mode; label: string }[] = [
  { key: "full", label: "Approve in full" },
  { key: "lower", label: "Approve lower" },
  { key: "reject", label: "Reject" },
];

function RequestBody({ request, onClose, ...context }: { request: RequestItem; onClose: () => void } & PromotionsContext) {
  const { currency, timezone } = context;
  const asked = formatDiscountLabel(request.type, request.value, currency);
  const detail = request.detail;

  return (
    <div className="flex flex-col gap-5 p-5 sm:p-6">
      <div>
        <span className={REQUEST_STATUS_BADGES[request.status]}>{REQUEST_STATUS_LABELS[request.status]}</span>
      </div>

      <section aria-label="Contact" className="flex flex-col gap-2 rounded-lg bg-muted/60 p-4 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">E-mail</span>
          <a href={mailtoLink(request.email, `Your discount request ${request.reference}`)} className="min-w-0 truncate font-semibold text-primary underline-offset-4 hover:underline">
            {request.email}
          </a>
        </div>
        {request.phone ? (
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Phone</span>
            <a href={`tel:${request.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-primary underline-offset-4 hover:underline">
              {request.phone}
            </a>
          </div>
        ) : null}
      </section>

      <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5 text-sm sm:grid-cols-[140px_1fr]">
        <dt className="text-muted-foreground">Tour</dt>
        <dd className="font-semibold">{request.tourTitle}</dd>
        <dt className="text-muted-foreground">Party</dt>
        <dd>{formatGuests(request.adults, request.children)}</dd>
        {detail ? (
          <>
            <dt className="text-muted-foreground">Party price</dt>
            <dd>{formatMoney(detail.limits.base, currency)}</dd>
            <dt className="text-muted-foreground">Requested</dt>
            <dd className="font-semibold">
              {asked} ({formatMoney(discountAmount(request.type, request.value, detail.limits.base), currency)}) →{" "}
              {formatMoney(priceAfter(request.type, request.value, detail.limits.base), currency)}
            </dd>
            <dt className="text-muted-foreground">Your private max</dt>
            <dd>
              {detail.limits.cap.percent}% <span className="text-xs text-muted-foreground">· not visible to the customer</span>
            </dd>
          </>
        ) : (
          <>
            <dt className="text-muted-foreground">Requested</dt>
            <dd className="font-semibold">{asked}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Reason</dt>
        <dd className="leading-relaxed">{request.reason ? `“${request.reason}”` : "—"}</dd>
        {detail ? (
          <>
            <dt className="text-muted-foreground">Existing offers</dt>
            <dd>
              {detail.offers[0]
                ? `${detail.offers[0]} already applies — the better of the two will be used, never both.`
                : "None apply today. Offers that need booking ahead depend on the travel date."}
            </dd>
          </>
        ) : null}
      </dl>

      {request.status === "pending" ? (
        detail ? (
          <DecisionForm request={request} detail={detail} onClose={onClose} {...context} />
        ) : (
          <p className="text-sm text-muted-foreground">Reload the page to decide this request.</p>
        )
      ) : (
        <Decision request={request} currency={currency} timezone={timezone} />
      )}
    </div>
  );
}

function Decision({ request, currency, timezone }: { request: RequestItem; currency: string; timezone: string }) {
  const meta = `By ${request.decidedByName ?? "a team member"}${request.decidedAt ? ` · ${formatDateTime(request.decidedAt, timezone)}` : ""} · customer e-mailed`;
  if (request.status === "approved" && request.decidedType && request.decidedValue) {
    const granted = formatDiscountLabel(request.decidedType, request.decidedValue, currency);
    const partial = request.decidedType !== request.type || request.decidedValue !== request.value;
    return (
      <div className="alert border-emerald-600/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
        <p className="font-bold">
          Approved · {granted}
          {partial ? <span className="font-normal"> (asked for {formatDiscountLabel(request.type, request.value, currency)})</span> : null}
        </p>
        <p className="mt-1">
          Single-use discount for {request.email} on {request.tourTitle} ·{" "}
          {request.usedByBookingReference ? `used on ${request.usedByBookingReference}` : "not used yet"}
          {request.decisionNote ? ` · Note: ${request.decisionNote}` : ""}
        </p>
        <p className="mt-2 text-xs opacity-80">{meta}</p>
      </div>
    );
  }
  return (
    <div className="alert alert-destructive">
      <p className="font-bold">Rejected</p>
      <p className="mt-1">{request.decisionNote ? `“${request.decisionNote}”` : "No reason recorded."}</p>
      <p className="mt-2 text-xs opacity-80">Reason shown to the customer · {meta}</p>
    </div>
  );
}

interface DecisionValues {
  type: DiscountType;
  value: string;
  reason: string;
  note: string;
}

function DecisionForm({
  request,
  detail,
  onClose,
  access,
  currency,
}: { request: RequestItem; detail: RequestDetail; onClose: () => void } & PromotionsContext) {
  const { limits } = detail;
  const overMax = isOverMaximum(limits);
  const [mode, setMode] = useState<Mode>(detail.canApproveInFull ? "full" : "lower");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lower = defaultLowerApproval(limits);
  const form = useForm<DecisionValues>({
    defaultValues: { type: lower.type, value: discountInputValue(lower.type, lower.value, currency), reason: "", note: "" },
  });
  const { errors } = form.formState;
  const first = firstName(request.name);

  const approve = useAction(approveDiscountRequestAction, { toastError: false, success: `Approved — ${first || "the customer"} notified by e-mail` });
  const reject = useAction(rejectDiscountRequestAction, { toastError: false, success: `Rejected — ${first || "the customer"} notified by e-mail` });
  const pending = approve.pending || reject.pending;
  const active = mode === "reject" ? reject : approve;

  const watched = useWatch({ control: form.control });
  const type: DiscountType = watched.type ?? "percent";
  const parsed = parseDiscountValue(type, watched.value ?? "", currency);
  const liveError = mode === "lower" && parsed.ok ? approvalError(type, parsed.value, limits) : null;
  const askedAmount = discountAmount(request.type, request.value, limits.base);

  const disabled = (key: Mode) => key === "full" && !detail.canApproveInFull;

  function pick(key: Mode) {
    if (disabled(key)) return;
    setMode(key);
    form.clearErrors();
    approve.reset();
    reject.reset();
  }

  function onModeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = MODES.findIndex((item) => item.key === mode);
    let next = nextTabIndex(event.key, current, MODES.length);
    if (next === null) return;
    event.preventDefault();
    if (disabled(MODES[next]!.key)) next = nextTabIndex(event.key === "ArrowLeft" || event.key === "End" ? "ArrowLeft" : "ArrowRight", next, MODES.length)!;
    pick(MODES[next]!.key);
    tabRefs.current[next]?.focus();
  }

  const submit = form.handleSubmit(async (values) => {
    if (mode === "reject") {
      const reason = values.reason.trim();
      if (!reason) {
        form.setError("reason", { message: "Add a reason so the customer understands." }, { shouldFocus: true });
        return;
      }
      const result = await reject.run({ id: request.id, reason });
      if (result.ok) onClose();
      else if (result.fieldErrors?.reason?.[0]) form.setError("reason", { message: result.fieldErrors.reason[0] }, { shouldFocus: true });
      return;
    }

    let decision: { type: DiscountType; value: number };
    if (mode === "full") {
      decision = { type: request.type, value: request.value };
    } else {
      const value = parseDiscountValue(values.type, values.value, currency);
      const problem = value.ok ? approvalError(values.type, value.value, limits) : value.error;
      if (!value.ok || problem) {
        form.setError("value", { message: problem ?? "Enter the discount you’re approving." }, { shouldFocus: true });
        return;
      }
      decision = { type: values.type, value: value.value };
    }
    const result = await approve.run({ id: request.id, ...decision, note: values.note.trim() || undefined });
    if (result.ok) onClose();
    else if (result.fieldErrors?.value?.[0] && mode === "lower") form.setError("value", { message: result.fieldErrors.value[0] }, { shouldFocus: true });
  });

  const formError = active.error && !(mode === "lower" && errors.value) && !(mode === "reject" && errors.reason) ? active.error : null;
  const button =
    mode === "full"
      ? { label: `Approve ${asked(request, currency)} & notify`, className: "btn btn-default" }
      : mode === "lower"
        ? { label: "Approve lower & notify", className: "btn btn-default" }
        : { label: "Reject & notify", className: "btn btn-destructive" };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="separator" />

      <div role="tablist" aria-label="Decision" className="tabs-list grid w-full grid-cols-3" onKeyDown={onModeKeyDown}>
        {MODES.map((item, index) => (
          <button
            key={item.key}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={`decision-${item.key}`}
            type="button"
            role="tab"
            aria-selected={mode === item.key}
            aria-controls="decision-panel"
            aria-disabled={disabled(item.key) || undefined}
            tabIndex={mode === item.key ? 0 : -1}
            onClick={() => pick(item.key)}
            className="tabs-trigger aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id="decision-panel" role="tabpanel" aria-labelledby={`decision-${mode}`} className="flex flex-col gap-5">
        {overMax ? (
          <div role="alert" className="alert border-amber-500/50 bg-amber-50 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            This request ({limits.asked.percent}% of the party price) is above your current private maximum of {limits.cap.percent}%. You can approve up to{" "}
            {limits.cap.percent}% or reject it.
          </div>
        ) : null}

        {mode === "full" ? (
          <p className="rounded-lg bg-secondary/60 p-3 text-sm">
            Approve <strong>{asked(request, currency)}</strong> ({formatMoney(askedAmount, currency)} off) — customer pays{" "}
            <strong>{formatMoney(limits.base - askedAmount, currency)}</strong> instead of {formatMoney(limits.base, currency)}. Single use, for{" "}
            {request.email} on {request.tourTitle}.
          </p>
        ) : null}

        {mode === "lower" ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Approve as">
                {(control) => (
                  <select
                    {...control}
                    {...form.register("type", {
                      onChange: (event) => {
                        // Keep the same discount when switching between a percentage and an amount.
                        const next = event.target.value as DiscountType;
                        const value = next === "percent" ? limits.maxPercent : limits.maxFixed;
                        form.setValue("value", discountInputValue(next, Math.max(1, value), currency));
                      },
                    })}
                    className="select"
                  >
                    <option value="percent">Percentage</option>
                    <option value="fixed">Fixed amount</option>
                  </select>
                )}
              </Field>
              <Field label={valueFieldLabel(type, currency)} error={errors.value?.message ?? liveError}>
                {(control) => (
                  <input {...control} {...form.register("value")} className="input" inputMode={type === "percent" ? "numeric" : "decimal"} autoComplete="off" />
                )}
              </Field>
            </div>
            <p className="field-hint">{approvalHint(limits, currency, first)}</p>
            {parsed.ok && !liveError ? (
              <p className="rounded-lg bg-secondary/60 p-3 text-sm" aria-live="polite">
                Customer pays <strong>{formatMoney(priceAfter(type, parsed.value, limits.base), currency)}</strong> instead of{" "}
                {formatMoney(limits.base, currency)} · single use
              </p>
            ) : null}
          </div>
        ) : null}

        {mode === "reject" ? (
          <Field label="Reason shown to the customer" error={errors.reason?.message}>
            {(control) => (
              <textarea
                {...control}
                {...form.register("reason")}
                rows={3}
                maxLength={1000}
                className="textarea"
                placeholder="e.g. We can’t discount peak dates, but our autumn offer applies in October."
              />
            )}
          </Field>
        ) : (
          <Field label="Internal note" note="(optional)">
            {(control) => <textarea {...control} {...form.register("note")} rows={2} maxLength={1000} className="textarea" />}
          </Field>
        )}

        <p className="text-sm text-muted-foreground">
          {first || "The customer"} is e-mailed your decision{mode === "reject" ? ", including the reason" : ""}.
        </p>

        <FormError message={formError} />
        {!access.decide ? <AccessNote>Your role can’t approve or reject discount requests.</AccessNote> : null}

        <div className="flex flex-wrap gap-2">
          <button type="submit" className={cn(button.className)} disabled={!access.decide || pending} aria-busy={pending || undefined}>
            {pending ? <Spinner /> : null}
            {button.label}
          </button>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={pending}>
            Later
          </button>
        </div>
      </div>
    </form>
  );
}

function asked(request: RequestItem, currency: string): string {
  return formatDiscountLabel(request.type, request.value, currency);
}
