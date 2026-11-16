import "server-only";
import type { NotificationInput } from "../notifications";
import { renderNotification, type BookingDetails } from "../notifications/templates";
import type { TenantInfo } from "./shared";

/** The parts of a booking that appear in e-mails. A booking row satisfies it. */
export interface MessageBooking {
  id: string;
  reference: string;
  tourTitle: string;
  startDate: string;
  endDate: string;
  slotTime: string | null;
  adults: number;
  children: number;
  totalAmount: number;
  currency: string;
  pickup: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  customerNotes: string;
}

export type CancelKind = "declined" | "by_customer" | "by_business" | "expired";

/** `2027-03-10 at 14:00` or `2027-03-10 to 2027-03-17`: how the timeline names a booking's dates. */
export function describeWhen(booking: Pick<MessageBooking, "startDate" | "endDate" | "slotTime">): string {
  const range = booking.endDate > booking.startDate ? `${booking.startDate} to ${booking.endDate}` : booking.startDate;
  return booking.slotTime ? `${range} at ${booking.slotTime.slice(0, 5)}` : range;
}

/**
 * Booking and business facts in the shape the notification templates take.
 * The wording itself lives in `notifications/templates`, in one place for
 * every kind of message.
 */
function details(tenant: TenantInfo, booking: MessageBooking): BookingDetails {
  return {
    businessName: tenant.name,
    contactEmail: tenant.email,
    contactPhone: tenant.phone,
    customerName: booking.contactName,
    reference: booking.reference,
    tourTitle: booking.tourTitle,
    startDate: booking.startDate,
    endDate: booking.endDate,
    slotTime: booking.slotTime,
    adults: booking.adults,
    children: booking.children,
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    pickup: booking.pickup,
  };
}

const toCustomer = (booking: MessageBooking) => ({ toEmail: booking.contactEmail, relatedType: "booking", relatedId: booking.id });

export function bookingReceivedMessage(tenant: TenantInfo, booking: MessageBooking, holdHours: number): NotificationInput {
  return { kind: "booking.received", ...toCustomer(booking), ...renderNotification("booking.received", { ...details(tenant, booking), holdHours }) };
}

/** Sent to the business itself, so it carries the traveller's contact details and note. */
export function staffAlertMessage(tenant: TenantInfo, toEmail: string, booking: MessageBooking): NotificationInput {
  return {
    kind: "booking.staff_alert",
    toEmail,
    relatedType: "booking",
    relatedId: booking.id,
    ...renderNotification("booking.staff_alert", {
      ...details(tenant, booking),
      customerEmail: booking.contactEmail,
      customerPhone: booking.contactPhone,
      customerNotes: booking.customerNotes,
    }),
  };
}

export function bookingConfirmedMessage(tenant: TenantInfo, booking: MessageBooking): NotificationInput {
  return { kind: "booking.confirmed", ...toCustomer(booking), ...renderNotification("booking.confirmed", details(tenant, booking)) };
}

export function bookingCancelledMessage(tenant: TenantInfo, booking: MessageBooking, cancelKind: CancelKind, reason: string | null): NotificationInput {
  return { kind: "booking.cancelled", ...toCustomer(booking), ...renderNotification("booking.cancelled", { ...details(tenant, booking), cancelKind, reason }) };
}

export function bookingRescheduledMessage(tenant: TenantInfo, booking: MessageBooking, previous: Pick<MessageBooking, "startDate" | "endDate" | "slotTime">): NotificationInput {
  return {
    kind: "booking.rescheduled",
    ...toCustomer(booking),
    ...renderNotification("booking.rescheduled", {
      ...details(tenant, booking),
      previousStartDate: previous.startDate,
      previousEndDate: previous.endDate,
      previousSlotTime: previous.slotTime,
    }),
  };
}
