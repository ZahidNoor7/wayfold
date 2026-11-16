import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { z } from "zod";
import { platformIntegrations } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { getAdapter, registerAdapter } from "@/server/integrations/registry";
import { withPlatform } from "@/server/platform/db";
import { savePlatformIntegration } from "@/server/platform/integrations";
import {
  appLink,
  capturePlatformEmails,
  passwordResetMessage,
  PLATFORM_LINKS,
  sendPlatformEmail,
  stopCapturingPlatformEmails,
  supportAccessRequestedMessage,
  verifyEmailMessage,
  workspaceCreatedMessage,
  workspaceInvitationMessage,
} from "@/server/platform/mailer";
import { createAdmin, holdPlatformIntegrationsLock } from "./helpers";

// The network edge: nodemailer's transport is replaced, nothing else.
const transport = vi.hoisted(() => ({
  sendMail: vi.fn(),
  close: vi.fn(),
  created: [] as Record<string, unknown>[],
}));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (options: Record<string, unknown>) => {
      transport.created.push(options);
      return { sendMail: transport.sendMail, close: transport.close };
    },
  },
}));

const SMTP_PASSWORD = "smtp-p4ssw0rd-very-secret";
const smtp = {
  provider: "smtp",
  config: { host: "smtp.example.com", port: 587, secure: false, requireTLS: true, fromName: "Wayfold", fromEmail: "Hello@Wayfold.Example" },
  secrets: { username: "mailer@wayfold.example", password: SMTP_PASSWORD },
};
const message = { to: "traveller@example.test", subject: "Confirm your e-mail address", text: "Open https://app.wayfold.test/verify-email?token=TOKEN-123" };

describe("platform mailer", () => {
  holdPlatformIntegrationsLock();
  let info: MockInstance<typeof console.info>;

  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    transport.sendMail.mockReset().mockResolvedValue({ messageId: "<1@wayfold>", accepted: ["traveller@example.test"], rejected: [] });
    transport.close.mockReset();
    transport.created.length = 0;
  });

  afterEach(async () => {
    stopCapturingPlatformEmails();
    info.mockRestore();
    vi.unstubAllEnvs();
    resetEnvCache();
    await withPlatform((tx) => tx.delete(platformIntegrations));
  });

  const logged = () => info.mock.calls.map((call) => String(call[0])).join("\n");

  it("logs recipient and subject, never the body, when no mailer is configured", async () => {
    expect(await sendPlatformEmail(message)).toEqual({ delivered: false, reason: "not_configured" });
    expect(info).toHaveBeenCalledTimes(1);
    expect(logged()).toContain("to=traveller@example.test");
    expect(logged()).toContain("Confirm your e-mail address");
    expect(logged()).not.toContain("TOKEN-123");
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it("does not log the recipient in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    resetEnvCache();
    expect(await sendPlatformEmail(message)).toEqual({ delivered: false, reason: "not_configured" });
    expect(info).toHaveBeenCalledTimes(1);
    expect(logged()).not.toContain("traveller@example.test");
    expect(logged()).not.toContain("TOKEN-123");
  });

  it("sends through the platform SMTP connection when one is configured", async () => {
    const owner = await createAdmin();
    await savePlatformIntegration(owner, smtp);

    expect(await sendPlatformEmail(message)).toEqual({ delivered: true });
    expect(transport.created[0]).toMatchObject({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "mailer@wayfold.example", pass: SMTP_PASSWORD },
    });
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    expect(transport.sendMail.mock.calls[0]![0]).toMatchObject({
      from: { name: "Wayfold", address: "hello@wayfold.example" },
      to: "traveller@example.test",
      subject: message.subject,
      text: message.text,
    });
    expect(transport.close).toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("reports a delivery failure without throwing or logging what the server said", async () => {
    const owner = await createAdmin();
    await savePlatformIntegration(owner, smtp);
    transport.sendMail.mockRejectedValue(Object.assign(new Error(`535 bad credentials ${SMTP_PASSWORD}`), { code: "EAUTH", responseCode: 535 }));

    expect(await sendPlatformEmail(message)).toEqual({ delivered: false, reason: "failed" });
    expect(logged()).toContain("delivery failed");
    expect(logged()).not.toContain(SMTP_PASSWORD);
    expect(logged()).not.toContain("TOKEN-123");
    expect(logged()).not.toContain("traveller@example.test");
  });

  it("does not send through a disabled connection, an unsupported provider or incomplete settings", async () => {
    const owner = await createAdmin();
    await savePlatformIntegration(owner, smtp);

    // Settings that no longer satisfy the provider's schema are not trusted.
    await withPlatform((tx) => tx.update(platformIntegrations).set({ config: { host: "smtp.example.com" } }));
    expect(await sendPlatformEmail(message)).toEqual({ delivered: false, reason: "invalid_settings" });

    await withPlatform((tx) => tx.update(platformIntegrations).set({ status: "disabled" }));
    expect(await sendPlatformEmail(message)).toEqual({ delivered: false, reason: "not_configured" });

    if (!getAdapter("test_api_mail")) {
      registerAdapter({
        id: "test_api_mail",
        category: "email",
        name: "API Mail",
        description: "Test adapter",
        fields: [],
        configSchema: z.strictObject({ region: z.string() }),
        secretSchema: z.strictObject({ accessKey: z.string().min(8) }),
        test: async () => ({ ok: true }),
      });
    }
    await savePlatformIntegration(owner, { provider: "test_api_mail", config: { region: "eu" }, secrets: { accessKey: "access-key-1" } });
    expect(await sendPlatformEmail(message)).toEqual({ delivered: false, reason: "unsupported_provider" });
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it("captures messages in tests instead of sending them, and only in tests", async () => {
    const owner = await createAdmin();
    await savePlatformIntegration(owner, smtp);

    const inbox = capturePlatformEmails();
    expect(await sendPlatformEmail(message)).toEqual({ delivered: true });
    expect(inbox).toEqual([message]);
    expect(transport.sendMail).not.toHaveBeenCalled();

    stopCapturingPlatformEmails();
    await sendPlatformEmail(message);
    expect(inbox).toHaveLength(1);
    expect(transport.sendMail).toHaveBeenCalledTimes(1);

    vi.stubEnv("NODE_ENV", "production");
    resetEnvCache();
    expect(() => capturePlatformEmails()).toThrow(/only available in tests/);
  });

  describe("PLATFORM_MAIL_CAPTURE_FILE", () => {
    let directory: string;
    let file: string;

    beforeEach(async () => {
      directory = await mkdtemp(path.join(tmpdir(), "wayfold-mail-"));
      file = path.join(directory, "captured.jsonl");
      vi.stubEnv("PLATFORM_MAIL_CAPTURE_FILE", file);
    });
    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    it("appends one JSON line per message instead of sending, outside production", async () => {
      const owner = await createAdmin();
      await savePlatformIntegration(owner, smtp);

      const started = Date.now();
      expect(await sendPlatformEmail(message)).toEqual({ delivered: false, reason: "captured" });
      expect(await sendPlatformEmail({ ...message, to: "second@example.test", text: "line one\nline two" })).toEqual({ delivered: false, reason: "captured" });
      expect(transport.sendMail).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();

      const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
      expect(lines).toHaveLength(2);
      const [first, second] = lines.map((line) => JSON.parse(line) as { to: string; subject: string; text: string; at: string });
      expect(first).toEqual({ ...message, at: expect.any(String) });
      expect(Date.parse(first!.at)).toBeGreaterThanOrEqual(started - 1_000);
      expect(second).toMatchObject({ to: "second@example.test", text: "line one\nline two" });
      // Bodies carry single-use tokens: the file is readable by its owner only.
      expect((await stat(file)).mode & 0o077).toBe(0);
    });

    it("is ignored in production: the message goes to the real mailer and no file appears", async () => {
      const owner = await createAdmin();
      await savePlatformIntegration(owner, smtp);
      vi.stubEnv("NODE_ENV", "production");
      resetEnvCache();

      expect(await sendPlatformEmail(message)).toEqual({ delivered: true });
      expect(transport.sendMail).toHaveBeenCalledTimes(1);
      await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("is ignored when either view of the environment says production", async () => {
      // The parsed configuration still says "test" (it is cached); the process variable says production.
      vi.stubEnv("NODE_ENV", "production");
      expect(await sendPlatformEmail(message)).toEqual({ delivered: false, reason: "not_configured" });
      await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("gives way to the in-process test capture", async () => {
      const inbox = capturePlatformEmails();
      expect(await sendPlatformEmail(message)).toEqual({ delivered: true });
      expect(inbox).toEqual([message]);
      await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("builds absolute links on the app host", () => {
    expect(appLink("/verify-email", { token: "a b&c" })).toBe("https://app.wayfold.test/verify-email?token=a+b%26c");
    expect(PLATFORM_LINKS.verifyEmail("t1")).toBe("https://app.wayfold.test/verify-email?token=t1");
    expect(PLATFORM_LINKS.resetPassword("t2")).toBe("https://app.wayfold.test/reset-password?token=t2");
    expect(PLATFORM_LINKS.invitation("t3")).toBe("https://app.wayfold.test/invitations/accept?token=t3");
    expect(PLATFORM_LINKS.supportAccess()).toBe("https://app.wayfold.test/workspace/settings/support");
  });

  it("renders every template with its link and without header or line injection", () => {
    const url = "https://app.wayfold.test/x?token=abc";

    const verify = verifyEmailMessage({ name: "Leyla", url });
    expect(verify.subject).toBe("Confirm your e-mail address");
    expect(verify.text).toContain("Hello Leyla,");
    expect(verify.text).toContain(url);
    expect(verifyEmailMessage({ url }).text.startsWith("Hello,")).toBe(true);

    const reset = passwordResetMessage({ name: null, url });
    expect(reset.subject).toContain("Reset");
    expect(reset.text).toContain(url);

    const invitation = workspaceInvitationMessage({
      tenantName: "Caspian\r\nBcc: attacker@example.test",
      roleName: "Tour Manager",
      inviterName: "Rashad",
      url,
      expiresAt: new Date("2026-03-05T10:00:00Z"),
    });
    expect(invitation.subject).toBe("You have been invited to Caspian Bcc: attacker@example.test on Wayfold");
    expect(invitation.subject).not.toMatch(/[\r\n]/);
    expect(invitation.text).toContain("Rashad invited you to join");
    expect(invitation.text).toContain("as Tour Manager");
    expect(invitation.text).toContain("2026-03-05");
    expect(workspaceInvitationMessage({ tenantName: "T", roleName: "Staff", url, expiresAt: new Date() }).text).toContain("A team member invited you");

    const support = supportAccessRequestedMessage({ tenantName: "Caspian Trails", adminName: "Sam Support", reason: "Bookings page\nshows an error", url });
    expect(support.subject).toContain("Caspian Trails");
    expect(support.text).toContain("Reason given: Bookings page shows an error");
    expect(support.text).toContain("unless you approve");

    const created = workspaceCreatedMessage({ name: "Fatima", tenantName: "Silk Road", url });
    expect(created.subject).toContain("Silk Road");
    expect(created.text).toContain("Choose a password");
    expect(created.text).toContain(url);
  });
});
