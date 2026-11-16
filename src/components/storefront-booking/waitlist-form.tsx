"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { useForm } from "react-hook-form";
import { joinWaitlistAction } from "@/app/s/[site]/book/actions";
import { Field, firstError } from "@/components/form";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { waitlistSchema, type WaitlistValues } from "@/lib/booking-form";
import { cn } from "@/lib/utils";

interface WaitlistFormProps {
  tourSlug: string;
  date: string;
  /** Day tours: the sold-out start time being waited for. */
  slotTime?: string | null;
  partySize: number;
  /** "Sat, 12 Dec 2026", or with a time. */
  dateLabel: string;
  /** Pre-fills from details the visitor already typed. */
  defaults?: Partial<WaitlistValues>;
  className?: string;
}

/**
 * Joins the waitlist of a sold-out or on-hold date. It asks for a name and an
 * e-mail address because the promise is "we will email you": the design
 * collected nothing. Rendered as a group, not a <form>, so it can live inside
 * the booking form without nesting forms.
 */
export function WaitlistForm({ tourSlug, date, slotTime, partySize, dateLabel, defaults, className }: WaitlistFormProps) {
  const [open, setOpen] = useState(false);
  const [joined, setJoined] = useState(false);
  const { run, pending, error, fieldErrors } = useAction(joinWaitlistAction, { toastError: false, onSuccess: () => setJoined(true) });
  const form = useForm<WaitlistValues>({
    resolver: zodResolver(waitlistSchema),
    defaultValues: { name: defaults?.name ?? "", email: defaults?.email ?? "" },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit((values) => {
    void run({ tourSlug, date, slotTime: slotTime || null, partySize, name: values.name, email: values.email });
  });

  function onEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void submit();
  }

  if (joined) {
    return (
      <p role="status" className={cn("flex items-start gap-2 text-sm font-semibold", className)}>
        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>You’re on the waitlist for {dateLabel}. We will email you if a place opens.</span>
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className={cn("btn btn-secondary btn-sm w-full", className)} onClick={() => setOpen(true)}>
        Join the waitlist for this date
      </button>
    );
  }

  // The service answers about the date or the time; neither has a field here.
  const formError = firstError(fieldErrors, "date") ?? firstError(fieldErrors, "slotTime") ?? (fieldErrors ? null : error);

  return (
    <div role="group" aria-label={`Join the waitlist for ${dateLabel}`} className={cn("flex animate-fade-in flex-col gap-3 rounded-lg bg-background p-3 text-foreground", className)}>
      <p className="text-sm font-semibold">Join the waitlist for {dateLabel}</p>
      <Field label="Your name" error={errors.name?.message ?? firstError(fieldErrors, "name")}>
        {(control) => <input {...control} {...form.register("name")} className="input" autoComplete="name" onKeyDown={onEnter} />}
      </Field>
      <Field label="Email address" error={errors.email?.message ?? firstError(fieldErrors, "email")} hint="Only used to tell you when a place opens.">
        {(control) => (
          <input {...control} {...form.register("email")} className="input" type="email" inputMode="email" autoComplete="email" spellCheck={false} onKeyDown={onEnter} />
        )}
      </Field>
      {formError ? (
        <p role="alert" className="field-error">
          {formError}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="button" className="btn btn-default btn-sm" disabled={pending} aria-busy={pending || undefined} onClick={() => void submit()}>
          {pending ? <Spinner /> : null}
          {pending ? "Joining…" : "Join waitlist"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
