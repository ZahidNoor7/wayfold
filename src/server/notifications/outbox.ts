import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { TenantScope } from "../db/context";
import { notificationOutbox } from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { NOTIFICATION_KINDS, OUTBOX_STATUSES, type NotificationInput, type OutboxEntry } from "./types";

type Row = typeof notificationOutbox.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT_MAX = 200;

export function toEntry(row: Row): OutboxEntry {
  return {
    id: row.id,
    kind: row.kind,
    toEmail: row.toEmail,
    subject: row.subject,
    bodyText: row.bodyText,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    relatedType: row.relatedType,
    relatedId: row.relatedId,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) (out[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
  return out;
}

// Unknown keys are dropped, not rejected: a tenant id smuggled into the
// payload is simply ignored and the row lands in the caller's own tenant.
export const notificationInputSchema = z.object({
  kind: z.enum(NOTIFICATION_KINDS, "Unknown notification kind."),
  toEmail: z.string().trim().toLowerCase().max(320, "That address is too long.").pipe(z.email("Enter a valid e-mail address.")),
  subject: z
    .string()
    // A subject is one header line. Folding line breaks here means recipient
    // data placed in a subject can never start a second header. A long one is
    // shortened, not refused: a tour title must never block a booking.
    .transform((value) => {
      const line = value.replace(/\s+/g, " ").trim();
      return line.length > SUBJECT_MAX ? `${line.slice(0, SUBJECT_MAX - 1)}…` : line;
    })
    .pipe(z.string().min(1, "A subject is required.")),
  bodyText: z.string().trim().min(1, "A message is required.").max(50_000, "That message is too long."),
  relatedType: z.string().trim().min(1).max(60).optional(),
  relatedId: z.uuid("Related id must be a UUID.").optional(),
});

/**
 * Queues a message in the tenant's outbox inside the caller's transaction, so
 * it exists exactly when the change that caused it is committed. Delivery
 * happens afterwards through the tenant's own e-mail integration.
 */
export async function enqueueNotification(scope: TenantScope, input: NotificationInput): Promise<void> {
  const parsed = notificationInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("That notification could not be queued.", fieldErrors(parsed.error));
  await scope.tx.insert(notificationOutbox).values({
    tenantId: scope.tenantId,
    kind: parsed.data.kind,
    toEmail: parsed.data.toEmail,
    subject: parsed.data.subject,
    bodyText: parsed.data.bodyText,
    relatedType: parsed.data.relatedType ?? null,
    relatedId: parsed.data.relatedId ?? null,
    // now() is frozen at the start of the transaction; the wall clock keeps
    // messages queued by one request in the order they were written.
    createdAt: sql`clock_timestamp()`,
  });
}

export const outboxFiltersSchema = z.object({
  status: z.enum(OUTBOX_STATUSES).optional(),
  kind: z.enum(NOTIFICATION_KINDS).optional(),
  toEmail: z.string().trim().toLowerCase().min(1).max(320).optional(),
  relatedType: z.string().trim().min(1).max(60).optional(),
  relatedId: z.uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export type OutboxFilters = z.input<typeof outboxFiltersSchema>;

/** The tenant's outbox, newest first. */
export async function listOutbox(scope: TenantScope, filters: OutboxFilters = {}): Promise<OutboxEntry[]> {
  const parsed = outboxFiltersSchema.safeParse(filters);
  if (!parsed.success) throw new ValidationError("Those filters are not valid.", fieldErrors(parsed.error));
  const { status, kind, toEmail, relatedType, relatedId, limit, offset } = parsed.data;

  const conditions = [eq(notificationOutbox.tenantId, scope.tenantId)];
  if (status) conditions.push(eq(notificationOutbox.status, status));
  if (kind) conditions.push(eq(notificationOutbox.kind, kind));
  if (toEmail) conditions.push(eq(notificationOutbox.toEmail, toEmail));
  if (relatedType) conditions.push(eq(notificationOutbox.relatedType, relatedType));
  if (relatedId) conditions.push(eq(notificationOutbox.relatedId, relatedId));

  const rows = await scope.tx
    .select()
    .from(notificationOutbox)
    .where(and(...conditions))
    .orderBy(desc(notificationOutbox.createdAt), desc(notificationOutbox.id))
    .limit(limit)
    .offset(offset);
  return rows.map(toEntry);
}

/**
 * Puts a failed or skipped message back in the queue with a fresh set of
 * attempts. A message that was already sent is never sent twice.
 */
export async function retryNotification(scope: TenantScope, id: string): Promise<OutboxEntry> {
  // A malformed id is answered like an unknown one, before it reaches a uuid column.
  if (typeof id !== "string" || !UUID.test(id)) throw new NotFoundError("Notification");

  const [row] = await scope.tx
    .select()
    .from(notificationOutbox)
    .where(and(eq(notificationOutbox.tenantId, scope.tenantId), eq(notificationOutbox.id, id)))
    .limit(1)
    .for("update");
  // Same answer whether the id is unknown or belongs to another tenant.
  if (!row) throw new NotFoundError("Notification");
  if (row.status === "sent") throw new ConflictError("That message has already been sent.");
  if (row.status === "pending") return toEntry(row);

  const [updated] = (await scope.tx
    .update(notificationOutbox)
    .set({ status: "pending", attempts: 0, lastError: null })
    .where(and(eq(notificationOutbox.tenantId, scope.tenantId), eq(notificationOutbox.id, id)))
    .returning()) as [Row];

  await recordAudit(scope, {
    action: "notification.retried",
    targetType: "notification",
    targetId: id,
    metadata: { kind: row.kind, previousStatus: row.status },
  });
  return toEntry(updated);
}
