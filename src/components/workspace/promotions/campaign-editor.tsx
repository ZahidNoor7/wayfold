"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { saveCampaignAction } from "@/app/workspace/promotions/actions";
import { applyServerErrors } from "@/components/auth/form-utils";
import { Field, FormError, SubmitButton } from "@/components/form";
import { Panel } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { formatDate } from "@/lib/booking-display";
import { addDays, formatMoney } from "@/lib/dates";
import {
  campaignSummary,
  discountInputValue,
  parseDiscountValue,
  parseRuleNumber,
  priceAfter,
  valueFieldLabel,
  type DiscountType,
} from "@/lib/promotion-display";
import type { CampaignInput, CampaignView } from "@/server/promotions/campaigns";
import { EmailChips } from "./email-chips";
import type { PromotionsContext } from "./promotions-view";

interface CampaignEditorProps extends PromotionsContext {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = a new campaign. */
  campaign: CampaignView | null;
}

const RULE_LIMITS = { minGuests: 100, minChildren: 100, bookAheadDays: 730 } as const;

function makeSchema(currency: string) {
  const rule = (max: number) =>
    z.string().refine((value) => parseRuleNumber(value, max) !== null, `Enter a whole number from 0 to ${max}.`);
  return z
    .object({
      name: z.string().trim().min(3, "Give the campaign a name.").max(120, "Keep the name under 120 characters."),
      code: z
        .string()
        .trim()
        .max(40, "Keep the code under 40 characters.")
        .regex(/^[A-Za-z0-9_-]*$/, "Use letters, numbers, dashes or underscores."),
      blurb: z.string().trim().max(500, "Keep the description under 500 characters."),
      type: z.enum(["percent", "fixed"]),
      value: z.string(),
      appliesToAllTours: z.boolean(),
      tourIds: z.array(z.string()),
      visibility: z.enum(["public", "private"]),
      assignedEmails: z.array(z.string()),
      minGuests: rule(RULE_LIMITS.minGuests),
      minChildren: rule(RULE_LIMITS.minChildren),
      bookAheadDays: rule(RULE_LIMITS.bookAheadDays),
      startsOn: z.string().min(1, "Choose a start date."),
      endsOn: z.string().min(1, "Choose an end date."),
      isActive: z.boolean(),
    })
    .superRefine((values, ctx) => {
      const parsed = parseDiscountValue(values.type, values.value, currency);
      if (!parsed.ok) ctx.addIssue({ code: "custom", path: ["value"], message: parsed.error });
      if (values.startsOn && values.endsOn && values.endsOn < values.startsOn) {
        ctx.addIssue({ code: "custom", path: ["endsOn"], message: "End date must be on or after the start date." });
      }
      if (!values.appliesToAllTours && values.tourIds.length === 0) {
        ctx.addIssue({ code: "custom", path: ["tourIds"], message: "Choose at least one tour." });
      }
      if (values.visibility === "private" && values.assignedEmails.length === 0) {
        ctx.addIssue({ code: "custom", path: ["assignedEmails"], message: "Add at least one customer email." });
      }
    });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

const FIELD_ORDER = [
  "name",
  "code",
  "value",
  "startsOn",
  "endsOn",
  "tourIds",
  "assignedEmails",
  "minGuests",
  "minChildren",
  "bookAheadDays",
  "blurb",
] as const satisfies readonly (keyof FormValues)[];

function defaults(campaign: CampaignView | null, currency: string, today: string): FormValues {
  if (!campaign) {
    return {
      name: "",
      code: "",
      blurb: "",
      type: "percent",
      value: "10",
      appliesToAllTours: true,
      tourIds: [],
      visibility: "public",
      assignedEmails: [],
      minGuests: "0",
      minChildren: "0",
      bookAheadDays: "0",
      startsOn: today,
      endsOn: addDays(today, 30),
      isActive: true,
    };
  }
  return {
    name: campaign.name,
    code: campaign.code ?? "",
    blurb: campaign.blurb,
    type: campaign.type,
    value: discountInputValue(campaign.type, campaign.value, currency),
    appliesToAllTours: campaign.appliesToAllTours,
    tourIds: campaign.tours.map((tour) => tour.id),
    visibility: campaign.visibility,
    assignedEmails: campaign.assignedEmails,
    minGuests: String(campaign.minGuests),
    minChildren: String(campaign.minChildren),
    bookAheadDays: String(campaign.bookAheadDays),
    startsOn: campaign.startsOn,
    endsOn: campaign.endsOn,
    isActive: campaign.isActive,
  };
}

const ruleValue = (raw: string, max: number) => parseRuleNumber(raw, max) ?? 0;

export function CampaignEditor({ open, onOpenChange, campaign, tours, currency, today }: CampaignEditorProps) {
  const schema = useMemo(() => makeSchema(currency), [currency]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults(campaign, currency, today) });
  const { errors } = form.formState;
  const save = useAction(saveCampaignAction, {
    toastError: false,
    success: (data) =>
      !data.created ? "Campaign updated" : data.status === "active" ? "Campaign created — live on the website" : "Campaign created",
  });
  const { reset: resetForm } = form;
  const { reset: resetAction } = save;

  // Each opening starts from the campaign being edited (or a blank one).
  useEffect(() => {
    if (!open) return;
    resetForm(defaults(campaign, currency, today));
    resetAction();
  }, [open, campaign, currency, today, resetForm, resetAction]);

  const watched = useWatch({ control: form.control });
  const type: DiscountType = watched.type ?? "percent";
  const parsed = parseDiscountValue(type, watched.value ?? "", currency);

  // Tours that can be chosen: everything not archived, plus archived ones this campaign already covers.
  const linked = new Set(campaign?.tours.map((tour) => tour.id) ?? []);
  const choices = tours.filter((tour) => tour.status !== "archived" || linked.has(tour.id));
  const titleOf = new Map(tours.map((tour) => [tour.id, tour.title]));
  for (const tour of campaign?.tours ?? []) if (!titleOf.has(tour.id)) titleOf.set(tour.id, tour.title);

  const allTours = watched.appliesToAllTours ?? true;
  const selected = (watched.tourIds ?? []).filter((id): id is string => typeof id === "string");
  const summary = campaignSummary(
    {
      type,
      value: parsed.ok ? parsed.value : null,
      appliesToAllTours: allTours,
      tourTitles: selected.map((id) => titleOf.get(id) ?? "a tour"),
      visibility: watched.visibility ?? "public",
      assignedCount: watched.assignedEmails?.length ?? 0,
      minGuests: ruleValue(watched.minGuests ?? "", RULE_LIMITS.minGuests),
      minChildren: ruleValue(watched.minChildren ?? "", RULE_LIMITS.minChildren),
      bookAheadDays: ruleValue(watched.bookAheadDays ?? "", RULE_LIMITS.bookAheadDays),
      startsOn: watched.startsOn ?? "",
      endsOn: watched.endsOn ?? "",
    },
    currency,
  );
  const startsLater = Boolean(watched.startsOn && watched.startsOn > today);
  const endedAlready = Boolean(watched.endsOn && watched.endsOn < today);

  // Per-adult preview for a percentage: the first few tours it covers.
  const previewTours = type === "percent" && parsed.ok ? (allTours ? choices : choices.filter((tour) => selected.includes(tour.id))).slice(0, 4) : [];

  function setAllTours(next: boolean) {
    form.setValue("appliesToAllTours", next, { shouldValidate: form.formState.isSubmitted });
    if (next) form.setValue("tourIds", []);
  }

  function toggleTour(id: string) {
    if (allTours) {
      // Unticking one tour while "All tours" is on keeps every other tour.
      form.setValue("appliesToAllTours", false);
      form.setValue("tourIds", choices.map((tour) => tour.id).filter((tourId) => tourId !== id), { shouldValidate: form.formState.isSubmitted });
      return;
    }
    const next = selected.includes(id) ? selected.filter((tourId) => tourId !== id) : [...selected, id];
    form.setValue("tourIds", next, { shouldValidate: form.formState.isSubmitted });
  }

  const submit = form.handleSubmit(async (values) => {
    const value = parseDiscountValue(values.type, values.value, currency);
    if (!value.ok) return;
    const input: CampaignInput = {
      name: values.name.trim(),
      code: values.code.trim() ? values.code.trim().toUpperCase() : null,
      blurb: values.blurb.trim(),
      type: values.type,
      value: value.value,
      appliesToAllTours: values.appliesToAllTours,
      tourIds: values.appliesToAllTours ? [] : values.tourIds,
      visibility: values.visibility,
      assignedEmails: values.visibility === "private" ? values.assignedEmails : [],
      minGuests: ruleValue(values.minGuests, RULE_LIMITS.minGuests),
      minChildren: ruleValue(values.minChildren, RULE_LIMITS.minChildren),
      bookAheadDays: ruleValue(values.bookAheadDays, RULE_LIMITS.bookAheadDays),
      startsOn: values.startsOn,
      endsOn: values.endsOn,
      isActive: values.isActive,
    };
    const result = await save.run({ id: campaign?.id, campaign: input });
    if (result.ok) onOpenChange(false);
    else applyServerErrors(form, result.fieldErrors, FIELD_ORDER);
  });

  const formError = save.error && !FIELD_ORDER.some((name) => save.fieldErrors?.[name]) ? save.error : null;

  return (
    <Panel
      open={open}
      onOpenChange={(next) => {
        if (!save.pending) onOpenChange(next);
      }}
      title={campaign ? "Edit campaign" : "New campaign"}
      description="Applied automatically to every booking that qualifies. Only the best discount ever applies."
      className="sm:max-w-2xl"
    >
      <form onSubmit={submit} noValidate className="flex min-h-full flex-col">
        <div className="flex flex-1 flex-col gap-5 p-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <Field label="Campaign name" error={errors.name?.message}>
              {(control) => <input {...control} {...form.register("name")} className="input" autoComplete="off" />}
            </Field>
            <Field label="Code" note="(optional)" error={errors.code?.message}>
              {(control) => (
                <input {...control} {...form.register("code")} className="input font-mono uppercase" placeholder="AUTUMN15" autoComplete="off" />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Discount type">
              {(control) => (
                <select {...control} {...form.register("type")} className="select">
                  <option value="percent">Percentage off the trip</option>
                  <option value="fixed">Fixed amount off per booking</option>
                </select>
              )}
            </Field>
            <Field label={valueFieldLabel(type, currency)} error={errors.value?.message}>
              {(control) => (
                <input
                  {...control}
                  {...form.register("value")}
                  className="input"
                  inputMode={type === "percent" ? "numeric" : "decimal"}
                  autoComplete="off"
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" error={errors.startsOn?.message}>
              {(control) => <input {...control} {...form.register("startsOn")} type="date" className="input" />}
            </Field>
            <Field label="Ends" error={errors.endsOn?.message}>
              {(control) => <input {...control} {...form.register("endsOn")} type="date" min={watched.startsOn || undefined} className="input" />}
            </Field>
          </div>

          <fieldset aria-describedby={errors.tourIds ? "campaign-tours-error" : undefined}>
            <legend className="label mb-2">Applicable tours</legend>
            <div className="grid max-h-72 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
              <label className="flex min-h-9 items-center gap-2 text-sm font-semibold sm:col-span-2">
                <input type="checkbox" className="checkbox" checked={allTours} onChange={(event) => setAllTours(event.target.checked)} />
                All tours
                <span className="font-normal text-muted-foreground">· including tours you add later</span>
              </label>
              {choices.map((tour) => (
                <label key={tour.id} className="flex min-h-9 items-center gap-2 text-sm">
                  <input type="checkbox" className="checkbox" checked={allTours || selected.includes(tour.id)} onChange={() => toggleTour(tour.id)} />
                  <span className="min-w-0 truncate">{tour.title}</span>
                  {tour.status !== "published" ? <span className="text-xs text-muted-foreground">({tour.status})</span> : null}
                </label>
              ))}
              {choices.length === 0 ? (
                <p className="text-sm text-muted-foreground sm:col-span-2">You have no tours yet; this campaign will cover tours as you add them.</p>
              ) : null}
            </div>
            {errors.tourIds ? (
              <span id="campaign-tours-error" className="field-error mt-1 block" role="alert">
                {errors.tourIds.message}
              </span>
            ) : null}
          </fieldset>

          <fieldset>
            <legend className="label mb-2">Visibility</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { value: "public", label: "Public", description: "Shown on the Offers page and applied to everyone eligible" },
                  { value: "private", label: "Private", description: "Only for customers you add — not shown publicly" },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className="cursor-pointer rounded-lg border-2 border-border p-3 text-left transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--ring)]"
                >
                  <input type="radio" value={option.value} {...form.register("visibility")} className="sr-only" />
                  <span className="block text-sm font-bold">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {watched.visibility === "private" ? (
            <Controller
              control={form.control}
              name="assignedEmails"
              render={({ field, fieldState }) => (
                <EmailChips
                  label="Customers who get this offer"
                  hint="Applies when one of these addresses books. Press Enter or comma after each address, or paste a list."
                  value={field.value}
                  onChange={(emails) => field.onChange(emails)}
                  error={fieldState.error?.message}
                />
              )}
            />
          ) : null}

          <fieldset>
            <legend className="label mb-2">
              Eligibility <span className="font-normal text-muted-foreground">· leave 0 for no rule</span>
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  { name: "minGuests", label: "Minimum guests" },
                  { name: "minChildren", label: "Minimum children" },
                  { name: "bookAheadDays", label: "Book days ahead" },
                ] as const
              ).map((rule) => (
                <div key={rule.name} className="flex flex-col gap-1.5">
                  <label htmlFor={`campaign-${rule.name}`} className="text-[13px]">
                    {rule.label}
                  </label>
                  <input
                    id={`campaign-${rule.name}`}
                    {...form.register(rule.name)}
                    className="input"
                    inputMode="numeric"
                    aria-invalid={Boolean(errors[rule.name])}
                    aria-describedby={errors[rule.name] ? `campaign-${rule.name}-error` : undefined}
                  />
                  {errors[rule.name] ? (
                    <span id={`campaign-${rule.name}-error`} role="alert" className="field-error">
                      {errors[rule.name]?.message}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </fieldset>

          <Field label="Description on the Offers page" note="(optional)" error={errors.blurb?.message}>
            {(control) => <textarea {...control} {...form.register("blurb")} rows={2} className="textarea" />}
          </Field>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <span>
              <span className="block text-sm font-semibold" id="campaign-active-label">
                Active
              </span>
              <span className="text-xs text-muted-foreground">Inactive campaigns are hidden and never applied.</span>
            </span>
            <Controller
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <button
                  type="button"
                  role="switch"
                  className="switch"
                  aria-checked={field.value}
                  aria-labelledby="campaign-active-label"
                  onClick={() => field.onChange(!field.value)}
                >
                  <span className="switch-thumb" />
                </button>
              )}
            />
          </div>

          <section aria-labelledby="campaign-summary-title" className="rounded-lg bg-secondary/60 p-4">
            <h3 id="campaign-summary-title" className="text-sm font-semibold">
              Who gets what
            </h3>
            <p className="mt-1 text-sm" aria-live="polite">
              {summary ?? "Fill in the discount, tours and dates to see who this campaign is for."}
            </p>
            {summary && !watched.isActive ? (
              <p className="mt-1 text-xs text-muted-foreground">Switched off: customers won’t see it until you turn it on.</p>
            ) : summary && endedAlready ? (
              <p className="mt-1 text-xs text-muted-foreground">The end date has passed, so it won’t apply to new bookings.</p>
            ) : summary && startsLater ? (
              <p className="mt-1 text-xs text-muted-foreground">Starts {formatDate(watched.startsOn)}; until then it stays off your website.</p>
            ) : null}
            {previewTours.length > 0 && parsed.ok ? (
              <ul className="mt-3 flex flex-col gap-1 border-t border-border/60 pt-3 text-sm">
                {previewTours.map((tour) => (
                  <li key={tour.id} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{tour.title} <span className="text-muted-foreground">· per adult</span></span>
                    <span className="whitespace-nowrap">
                      <span className="mr-2 text-muted-foreground line-through">{formatMoney(tour.priceAdult, currency)}</span>
                      <strong>{formatMoney(priceAfter("percent", parsed.value, tour.priceAdult), currency)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <FormError message={formError} />
        </div>

        <div className="safe-b sticky bottom-0 flex justify-end gap-2 border-t bg-background px-6 py-4">
          <button type="button" className="btn btn-outline" onClick={() => onOpenChange(false)} disabled={save.pending}>
            Cancel
          </button>
          <SubmitButton pending={save.pending} pendingLabel="Saving…">
            Save campaign
          </SubmitButton>
        </div>
      </form>
    </Panel>
  );
}
