"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { monthBucket } from "@/lib/booking-display";
import { todayIn } from "@/lib/dates";
import { workspaceAction } from "@/server/actions";
import { inWorkspace, type Workspace } from "@/server/auth/workspace";
import { getTourAvailability } from "@/server/bookings/availability";
import {
  BookingClashError,
  addBookingNote,
  cancelBooking,
  completeBooking,
  confirmBooking,
  declineBooking,
  reopenBooking,
  rescheduleBooking,
  updatePaymentStatus,
} from "@/server/bookings/service";
import { issueReviewLink, sendReviewRequest } from "@/server/content/review-requests";
import { deliverPending } from "@/server/notifications";

/**
 * A booking action either happened or was stopped by a scheduling clash.
 * A clash is an expected answer, not a failure: the panel lists what
 * collides and, where the action allows it, offers to go ahead anyway.
 */
export type BookingOutcome = { outcome: "done"; reference: string } | { outcome: "clash"; clashes: string[] };

const id = z.string().trim().min(1).max(64);
const reason = z.string().trim().max(500);

/** Every booking change can move the sidebar badge, the overview and the customer's history. */
function refresh(): void {
  revalidatePath("/workspace", "layout");
}

/**
 * Sends the e-mails a booking change queued, once the response has gone out
 * and the change is committed. A failure here is not the member's problem:
 * the message stays queued and the scheduled job retries it.
 */
function deliverSoon(workspace: Workspace): void {
  after(async () => {
    try {
      await inWorkspace(workspace, (scope) => deliverPending(scope, { limit: 10 }));
    } catch {
      // Left for the scheduled delivery job.
    }
  });
}

/** Runs a service call that may report a clash, turning the clash into data. */
async function orClash(run: () => Promise<{ reference: string }>): Promise<BookingOutcome> {
  try {
    const booking = await run();
    return { outcome: "done", reference: booking.reference };
  } catch (error) {
    // The service throws before writing anything, so there is nothing to undo.
    if (error instanceof BookingClashError) return { outcome: "clash", clashes: error.clashes };
    throw error;
  }
}

export const confirmBookingAction = workspaceAction(
  "bookings.manage",
  z.object({ id, force: z.boolean().optional() }),
  async ({ workspace, scope, input }) => {
    const result = await orClash(() => confirmBooking(scope, input.id, { force: input.force }));
    if (result.outcome === "done") {
      refresh();
      deliverSoon(workspace);
    }
    return result;
  },
);

export const declineBookingAction = workspaceAction(
  "bookings.manage",
  z.object({ id, reason: reason.optional() }),
  async ({ workspace, scope, input }) => {
    const booking = await declineBooking(scope, input.id, { reason: input.reason || undefined });
    refresh();
    deliverSoon(workspace);
    return { reference: booking.reference };
  },
);

export const cancelBookingAction = workspaceAction(
  "bookings.manage",
  z.object({
    id,
    kind: z.enum(["by_business", "by_customer"]),
    reason: reason.min(1, "Give a reason for the cancellation."),
  }),
  async ({ workspace, scope, input }) => {
    const booking = await cancelBooking(scope, input.id, { kind: input.kind, reason: input.reason });
    refresh();
    deliverSoon(workspace);
    return { reference: booking.reference };
  },
);

export const completeBookingAction = workspaceAction(
  "bookings.manage",
  z.object({ id, requestReview: z.boolean().optional() }),
  async ({ workspace, scope, input }) => {
    const booking = await completeBooking(scope, input.id, { requestReview: input.requestReview });
    refresh();
    deliverSoon(workspace);
    return { reference: booking.reference, reviewRequested: input.requestReview !== false && Boolean(booking.contactEmail) };
  },
);

/** E-mails the customer a review link; a new link replaces any earlier one. */
export const sendReviewRequestAction = workspaceAction("bookings.manage", z.object({ id }), async ({ workspace, scope, input }) => {
  const link = await sendReviewRequest(scope, input.id);
  refresh();
  deliverSoon(workspace);
  return { expiresAt: link.expiresAt.toISOString() };
});

/** A fresh review link to share another way (WhatsApp, a message). Replaces any earlier link. */
export const createReviewLinkAction = workspaceAction("bookings.manage", z.object({ id }), async ({ scope, input }) => {
  const link = await issueReviewLink(scope, input.id);
  refresh();
  return { url: link.url, expiresAt: link.expiresAt.toISOString() };
});

/** Reopening has no override: the seats must still be free. */
export const reopenBookingAction = workspaceAction("bookings.manage", z.object({ id }), async ({ scope, input }) => {
  const result = await orClash(() => reopenBooking(scope, input.id));
  if (result.outcome === "done") refresh();
  return result;
});

export const rescheduleBookingAction = workspaceAction(
  "bookings.manage",
  z.object({
    id,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
    slotTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a start time.")
      .nullish(),
    force: z.boolean().optional(),
  }),
  async ({ workspace, scope, input }) => {
    const result = await orClash(() => rescheduleBooking(scope, input.id, { date: input.date, slotTime: input.slotTime ?? undefined, force: input.force }));
    if (result.outcome === "done") {
      refresh();
      deliverSoon(workspace);
    }
    return result;
  },
);

export const updatePaymentAction = workspaceAction(
  "bookings.manage",
  z.object({
    id,
    paymentStatus: z.enum(["unpaid", "deposit_paid", "paid", "refunded"]),
    /** Minor units. */
    amountPaid: z.number().int().min(0).optional(),
  }),
  async ({ scope, input }) => {
    const booking = await updatePaymentStatus(scope, input.id, { paymentStatus: input.paymentStatus, amountPaid: input.amountPaid });
    refresh();
    return { reference: booking.reference, paymentStatus: booking.paymentStatus, amountPaid: booking.amountPaid };
  },
);

export const addBookingNoteAction = workspaceAction(
  "bookings.manage",
  z.object({ id, body: z.string().trim().min(1, "Write a note first.").max(2000, "Keep the note under 2,000 characters.") }),
  async ({ scope, input }) => {
    const note = await addBookingNote(scope, input.id, input.body);
    refresh();
    return { id: note.id };
  },
);

export interface AvailabilityDay {
  date: string;
  state: "open" | "limited" | "full" | "hold" | "closed" | "past";
  seatsLeft: number;
  slots: { time: string; seatsLeft: number; state: "open" | "limited" | "full" }[] | null;
}

export interface AvailabilityMonth {
  month: string;
  today: string;
  kind: "day" | "departure" | "private";
  days: AvailabilityDay[];
}

/** One month of a tour's calendar for the reschedule picker. Read-only, so viewers may load it too. */
export const loadAvailabilityAction = workspaceAction(
  "bookings.view",
  z.object({ tourId: id, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  async ({ workspace, scope, input }): Promise<AvailabilityMonth> => {
    const today = todayIn(workspace.tenant.timezone);
    const { from, to } = monthBucket(input.month);
    const availability = await getTourAvailability(scope, input.tourId, { from, to, today, includeUnpublished: true });
    return {
      month: input.month,
      today,
      kind: availability.kind,
      days: availability.days.map((day) => ({
        date: day.date,
        state: day.state,
        seatsLeft: day.seatsLeft,
        slots: day.slots ? day.slots.map((slot) => ({ time: slot.time, seatsLeft: slot.seatsLeft, state: slot.state })) : null,
      })),
    };
  },
);
