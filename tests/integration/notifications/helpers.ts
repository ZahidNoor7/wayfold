import { asc, eq } from "drizzle-orm";
import { withTenant } from "@/server/db/context";
import { notificationOutbox } from "@/server/db/schema";
import { saveIntegration } from "@/server/integrations";
import { enqueueNotification, type NotificationInput } from "@/server/notifications";
import type { TenantFixture } from "../../helpers/fixtures";

export type OutboxRow = typeof notificationOutbox.$inferSelect;

/** Distinct, recognisable SMTP settings for one tenant. */
export function smtpSettings(name: string) {
  return {
    config: {
      host: `smtp.${name}.example`,
      port: 587,
      secure: false,
      requireTLS: true,
      fromName: `${name} Tours`,
      fromEmail: `bookings@${name}.example`,
    },
    secrets: { username: `mailer@${name}.example`, password: `pw-${name}-Sup3r-s3cret!` },
  };
}

export function connectSmtp(tenant: TenantFixture, name: string) {
  const settings = smtpSettings(name);
  return withTenant(tenant.tenantId, (scope) => saveIntegration(scope, { provider: "smtp", ...settings }), { userId: tenant.ownerId });
}

export function message(overrides: Partial<NotificationInput> = {}): NotificationInput {
  return {
    kind: "booking.confirmed",
    toEmail: "leyla@example.test",
    subject: "Your booking CT-1 is confirmed",
    bodyText: "Hi Leyla,\n\nGood news: your booking is confirmed.",
    ...overrides,
  };
}

/** Queues each message in its own transaction, the way separate requests would. */
export async function queue(tenant: TenantFixture, ...inputs: Partial<NotificationInput>[]): Promise<void> {
  for (const input of inputs.length > 0 ? inputs : [{}]) {
    await withTenant(tenant.tenantId, (scope) => enqueueNotification(scope, message(input)));
  }
}

/** The tenant's raw outbox rows, oldest first. */
export function outboxRows(tenant: TenantFixture): Promise<OutboxRow[]> {
  return withTenant(tenant.tenantId, ({ tx }) =>
    tx.select().from(notificationOutbox).where(eq(notificationOutbox.tenantId, tenant.tenantId)).orderBy(asc(notificationOutbox.createdAt)),
  );
}
