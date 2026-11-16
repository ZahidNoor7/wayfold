"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Check } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Field, firstError, SubmitButton } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import type { ActionResult } from "@/server/errors";
import {
  CONTACT_FIELD_ORDER,
  contactFormSchema,
  EMPTY_CONTACT_FORM,
  firstInvalidField,
  firstName,
  latestPreferredDate,
  MESSAGE_MAX,
  type ContactFormOutput,
  type ContactFormValues,
} from "./contact-helpers";

/** Milliseconds since `start`, or null when the start was never recorded. */
function msSince(start: number | null): number | null {
  return start === null ? null : Date.now() - start;
}

interface ContactMessage {
  name: string;
  email: string;
  phone?: string;
  tourId?: string | null;
  preferredDate?: string | null;
  message: string;
  topic?: string;
  elapsedMs?: number | null;
}

interface ContactFormProps {
  /** The page's Server Action (rate-limited, tenant from the host). */
  action: (input: ContactMessage) => Promise<ActionResult<{ sent: true }>>;
  businessName: string;
  /** Published tours the visitor can say they are interested in. */
  tours: { id: string; title: string }[];
  /** Today in the business's timezone, `YYYY-MM-DD`: the earliest preferred date. */
  today: string;
  /** The business's own promise, e.g. "We reply within 24 hours." Empty when it made none. */
  responseTime: string;
  whatsappHref: string | null;
}

/**
 * The contact form and what follows it. Errors appear beside their fields
 * after the first attempt to send and then update as the visitor types; a
 * failed send keeps everything typed; a successful one is replaced by a
 * confirmation that takes focus.
 */
export function ContactForm({ action, businessName, tours, today, responseTime, whatsappHref }: ContactFormProps) {
  const schema = useMemo(() => contactFormSchema(today), [today]);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    control,
    formState: { errors },
  } = useForm<ContactFormValues, unknown, ContactFormOutput>({ resolver: zodResolver(schema), defaultValues: EMPTY_CONTACT_FORM });
  const { run, pending, error, fieldErrors, reset: resetAction } = useAction(action, { toastError: false });

  const [sent, setSent] = useState<{ firstName: string; email: string } | null>(null);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const failure = useRef<HTMLDivElement>(null);
  const startingOver = useRef(false);
  // When the form appeared, so the server can tell a person from a script (see isAutomatedSubmission).
  const shownAt = useRef<number | null>(null);
  const messageId = useId();
  const messageLength = useWatch({ control, name: "message" }).length;
  // A failure that belongs to no field is shown above the button.
  const formError = error && !firstInvalidField(fieldErrors) ? error : null;

  // The confirmation replaces the form (and the form replaces it again), so
  // focus is carried across instead of being dropped on <body>.
  useEffect(() => {
    if (!sent) shownAt.current = Date.now();
  }, [sent]);

  useEffect(() => {
    if (sent) confirmation.current?.focus();
    else if (startingOver.current) {
      startingOver.current = false;
      setFocus("name");
    }
  }, [sent, setFocus]);

  useEffect(() => {
    if (formError) failure.current?.focus();
  }, [formError]);

  // Built per submit, with the time the visitor took measured in the event handler.
  const send = (elapsedMs: number | null) =>
    handleSubmit(async (values) => {
    const result = await run({
      name: values.name,
      email: values.email,
      phone: values.phone || undefined,
      tourId: values.tourId || null,
      preferredDate: values.preferredDate || null,
      message: values.message,
      topic: values.trap,
      elapsedMs,
    });
    if (result.ok) {
      setSent({ firstName: firstName(values.name), email: values.email });
      return;
    }
    // The server's word on each field goes beside that field, and the first one takes focus.
    for (const field of CONTACT_FIELD_ORDER) {
      const message = firstError(result.fieldErrors, field);
      if (message) setError(field, { type: "server", message });
    }
    const invalid = firstInvalidField(result.fieldErrors);
    if (invalid) setFocus(invalid);
  });

  if (sent) {
    return (
      <div role="status" className="card animate-rise p-10 text-center sm:p-14">
        <span className="inline-flex h-16 w-16 animate-pop items-center justify-center rounded-full bg-primary text-highlight">
          <Check aria-hidden="true" className="size-8" strokeWidth={2} />
        </span>
        <h2 ref={confirmation} tabIndex={-1} className="mb-3 mt-6 font-display text-4xl font-medium text-primary outline-none">
          Message sent. Thank you{sent.firstName ? `, ${sent.firstName}` : ""}.
        </h2>
        <p className="mx-auto mb-7 max-w-md leading-relaxed text-muted-foreground">
          {businessName} will reply to <span className="break-all font-semibold text-foreground">{sent.email}</span>.{responseTime ? ` ${responseTime}` : ""}
          {whatsappHref ? (
            <>
              {" "}
              For anything urgent,{" "}
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline underline-offset-4">
                WhatsApp
              </a>{" "}
              is quickest.
            </>
          ) : null}
        </p>
        <button
          type="button"
          className="btn btn-outline btn-lg rounded-full"
          onClick={() => {
            reset(EMPTY_CONTACT_FORM);
            resetAction();
            startingOver.current = true;
            setSent(null);
          }}
        >
          Send another message
        </button>
      </div>
    );
  }

  const messageError = errors.message?.message ?? null;

  return (
    <form noValidate onSubmit={(event) => void send(msSince(shownAt.current))(event)} className="card relative flex flex-col gap-5 p-6 sm:p-9">
      <div>
        <h2 className="font-display text-3xl font-medium text-primary">Send a message</h2>
        {responseTime ? <p className="mt-1 text-sm text-muted-foreground">{responseTime}</p> : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" error={errors.name?.message}>
          {(control) => <input {...control} {...register("name")} className="input" autoComplete="name" maxLength={200} />}
        </Field>
        <Field label="Email" error={errors.email?.message}>
          {(control) => (
            <input {...control} {...register("email")} className="input" type="email" inputMode="email" autoComplete="email" spellCheck={false} maxLength={200} />
          )}
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Phone" note="(optional)" error={errors.phone?.message}>
          {(control) => <input {...control} {...register("phone")} className="input" type="tel" inputMode="tel" autoComplete="tel" maxLength={50} />}
        </Field>
        <Field label="Preferred date" note="(optional)" error={errors.preferredDate?.message}>
          {(control) => <input {...control} {...register("preferredDate")} className="input" type="date" min={today} max={latestPreferredDate(today)} />}
        </Field>
      </div>

      {tours.length > 0 ? (
        <Field label="Interested in" note="(optional)" error={errors.tourId?.message}>
          {(control) => (
            <select {...control} {...register("tourId")} className="select">
              <option value="">Not sure yet</option>
              {tours.map((tour) => (
                <option key={tour.id} value={tour.id}>
                  {tour.title}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor={messageId} className="label">
          Message
        </label>
        <textarea
          id={messageId}
          {...register("message")}
          className="textarea min-h-[150px]"
          maxLength={MESSAGE_MAX}
          placeholder="Who is travelling, when, and what you would like to see or do"
          aria-invalid={Boolean(messageError)}
          aria-describedby={`${messageError ? `${messageId}-error ` : ""}${messageId}-count`}
        />
        <span className="flex justify-between gap-3">
          {messageError ? (
            <span id={`${messageId}-error`} role="alert" className="field-error">
              {messageError}
            </span>
          ) : null}
          <span id={`${messageId}-count`} className="field-hint ml-auto tabular-nums">
            {messageLength} / {MESSAGE_MAX}
            <span className="sr-only"> characters</span>
          </span>
        </span>
      </div>

      {/*
        Trap field: off-screen, out of the tab order and hidden from assistive
        technology, so only a script fills it. Its name and the data-* hints keep
        browser autofill and password managers away from it; if one fills it
        anyway, the server still keeps the message (see isAutomatedSubmission).
      */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label>
          Leave this field empty
          <input
            {...register("trap")}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            data-form-type="other"
          />
        </label>
      </div>

      {formError ? (
        <div ref={failure} tabIndex={-1} role="alert" className="alert alert-destructive">
          {formError}
          {whatsappHref ? (
            <>
              {" "}
              You can also{" "}
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-4">
                send a message on WhatsApp
              </a>
              .
            </>
          ) : null}
        </div>
      ) : null}

      <SubmitButton pending={pending} pendingLabel="Sending…" className="btn-xl rounded-full">
        Send message
      </SubmitButton>
      <p className="text-center text-[13px] text-muted-foreground">
        By sending, you agree to the{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          privacy policy
        </Link>
        .
      </p>
    </form>
  );
}
