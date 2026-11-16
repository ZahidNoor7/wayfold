import "server-only";
import type { TenantScope } from "../db/context";
import { enqueueNotification } from "./outbox";
import { renderNotification, type NotificationTemplateData } from "./templates";
import type { NotificationKind } from "./types";

export { NOTIFICATION_KINDS, OUTBOX_STATUSES } from "./types";
export type { NotificationInput, NotificationKind, OutboxEntry, OutboxStatus } from "./types";
export { enqueueNotification, listOutbox, notificationInputSchema, outboxFiltersSchema, retryNotification } from "./outbox";
export type { OutboxFilters } from "./outbox";
export { MAX_DELIVERY_ATTEMPTS, NO_EMAIL_INTEGRATION_MESSAGE, deliverPending } from "./deliver";
export type { DeliveryReport } from "./deliver";
export * from "./templates";

export interface NotificationTarget {
  toEmail: string;
  relatedType?: string;
  relatedId?: string;
}

/** Renders the template for `kind` and queues the result in one step. */
export async function enqueueTemplatedNotification<K extends NotificationKind>(
  scope: TenantScope,
  kind: K,
  target: NotificationTarget,
  data: NotificationTemplateData[K],
): Promise<void> {
  await enqueueNotification(scope, { kind, toEmail: target.toEmail, relatedType: target.relatedType, relatedId: target.relatedId, ...renderNotification(kind, data) });
}
