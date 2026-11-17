import "server-only";
import { formatMoney, isIsoDate } from "../../lib/dates";
import type { NotificationKind } from "./types";

export interface RenderedNotification {
  subject: string;
  bodyText: string;
}

/** Who the message is from, and how the reader can get back in touch. */
export interface BusinessDetails {
  businessName: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface BookingDetails extends BusinessDetails {
  customerName: string;
  reference: string;
  tourTitle: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive last day, `YYYY-MM-DD`. Omit for a single-day tour. */
  endDate?: string;
  /** `HH:MM` or `HH:MM:SS`, for tours with a start time. */
  slotTime?: string | null;
  adults: number;
  children?: number;
  /** Minor units. */
  totalAmount: number;
  currency: string;
  pickup?: string;
  /** Page where the traveller can follow this booking. */
  statusUrl?: string;
}

export interface BookingReceivedData extends BookingDetails {
  /** How long the seats are held while the request is reviewed. */
  holdHours?: number;
}

export type BookingConfirmedData = BookingDetails;

export interface BookingCancelledData extends BookingDetails {
  cancelKind: "declined" | "by_customer" | "by_business" | "expired";
  reason?: string | null;
}

export interface BookingRescheduledData extends BookingDetails {
  previousStartDate: string;
  previousEndDate?: string;
  previousSlotTime?: string | null;
}

export interface BookingStaffAlertData extends BookingDetails {
  customerEmail: string;
  customerPhone?: string;
  customerNotes?: string;
  /** Dashboard page of the booking. */
  dashboardUrl?: string;
}

export interface DiscountValue {
  type: "percent" | "fixed";
  /** Whole percent for `percent`; minor units for `fixed`. */
  value: number;
}

export interface DiscountRequestDetails extends BusinessDetails {
  customerName: string;
  reference: string;
  tourTitle: string;
  guests: number;
  currency: string;
  /** Page where the traveller can follow this request. */
  statusUrl?: string;
}

export interface DiscountRequestReceivedData extends DiscountRequestDetails {
  requested: DiscountValue;
}

export interface DiscountRequestApprovedData extends DiscountRequestDetails {
  approved: DiscountValue;
  note?: string | null;
  /** Page where the traveller books with the discount applied. */
  bookingUrl?: string;
}

export interface DiscountRequestRejectedData extends DiscountRequestDetails {
  note?: string | null;
}

export interface InquiryStaffAlertData {
  businessName: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  tourTitle?: string | null;
  message: string;
  /** Dashboard page of the inquiry. */
  dashboardUrl?: string;
}

export interface ReviewRequestedData extends BusinessDetails {
  customerName: string;
  tourTitle: string;
  /** `YYYY-MM-DD`: the day the tour began. */
  startDate: string;
  /** The private review page. */
  reviewUrl: string;
  /** Last day the link works, `YYYY-MM-DD`. */
  expiresOn: string;
}

export interface ReviewStaffAlertData {
  businessName: string;
  customerName: string;
  bookingReference: string;
  tourTitle: string;
  rating: number;
  title?: string;
  body: string;
  /** How many photos and videos came with it. */
  attachments: number;
  /** Dashboard page where the review can be published. */
  dashboardUrl?: string;
}

export interface NotificationTemplateData {
  "booking.received": BookingReceivedData;
  "booking.confirmed": BookingConfirmedData;
  "booking.cancelled": BookingCancelledData;
  "booking.rescheduled": BookingRescheduledData;
  "booking.staff_alert": BookingStaffAlertData;
  "discount_request.received": DiscountRequestReceivedData;
  "discount_request.approved": DiscountRequestApprovedData;
  "discount_request.rejected": DiscountRequestRejectedData;
  "inquiry.staff_alert": InquiryStaffAlertData;
  "review.requested": ReviewRequestedData;
  "review.staff_alert": ReviewStaffAlertData;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** `2026-03-14` → `Sat, 14 Mar 2026`. Anything else is shown as given. */
function formatDate(date: string): string {
  return isIsoDate(date) ? DATE_FORMAT.format(new Date(`${date}T00:00:00Z`)) : date;
}

function formatWhen(startDate: string, endDate?: string, slotTime?: string | null): string {
  const range = endDate && endDate !== startDate ? `${formatDate(startDate)} to ${formatDate(endDate)}` : formatDate(startDate);
  return slotTime ? `${range} at ${slotTime.slice(0, 5)}` : range;
}

function money(minorUnits: number, currency: string): string {
  try {
    return formatMoney(minorUnits, currency);
  } catch {
    // A currency code the runtime does not know must not stop a message.
    return `${minorUnits} ${currency} (minor units)`;
  }
}

function discount(value: DiscountValue, currency: string): string {
  return value.type === "percent" ? `${value.value}% off` : `${money(value.value, currency)} off`;
}

function guests(adults: number, children = 0): string {
  const grownUps = plural(adults, "adult", "adults");
  return children > 0 ? `${grownUps}, ${plural(children, "child", "children")}` : grownUps;
}

function bookingSummary(data: BookingDetails): string[] {
  return [
    `Booking reference: ${data.reference}`,
    `Tour: ${data.tourTitle}`,
    `When: ${formatWhen(data.startDate, data.endDate, data.slotTime)}`,
    `Guests: ${guests(data.adults, data.children)}`,
    `Total: ${money(data.totalAmount, data.currency)}`,
    ...(data.pickup?.trim() ? [`Pick-up: ${data.pickup.trim()}`] : []),
  ];
}

function requestSummary(data: DiscountRequestDetails): string[] {
  return [`Request reference: ${data.reference}`, `Tour: ${data.tourTitle}`, `Guests: ${data.guests}`];
}

function signOff(business: BusinessDetails): string[] {
  const ways = [business.contactEmail?.trim(), business.contactPhone?.trim()].filter(Boolean);
  return [...(ways.length > 0 ? [`Questions? Reach us at ${ways.join(" or ")}.`, ""] : []), "Warm regards,", business.businessName];
}

/** Joins paragraphs with one blank line; empty paragraphs are left out. */
function compose(...paragraphs: (string | string[] | false | null | undefined)[]): string {
  return paragraphs
    .map((paragraph) => (Array.isArray(paragraph) ? paragraph.join("\n") : paragraph || ""))
    .filter((paragraph) => paragraph.trim() !== "")
    .join("\n\n");
}

const CANCELLED_OPENING: Record<BookingCancelledData["cancelKind"], string> = {
  declined: "Thank you for your request. Unfortunately we are not able to accept it this time.",
  by_business: "We are sorry to let you know that we have had to cancel your booking.",
  by_customer: "Your booking has been cancelled, as you asked.",
  expired: "We could not confirm your request in time, so the hold on your seats has been released.",
};

export function bookingReceived(data: BookingReceivedData): RenderedNotification {
  const hold = data.holdHours ? ` Your seats are held for ${plural(data.holdHours, "hour", "hours")} while we check the details.` : "";
  return {
    subject: `We received your booking request ${data.reference}`,
    bodyText: compose(
      `Hi ${firstName(data.customerName)},`,
      `Thank you for choosing ${data.businessName}. We have your request and will confirm it as soon as we can.${hold}`,
      bookingSummary(data),
      data.statusUrl && `Follow your booking here: ${data.statusUrl}`,
      signOff(data),
    ),
  };
}

export function bookingConfirmed(data: BookingConfirmedData): RenderedNotification {
  return {
    subject: `Your booking ${data.reference} is confirmed`,
    bodyText: compose(
      `Hi ${firstName(data.customerName)},`,
      `Good news: your booking with ${data.businessName} is confirmed. We are looking forward to welcoming you.`,
      bookingSummary(data),
      data.statusUrl && `View your booking here: ${data.statusUrl}`,
      signOff(data),
    ),
  };
}

export function bookingCancelled(data: BookingCancelledData): RenderedNotification {
  const neverConfirmed = data.cancelKind === "declined" || data.cancelKind === "expired";
  return {
    subject: neverConfirmed ? `About your booking request ${data.reference}` : `Your booking ${data.reference} has been cancelled`,
    bodyText: compose(
      `Hi ${firstName(data.customerName)},`,
      CANCELLED_OPENING[data.cancelKind],
      data.reason?.trim() && `Reason: ${data.reason.trim()}`,
      bookingSummary(data),
      data.cancelKind !== "by_customer" && "We would be glad to help you find another date.",
      signOff(data),
    ),
  };
}

export function bookingRescheduled(data: BookingRescheduledData): RenderedNotification {
  return {
    subject: `New date for your booking ${data.reference}`,
    bodyText: compose(
      `Hi ${firstName(data.customerName)},`,
      `Your booking with ${data.businessName} has been moved.`,
      [
        `Was: ${formatWhen(data.previousStartDate, data.previousEndDate, data.previousSlotTime)}`,
        `Now: ${formatWhen(data.startDate, data.endDate, data.slotTime)}`,
      ],
      bookingSummary(data),
      data.statusUrl && `View your booking here: ${data.statusUrl}`,
      "If the new date does not suit you, let us know and we will sort it out.",
      signOff(data),
    ),
  };
}

export function bookingStaffAlert(data: BookingStaffAlertData): RenderedNotification {
  return {
    subject: `New booking request ${data.reference}: ${data.tourTitle}`,
    bodyText: compose(
      `${data.customerName} has asked to book ${data.tourTitle}.`,
      bookingSummary(data),
      [`Traveller: ${data.customerName}`, `E-mail: ${data.customerEmail}`, ...(data.customerPhone?.trim() ? [`Phone: ${data.customerPhone.trim()}`] : [])],
      data.customerNotes?.trim() && `Their note: ${data.customerNotes.trim()}`,
      data.dashboardUrl ? `Review and confirm it here: ${data.dashboardUrl}` : "Review and confirm it in your Wayfold dashboard.",
    ),
  };
}

export function discountRequestReceived(data: DiscountRequestReceivedData): RenderedNotification {
  return {
    subject: `We received your discount request ${data.reference}`,
    bodyText: compose(
      `Hi ${firstName(data.customerName)},`,
      `Thank you for getting in touch with ${data.businessName}. We have your request and will reply soon.`,
      [...requestSummary(data), `Requested: ${discount(data.requested, data.currency)}`],
      data.statusUrl && `Check the status any time here: ${data.statusUrl}`,
      signOff(data),
    ),
  };
}

export function discountRequestApproved(data: DiscountRequestApprovedData): RenderedNotification {
  return {
    subject: `Your discount request ${data.reference} is approved`,
    bodyText: compose(
      `Hi ${firstName(data.customerName)},`,
      `Good news: ${data.businessName} has approved a discount for you.`,
      [...requestSummary(data), `Your discount: ${discount(data.approved, data.currency)}`],
      data.note?.trim() && `A note from us: ${data.note.trim()}`,
      data.bookingUrl ? `Book with your discount here: ${data.bookingUrl}` : `Quote the reference ${data.reference} when you book and the discount will be applied.`,
      signOff(data),
    ),
  };
}

export function discountRequestRejected(data: DiscountRequestRejectedData): RenderedNotification {
  return {
    subject: `About your discount request ${data.reference}`,
    bodyText: compose(
      `Hi ${firstName(data.customerName)},`,
      `Thank you for asking. We are sorry, but ${data.businessName} is not able to offer a discount on this request.`,
      requestSummary(data),
      data.note?.trim() && `A note from us: ${data.note.trim()}`,
      "You are still very welcome to book at the listed price, and we would love to have you with us.",
      signOff(data),
    ),
  };
}

export function inquiryStaffAlert(data: InquiryStaffAlertData): RenderedNotification {
  return {
    subject: `New inquiry from ${data.customerName}`,
    bodyText: compose(
      `${data.customerName} sent a message through the ${data.businessName} website.`,
      [
        `Name: ${data.customerName}`,
        `E-mail: ${data.customerEmail}`,
        ...(data.customerPhone?.trim() ? [`Phone: ${data.customerPhone.trim()}`] : []),
        ...(data.tourTitle?.trim() ? [`About: ${data.tourTitle.trim()}`] : []),
      ],
      ["Message:", data.message.trim()],
      data.dashboardUrl ? `Reply from your dashboard: ${data.dashboardUrl}` : "Reply from your Wayfold dashboard, or write to them directly.",
    ),
  };
}

export function reviewRequested(data: ReviewRequestedData): RenderedNotification {
  return {
    subject: `How was ${data.tourTitle}?`,
    bodyText: compose(
      `Hi ${firstName(data.customerName)},`,
      `Thank you for travelling with ${data.businessName} on ${data.tourTitle} (${formatDate(data.startDate)}). We would love to hear how it went.`,
      `Write a short review here, and add photos or videos if you like. It takes a couple of minutes: ${data.reviewUrl}`,
      `The link is just for you and works until ${formatDate(data.expiresOn)}. Your review appears on our website once we have read it.`,
      signOff(data),
    ),
  };
}

export function reviewStaffAlert(data: ReviewStaffAlertData): RenderedNotification {
  const stars = Math.min(5, Math.max(1, Math.round(data.rating)));
  return {
    subject: `New ${stars}-star review from ${data.customerName}`,
    bodyText: compose(
      `${data.customerName} reviewed ${data.tourTitle} (booking ${data.bookingReference}). It is waiting for you to publish it.`,
      [`Rating: ${"★".repeat(stars)}${"☆".repeat(5 - stars)} (${stars} of 5)`, ...(data.title?.trim() ? [`Title: ${data.title.trim()}`] : []), ...(data.attachments > 0 ? [`Photos and videos: ${data.attachments}`] : [])],
      data.body.trim(),
      data.dashboardUrl ? `Read and publish it from your dashboard: ${data.dashboardUrl}` : "Read and publish it from your Wayfold dashboard.",
    ),
  };
}

export const notificationTemplates: { [K in NotificationKind]: (data: NotificationTemplateData[K]) => RenderedNotification } = {
  "booking.received": bookingReceived,
  "booking.confirmed": bookingConfirmed,
  "booking.cancelled": bookingCancelled,
  "booking.rescheduled": bookingRescheduled,
  "booking.staff_alert": bookingStaffAlert,
  "discount_request.received": discountRequestReceived,
  "discount_request.approved": discountRequestApproved,
  "discount_request.rejected": discountRequestRejected,
  "inquiry.staff_alert": inquiryStaffAlert,
  "review.requested": reviewRequested,
  "review.staff_alert": reviewStaffAlert,
};

/** Renders the template for `kind`. The data type follows from the kind. */
export function renderNotification<K extends NotificationKind>(kind: K, data: NotificationTemplateData[K]): RenderedNotification {
  return notificationTemplates[kind](data);
}
