"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  cancelBookingAction,
  completeBookingAction,
  confirmBookingAction,
  declineBookingAction,
  reopenBookingAction,
} from "@/app/workspace/bookings/actions";
import { Field, firstError } from "@/components/form";
import { ConfirmDialog, Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { firstName } from "@/lib/booking-display";
import { cn } from "@/lib/utils";

/** The little a booking action needs to know about its booking. */
export interface BookingRef {
  id: string;
  reference: string;
  name: string;
}

export function ClashList({ clashes, className }: { clashes: string[]; className?: string }) {
  return (
    <ul className={cn("list-disc pl-5", className)}>
      {clashes.map((clash) => (
        <li key={clash}>{clash}</li>
      ))}
    </ul>
  );
}

interface ButtonProps {
  booking: BookingRef;
  className?: string;
  /** Short label for tight spaces such as the overview cards. */
  label?: string;
}

/**
 * Confirms a pending request. When the server reports a scheduling clash it
 * lists what collides and asks before double-booking.
 */
export function ConfirmBookingButton({ booking, className = "btn btn-default", label = "Confirm booking" }: ButtonProps) {
  const [clashes, setClashes] = useState<string[] | null>(null);
  const { run, pending } = useAction(confirmBookingAction);

  async function confirm(force: boolean) {
    const result = await run({ id: booking.id, force });
    if (!result.ok) return;
    if (result.data.outcome === "clash") {
      setClashes(result.data.clashes);
      return;
    }
    setClashes(null);
    toast.success(`${result.data.reference} confirmed`);
  }

  return (
    <>
      <button type="button" className={className} disabled={pending} aria-busy={pending || undefined} onClick={() => confirm(false)}>
        {pending && !clashes ? <Spinner /> : <Check aria-hidden="true" />}
        {label}
      </button>
      <ConfirmDialog
        open={clashes !== null}
        onOpenChange={(open) => {
          if (!open) setClashes(null);
        }}
        title="Confirm despite a scheduling clash?"
        description={
          <>
            <ClashList clashes={clashes ?? []} />
            <p className="mt-2">Confirming will double-book this date. Usually it’s better to offer {firstName(booking.name)} another date.</p>
          </>
        }
        cancelLabel="Go back"
        confirmLabel="Confirm anyway"
        destructive
        pending={pending}
        onConfirm={() => confirm(true)}
      />
    </>
  );
}

/** Declines a pending request, with an optional reason that goes into the customer's e-mail. */
export function DeclineBookingButton({ booking, className = "btn btn-outline text-destructive hover:text-destructive", label = "Decline request" }: ButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending, fieldErrors, reset } = useAction(declineBookingAction, {
    success: (data) => `${data.reference} declined`,
    onSuccess: () => setOpen(false),
  });

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setReason("");
          reset();
          setOpen(true);
        }}
      >
        {label}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Decline request ${booking.reference}?`}
        description={
          <div className="flex flex-col gap-4">
            <p>{booking.name} is told by e-mail when your workspace has e-mail connected. The seats are released at once, and you can reopen the request later.</p>
            <Field label="Reason" note="optional" hint="Included in the message to the customer." error={firstError(fieldErrors, "reason")} className="text-foreground">
              {(control) => <textarea {...control} className="textarea" rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />}
            </Field>
          </div>
        }
        cancelLabel="Keep request"
        confirmLabel="Decline request"
        destructive
        pending={pending}
        onConfirm={() => run({ id: booking.id, reason: reason.trim() || undefined })}
      />
    </>
  );
}

/** Cancels a confirmed booking. Who cancelled and why are both recorded. */
export function CancelBookingButton({ booking, className = "btn btn-outline text-destructive hover:text-destructive" }: ButtonProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"by_business" | "by_customer">("by_customer");
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  const { run, pending, fieldErrors, reset } = useAction(cancelBookingAction, {
    success: (data) => `${data.reference} cancelled`,
    onSuccess: () => setOpen(false),
  });

  function submit() {
    if (!reason.trim()) {
      setMissing(true);
      return;
    }
    run({ id: booking.id, kind, reason: reason.trim() });
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setReason("");
          setKind("by_customer");
          setMissing(false);
          reset();
          setOpen(true);
        }}
      >
        Cancel booking
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Cancel booking ${booking.reference}?`}
        description={
          <div className="flex flex-col gap-4">
            <p>{booking.name} is told by e-mail when your workspace has e-mail connected. The seats are released at once, and you can reopen the booking later.</p>
            <Field label="Who is cancelling?" error={firstError(fieldErrors, "kind")} className="text-foreground">
              {(control) => (
                <select {...control} className="select" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                  <option value="by_customer">The customer asked to cancel</option>
                  <option value="by_business">We are cancelling</option>
                </select>
              )}
            </Field>
            <Field
              label="Reason"
              hint="Included in the message to the customer."
              error={missing && !reason.trim() ? "Give a reason for the cancellation." : firstError(fieldErrors, "reason")}
              className="text-foreground"
            >
              {(control) => (
                <textarea {...control} className="textarea" rows={3} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} />
              )}
            </Field>
          </div>
        }
        cancelLabel="Keep booking"
        confirmLabel="Cancel booking"
        destructive
        pending={pending}
        onConfirm={submit}
      />
    </>
  );
}

export function CompleteBookingButton({ booking, className = "btn btn-secondary" }: ButtonProps) {
  const { run, pending } = useAction(completeBookingAction, {
    success: (data) => (data.reviewRequested ? `${data.reference} completed. Review link e-mailed to the customer.` : `${data.reference} marked as completed`),
  });
  return (
    <button type="button" className={className} disabled={pending} aria-busy={pending || undefined} onClick={() => run({ id: booking.id })}>
      {pending ? <Spinner /> : null}
      Mark completed
    </button>
  );
}

/**
 * Reopens a cancelled booking as pending. The seats may have been sold
 * since; if so the reasons are shown and nothing changes.
 */
export function ReopenBookingButton({ booking, className = "btn btn-outline", onClash }: ButtonProps & { onClash: (clashes: string[] | null) => void }) {
  const { run, pending } = useAction(reopenBookingAction);

  async function reopen() {
    onClash(null);
    const result = await run({ id: booking.id });
    if (!result.ok) return;
    if (result.data.outcome === "clash") onClash(result.data.clashes);
    else toast.success(`${result.data.reference} reopened`);
  }

  return (
    <button type="button" className={className} disabled={pending} aria-busy={pending || undefined} onClick={reopen}>
      {pending ? <Spinner /> : null}
      Reopen as pending
    </button>
  );
}
