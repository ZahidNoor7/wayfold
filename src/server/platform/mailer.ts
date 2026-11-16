import "server-only";
import { appendFile } from "node:fs/promises";
import { env } from "../env";
import { sendSmtpMail, smtpAdapter } from "../integrations/adapters/smtp";
import { withTimeout } from "../integrations/http";
import { resolvePlatformIntegration } from "./integrations";

export interface PlatformEmail {
  to: string;
  subject: string;
  text: string;
}

export type PlatformEmailResult =
  | { delivered: true }
  | { delivered: false; reason: "not_configured" | "unsupported_provider" | "invalid_settings" | "failed" | "captured" };

export const PLATFORM_SEND_TIMEOUT_MS = 15_000;

let captured: PlatformEmail[] | null = null;

/**
 * Test hook: from now on every message is collected in the returned array
 * instead of being sent. Refuses to work outside the test environment, so it
 * can never divert real mail.
 */
export function capturePlatformEmails(): PlatformEmail[] {
  if (env().NODE_ENV !== "test") throw new Error("E-mail capture is only available in tests");
  captured = [];
  return captured;
}

export function stopCapturingPlatformEmails(): void {
  captured = null;
}

/**
 * End-to-end test hook: the file every message is written to instead of being
 * sent, or null. Both the validated environment and the raw variable have to
 * say this is not production, so the hook cannot divert real mail there
 * however the variable came to be set.
 */
function captureFile(): string | null {
  const file = process.env.PLATFORM_MAIL_CAPTURE_FILE;
  if (!file) return null;
  if (env().NODE_ENV === "production" || process.env.NODE_ENV === "production") return null;
  return file;
}

function logLine(message: string): void {
  console.info(`[wayfold] ${message}`);
}

/**
 * Sends an account e-mail (verification, password reset, invitation, support
 * notice) through the platform's own e-mail connection.
 *
 * Never throws for a delivery problem: the caller's work (registering,
 * inviting) has already happened and must not be undone by a mail server.
 * The body is never logged, because it carries single-use tokens.
 */
export async function sendPlatformEmail(message: PlatformEmail): Promise<PlatformEmailResult> {
  if (captured) {
    captured.push({ ...message });
    return { delivered: true };
  }

  const file = captureFile();
  if (file) {
    // One JSON object per line. Owner-only: the bodies carry single-use tokens.
    const line = JSON.stringify({ to: message.to, subject: message.subject, text: message.text, at: new Date().toISOString() });
    await appendFile(file, `${line}\n`, { mode: 0o600 });
    return { delivered: false, reason: "captured" };
  }

  const integration = await resolvePlatformIntegration("email");
  if (!integration) {
    if (env().NODE_ENV === "production") {
      logLine("platform e-mail is not configured; a message was not sent");
    } else {
      // Recipient and subject only, so a developer can see what would have gone out.
      logLine(`platform e-mail not configured; not sent: to=${message.to} subject=${JSON.stringify(message.subject)}`);
    }
    return { delivered: false, reason: "not_configured" };
  }

  if (integration.provider !== smtpAdapter.id) {
    logLine(`platform e-mail provider ${integration.provider} cannot send messages`);
    return { delivered: false, reason: "unsupported_provider" };
  }
  const config = smtpAdapter.configSchema.safeParse(integration.config);
  const secrets = smtpAdapter.secretSchema.safeParse(integration.secrets);
  if (!config.success || !secrets.success) {
    logLine("platform e-mail settings are incomplete; save the connection again");
    return { delivered: false, reason: "invalid_settings" };
  }

  try {
    const credentials = { config: config.data, secrets: secrets.data };
    await withTimeout(PLATFORM_SEND_TIMEOUT_MS, (signal) =>
      sendSmtpMail(credentials, { to: message.to, subject: message.subject, text: message.text }, signal),
    );
    return { delivered: true };
  } catch (error) {
    // Class of failure only: a mail server's reply can quote addresses and credentials.
    logLine(`platform e-mail delivery failed (${error instanceof Error ? error.name : "unknown error"})`);
    return { delivered: false, reason: "failed" };
  }
}

/** Absolute URL on the app host, e.g. `appLink("/verify-email", { token })`. */
export function appLink(path: string, query: Record<string, string> = {}): string {
  const url = new URL(path, env().APP_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

/** Where each account e-mail points. The app routes must match these paths. */
export const PLATFORM_LINKS = {
  verifyEmail: (token: string) => appLink("/verify-email", { token }),
  resetPassword: (token: string) => appLink("/reset-password", { token }),
  invitation: (token: string) => appLink("/invitations/accept", { token }),
  supportAccess: () => appLink("/workspace/settings/support"),
} as const;

type Template = Pick<PlatformEmail, "subject" | "text">;

const SIGN_OFF = "Wayfold";

/** Keeps a user-supplied value on one line so it cannot forge extra lines of an e-mail. */
function oneLine(value: string, max = 200): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function greeting(name: string | null | undefined): string {
  const clean = name ? oneLine(name, 80) : "";
  return clean ? `Hello ${clean},` : "Hello,";
}

function body(lines: string[]): string {
  return [...lines, "", SIGN_OFF].join("\n");
}

export function verifyEmailMessage(input: { name?: string | null; url: string }): Template {
  return {
    subject: "Confirm your e-mail address",
    text: body([
      greeting(input.name),
      "",
      "Please confirm your e-mail address to finish setting up your Wayfold account:",
      "",
      input.url,
      "",
      "This link works once and expires in 24 hours. If you did not create an account, you can ignore this message.",
    ]),
  };
}

export function passwordResetMessage(input: { name?: string | null; url: string }): Template {
  return {
    subject: "Reset your Wayfold password",
    text: body([
      greeting(input.name),
      "",
      "We received a request to reset your password. Choose a new one here:",
      "",
      input.url,
      "",
      "This link works once and expires in 1 hour. If you did not ask for it, you can ignore this message and your password stays the same.",
    ]),
  };
}

export function workspaceInvitationMessage(input: {
  tenantName: string;
  roleName: string;
  inviterName?: string | null;
  url: string;
  expiresAt: Date;
}): Template {
  const tenant = oneLine(input.tenantName, 80);
  const inviter = input.inviterName ? oneLine(input.inviterName, 80) : "";
  return {
    subject: `You have been invited to ${tenant} on Wayfold`,
    text: body([
      "Hello,",
      "",
      `${inviter || "A team member"} invited you to join ${tenant} on Wayfold as ${oneLine(input.roleName, 60)}.`,
      "",
      "Accept the invitation here:",
      "",
      input.url,
      "",
      `The invitation expires on ${input.expiresAt.toISOString().slice(0, 10)}. If you were not expecting it, you can ignore this message.`,
    ]),
  };
}

export function supportAccessRequestedMessage(input: { tenantName: string; adminName: string; reason: string; url: string }): Template {
  const tenant = oneLine(input.tenantName, 80);
  return {
    subject: `Wayfold support is asking for access to ${tenant}`,
    text: body([
      "Hello,",
      "",
      `${oneLine(input.adminName, 80)} from Wayfold support has asked for temporary, view-only access to ${tenant}.`,
      "",
      `Reason given: ${oneLine(input.reason, 500)}`,
      "",
      "Nobody can enter your workspace unless you approve this request. Review it here:",
      "",
      input.url,
      "",
      "You choose how long access lasts, and you can end it at any time.",
    ]),
  };
}

export function workspaceCreatedMessage(input: { name?: string | null; tenantName: string; url: string }): Template {
  const tenant = oneLine(input.tenantName, 80);
  return {
    subject: `Your Wayfold workspace ${tenant} is ready`,
    text: body([
      greeting(input.name),
      "",
      `A Wayfold workspace has been set up for ${tenant}, with you as its owner.`,
      "",
      "Choose a password to sign in:",
      "",
      input.url,
      "",
      "This link works once and expires in 72 hours. After that, use \"Forgot password\" on the sign-in page.",
    ]),
  };
}
