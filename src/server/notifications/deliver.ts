import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { TenantScope } from "../db/context";
import { notificationOutbox } from "../db/schema";
import { AppError } from "../errors";
import { smtpAdapter, sendSmtpMail } from "../integrations/adapters/smtp";
import { ProviderTimeoutError, TransientProviderError, sanitiseProviderMessage, withTimeout } from "../integrations/http";
import { IntegrationNotConfiguredError, resolveIntegration } from "../integrations/service";

/** A message is given up on after this many failed deliveries. */
export const MAX_DELIVERY_ATTEMPTS = 3;
export const SEND_TIMEOUT_MS = 15_000;
const DEFAULT_BATCH = 20;
const MAX_BATCH = 100;

export const NO_EMAIL_INTEGRATION_MESSAGE =
  "Not sent: no e-mail integration is connected. Connect one in Settings → Integrations, then retry this message.";

export interface DeliveryReport {
  /** Rows picked up by this run. */
  picked: number;
  sent: number;
  /** Failed this time and still queued for another attempt. */
  retrying: number;
  /** Failed for the last time. */
  failed: number;
  /** Not sent because the tenant has no e-mail integration. */
  skipped: number;
  /** Left untouched because the mail server stopped responding mid-run. */
  deferred: number;
}

interface Mailer {
  send(message: { to: string; subject: string; text: string }, signal: AbortSignal): Promise<unknown>;
  /** Values that must never appear in a stored error. */
  secrets: string[];
}

/**
 * The current tenant's own default e-mail connection, ready to send. Returns
 * null when there is none. A string means a connection exists but cannot be
 * used, and says why. There is deliberately no other source of credentials.
 */
async function resolveMailer(scope: TenantScope): Promise<Mailer | string | null> {
  let integration;
  try {
    integration = await resolveIntegration(scope, "email");
  } catch (error) {
    if (error instanceof IntegrationNotConfiguredError) return null;
    throw error;
  }
  if (integration.provider !== smtpAdapter.id) {
    return "Your e-mail integration cannot send notifications yet. Connect an SMTP account in Settings → Integrations.";
  }
  const config = smtpAdapter.configSchema.safeParse(integration.config);
  const secrets = smtpAdapter.secretSchema.safeParse(integration.secrets);
  if (!config.success || !secrets.success) {
    return "Your e-mail integration settings are incomplete. Open Settings → Integrations and save them again.";
  }
  const credentials = { config: config.data, secrets: secrets.data };
  return {
    send: (message, signal) => sendSmtpMail(credentials, message, signal),
    secrets: Object.values(secrets.data),
  };
}

/** Only messages written for people are stored; anything else is internal. */
function describeFailure(error: unknown): string {
  if (error instanceof AppError || error instanceof TransientProviderError || error instanceof ProviderTimeoutError) return error.message;
  return "The message could not be sent because of an unexpected error.";
}

/**
 * Sends the tenant's pending messages through the tenant's own e-mail
 * integration and records every outcome.
 *
 * Rows are locked while they are being sent, so two overlapping runs never
 * pick the same message. The outcomes are saved by the surrounding
 * transaction: call this in its own `withTenant`, after the transaction that
 * queued the messages has committed, and let it commit.
 */
export async function deliverPending(scope: TenantScope, options: { limit?: number } = {}): Promise<DeliveryReport> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_BATCH) || DEFAULT_BATCH, 1), MAX_BATCH);
  const report: DeliveryReport = { picked: 0, sent: 0, retrying: 0, failed: 0, skipped: 0, deferred: 0 };

  const rows = await scope.tx
    .select()
    .from(notificationOutbox)
    .where(and(eq(notificationOutbox.tenantId, scope.tenantId), eq(notificationOutbox.status, "pending")))
    .orderBy(asc(notificationOutbox.createdAt), asc(notificationOutbox.id))
    .limit(limit)
    .for("update", { skipLocked: true });
  report.picked = rows.length;
  if (rows.length === 0) return report;

  const owned = (id: string) => and(eq(notificationOutbox.tenantId, scope.tenantId), eq(notificationOutbox.id, id));
  const mailer = await resolveMailer(scope);

  if (mailer === null) {
    // No connection of the tenant's own means no delivery at all: the message
    // is parked, visibly, instead of leaving through anybody else's account.
    for (const row of rows) {
      await scope.tx.update(notificationOutbox).set({ status: "skipped", lastError: NO_EMAIL_INTEGRATION_MESSAGE }).where(owned(row.id));
    }
    report.skipped = rows.length;
    return report;
  }

  for (const [index, row] of rows.entries()) {
    const attempts = row.attempts + 1;
    // Only the send itself is guarded: a database error must not be mistaken
    // for a delivery failure and written back as one.
    let failure: unknown = null;
    let delivered = false;
    try {
      if (typeof mailer === "string") throw new AppError("email_unusable", mailer);
      await withTimeout(SEND_TIMEOUT_MS, (signal) => mailer.send({ to: row.toEmail, subject: row.subject, text: row.bodyText }, signal));
      delivered = true;
    } catch (error) {
      failure = error;
    }

    if (delivered) {
      await scope.tx.update(notificationOutbox).set({ status: "sent", sentAt: new Date(), attempts, lastError: null }).where(owned(row.id));
      report.sent += 1;
      continue;
    }

    const exhausted = attempts >= MAX_DELIVERY_ATTEMPTS;
    const lastError = sanitiseProviderMessage(describeFailure(failure), typeof mailer === "string" ? [] : mailer.secrets);
    await scope.tx
      .update(notificationOutbox)
      .set({ status: exhausted ? "failed" : "pending", attempts, lastError })
      .where(owned(row.id));
    if (exhausted) report.failed += 1;
    else report.retrying += 1;

    // An unreachable server will fail the rest of the batch the same slow
    // way. Stop here; the untouched rows keep their attempts for the next run.
    if (failure instanceof ProviderTimeoutError || failure instanceof TransientProviderError) {
      report.deferred = rows.length - index - 1;
      break;
    }
  }
  return report;
}
