import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { withTenant } from "@/server/db/context";
import { integrations } from "@/server/db/schema";
import { saveIntegration, setIntegrationEnabled } from "@/server/integrations";
import { getAdapter, registerAdapter } from "@/server/integrations/registry";
import { MAX_DELIVERY_ATTEMPTS, NO_EMAIL_INTEGRATION_MESSAGE, deliverPending, listOutbox, retryNotification } from "@/server/notifications";
import { createTenant, type TenantFixture } from "../../helpers/fixtures";
import { expectNoSecret } from "../adapters/helpers";
import { connectSmtp, outboxRows, queue, smtpSettings } from "./helpers";

// Only the SMTP transport is replaced; the outbox and the credential store are real.
const mail = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn(), verify: vi.fn(), close: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: mail.createTransport } }));

beforeEach(() => {
  mail.sendMail.mockReset().mockResolvedValue({ messageId: "<id@wayfold.test>", accepted: ["leyla@example.test"], rejected: [] });
  mail.close.mockReset();
  mail.createTransport.mockReset().mockImplementation(() => ({ sendMail: mail.sendMail, verify: mail.verify, close: mail.close }));
});

const deliver = (tenant: TenantFixture, options?: { limit?: number }) => withTenant(tenant.tenantId, (scope) => deliverPending(scope, options));
const smtpError = (fields: Record<string, unknown>) => Object.assign(new Error("smtp failure"), fields);
const NOTHING = { picked: 0, sent: 0, retrying: 0, failed: 0, skipped: 0, deferred: 0 };

describe("deliverPending", () => {
  it("does nothing when the outbox is empty", async () => {
    const tenant = await createTenant();
    expect(await deliver(tenant)).toEqual(NOTHING);
    expect(mail.createTransport).not.toHaveBeenCalled();
  });

  it("sends through the tenant's own SMTP account and marks the message sent", async () => {
    const tenant = await createTenant();
    await connectSmtp(tenant, "caspian");
    await queue(tenant, { toEmail: "leyla@example.test", subject: "Your booking CT-1 is confirmed" });
    const before = Date.now();

    const report = await deliver(tenant);

    expect(report).toEqual({ ...NOTHING, picked: 1, sent: 1 });
    const settings = smtpSettings("caspian");
    expect(mail.createTransport).toHaveBeenCalledTimes(1);
    expect(mail.createTransport.mock.calls[0]![0]).toMatchObject({
      host: settings.config.host,
      port: 587,
      auth: { user: settings.secrets.username, pass: settings.secrets.password },
    });
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(mail.sendMail.mock.calls[0]![0]).toMatchObject({
      from: { name: "caspian Tours", address: "bookings@caspian.example" },
      to: "leyla@example.test",
      subject: "Your booking CT-1 is confirmed",
      text: "Hi Leyla,\n\nGood news: your booking is confirmed.",
    });
    expect(mail.sendMail.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal);

    const [row] = await outboxRows(tenant);
    expect(row).toMatchObject({ status: "sent", attempts: 1, lastError: null });
    expect(row!.sentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // A sent message is never picked up again.
    expect(await deliver(tenant)).toEqual(NOTHING);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it("marks messages skipped, and sends nothing, when the tenant has no e-mail integration", async () => {
    const tenant = await createTenant();
    await queue(tenant, { subject: "one" }, { subject: "two" });

    const report = await deliver(tenant);

    expect(report).toEqual({ ...NOTHING, picked: 2, skipped: 2 });
    expect(mail.createTransport).not.toHaveBeenCalled();
    expect(mail.sendMail).not.toHaveBeenCalled();
    for (const row of await outboxRows(tenant)) {
      expect(row).toMatchObject({ status: "skipped", attempts: 0, lastError: NO_EMAIL_INTEGRATION_MESSAGE, sentAt: null });
    }
    expect(NO_EMAIL_INTEGRATION_MESSAGE).toMatch(/no e-mail integration is connected/);
  });

  it("treats a disabled integration as none at all", async () => {
    const tenant = await createTenant();
    const integration = await connectSmtp(tenant, "caspian");
    await withTenant(tenant.tenantId, (scope) => setIntegrationEnabled(scope, integration.id, false));
    await queue(tenant);

    expect(await deliver(tenant)).toEqual({ ...NOTHING, picked: 1, skipped: 1 });
    expect(mail.createTransport).not.toHaveBeenCalled();
  });

  it("counts each failure, keeps a sanitised reason, and gives up after three attempts", async () => {
    const tenant = await createTenant();
    await connectSmtp(tenant, "caspian");
    await queue(tenant);
    const { secrets } = smtpSettings("caspian");
    mail.sendMail.mockRejectedValue(
      smtpError({ code: "EMESSAGE", responseCode: 554, response: `554 5.7.1 Rejected (auth ${secrets.username}:${secrets.password})`, permanent: true }),
    );

    expect(await deliver(tenant)).toEqual({ ...NOTHING, picked: 1, retrying: 1 });
    let [row] = await outboxRows(tenant);
    expect(row).toMatchObject({ status: "pending", attempts: 1, sentAt: null });
    expect(row!.lastError).toContain("The mail server reported a problem (SMTP 554): 554 5.7.1 Rejected");
    expectNoSecret(row, Object.values(secrets));

    expect(await deliver(tenant)).toEqual({ ...NOTHING, picked: 1, retrying: 1 });
    [row] = await outboxRows(tenant);
    expect(row).toMatchObject({ status: "pending", attempts: 2 });

    expect(await deliver(tenant)).toEqual({ ...NOTHING, picked: 1, failed: 1 });
    [row] = await outboxRows(tenant);
    expect(row).toMatchObject({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, sentAt: null });
    expectNoSecret(row, Object.values(secrets));

    // A failed message is left alone until somebody retries it.
    expect(await deliver(tenant)).toEqual(NOTHING);
    expect(mail.sendMail).toHaveBeenCalledTimes(3);

    // After a manual retry it gets a fresh set of attempts and can succeed.
    mail.sendMail.mockResolvedValue({ messageId: "<ok@wayfold.test>", accepted: ["leyla@example.test"], rejected: [] });
    const retried = await withTenant(tenant.tenantId, (scope) => retryNotification(scope, row!.id));
    expect(retried).toMatchObject({ status: "pending", attempts: 0, lastError: null });
    expect(await deliver(tenant)).toEqual({ ...NOTHING, picked: 1, sent: 1 });
    const [entry] = await withTenant(tenant.tenantId, (scope) => listOutbox(scope));
    expect(entry).toMatchObject({ status: "sent", attempts: 1, lastError: null });
  });

  it("carries on with the rest of the batch after one message is refused", async () => {
    const tenant = await createTenant();
    await connectSmtp(tenant, "caspian");
    await queue(tenant, { toEmail: "gone@example.test", subject: "one" }, { toEmail: "leyla@example.test", subject: "two" });
    mail.sendMail.mockImplementation(async (options: { to: string }) => {
      if (options.to === "gone@example.test") throw smtpError({ code: "EENVELOPE", responseCode: 550, response: "550 5.1.1 No such user", permanent: true });
      return { messageId: "<ok@wayfold.test>", accepted: [options.to], rejected: [] };
    });

    expect(await deliver(tenant)).toEqual({ ...NOTHING, picked: 2, sent: 1, retrying: 1 });
    const rows = await outboxRows(tenant);
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 1, lastError: expect.stringContaining("refused the sender or recipient address") });
    expect(rows[1]).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("stops the batch when the mail server is unreachable, without spending the other messages' attempts", async () => {
    const tenant = await createTenant();
    await connectSmtp(tenant, "caspian");
    await queue(tenant, { subject: "one" }, { subject: "two" }, { subject: "three" });

    mail.sendMail.mockRejectedValue(smtpError({ code: "ETIMEDOUT" }));
    expect(await deliver(tenant)).toEqual({ ...NOTHING, picked: 3, retrying: 1, deferred: 2 });
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    let rows = await outboxRows(tenant);
    expect(rows.map((row) => [row.status, row.attempts])).toEqual([["pending", 1], ["pending", 0], ["pending", 0]]);
    expect(rows[0]!.lastError).toBe("The provider did not respond in time.");

    mail.sendMail.mockRejectedValue(smtpError({ code: "ECONNECTION" }));
    expect(await deliver(tenant)).toEqual({ ...NOTHING, picked: 3, retrying: 1, deferred: 2 });
    rows = await outboxRows(tenant);
    expect(rows.map((row) => row.attempts)).toEqual([2, 0, 0]);
    expect(rows[0]!.lastError).toContain("closed the connection");
  });

  it("delivers oldest first and respects the limit", async () => {
    const tenant = await createTenant();
    await connectSmtp(tenant, "caspian");
    await queue(tenant, { subject: "one" }, { subject: "two" }, { subject: "three" });

    expect(await deliver(tenant, { limit: 2 })).toEqual({ ...NOTHING, picked: 2, sent: 2 });
    expect(mail.sendMail.mock.calls.map(([options]) => options.subject)).toEqual(["one", "two"]);
    expect((await outboxRows(tenant)).map((row) => row.status)).toEqual(["sent", "sent", "pending"]);

    // Nonsense limits fall back to something safe.
    expect(await deliver(tenant, { limit: -5 })).toEqual({ ...NOTHING, picked: 1, sent: 1 });
    await queue(tenant, { subject: "four" });
    expect(await deliver(tenant, { limit: Number.NaN })).toEqual({ ...NOTHING, picked: 1, sent: 1 });
  });

  it("fails the message, with a clear reason, when the saved settings can no longer be used", async () => {
    const tenant = await createTenant();
    const integration = await connectSmtp(tenant, "caspian");
    await withTenant(tenant.tenantId, ({ tx }) => tx.update(integrations).set({ config: { host: "smtp.caspian.example" } }).where(eq(integrations.id, integration.id)));
    await queue(tenant);

    expect(await deliver(tenant)).toEqual({ ...NOTHING, picked: 1, retrying: 1 });
    expect(mail.createTransport).not.toHaveBeenCalled();
    const [row] = await outboxRows(tenant);
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: expect.stringContaining("settings are incomplete") });
  });

  it("does not send through an e-mail provider it has no sender for", async () => {
    if (!getAdapter("carrier_pigeon")) {
      registerAdapter({
        id: "carrier_pigeon",
        category: "email",
        name: "Carrier pigeon",
        description: "A provider the outbox cannot send through.",
        fields: [],
        configSchema: z.strictObject({}),
        secretSchema: z.strictObject({}),
        test: async () => ({ ok: true }),
      });
    }
    const tenant = await createTenant();
    await withTenant(tenant.tenantId, (scope) => saveIntegration(scope, { provider: "carrier_pigeon", config: {}, secrets: {} }));
    await queue(tenant);

    expect(await deliver(tenant)).toEqual({ ...NOTHING, picked: 1, retrying: 1 });
    expect(mail.createTransport).not.toHaveBeenCalled();
    const [row] = await outboxRows(tenant);
    expect(row!.lastError).toContain("Connect an SMTP account");
  });

  it("lets a broken credential store surface as an error and leaves the outbox untouched", async () => {
    const tenant = await createTenant();
    const integration = await connectSmtp(tenant, "caspian");
    await withTenant(tenant.tenantId, ({ tx }) => tx.update(integrations).set({ secretCiphertext: "not-a-ciphertext" }).where(eq(integrations.id, integration.id)));
    await queue(tenant);

    await expect(deliver(tenant)).rejects.toThrow();
    expect(mail.createTransport).not.toHaveBeenCalled();
    const [row] = await outboxRows(tenant);
    expect(row).toMatchObject({ status: "pending", attempts: 0, lastError: null });
  });
});
