import "server-only";
import nodemailer from "nodemailer";
import type { NodemailerError } from "nodemailer";
import { z } from "zod";
import { IntegrationError } from "../../errors";
import { ProviderTimeoutError, TransientProviderError } from "../http";
import type { Credentials, ProviderAdapter } from "../types";
import { providerText } from "./shared";

export interface SmtpConfig {
  host: string;
  port: number;
  /** TLS from the first byte (usually port 465). */
  secure: boolean;
  /** Start in plain text and insist on a STARTTLS upgrade (usually port 587). */
  requireTLS: boolean;
  fromName: string;
  fromEmail: string;
}

export interface SmtpSecrets {
  username: string;
  password: string;
}

export interface SmtpMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export interface SmtpSendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Tenants choose this host and our servers connect to it, so names and
 * addresses that point back into a private network are refused.
 */
function isPublicHost(host: string): boolean {
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return false;
  const ip = IPV4.exec(host);
  if (!ip) return true;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  if (ip.slice(1).some((part) => Number(part) > 255)) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

const configSchema: z.ZodType<SmtpConfig> = z
  .strictObject({
    host: z
      .string()
      .trim()
      .toLowerCase()
      .regex(HOSTNAME, "Enter the server name only, for example smtp.example.com.")
      .refine(isPublicHost, "Use the public address of your mail server."),
    port: z.coerce.number("Enter a port number.").int("Enter a port number.").min(1, "Enter a port number.").max(65535, "Ports go up to 65535."),
    secure: z.boolean().default(false),
    requireTLS: z.boolean().default(true),
    fromName: z
      .string()
      .trim()
      .min(1, "Enter the name travellers should see.")
      .max(100, "Keep the sender name under 100 characters.")
      .regex(/^[^\u0000-\u001f\u007f<>"]+$/, "The sender name cannot contain quotes, angle brackets or line breaks."),
    fromEmail: z.string().trim().toLowerCase().pipe(z.email("Enter a valid sender address.")),
  })
  .superRefine((config, ctx) => {
    // The two standard submission ports each allow exactly one TLS style, and
    // guessing wrong only shows up later as a confusing handshake error.
    if (config.port === 465 && !config.secure) {
      ctx.addIssue({ code: "custom", path: ["secure"], message: "Port 465 needs TLS on connect." });
    }
    if ([25, 587, 2525].includes(config.port) && config.secure) {
      ctx.addIssue({ code: "custom", path: ["secure"], message: `Port ${config.port} uses STARTTLS. Turn off TLS on connect.` });
    }
    // Without either, the password could cross the network unencrypted.
    if (!config.secure && !config.requireTLS) {
      ctx.addIssue({ code: "custom", path: ["requireTLS"], message: "Turn on TLS on connect or STARTTLS so your password is never sent unencrypted." });
    }
  });

const secretSchema: z.ZodType<SmtpSecrets> = z.strictObject({
  username: z
    .string()
    .trim()
    .min(1, "Enter the SMTP username.")
    .max(320, "That username is too long.")
    .regex(/^\S+$/, "The username cannot contain spaces."),
  // Not trimmed: a password may legitimately start or end with a space.
  password: z
    .string()
    .min(1, "Enter the SMTP password.")
    .max(1024, "That password is too long.")
    .regex(/^[^\r\n]+$/, "The password cannot contain line breaks."),
});

type SmtpCredentials = Credentials<SmtpConfig, SmtpSecrets>;

function openTransport({ config, secrets }: SmtpCredentials) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure && config.requireTLS,
    auth: { user: secrets.username, pass: secrets.password },
    // Bounded waits so a silent server cannot hold a request open.
    dnsTimeout: 8_000,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    // Messages are plain text; nothing may be read from disk or fetched.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

/** Settles with `work`, or rejects as a timeout the moment `signal` fires. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined, onAbort: () => void): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort();
      reject(new ProviderTimeoutError());
    };
    signal.addEventListener("abort", abort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

type Failure = { kind: "timeout" } | { kind: "transient"; message: string } | { kind: "rejected"; message: string };

/**
 * Turns a nodemailer failure into a message that is safe to show. Only the
 * error code and the server's reply are used, and the reply is scrubbed of
 * the username and password in every form a server might echo.
 */
function classify(error: unknown, { config, secrets }: SmtpCredentials): Failure {
  if (error instanceof ProviderTimeoutError) return { kind: "timeout" };
  const e = (typeof error === "object" && error !== null ? error : {}) as NodemailerError;
  const where = `${config.host}:${config.port}`;
  const reply = providerText(typeof e.response === "string" ? e.response : undefined, { ...secrets }, "");
  const smtp = typeof e.responseCode === "number" ? ` (SMTP ${e.responseCode})` : "";

  if (e.code === "EABORT" || e.code === "ETIMEDOUT") return { kind: "timeout" };
  if (e.code === "EAUTH" || e.code === "ENOAUTH" || e.responseCode === 535 || e.responseCode === 534) {
    return { kind: "rejected", message: `The mail server did not accept the username or password${smtp}.` };
  }
  if (e.code === "EDNS") return { kind: "rejected", message: `The mail server ${config.host} could not be found. Check the host name.` };
  if (e.code === "ETLS" || e.code === "EREQUIRETLS") {
    return { kind: "rejected", message: `A secure connection to ${where} could not be set up. Check the port and the TLS setting.` };
  }
  if (e.code === "ESOCKET") {
    return { kind: "rejected", message: `Could not connect to ${where}. Check the host, the port and the TLS setting.` };
  }
  if (e.code === "ECONNECTION") return { kind: "transient", message: `The mail server at ${where} closed the connection. Please try again.` };
  // 4xx replies (and 503) mean "not now"; nodemailer marks them non-permanent.
  if (typeof e.responseCode === "number" && e.responseCode >= 400 && (e.responseCode < 500 || e.permanent === false)) {
    return { kind: "transient", message: `The mail server is busy${smtp}. Please try again.` };
  }
  if (e.code === "EENVELOPE") {
    return { kind: "rejected", message: `The mail server refused the sender or recipient address${smtp}${reply ? `: ${reply}` : "."}` };
  }
  return { kind: "rejected", message: `The mail server reported a problem${smtp}${reply ? `: ${reply}` : "."}` };
}

function throwFailure(failure: Failure): never {
  if (failure.kind === "timeout") throw new ProviderTimeoutError();
  if (failure.kind === "transient") throw new TransientProviderError(failure.message);
  throw new IntegrationError(failure.message, "email_rejected");
}

/**
 * Sends one plain-text message through a tenant's SMTP account.
 *
 * Throws ProviderTimeoutError or TransientProviderError when trying again may
 * help, and IntegrationError when the server refused. An aborted send may
 * still have been accepted by the server, so callers must tolerate a
 * duplicate if they retry.
 */
export async function sendSmtpMail(credentials: SmtpCredentials, message: SmtpMessage, signal?: AbortSignal): Promise<SmtpSendResult> {
  if (signal?.aborted) throw new ProviderTimeoutError();
  let transport: ReturnType<typeof openTransport> | undefined;
  try {
    const opened = (transport = openTransport(credentials));
    const info = await untilAborted(
      opened.sendMail({
        // An address object, so a display name can never inject a header.
        from: { name: credentials.config.fromName, address: credentials.config.fromEmail },
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        signal,
      }),
      signal,
      () => opened.close(),
    );
    return { messageId: info.messageId, accepted: (info.accepted ?? []).map(String), rejected: (info.rejected ?? []).map(String) };
  } catch (error) {
    return throwFailure(classify(error, credentials));
  } finally {
    transport?.close();
  }
}

export const smtpAdapter: ProviderAdapter<SmtpConfig, SmtpSecrets> = {
  id: "smtp",
  category: "email",
  name: "SMTP",
  description: "Send booking e-mails from your own mailbox or e-mail service.",
  docsUrl: "https://nodemailer.com/smtp/",
  fields: [
    {
      key: "host",
      label: "SMTP server",
      type: "text",
      secret: false,
      required: true,
      placeholder: "smtp.example.com",
      help: "Your e-mail provider lists this under SMTP or outgoing mail settings.",
    },
    { key: "port", label: "Port", type: "number", secret: false, required: true, placeholder: "587", help: "Usually 587 with STARTTLS, or 465 with TLS on connect." },
    { key: "secure", label: "TLS on connect", type: "boolean", secret: false, required: false, help: "Turn on for port 465. Leave off for port 587." },
    {
      key: "requireTLS",
      label: "Require STARTTLS",
      type: "boolean",
      secret: false,
      required: false,
      help: "Refuses to send unless the connection is upgraded to TLS first. Keep on for port 587.",
    },
    { key: "username", label: "Username", type: "text", secret: true, required: true, help: "Often your full e-mail address. Stored encrypted." },
    {
      key: "password",
      label: "Password",
      type: "password",
      secret: true,
      required: true,
      help: "Use an app password if your provider offers one. Stored encrypted and never displayed again.",
    },
    { key: "fromName", label: "Sender name", type: "text", secret: false, required: true, placeholder: "Caspian Trails", help: "The name travellers see in their inbox." },
    {
      key: "fromEmail",
      label: "Sender address",
      type: "text",
      secret: false,
      required: true,
      placeholder: "bookings@example.com",
      help: "Must be an address this SMTP account is allowed to send from.",
    },
  ],
  configSchema,
  secretSchema,

  async test(credentials, signal) {
    if (signal.aborted) throw new ProviderTimeoutError();
    let transport: ReturnType<typeof openTransport> | undefined;
    try {
      const opened = (transport = openTransport(credentials));
      // verify() connects, upgrades to TLS and signs in, without sending mail.
      await untilAborted(opened.verify(), signal, () => opened.close());
      return { ok: true, detail: `Signed in to ${credentials.config.host}:${credentials.config.port}.` };
    } catch (error) {
      const failure = classify(error, credentials);
      if (failure.kind === "rejected") return { ok: false, message: failure.message };
      return throwFailure(failure);
    } finally {
      transport?.close();
    }
  },
};
