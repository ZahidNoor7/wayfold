import "server-only";

export const NOTIFICATION_KINDS = [
  "booking.received",
  "booking.confirmed",
  "booking.cancelled",
  "booking.rescheduled",
  "booking.staff_alert",
  "discount_request.received",
  "discount_request.approved",
  "discount_request.rejected",
  "inquiry.staff_alert",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationInput {
  kind: NotificationKind;
  toEmail: string;
  subject: string;
  bodyText: string;
  relatedType?: string;
  relatedId?: string;
}

export const OUTBOX_STATUSES = ["pending", "sent", "failed", "skipped"] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** One outbox row as the dashboard sees it. */
export interface OutboxEntry {
  id: string;
  kind: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  status: OutboxStatus;
  /** Delivery attempts made so far, including the one that succeeded. */
  attempts: number;
  /** Sanitised reason for the last failure or skip. Never contains credentials. */
  lastError: string | null;
  relatedType: string | null;
  relatedId: string | null;
  createdAt: Date;
  sentAt: Date | null;
}
