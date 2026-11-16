/**
 * What the bookings screens show, already formatted. Built on the server so
 * dates, money and "requested 3 h ago" are rendered once, in the workspace's
 * timezone, and the browser never re-formats them differently.
 */
import {
  CONTACT_METHOD_LABELS,
  bookingStatusLabel,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatGuests,
  formatRelative,
  mailtoLink,
  type BookingStatus,
  type PaymentStatus,
} from "@/lib/booking-display";
import { formatMoney } from "@/lib/dates";
import type { BookingDetail, BookingListItem } from "@/server/bookings/service";

export interface BookingRowView {
  id: string;
  reference: string;
  name: string;
  country: string;
  /** `3 h ago`, `Yesterday`, `2 Nov`. */
  requested: string;
  tourTitle: string;
  date: string;
  time: string | null;
  guests: string;
  total: string;
  /** Undiscounted amount, only when a discount applies. */
  base: string | null;
  status: BookingStatus;
  statusLabel: string;
  paymentStatus: PaymentStatus;
  clashes: string[];
  /** What the guest wrote with the request; empty when nothing. */
  notes: string;
}

export interface FormatContext {
  now: Date;
  timezone: string;
}

type RowSource = Pick<
  BookingListItem,
  | "id"
  | "reference"
  | "contactName"
  | "country"
  | "createdAt"
  | "tourTitle"
  | "startDate"
  | "slotTime"
  | "adults"
  | "children"
  | "totalAmount"
  | "baseAmount"
  | "discountAmount"
  | "currency"
  | "status"
  | "cancelKind"
  | "paymentStatus"
  | "clashes"
  | "customerNotes"
>;

export function toRowView(row: RowSource, context: FormatContext): BookingRowView {
  return {
    id: row.id,
    reference: row.reference,
    name: row.contactName,
    country: row.country,
    requested: formatRelative(row.createdAt, context.now, context.timezone),
    tourTitle: row.tourTitle,
    date: formatDate(row.startDate),
    time: row.slotTime ? row.slotTime.slice(0, 5) : null,
    guests: formatGuests(row.adults, row.children),
    total: formatMoney(row.totalAmount, row.currency),
    base: row.discountAmount > 0 ? formatMoney(row.baseAmount, row.currency) : null,
    status: row.status,
    statusLabel: bookingStatusLabel(row),
    paymentStatus: row.paymentStatus,
    clashes: row.clashes.map((clash) => clash.message),
    notes: row.customerNotes,
  };
}

export interface BookingEventView {
  id: string;
  kind: BookingDetail["events"][number]["kind"];
  kindLabel: string;
  message: string;
  actor: string | null;
  at: string;
}

export interface BookingDetailView {
  id: string;
  reference: string;
  status: BookingStatus;
  statusLabel: string;
  /** Why it was cancelled or declined, when a reason was recorded. */
  cancelReason: string | null;
  requested: string;
  requestedAt: string;
  /** Pending requests: until when the seats are held, or that the hold has lapsed. */
  hold: string | null;
  clashes: string[];
  contact: {
    name: string;
    email: string;
    phone: string;
    country: string;
    prefers: string;
    mailto: string;
    /** Chat link, only when the workspace has a messaging integration. */
    whatsapp: string | null;
    /** Profile page, only for members who may see customers. */
    profileHref: string | null;
  };
  trip: {
    tourId: string;
    tourTitle: string;
    startDate: string;
    slotTime: string | null;
    when: string;
    alternativeDate: string | null;
    guests: string;
    participants: string[];
    language: string;
    pickup: string;
    notes: string;
  };
  price: {
    currency: string;
    lines: { label: string; amount: string }[];
    base: string;
    discount: string | null;
    discountLabel: string | null;
    total: string;
    paid: string;
    balance: string;
    totalAmount: number;
    amountPaid: number;
  };
  paymentStatus: PaymentStatus;
  events: BookingEventView[];
}

const EVENT_LABELS: Record<BookingEventView["kind"], string> = {
  created: "Request",
  status: "Status",
  reschedule: "Date change",
  payment: "Payment",
  note: "Note",
  notification: "Notification",
};

const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g;

/** Timeline messages may quote machine timestamps; show them as local date and time. */
export function humaniseMessage(message: string, timezone: string): string {
  return message.replace(ISO_INSTANT, (instant) => formatDateTime(instant, timezone));
}

export interface DetailContext extends FormatContext {
  workspaceName: string;
  whatsapp: string | null;
  canViewCustomer: boolean;
}

export function toDetailView(detail: BookingDetail, context: DetailContext): BookingDetailView {
  const { booking, customer } = detail;
  const money = (amount: number) => formatMoney(amount, booking.currency);
  const slotTime = booking.slotTime ? booking.slotTime.slice(0, 5) : null;

  const lines = [{ label: `${booking.adults} × adult at ${money(booking.unitPriceAdult)}`, amount: money(booking.adults * booking.unitPriceAdult) }];
  if (booking.children > 0) {
    lines.push({ label: `${booking.children} × child at ${money(booking.unitPriceChild)}`, amount: money(booking.children * booking.unitPriceChild) });
  }

  let hold: string | null = null;
  if (booking.status === "pending") {
    if (!booking.holdExpiresAt || booking.holdExpiresAt.getTime() <= context.now.getTime()) hold = "The hold on these seats has lapsed.";
    else hold = `Seats held until ${formatDateTime(booking.holdExpiresAt, context.timezone)}.`;
  }

  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    statusLabel: bookingStatusLabel(booking),
    cancelReason: booking.status === "cancelled" ? booking.cancelReason : null,
    requested: formatRelative(booking.createdAt, context.now, context.timezone),
    requestedAt: formatDateTime(booking.createdAt, context.timezone),
    hold,
    clashes: detail.clashes.map((clash) => clash.message),
    contact: {
      name: booking.contactName,
      email: booking.contactEmail,
      phone: booking.contactPhone,
      country: booking.country,
      prefers: CONTACT_METHOD_LABELS[booking.contactMethod],
      mailto: mailtoLink(booking.contactEmail, `Your ${context.workspaceName} request ${booking.reference}`),
      whatsapp: booking.contactPhone ? context.whatsapp : null,
      profileHref: context.canViewCustomer ? `/workspace/customers/${customer.id}` : null,
    },
    trip: {
      tourId: booking.tourId,
      tourTitle: booking.tourTitle,
      startDate: booking.startDate,
      slotTime,
      when: `${formatDateRange(booking.startDate, booking.endDate)}${slotTime ? ` · ${slotTime}` : ""}`,
      alternativeDate: booking.alternativeDate ? formatDate(booking.alternativeDate) : null,
      guests: formatGuests(booking.adults, booking.children),
      participants: booking.participants.map((person) => (person.age === null || person.age === undefined ? person.name : `${person.name} (${person.age})`)),
      language: booking.language,
      pickup: booking.pickup,
      notes: booking.customerNotes,
    },
    price: {
      currency: booking.currency,
      lines,
      base: money(booking.baseAmount),
      discount: booking.discountAmount > 0 ? money(booking.discountAmount) : null,
      discountLabel: booking.discountAmount > 0 ? booking.discountLabel : null,
      total: money(booking.totalAmount),
      paid: money(booking.amountPaid),
      balance: money(Math.max(0, booking.totalAmount - booking.amountPaid)),
      totalAmount: booking.totalAmount,
      amountPaid: booking.amountPaid,
    },
    paymentStatus: booking.paymentStatus,
    events: detail.events.map((event) => ({
      id: event.id,
      kind: event.kind,
      kindLabel: EVENT_LABELS[event.kind],
      message: humaniseMessage(event.message, context.timezone),
      actor: event.actorName,
      at: formatDateTime(event.createdAt, context.timezone),
    })),
  };
}
