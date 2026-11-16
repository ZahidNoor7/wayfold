import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTenant, withoutTenant } from "@/server/db/context";
import { auditLogs, notificationOutbox } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import { deliverPending, enqueueNotification, listOutbox, retryNotification, type NotificationInput } from "@/server/notifications";
import { createTenant, randomId, type TenantFixture } from "../helpers/fixtures";
import { expectNoSecret } from "../integration/adapters/helpers";
import { connectSmtp, message, outboxRows, queue, smtpSettings } from "../integration/notifications/helpers";

// Only the SMTP transport is replaced, so every use of a credential is visible.
const mail = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn(), close: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: mail.createTransport } }));

beforeEach(() => {
  mail.sendMail.mockReset().mockResolvedValue({ messageId: "<id@wayfold.test>", accepted: [], rejected: [] });
  mail.close.mockReset();
  mail.createTransport.mockReset().mockImplementation(() => ({ sendMail: mail.sendMail, close: mail.close }));
});

async function pgCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code ?? "unknown";
  }
}

const deliver = (tenant: TenantFixture) => withTenant(tenant.tenantId, (scope) => deliverPending(scope));
const failRow = (tenant: TenantFixture, id: string) =>
  withTenant(tenant.tenantId, ({ tx }) =>
    tx.update(notificationOutbox).set({ status: "failed", attempts: 3, lastError: "The mail server is busy." }).where(eq(notificationOutbox.id, id)),
  );

describe("notification outbox isolation", () => {
  it("lists only the current tenant's messages, whatever the filters say", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const bookingId = randomId();
    await queue(a, { subject: "for A's customer", toEmail: "a-customer@example.test", relatedType: "booking", relatedId: bookingId });
    await queue(b, { subject: "for B's customer", toEmail: "b-customer@example.test" });

    const fromB = (filters?: Parameters<typeof listOutbox>[1]) => withTenant(b.tenantId, (scope) => listOutbox(scope, filters));

    expect((await fromB()).map((entry) => entry.subject)).toEqual(["for B's customer"]);
    // Searching for A's recipient, related record or kind finds nothing.
    expect(await fromB({ toEmail: "a-customer@example.test" })).toEqual([]);
    expect(await fromB({ relatedType: "booking", relatedId: bookingId })).toEqual([]);
    expect(await fromB({ relatedId: bookingId })).toEqual([]);
    // A tenant id slipped into the filters is ignored, not obeyed.
    expect((await fromB({ tenantId: a.tenantId } as never)).map((entry) => entry.subject)).toEqual(["for B's customer"]);

    expect((await withTenant(a.tenantId, (scope) => listOutbox(scope))).map((entry) => entry.subject)).toEqual(["for A's customer"]);
  });

  it("answers another tenant's message id with NotFoundError and changes nothing", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await queue(a);
    const [row] = await outboxRows(a);
    await failRow(a, row!.id);

    await expect(withTenant(b.tenantId, (scope) => retryNotification(scope, row!.id), { userId: b.ownerId })).rejects.toBeInstanceOf(NotFoundError);
    // Exactly the answer an id that exists nowhere gets.
    const foreign = await withTenant(b.tenantId, (scope) => retryNotification(scope, row!.id)).catch((error: unknown) => error);
    const unknown = await withTenant(b.tenantId, (scope) => retryNotification(scope, randomId())).catch((error: unknown) => error);
    expect((foreign as Error).message).toBe((unknown as Error).message);

    const [after] = await outboxRows(a);
    expect(after).toMatchObject({ status: "failed", attempts: 3, lastError: "The mail server is busy." });
    const bAudit = await withTenant(b.tenantId, ({ tx }) => tx.select().from(auditLogs).where(eq(auditLogs.action, "notification.retried")));
    expect(bAudit).toEqual([]);

    // The owner can still retry it.
    expect(await withTenant(a.tenantId, (scope) => retryNotification(scope, row!.id))).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("queues into the caller's tenant even when the payload names another one", async () => {
    const a = await createTenant();
    const b = await createTenant();

    await withTenant(b.tenantId, (scope) => enqueueNotification(scope, { ...message({ subject: "planted" }), tenantId: a.tenantId } as NotificationInput));

    expect(await outboxRows(a)).toEqual([]);
    expect((await outboxRows(b)).map((row) => [row.tenantId, row.subject])).toEqual([[b.tenantId, "planted"]]);
  });

  it("never delivers, skips or counts another tenant's messages", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await connectSmtp(b, "tenant-b");
    await queue(a, { subject: "A's message", toEmail: "a-customer@example.test" });
    await queue(b, { subject: "B's message", toEmail: "b-customer@example.test" });

    const report = await deliver(b);

    expect(report).toMatchObject({ picked: 1, sent: 1 });
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(mail.sendMail.mock.calls[0]![0]).toMatchObject({ to: "b-customer@example.test", subject: "B's message" });
    const [aRow] = await outboxRows(a);
    expect(aRow).toMatchObject({ status: "pending", attempts: 0, lastError: null, sentAt: null });
  });

  it("does not send a tenant's mail through another tenant's SMTP account", async () => {
    const a = await createTenant();
    const b = await createTenant();
    // Only A has an e-mail integration.
    await connectSmtp(a, "tenant-a");
    await queue(b, { subject: "B's message", toEmail: "b-customer@example.test" });

    const report = await deliver(b);

    // B's message is parked; A's credentials were never even opened.
    expect(report).toMatchObject({ picked: 1, skipped: 1, sent: 0 });
    expect(mail.createTransport).not.toHaveBeenCalled();
    expect(mail.sendMail).not.toHaveBeenCalled();
    const [bRow] = await outboxRows(b);
    expect(bRow!.status).toBe("skipped");
    expectNoSecret(bRow, Object.values(smtpSettings("tenant-a").secrets));
    expect(bRow!.lastError).not.toContain("tenant-a");
  });

  it("uses each tenant's own credentials when both have an SMTP account", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await connectSmtp(a, "tenant-a");
    await connectSmtp(b, "tenant-b");
    await queue(a, { subject: "A's message", toEmail: "a-customer@example.test" });
    await queue(b, { subject: "B's message", toEmail: "b-customer@example.test" });
    const settingsA = smtpSettings("tenant-a");
    const settingsB = smtpSettings("tenant-b");

    await deliver(b);

    expect(mail.createTransport).toHaveBeenCalledTimes(1);
    const usedByB = mail.createTransport.mock.calls[0]![0];
    expect(usedByB).toMatchObject({ host: settingsB.config.host, auth: { user: settingsB.secrets.username, pass: settingsB.secrets.password } });
    expectNoSecret(usedByB, Object.values(settingsA.secrets));
    expect(mail.sendMail.mock.calls[0]![0]).toMatchObject({ from: { address: settingsB.config.fromEmail }, to: "b-customer@example.test" });

    mail.createTransport.mockClear();
    mail.sendMail.mockClear();
    await deliver(a);

    expect(mail.createTransport).toHaveBeenCalledTimes(1);
    const usedByA = mail.createTransport.mock.calls[0]![0];
    expect(usedByA).toMatchObject({ host: settingsA.config.host, auth: { user: settingsA.secrets.username, pass: settingsA.secrets.password } });
    expectNoSecret(usedByA, Object.values(settingsB.secrets));
    expect(mail.sendMail.mock.calls[0]![0]).toMatchObject({ from: { address: settingsA.config.fromEmail }, to: "a-customer@example.test" });
  });

  it("is fenced by row-level security underneath the service", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await queue(a);
    const [row] = await outboxRows(a);

    const seen = await withTenant(b.tenantId, async ({ tx }) => ({
      byTenant: await tx.select().from(notificationOutbox).where(eq(notificationOutbox.tenantId, a.tenantId)),
      byId: await tx.select().from(notificationOutbox).where(eq(notificationOutbox.id, row!.id)),
      updated: await tx.update(notificationOutbox).set({ status: "sent" }).where(eq(notificationOutbox.id, row!.id)).returning(),
      deleted: await tx.delete(notificationOutbox).where(eq(notificationOutbox.id, row!.id)).returning(),
    }));
    expect(seen).toEqual({ byTenant: [], byId: [], updated: [], deleted: [] });

    expect(
      await pgCode(() => withTenant(b.tenantId, ({ tx }) => tx.insert(notificationOutbox).values({ ...message(), tenantId: a.tenantId }))),
    ).toBe("42501");
    expect(await withoutTenant((tx) => tx.select().from(notificationOutbox))).toEqual([]);

    const [after] = await outboxRows(a);
    expect(after).toMatchObject({ id: row!.id, status: "pending" });
    expect(await outboxRows(a)).toHaveLength(1);
  });
});
