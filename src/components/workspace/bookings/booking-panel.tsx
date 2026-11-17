"use client";

import { CalendarClock, Mail, MessageCircle, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { addBookingNoteAction, updatePaymentAction } from "@/app/workspace/bookings/actions";
import { Field, firstError } from "@/components/form";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import {
  BOOKING_STATUS_BADGES,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_BADGES,
  PAYMENT_STATUS_LABELS,
  availableActions,
  fromMinorUnits,
  toMinorUnits,
  type PaymentStatus,
} from "@/lib/booking-display";
import {
  CancelBookingButton,
  ClashList,
  CompleteBookingButton,
  ConfirmBookingButton,
  DeclineBookingButton,
  ReopenBookingButton,
} from "./booking-actions";
import { RescheduleForm } from "./reschedule-form";
import { ReviewLinkSection } from "./review-link-section";
import type { BookingDetailView, BookingRowView } from "./view-models";

export interface PanelPermissions {
  /** bookings.manage: every action in the panel. */
  manage: boolean;
  /** promotions.view: the "Manage" link beside a discount. */
  promotions: boolean;
}

const SECTION_HEADING = "mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground";

function PanelHeader({
  kicker,
  name,
  badges,
  onClose,
}: {
  kicker: string;
  name: string;
  badges: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-background p-5 sm:p-6">
      <div className="min-w-0">
        <p className="text-[13px] text-muted-foreground">{kicker}</p>
        <p className="my-1 break-words font-display text-3xl font-semibold leading-tight text-primary">{name}</p>
        <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
      </div>
      <button type="button" className="btn btn-outline btn-icon shrink-0" aria-label="Close details" onClick={onClose}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

/** Shown the instant a row is pressed, while the full record is on its way. */
export function BookingPanelSkeleton({ row, onClose }: { row: BookingRowView | null; onClose: () => void }) {
  return (
    <>
      <PanelHeader
        kicker={row ? `${row.reference} · requested ${row.requested}` : "Loading booking"}
        name={row?.name ?? "…"}
        badges={row ? <span className={BOOKING_STATUS_BADGES[row.status]}>{row.statusLabel}</span> : null}
        onClose={onClose}
      />
      <div aria-busy="true" aria-label="Loading booking details" className="flex flex-col gap-6 p-5 sm:p-6">
        <div className="skeleton h-11 w-48" />
        <div className="skeleton h-32" />
        <div className="skeleton h-48" />
        <div className="skeleton h-24" />
      </div>
    </>
  );
}

export function BookingPanelMissing({ onClose }: { onClose: () => void }) {
  return (
    <>
      <PanelHeader kicker="Bookings" name="Booking not found" badges={null} onClose={onClose} />
      <div className="flex flex-col items-start gap-4 p-5 sm:p-6">
        <p className="text-sm leading-relaxed text-muted-foreground">
          This link does not match a booking in this workspace. It may have been opened from another workspace, or the address was shortened.
        </p>
        <button type="button" className="btn btn-default" onClick={onClose}>
          Back to bookings
        </button>
      </div>
    </>
  );
}

function PaymentForm({ booking }: { booking: BookingDetailView }) {
  const { currency, totalAmount, amountPaid } = booking.price;
  const [status, setStatus] = useState<PaymentStatus>(booking.paymentStatus);
  const [amount, setAmount] = useState(amountPaid > 0 ? fromMinorUnits(amountPaid, currency) : "");
  const [amountError, setAmountError] = useState<string | null>(null);
  const { run, pending, fieldErrors } = useAction(updatePaymentAction, { success: "Payment updated" });

  const needsAmount = status === "deposit_paid";
  const unchanged = status === booking.paymentStatus && (!needsAmount || toMinorUnits(amount, currency) === amountPaid);

  function submit(event: FormEvent) {
    event.preventDefault();
    setAmountError(null);
    if (!needsAmount) {
      run({ id: booking.id, paymentStatus: status });
      return;
    }
    const minor = toMinorUnits(amount, currency);
    if (minor === null || minor === 0) {
      setAmountError("Enter the deposit received, for example 150.00.");
      return;
    }
    if (minor > totalAmount) {
      setAmountError(`The deposit cannot be more than the total of ${booking.price.total}.`);
      return;
    }
    run({ id: booking.id, paymentStatus: status, amountPaid: minor });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Payment status" error={firstError(fieldErrors, "paymentStatus")}>
          {(control) => (
            <select
              {...control}
              className="select"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as PaymentStatus);
                setAmountError(null);
              }}
            >
              {PAYMENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {needsAmount ? (
          <Field label={`Deposit received (${currency})`} error={amountError ?? firstError(fieldErrors, "amountPaid")}>
            {(control) => (
              <input {...control} className="input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} />
            )}
          </Field>
        ) : firstError(fieldErrors, "amountPaid") ? (
          <p role="alert" className="field-error self-end">
            {firstError(fieldErrors, "amountPaid")}
          </p>
        ) : null}
      </div>
      <p className="field-hint">
        {status === "paid"
          ? `Records the full ${booking.price.total} as received.`
          : status === "unpaid"
            ? "Records that nothing has been received."
            : status === "refunded"
              ? "Keeps the amount received on record and marks it refunded."
              : "Payments are recorded here, not collected."}
      </p>
      <button type="submit" className="btn btn-outline self-start" disabled={pending || unchanged} aria-busy={pending || undefined}>
        {pending ? <Spinner /> : null}
        Update payment
      </button>
    </form>
  );
}

function NoteForm({ bookingId }: { bookingId: string }) {
  const [body, setBody] = useState("");
  const [empty, setEmpty] = useState(false);
  const { run, pending, fieldErrors } = useAction(addBookingNoteAction, { success: "Note saved", onSuccess: () => setBody("") });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    run({ id: bookingId, body: body.trim() });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Internal notes" note="· only visible to your team" error={empty && !body.trim() ? "Write a note first." : firstError(fieldErrors, "body")}>
        {(control) => (
          <textarea
            {...control}
            className="textarea"
            rows={3}
            maxLength={2000}
            placeholder="Dietary needs, what was agreed by phone, anything the next person should know"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        )}
      </Field>
      <button type="submit" className="btn btn-default self-start" disabled={pending} aria-busy={pending || undefined}>
        {pending ? <Spinner /> : null}
        Save note
      </button>
    </form>
  );
}

interface BookingPanelContentProps {
  booking: BookingDetailView;
  permissions: PanelPermissions;
  onClose: () => void;
}

export function BookingPanelContent({ booking, permissions, onClose }: BookingPanelContentProps) {
  const [rescheduling, setRescheduling] = useState(false);
  const [reopenClashes, setReopenClashes] = useState<string[] | null>(null);
  const actions = availableActions(booking.status);
  const ref = { id: booking.id, reference: booking.reference, name: booking.contact.name };
  const hasStatusActions = permissions.manage && (actions.confirm || actions.complete || actions.cancel || actions.decline || actions.reopen);

  return (
    <div className="flex min-h-full flex-col">
      <PanelHeader
        kicker={`${booking.reference} · requested ${booking.requested}`}
        name={booking.contact.name}
        badges={
          <>
            <span className={BOOKING_STATUS_BADGES[booking.status]}>{booking.statusLabel}</span>
            <span className={PAYMENT_STATUS_BADGES[booking.paymentStatus]}>{PAYMENT_STATUS_LABELS[booking.paymentStatus]}</span>
          </>
        }
        onClose={onClose}
      />

      {/* First in the sheet on wide screens, as designed; a thumb-reach bar on phones. */}
      {hasStatusActions ? (
        <div className="safe-b sticky bottom-0 z-10 order-last flex flex-wrap gap-2 border-t bg-background px-5 pt-3 sm:static sm:order-none sm:border-t-0 sm:bg-transparent sm:px-6 sm:pb-0 sm:pt-6">
          {actions.confirm ? <ConfirmBookingButton booking={ref} className="btn btn-default flex-1 sm:flex-none" /> : null}
          {actions.complete ? <CompleteBookingButton booking={ref} className="btn btn-secondary flex-1 sm:flex-none" /> : null}
          {actions.decline ? <DeclineBookingButton booking={ref} className="btn btn-outline flex-1 text-destructive hover:text-destructive sm:flex-none" /> : null}
          {actions.cancel ? <CancelBookingButton booking={ref} className="btn btn-outline flex-1 text-destructive hover:text-destructive sm:flex-none" /> : null}
          {actions.reopen ? <ReopenBookingButton booking={ref} className="btn btn-outline flex-1 sm:flex-none" onClash={setReopenClashes} /> : null}
        </div>
      ) : null}

      <div className="flex flex-1 flex-col gap-6 p-5 sm:p-6">
        {reopenClashes ? (
          <div role="alert" className="alert alert-destructive">
            <p className="font-bold">This booking cannot be reopened on its date</p>
            <ClashList clashes={reopenClashes} className="mt-1" />
            <p className="mt-2">The seats were taken after it was cancelled. Move it to another date first, then reopen it.</p>
          </div>
        ) : null}

        {booking.clashes.length > 0 ? (
          <div role="alert" className="alert alert-destructive">
            <p className="flex items-center gap-2 font-bold">
              <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
              Scheduling conflict
            </p>
            <ClashList clashes={booking.clashes} className="mt-1" />
            <p className="mt-2">Suggest another date to the guest, or decline, to avoid a double booking.</p>
          </div>
        ) : null}

        {booking.hold ? <p className="alert alert-warning">{booking.hold}</p> : null}
        {booking.cancelReason ? (
          <p className="alert">
            <span className="font-semibold">Reason given:</span> {booking.cancelReason}
          </p>
        ) : null}

        <section aria-label="Contact" className="flex flex-col gap-2 rounded-lg bg-muted/60 p-4 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Email</span>
            <span className="min-w-0 break-all text-right font-semibold">{booking.contact.email}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Phone</span>
            <span className="text-right font-semibold">{booking.contact.phone || "Not given"}</span>
          </div>
          {booking.contact.country ? (
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Country</span>
              <span className="text-right font-semibold">{booking.contact.country}</span>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Prefers</span>
            <span className="text-right font-semibold">{booking.contact.prefers}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {booking.contact.whatsapp ? (
              <a href={booking.contact.whatsapp} target="_blank" rel="noreferrer" className="btn btn-default btn-sm">
                <MessageCircle aria-hidden="true" />
                WhatsApp<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
            <a href={booking.contact.mailto} className={booking.contact.whatsapp ? "btn btn-outline btn-sm" : "btn btn-default btn-sm"}>
              <Mail aria-hidden="true" />
              Email guest
            </a>
            {booking.contact.profileHref ? (
              <Link href={booking.contact.profileHref} className="btn btn-ghost btn-sm">
                Customer profile
              </Link>
            ) : null}
          </div>
        </section>

        {booking.review ? (
          <ReviewLinkSection
            bookingId={booking.id}
            customerEmail={booking.contact.email}
            review={booking.review}
            canManage={permissions.manage}
            headingClassName={SECTION_HEADING}
          />
        ) : null}

        <section aria-labelledby="booking-trip">
          <h3 id="booking-trip" className={SECTION_HEADING}>
            Trip details
          </h3>
          <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2.5 text-sm sm:grid-cols-[130px_1fr]">
            <dt className="text-muted-foreground">Tour</dt>
            <dd className="font-semibold">{booking.trip.tourTitle}</dd>
            <dt className="text-muted-foreground">Date &amp; time</dt>
            <dd>{booking.trip.when}</dd>
            <dt className="text-muted-foreground">Alternative date</dt>
            <dd>{booking.trip.alternativeDate ?? "—"}</dd>
            <dt className="text-muted-foreground">Travellers</dt>
            <dd>
              {booking.trip.guests}
              {booking.trip.participants.length > 0 ? <span className="mt-0.5 block text-[13px] text-muted-foreground">{booking.trip.participants.join(", ")}</span> : null}
            </dd>
            <dt className="text-muted-foreground">Language</dt>
            <dd>{booking.trip.language || "—"}</dd>
            <dt className="text-muted-foreground">Pickup</dt>
            <dd>{booking.trip.pickup || "—"}</dd>
            <dt className="text-muted-foreground">Guest notes</dt>
            <dd className="whitespace-pre-wrap leading-relaxed">{booking.trip.notes || "None"}</dd>
          </dl>
          {permissions.manage && actions.reschedule ? (
            <div className="mt-4 flex flex-col gap-3">
              {rescheduling ? (
                <RescheduleForm
                  booking={{ id: booking.id, tourId: booking.trip.tourId, startDate: booking.trip.startDate, slotTime: booking.trip.slotTime }}
                  onDone={() => setRescheduling(false)}
                />
              ) : (
                <button type="button" className="btn btn-outline self-start" aria-expanded={false} onClick={() => setRescheduling(true)}>
                  <CalendarClock aria-hidden="true" />
                  Change date
                </button>
              )}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="booking-price">
          <h3 id="booking-price" className={SECTION_HEADING}>
            Price &amp; payment
          </h3>
          <dl className="flex flex-col gap-2 text-sm">
            {booking.price.lines.map((line) => (
              <div key={line.label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd>{line.amount}</dd>
              </div>
            ))}
            {booking.price.discount ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  Discount{booking.price.discountLabel ? ` · ${booking.price.discountLabel}` : ""}
                  {permissions.promotions ? (
                    <>
                      {" "}
                      <Link href="/workspace/promotions" className="text-xs text-primary underline-offset-4 hover:underline">
                        Manage
                      </Link>
                    </>
                  ) : null}
                </dt>
                <dd className="font-semibold">−{booking.price.discount}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3 border-t pt-2">
              <dt className="font-semibold">Total</dt>
              <dd className="font-bold">
                {booking.price.total}
                {booking.price.discount ? <span className="ml-2 text-xs font-normal text-muted-foreground line-through">{booking.price.base}</span> : null}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Received</dt>
              <dd>{booking.price.paid}</dd>
            </div>
            {booking.paymentStatus !== "refunded" ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Balance due</dt>
                <dd className="font-semibold">{booking.price.balance}</dd>
              </div>
            ) : null}
          </dl>
          {permissions.manage ? (
            <div className="mt-4">
              <PaymentForm key={`${booking.paymentStatus}:${booking.price.amountPaid}`} booking={booking} />
            </div>
          ) : null}
        </section>

        <div className="separator" />

        {permissions.manage ? <NoteForm bookingId={booking.id} /> : null}

        <section aria-labelledby="booking-timeline">
          <h3 id="booking-timeline" className={SECTION_HEADING}>
            Timeline
          </h3>
          {booking.events.length > 0 ? (
            <ol className="flex flex-col gap-3">
              {booking.events.map((event) => (
                <li key={event.id} className="border-l-2 pl-3 text-[13px]">
                  <span className="text-muted-foreground">
                    {event.at} · {event.kindLabel}
                    {event.actor ? ` · ${event.actor}` : ""}
                  </span>
                  <p className="mt-0.5 whitespace-pre-wrap leading-relaxed">{event.message}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-muted-foreground">Nothing has happened on this booking since it was requested on {booking.requestedAt}.</p>
          )}
        </section>
      </div>
    </div>
  );
}
