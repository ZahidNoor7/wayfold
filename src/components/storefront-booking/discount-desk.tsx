"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Clock, Copy, X } from "lucide-react";
import Link from "next/link";
import { useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { submitDiscountRequestAction, trackDiscountRequestAction, type DiscountRequestTracking } from "@/app/s/[site]/offers/actions";
import { Field, firstError, FormError, SubmitButton } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import {
  clampParty,
  defaultParty,
  discountRequestFormSchema,
  parseDiscountValue,
  partyLimits,
  REQUEST_STATUS_LABELS,
  requestTimeline,
  trackerSchema,
  type DiscountRequestFormValues,
  type TimelineStep,
  type TrackerValues,
} from "@/lib/booking-form";
import { formatDateTime } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import { PartySteppers } from "./party-steppers";

interface DeskTour {
  id: string;
  slug: string;
  title: string;
  minGroupSize: number;
  maxGroupSize: number;
}

interface DiscountDeskProps {
  /** Copy beside the request form. */
  intro: ReactNode;
  /** Copy beside the status tracker. */
  trackerIntro: ReactNode;
  tours: DeskTour[];
  currency: string;
  timezone: string;
  /** False when the business has paused requests or its plan does not take them: the form is not shown. */
  requestsOpen: boolean;
  /** Carried over from the booking form: tour slug and party. */
  prefill: { tour?: string; adults?: number; children?: number };
}

interface TrackerHandle {
  check: (reference: string, accessCode: string) => void;
}

const NOT_FOUND = "We couldn’t find a request with that reference and access code. Check both and try again.";

/**
 * The two discount tools of the Offers page: asking for a personal discount,
 * and checking on a request with its reference and the access code shown once
 * when it was sent.
 */
export function DiscountDesk({ intro, trackerIntro, tours, currency, timezone, requestsOpen, prefill }: DiscountDeskProps) {
  const tracker = useRef<TrackerHandle>(null);

  return (
    <>
      <section id="request" aria-labelledby="request-heading" className="scroll-mt-24 bg-secondary/60 py-16 lg:py-24">
        <div className="container-x grid gap-8 lg:grid-cols-2 lg:gap-14">
          <div>{intro}</div>
          {requestsOpen && tours.length > 0 ? (
            <RequestForm
              tours={tours}
              currency={currency}
              prefill={prefill}
              onTrack={(reference, accessCode) => {
                tracker.current?.check(reference, accessCode);
                document.getElementById("track")?.scrollIntoView({ block: "start" });
              }}
            />
          ) : (
            <div className="alert self-start bg-background">Personal discount requests are paused at the moment. Current offers still apply automatically when you book.</div>
          )}
        </div>
      </section>

      <section id="track" aria-labelledby="track-heading" className="scroll-mt-24 py-16 lg:py-24">
        <div className="container-x grid gap-8 lg:grid-cols-2 lg:gap-14">
          <div>{trackerIntro}</div>
          <Tracker ref={tracker} timezone={timezone} />
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------ the request */

interface RequestFormProps {
  tours: DeskTour[];
  currency: string;
  prefill: DiscountDeskProps["prefill"];
  onTrack: (reference: string, accessCode: string) => void;
}

function RequestForm({ tours, currency, prefill, onTrack }: RequestFormProps) {
  const startTour = tours.find((tour) => tour.slug === prefill.tour) ?? tours[0]!;
  const startParty = clampParty({ adults: prefill.adults ?? defaultParty(partyLimits(startTour)).adults, children: prefill.children ?? 0 }, partyLimits(startTour));
  const form = useForm<DiscountRequestFormValues>({
    resolver: zodResolver(discountRequestFormSchema),
    defaultValues: { tourId: startTour.id, name: "", email: "", phone: "", adults: startParty.adults, children: startParty.children, type: "percent", value: "10", reason: "" },
  });
  const [sent, setSent] = useState<{ reference: string; accessToken: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const { run, pending, error, fieldErrors } = useAction(submitDiscountRequestAction, { toastError: false, onSuccess: setSent });

  const errors = form.formState.errors;
  const [tourId, adults, children, type] = useWatch({ control: form.control, name: ["tourId", "adults", "children", "type"] });
  const tour = tours.find((candidate) => candidate.id === tourId) ?? startTour;
  const limits = partyLimits(tour);
  const serverError = (name: string) => firstError(fieldErrors, name) ?? undefined;

  const submit = form.handleSubmit((values) => {
    const value = parseDiscountValue(values.type, values.value, currency);
    if (value === null) {
      form.setError("value", { message: "Please enter a valid discount." }, { shouldFocus: true });
      return;
    }
    void run({
      tourId: values.tourId,
      name: values.name,
      email: values.email,
      phone: values.phone,
      adults: values.adults,
      children: values.children,
      type: values.type,
      value,
      reason: values.reason,
    });
  });

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Access code copied");
    } catch {
      toast.error("We could not copy the code. Select it and copy it by hand.");
    }
  }

  if (sent) {
    return (
      <div className="card self-start p-6 sm:p-8" role="status">
        <span className="inline-flex h-12 w-12 animate-pop items-center justify-center rounded-full bg-primary text-highlight">
          <Check aria-hidden="true" className="size-6" />
        </span>
        <h3 className="mt-4 font-display text-3xl font-semibold text-primary">Request sent</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          We received your request for {tour.title}. Your booking request is separate: you can send it whenever you are ready.
        </p>
        <dl className="mt-6 flex flex-col gap-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reference</dt>
            <dd className="font-display text-3xl tracking-wider text-primary">{sent.reference}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Access code</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2">
              <code className="min-w-0 select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm">{sent.accessToken}</code>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void copyCode(sent.accessToken)}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? "Copied" : "Copy code"}
              </button>
            </dd>
          </div>
        </dl>
        <p className="alert alert-warning mt-5">
          <strong>Save this code now.</strong> It is not emailed and cannot be shown again. You need it, together with the reference, to check the status of your request.
        </p>
        <button type="button" className="btn btn-default mt-5" onClick={() => onTrack(sent.reference, sent.accessToken)}>
          Check the status now
        </button>
      </div>
    );
  }

  return (
    <form noValidate className="card flex flex-col gap-5 self-start p-6 sm:p-8" onSubmit={(event) => void submit(event)}>
      <h3 className="card-title">Ask for a personal discount</h3>

      <Field label="Tour" error={errors.tourId?.message ?? serverError("tourId")}>
        {(control) => (
          <select
            {...control}
            className="select"
            value={tourId}
            onChange={(event) => {
              const next = tours.find((candidate) => candidate.id === event.target.value) ?? tour;
              const party = clampParty({ adults, children }, partyLimits(next));
              form.setValue("tourId", next.id, { shouldValidate: true });
              form.setValue("adults", party.adults);
              form.setValue("children", party.children);
            }}
          >
            {tours.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <span className="label">Who is travelling</span>
        <PartySteppers
          party={{ adults, children }}
          limits={limits}
          onChange={(party) => {
            form.setValue("adults", party.adults);
            form.setValue("children", party.children);
          }}
        />
        {serverError("adults") || serverError("children") ? (
          <span role="alert" className="field-error">
            {serverError("adults") ?? serverError("children")}
          </span>
        ) : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" error={errors.name?.message ?? serverError("name")}>
          {(control) => <input {...control} {...form.register("name")} className="input" autoComplete="name" maxLength={120} />}
        </Field>
        <Field label="Email address" error={errors.email?.message ?? serverError("email")} hint="Use the address you will book with.">
          {(control) => (
            <input {...control} {...form.register("email")} className="input" type="email" inputMode="email" autoComplete="email" spellCheck={false} autoCapitalize="none" maxLength={254} />
          )}
        </Field>
      </div>

      <Field label="Phone number" note="(optional)" error={errors.phone?.message ?? serverError("phone")}>
        {(control) => <input {...control} {...form.register("phone")} className="input" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} />}
      </Field>

      <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
        <Field label="Type" error={errors.type?.message ?? serverError("type")}>
          {(control) => (
            <select {...control} {...form.register("type")} className="select">
              <option value="percent">Percentage (%)</option>
              <option value="fixed">Fixed amount ({currency})</option>
            </select>
          )}
        </Field>
        <Field label={type === "percent" ? "Discount you’d like (%)" : `Amount you’d like off (${currency})`} error={errors.value?.message ?? serverError("value")}>
          {(control) => <input {...control} {...form.register("value")} className="input" inputMode="decimal" autoComplete="off" maxLength={12} />}
        </Field>
      </div>

      <Field label="Reason" note="(optional)" error={errors.reason?.message ?? serverError("reason")}>
        {(control) => (
          <textarea {...control} {...form.register("reason")} className="textarea" rows={3} maxLength={1000} placeholder="e.g. honeymoon, student, returning guest, large group…" />
        )}
      </Field>

      <FormError message={fieldErrors ? null : error} />
      <div className="flex flex-col gap-2">
        <SubmitButton pending={pending} pendingLabel="Sending…" className="btn-lg self-start rounded-full">
          Send request
        </SubmitButton>
        <p className="text-xs text-muted-foreground">
          Your booking request is separate and is not affected. If approved, the discount applies automatically when you book with the same email address.
        </p>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------ the tracker */

const MARKER = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs";
const MARKER_STATE: Record<TimelineStep["state"], string> = {
  done: "bg-primary text-primary-foreground",
  current: "animate-pulse bg-amber-500 text-white",
  upcoming: "border text-muted-foreground",
  approved: "bg-emerald-600 text-white",
  rejected: "bg-destructive text-destructive-foreground",
};
const STATUS_BADGE = { pending: "badge-pending", approved: "badge-confirmed", rejected: "badge-cancelled" } as const;

function Marker({ step, position }: { step: TimelineStep; position: number }) {
  return (
    <span aria-hidden="true" className={cn(MARKER, MARKER_STATE[step.state])}>
      {step.state === "upcoming" ? position : step.state === "current" ? <Clock className="size-3.5" /> : step.state === "rejected" ? <X className="size-3.5" /> : <Check className="size-3.5" />}
    </span>
  );
}

const STATE_SPOKEN: Record<TimelineStep["state"], string> = { done: "Done", current: "In progress", upcoming: "Not yet", approved: "Done", rejected: "Done" };

function Tracker({ ref, timezone }: { ref: Ref<TrackerHandle>; timezone: string }) {
  const form = useForm<TrackerValues>({ resolver: zodResolver(trackerSchema), defaultValues: { reference: "", accessCode: "" } });
  const [found, setFound] = useState<DiscountRequestTracking | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { run, pending } = useAction(trackDiscountRequestAction, { toastError: false });
  const errors = form.formState.errors;

  async function check(values: TrackerValues) {
    setProblem(null);
    const result = await run({ reference: values.reference, accessToken: values.accessCode });
    if (result.ok) {
      setFound(result.data);
      return;
    }
    setFound(null);
    // A wrong reference and a wrong code read exactly the same.
    setProblem(result.code === "rate_limited" || result.code === "network" || result.code === "internal" ? result.error : NOT_FOUND);
  }

  useImperativeHandle(ref, () => ({
    check: (reference, accessCode) => {
      form.reset({ reference, accessCode });
      void check({ reference, accessCode });
    },
  }));

  const timeline = found
    ? requestTimeline({ status: found.status, approvedLabel: found.approvedLabel, rejectionReason: found.rejectionReason, used: found.used, responseDays: found.responseDays })
    : [];

  return (
    <div className="card self-start p-6 sm:p-8">
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void form.handleSubmit(check)(event)}>
        <Field label="Request reference" error={errors.reference?.message}>
          {(control) => <input {...control} {...form.register("reference")} className="input uppercase" placeholder="DR-0000" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} />}
        </Field>
        <Field label="Access code" error={errors.accessCode?.message} hint="Shown once, when you sent the request.">
          {(control) => <input {...control} {...form.register("accessCode")} className="input font-mono" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={200} />}
        </Field>
        <SubmitButton pending={pending} pendingLabel="Checking…" className="h-11 self-start">
          Check status
        </SubmitButton>
      </form>

      {problem ? (
        <p role="alert" className="field-error mt-4">
          {problem}
        </p>
      ) : null}

      <div aria-live="polite">
        {found ? (
          <div className="mt-6 animate-rise rounded-xl border p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">
                {found.reference} · {found.tourTitle}
              </p>
              <span className={cn("badge", STATUS_BADGE[found.status])}>{REQUEST_STATUS_LABELS[found.status]}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Requested {found.requestedLabel} · {formatDateTime(found.createdAt, timezone)}
            </p>
            <ol className="mt-5 flex flex-col gap-3 text-sm">
              {timeline.map((step, index) => (
                <li key={step.key} className="flex gap-3">
                  <Marker step={step} position={index + 1} />
                  <span>
                    <span className="sr-only">{STATE_SPOKEN[step.state]}: </span>
                    <strong>{step.title}</strong> — {step.detail}
                  </span>
                </li>
              ))}
            </ol>
            {found.status === "approved" && !found.used ? (
              <Link href="/book" className="btn btn-default btn-sm mt-5 rounded-full">
                Book with this discount
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
