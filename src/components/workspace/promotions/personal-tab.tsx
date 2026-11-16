"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { assignPersonalDiscountAction, revokePersonalDiscountAction } from "@/app/workspace/promotions/actions";
import { applyServerErrors } from "@/components/auth/form-utils";
import { Field, FormError, SubmitButton } from "@/components/form";
import { ConfirmDialog } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { firstName, formatDate } from "@/lib/booking-display";
import { todayIn } from "@/lib/dates";
import {
  formatDiscountLabel,
  normaliseEmail,
  parseDiscountValue,
  PERSONAL_STATUS_BADGES,
  PERSONAL_STATUS_LABELS,
  replaceableDiscounts,
  valueFieldLabel,
  type DiscountType,
} from "@/lib/promotion-display";
import type { PersonalDiscountView } from "@/server/promotions/personal-discounts";
import type { PromotionsContext } from "./promotions-view";
import { AccessNote } from "./shared";

interface PersonalTabProps extends PromotionsContext {
  discounts: PersonalDiscountView[];
}

const ANY_TOUR = "any";
const MANAGE_NOTE = "Only members who can manage discounts can assign or revoke personal discounts.";

function makeSchema(currency: string, today: string) {
  return z
    .object({
      customerName: z.string().trim().min(1, "Enter the customer’s name.").max(120, "Keep the name under 120 characters."),
      email: z.string().refine((value) => normaliseEmail(value) !== null, "Enter a valid e-mail address."),
      type: z.enum(["percent", "fixed"]),
      value: z.string(),
      tourId: z.string(),
      expiresOn: z.string().refine((value) => value === "" || value >= today, "Expiry date is in the past."),
      note: z.string().trim().max(1000, "Keep the note under 1,000 characters."),
    })
    .superRefine((values, ctx) => {
      const parsed = parseDiscountValue(values.type, values.value, currency);
      if (!parsed.ok) ctx.addIssue({ code: "custom", path: ["value"], message: parsed.error });
    });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

const EMPTY: FormValues = { customerName: "", email: "", type: "percent", value: "10", tourId: ANY_TOUR, expiresOn: "", note: "" };
const FIELD_ORDER = ["customerName", "email", "value", "tourId", "expiresOn", "note"] as const satisfies readonly (keyof FormValues)[];

export function PersonalTab({ discounts, tours, access, currency, timezone, today }: PersonalTabProps) {
  const schema = useMemo(() => makeSchema(currency, today), [currency, today]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const { errors } = form.formState;
  const [revoking, setRevoking] = useState<PersonalDiscountView | null>(null);

  const assign = useAction(assignPersonalDiscountAction, {
    toastError: false,
    success: (data) =>
      data.replaced > 0
        ? `Discount applied to ${data.customerName} — their earlier discount was replaced`
        : `Discount applied to ${data.customerName}`,
    onSuccess: () => form.reset(EMPTY),
  });
  const revoke = useAction(revokePersonalDiscountAction, { success: "Discount revoked", onSuccess: () => setRevoking(null) });

  const watched = useWatch({ control: form.control });
  const type: DiscountType = watched.type ?? "percent";
  const tourId = watched.tourId && watched.tourId !== ANY_TOUR ? watched.tourId : null;
  const tourTitle = tourId ? (tours.find((tour) => tour.id === tourId)?.title ?? "this tour") : "any tour";
  const parsed = parseDiscountValue(type, watched.value ?? "", currency);
  const duplicates = replaceableDiscounts(discounts, watched.email ?? "", tourId);
  const choices = tours.filter((tour) => tour.status !== "archived");

  const submit = form.handleSubmit(async (values) => {
    const value = parseDiscountValue(values.type, values.value, currency);
    if (!value.ok) return;
    const result = await assign.run({
      customerName: values.customerName.trim(),
      email: values.email,
      tourId: values.tourId === ANY_TOUR ? null : values.tourId,
      type: values.type,
      value: value.value,
      expiresOn: values.expiresOn || null,
      note: values.note.trim(),
    });
    if (!result.ok) applyServerErrors(form, result.fieldErrors, FIELD_ORDER);
  });
  const formError = assign.error && !FIELD_ORDER.some((name) => assign.fieldErrors?.[name]) ? assign.error : null;

  const assignedOn = (discount: PersonalDiscountView) => formatDate(todayIn(timezone, new Date(discount.createdAt)));
  const statusText = (discount: PersonalDiscountView) =>
    discount.status === "used" && discount.usedByBookingReference ? `Used on ${discount.usedByBookingReference}` : PERSONAL_STATUS_LABELS[discount.status];
  const revokeButton = (discount: PersonalDiscountView) =>
    discount.status === "active" ? (
      <button
        type="button"
        onClick={() => setRevoking(discount)}
        disabled={!access.manage}
        aria-label={`Revoke ${discount.customerName}’s discount`}
        className="btn btn-ghost btn-sm text-destructive hover:text-destructive"
      >
        Revoke
      </button>
    ) : null;

  return (
    <div className="grid gap-6 2xl:grid-cols-[420px_1fr]">
      <section className="card h-fit" aria-labelledby="assign-title">
        <div className="card-header">
          <h2 id="assign-title" className="card-title">
            Assign a personal discount
          </h2>
          <p className="card-description">Applied automatically when this customer books with their e-mail. Single use.</p>
        </div>
        <form onSubmit={submit} noValidate className="card-content flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-1">
            <Field label="Customer name" error={errors.customerName?.message}>
              {(control) => <input {...control} {...form.register("customerName")} className="input" autoComplete="off" />}
            </Field>
            <Field label="Customer e-mail" error={errors.email?.message}>
              {(control) => (
                <input {...control} {...form.register("email")} type="email" inputMode="email" className="input" autoComplete="off" placeholder="name@example.com" />
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              {(control) => (
                <select {...control} {...form.register("type")} className="select">
                  <option value="percent">Percentage</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              )}
            </Field>
            <Field label={valueFieldLabel(type, currency)} error={errors.value?.message}>
              {(control) => (
                <input {...control} {...form.register("value")} className="input" inputMode={type === "percent" ? "numeric" : "decimal"} autoComplete="off" />
              )}
            </Field>
          </div>
          <Field label="Applies to" error={errors.tourId?.message}>
            {(control) => (
              <select {...control} {...form.register("tourId")} className="select">
                <option value={ANY_TOUR}>Any tour</option>
                {choices.map((tour) => (
                  <option key={tour.id} value={tour.id}>
                    {tour.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Expiry date" note="(optional)" error={errors.expiresOn?.message}>
            {(control) => <input {...control} {...form.register("expiresOn")} type="date" min={today} className="input" />}
          </Field>
          <Field label="Internal note" note="· not shown to the customer" error={errors.note?.message}>
            {(control) => <textarea {...control} {...form.register("note")} rows={2} className="textarea" placeholder="Why this discount was given" />}
          </Field>

          {parsed.ok ? (
            <div className="rounded-lg bg-secondary/60 p-3 text-sm" aria-live="polite">
              {formatDiscountLabel(type, parsed.value, currency)} on {tourTitle}
              {type === "fixed" ? " (once per booking)" : ""} · {watched.expiresOn ? `expires ${formatDate(watched.expiresOn)}` : "no expiry"} · single use
            </div>
          ) : null}

          {duplicates.length > 0 ? (
            <div role="alert" className="alert border-amber-500/50 bg-amber-50 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              {firstName(watched.customerName || duplicates[0]!.customerName) || "This customer"} already has an active personal discount (
              {duplicates
                .map((discount) => `${formatDiscountLabel(discount.type, discount.value, currency)} on ${discount.tourTitle ?? "any tour"}`)
                .join("; ")}
              ). Applying will replace it so the customer can’t receive two.
            </div>
          ) : null}

          <FormError message={formError} />
          <SubmitButton pending={assign.pending} pendingLabel="Applying…" disabled={!access.manage} className="btn-lg">
            {duplicates.length > 0 ? "Replace & apply discount" : "Apply discount"}
          </SubmitButton>
          {!access.manage ? <AccessNote>{MANAGE_NOTE}</AccessNote> : null}
        </form>
      </section>

      <section className="card overflow-hidden" aria-labelledby="assigned-title">
        <div className="flex items-center justify-between p-5 pb-3 sm:p-6 sm:pb-3">
          <div>
            <h2 id="assigned-title" className="card-title">
              Assigned personal discounts
            </h2>
            <p className="card-description mt-1.5">Full record for auditing — revoked and used discounts stay listed.</p>
          </div>
        </div>

        {discounts.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">
            No personal discounts yet. Use the form to give a customer a one-off discount.
          </p>
        ) : (
          <>
            <ul className="divide-y lg:hidden">
              {discounts.map((discount) => (
                <li key={discount.id} className="flex flex-col gap-1.5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold">{discount.customerName}</p>
                      <p className="truncate text-xs text-muted-foreground">{discount.email}</p>
                    </div>
                    <span className={PERSONAL_STATUS_BADGES[discount.status]}>{statusText(discount)}</span>
                  </div>
                  <p className="text-sm">
                    <span className="font-semibold">{formatDiscountLabel(discount.type, discount.value, currency)}</span> · {discount.tourTitle ?? "Any tour"} ·{" "}
                    {discount.expiresOn ? `expires ${formatDate(discount.expiresOn)}` : "no expiry"}
                  </p>
                  {discount.note ? <p className="text-xs text-eyebrow">Note: {discount.note}</p> : null}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {discount.createdByName ?? "A team member"} · {assignedOn(discount)}
                    </span>
                    {revokeButton(discount)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto lg:block">
              <table className="table min-w-[860px]">
                <thead>
                  <tr>
                    <th className="pl-6">Customer</th>
                    <th>Discount</th>
                    <th>Applies to</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th>Assigned</th>
                    <th className="pr-6 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {discounts.map((discount) => (
                    <tr key={discount.id} className="align-top">
                      <td className="pl-6">
                        <span className="block font-bold">{discount.customerName}</span>
                        <span className="text-xs text-muted-foreground">{discount.email}</span>
                        {discount.note ? <span className="mt-1 block text-xs text-eyebrow">Note: {discount.note}</span> : null}
                      </td>
                      <td className="whitespace-nowrap font-semibold">{formatDiscountLabel(discount.type, discount.value, currency)}</td>
                      <td className="text-[13px]">{discount.tourTitle ?? "Any tour"}</td>
                      <td className="whitespace-nowrap text-[13px]">{discount.expiresOn ? formatDate(discount.expiresOn) : "No expiry"}</td>
                      <td>
                        <span className={PERSONAL_STATUS_BADGES[discount.status]}>{statusText(discount)}</span>
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {discount.createdByName ?? "A team member"}
                        <br />
                        {assignedOn(discount)}
                      </td>
                      <td className="pr-6 text-right">{revokeButton(discount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!access.manage && discounts.some((discount) => discount.status === "active") ? (
          <div className="border-t px-5 py-3 sm:px-6">
            <AccessNote>{MANAGE_NOTE}</AccessNote>
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open && !revoke.pending) setRevoking(null);
        }}
        title={revoking ? `Revoke ${revoking.customerName}’s discount?` : "Revoke discount?"}
        description="It will no longer apply to new bookings. The record stays listed here and in the activity log."
        confirmLabel="Revoke"
        destructive
        pending={revoke.pending}
        onConfirm={() => {
          if (revoking) void revoke.run({ id: revoking.id });
        }}
      />
    </div>
  );
}
