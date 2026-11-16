import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "@/server/errors";
import { sendSmtpMail, smtpAdapter, type SmtpConfig, type SmtpSecrets } from "@/server/integrations/adapters/smtp";
import { ProviderTimeoutError, TransientProviderError } from "@/server/integrations/http";
import { expectNoSecret, thrownBy } from "./helpers";

// Only the transport is replaced; everything above the socket is real.
const transport = vi.hoisted(() => ({ verify: vi.fn(), sendMail: vi.fn(), close: vi.fn() }));
const createTransport = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({ default: { createTransport } }));

const config: SmtpConfig = {
  host: "smtp.caspian-trails.example",
  port: 587,
  secure: false,
  requireTLS: true,
  fromName: "Caspian Trails",
  fromEmail: "bookings@caspian-trails.example",
};
const secrets: SmtpSecrets = { username: "mailer@caspian-trails.example", password: "Sup3r-s3cret pass!" };
const credentials = { config, secrets };
const message = { to: "leyla@example.test", subject: "Your booking", text: "See you soon." };
const never = new AbortController().signal;

/** An error shaped like the ones nodemailer hands to callers. */
function smtpError(fields: { code?: string; responseCode?: number; response?: string; permanent?: boolean }, text = "smtp failure"): Error {
  return Object.assign(new Error(text), fields);
}

beforeEach(() => {
  transport.verify.mockReset().mockResolvedValue(true);
  transport.sendMail.mockReset().mockResolvedValue({ messageId: "<abc@wayfold.test>", accepted: [message.to], rejected: [] });
  transport.close.mockReset();
  createTransport.mockReset().mockReturnValue(transport);
});

describe("smtp settings", () => {
  it("normalises host, port and sender, and defaults to STARTTLS", () => {
    expect(
      smtpAdapter.configSchema.parse({ host: " SMTP.Example.COM ", port: "587", fromName: " Caspian Trails ", fromEmail: " Bookings@Example.COM " }),
    ).toEqual({ host: "smtp.example.com", port: 587, secure: false, requireTLS: true, fromName: "Caspian Trails", fromEmail: "bookings@example.com" });
    expect(smtpAdapter.configSchema.safeParse({ ...config, port: 465, secure: true, requireTLS: false }).success).toBe(true);
    expect(smtpAdapter.configSchema.safeParse({ ...config, host: "203.0.113.25" }).success).toBe(true);
  });

  it("matches the TLS style to the well-known ports and never allows plaintext", () => {
    const issue = (overrides: Partial<SmtpConfig>) => smtpAdapter.configSchema.safeParse({ ...config, ...overrides }).error?.issues[0];
    expect(issue({ port: 465, secure: false })).toMatchObject({ path: ["secure"], message: "Port 465 needs TLS on connect." });
    expect(issue({ port: 587, secure: true })).toMatchObject({ path: ["secure"], message: "Port 587 uses STARTTLS. Turn off TLS on connect." });
    expect(issue({ port: 2526, secure: false, requireTLS: false })).toMatchObject({ path: ["requireTLS"] });
  });

  it("rejects hosts that are not a public mail server name", () => {
    for (const host of [
      "localhost",
      "mail.internal",
      "printer.local",
      "127.0.0.1",
      "10.0.0.8",
      "172.16.4.1",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "999.1.1.1",
      "smtp://mail.example.com",
      "mail.example.com:587",
      "user@mail.example.com",
      "[::1]",
      "",
    ]) {
      expect(smtpAdapter.configSchema.safeParse({ ...config, host }).success, host).toBe(false);
    }
  });

  it("rejects bad ports, sender names that could inject headers, bad addresses and unknown keys", () => {
    for (const port of [0, 70000, 58.7, "abc", ""]) {
      expect(smtpAdapter.configSchema.safeParse({ ...config, port }).success, String(port)).toBe(false);
    }
    for (const fromName of ["", "Evil\r\nBcc: x@example.test", 'Quote "me"', "Angle <x>", "x".repeat(101)]) {
      expect(smtpAdapter.configSchema.safeParse({ ...config, fromName }).success, fromName).toBe(false);
    }
    expect(smtpAdapter.configSchema.safeParse({ ...config, fromEmail: "not-an-address" }).success).toBe(false);
    expect(smtpAdapter.configSchema.safeParse({ ...config, secure: "false" }).success).toBe(false);
    expect(smtpAdapter.configSchema.safeParse({ ...config, tls: { rejectUnauthorized: false } }).success).toBe(false);
  });

  it("validates the username and keeps the password exactly as typed", () => {
    expect(smtpAdapter.secretSchema.parse({ username: " mailer ", password: " spaced pass " })).toEqual({ username: "mailer", password: " spaced pass " });
    expect(smtpAdapter.secretSchema.safeParse({ username: "", password: "x" }).success).toBe(false);
    expect(smtpAdapter.secretSchema.safeParse({ username: "two words", password: "x" }).success).toBe(false);
    expect(smtpAdapter.secretSchema.safeParse({ username: "mailer", password: "" }).success).toBe(false);
    expect(smtpAdapter.secretSchema.safeParse({ username: "mailer", password: "line\nbreak" }).success).toBe(false);
    expect(smtpAdapter.secretSchema.safeParse({ ...secrets, token: "x" }).success).toBe(false);
  });

  it("marks the username and password secret in its form", () => {
    expect(smtpAdapter).toMatchObject({ id: "smtp", category: "email" });
    expect(smtpAdapter.fields.filter((field) => field.secret).map((field) => field.key)).toEqual(["username", "password"]);
    expect(smtpAdapter.fields.map((field) => field.key).sort()).toEqual(
      ["fromEmail", "fromName", "host", "password", "port", "requireTLS", "secure", "username"].sort(),
    );
  });
});

describe("smtp connection test", () => {
  it("verifies with the tenant's settings and closes the connection", async () => {
    const result = await smtpAdapter.test(credentials, never);

    expect(result).toEqual({ ok: true, detail: "Signed in to smtp.caspian-trails.example:587." });
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport.mock.calls[0]![0]).toMatchObject({
      host: config.host,
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: secrets.username, pass: secrets.password },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(transport.verify).toHaveBeenCalledTimes(1);
    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalled();
    expectNoSecret(result, Object.values(secrets));
  });

  it("does not ask for STARTTLS on a connection that is already TLS", async () => {
    await smtpAdapter.test({ config: { ...config, port: 465, secure: true, requireTLS: true }, secrets }, never);
    expect(createTransport.mock.calls[0]![0]).toMatchObject({ secure: true, requireTLS: false });
  });

  it("reports rejected credentials without repeating them", async () => {
    transport.verify.mockRejectedValue(
      smtpError({ code: "EAUTH", responseCode: 535, response: `535 5.7.8 Authentication failed for ${secrets.username} / ${secrets.password}` }),
    );

    const result = await smtpAdapter.test(credentials, never);

    expect(result).toEqual({ ok: false, message: "The mail server did not accept the username or password (SMTP 535)." });
    expectNoSecret(result, Object.values(secrets));
    expect(transport.close).toHaveBeenCalled();
  });

  it("recognises a rejected login by its reply code alone, and missing credentials", async () => {
    transport.verify.mockRejectedValue(smtpError({ responseCode: 534, response: "534 5.7.9 Application-specific password required" }));
    expect(await smtpAdapter.test(credentials, never)).toMatchObject({ ok: false, message: expect.stringContaining("username or password") });

    transport.verify.mockRejectedValue(smtpError({ code: "ENOAUTH" }));
    expect(await smtpAdapter.test(credentials, never)).toEqual({
      ok: false,
      message: "The mail server did not accept the username or password.",
    });
  });

  it("explains an unknown host, a TLS failure and a refused connection", async () => {
    transport.verify.mockRejectedValue(smtpError({ code: "EDNS" }));
    expect(await smtpAdapter.test(credentials, never)).toEqual({
      ok: false,
      message: "The mail server smtp.caspian-trails.example could not be found. Check the host name.",
    });

    for (const code of ["ETLS", "EREQUIRETLS"]) {
      transport.verify.mockRejectedValue(smtpError({ code }));
      expect(await smtpAdapter.test(credentials, never)).toEqual({
        ok: false,
        message: "A secure connection to smtp.caspian-trails.example:587 could not be set up. Check the port and the TLS setting.",
      });
    }

    transport.verify.mockRejectedValue(smtpError({ code: "ESOCKET" }));
    expect(await smtpAdapter.test(credentials, never)).toEqual({
      ok: false,
      message: "Could not connect to smtp.caspian-trails.example:587. Check the host, the port and the TLS setting.",
    });
  });

  it("scrubs the password from a server reply in plain and base64 form", async () => {
    const encoded = Buffer.from(secrets.password).toString("base64");
    transport.verify.mockRejectedValue(
      smtpError({ code: "EPROTOCOL", responseCode: 554, response: `554 5.5.1 Unrecognised:\r\n AUTH ${encoded} then ${secrets.password}` }),
    );

    const result = await smtpAdapter.test(credentials, never);

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("The mail server reported a problem (SMTP 554): 554 5.5.1 Unrecognised:") });
    expect((result as { message: string }).message).toContain("[redacted]");
    expectNoSecret(result, Object.values(secrets));
  });

  it("gives a plain message when the failure carries no details at all", async () => {
    transport.verify.mockRejectedValue("socket hang up");
    expect(await smtpAdapter.test(credentials, never)).toEqual({ ok: false, message: "The mail server reported a problem." });

    // A failure while opening the transport is reported the same safe way.
    createTransport.mockImplementation(() => {
      throw smtpError({ code: "ECONFIG" }, `bad config ${secrets.password}`);
    });
    const result = await smtpAdapter.test(credentials, never);
    expect(result).toEqual({ ok: false, message: "The mail server reported a problem." });
  });

  it("turns timeouts into ProviderTimeoutError", async () => {
    for (const code of ["ETIMEDOUT", "EABORT"]) {
      transport.verify.mockRejectedValue(smtpError({ code }));
      await expect(smtpAdapter.test(credentials, never)).rejects.toBeInstanceOf(ProviderTimeoutError);
    }
  });

  it("turns dropped connections and temporary replies into TransientProviderError", async () => {
    transport.verify.mockRejectedValue(smtpError({ code: "ECONNECTION" }));
    const dropped = await thrownBy(() => smtpAdapter.test(credentials, never));
    expect(dropped).toBeInstanceOf(TransientProviderError);
    expectNoSecret(dropped.message, Object.values(secrets));

    transport.verify.mockRejectedValue(smtpError({ responseCode: 421, response: "421 4.7.0 Try again later", permanent: false }));
    const busy = await thrownBy(() => smtpAdapter.test(credentials, never));
    expect(busy).toBeInstanceOf(TransientProviderError);
    expect(busy.message).toBe("The mail server is busy (SMTP 421). Please try again.");

    // 503 is a 5xx reply that nodemailer marks as worth another attempt.
    transport.verify.mockRejectedValue(smtpError({ responseCode: 503, response: "503 Bad sequence", permanent: false }));
    await expect(smtpAdapter.test(credentials, never)).rejects.toBeInstanceOf(TransientProviderError);
  });

  it("stops and closes the connection when the signal is aborted mid-check", async () => {
    transport.verify.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();

    const pending = smtpAdapter.test(credentials, controller.signal);
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(transport.close).toHaveBeenCalled();
  });

  it("does not connect at all when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(smtpAdapter.test(credentials, controller.signal)).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(createTransport).not.toHaveBeenCalled();
  });
});

describe("sendSmtpMail", () => {
  it("sends plain text from the tenant's sender and reports what the server accepted", async () => {
    const controller = new AbortController();

    const result = await sendSmtpMail(credentials, { ...message, replyTo: "hello@caspian-trails.example" }, controller.signal);

    expect(result).toEqual({ messageId: "<abc@wayfold.test>", accepted: [message.to], rejected: [] });
    expect(createTransport.mock.calls[0]![0]).toMatchObject({ host: config.host, auth: { user: secrets.username, pass: secrets.password } });
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: { name: "Caspian Trails", address: "bookings@caspian-trails.example" },
      to: message.to,
      replyTo: "hello@caspian-trails.example",
      subject: message.subject,
      text: message.text,
      signal: controller.signal,
    });
    expect(transport.close).toHaveBeenCalled();
  });

  it("works without a signal and tolerates a sparse result", async () => {
    transport.sendMail.mockResolvedValue({ messageId: "<x@wayfold.test>" });
    expect(await sendSmtpMail(credentials, message)).toEqual({ messageId: "<x@wayfold.test>", accepted: [], rejected: [] });
  });

  it("throws IntegrationError with a safe message when the server refuses", async () => {
    transport.sendMail.mockRejectedValue(
      smtpError({ code: "EENVELOPE", responseCode: 550, response: `550 5.1.1 No such user (auth ${secrets.password})`, permanent: true }),
    );
    const refused = await thrownBy(() => sendSmtpMail(credentials, message, never));
    expect(refused).toBeInstanceOf(IntegrationError);
    expect(refused.message).toContain("The mail server refused the sender or recipient address (SMTP 550): 550 5.1.1 No such user");
    expectNoSecret(refused.message, Object.values(secrets));

    transport.sendMail.mockRejectedValue(smtpError({ code: "EENVELOPE" }));
    expect((await thrownBy(() => sendSmtpMail(credentials, message, never))).message).toBe(
      "The mail server refused the sender or recipient address.",
    );

    transport.sendMail.mockRejectedValue(smtpError({ code: "EAUTH", responseCode: 535 }));
    const auth = await thrownBy(() => sendSmtpMail(credentials, message, never));
    expect(auth).toBeInstanceOf(IntegrationError);
    expect(auth).toMatchObject({ code: "email_rejected", status: 502 });
  });

  it("throws retryable errors for timeouts, aborts and temporary replies", async () => {
    transport.sendMail.mockRejectedValue(smtpError({ code: "ETIMEDOUT" }));
    await expect(sendSmtpMail(credentials, message, never)).rejects.toBeInstanceOf(ProviderTimeoutError);

    // What nodemailer raises when its own signal handling cancels the send.
    transport.sendMail.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError", code: "EABORT" }));
    await expect(sendSmtpMail(credentials, message, never)).rejects.toBeInstanceOf(ProviderTimeoutError);

    transport.sendMail.mockRejectedValue(smtpError({ code: "EMESSAGE", responseCode: 451, response: "451 4.3.0 Try later", permanent: false }));
    await expect(sendSmtpMail(credentials, message, never)).rejects.toBeInstanceOf(TransientProviderError);
  });

  it("stops when the signal fires during the send, and never starts when it already has", async () => {
    transport.sendMail.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = sendSmtpMail(credentials, message, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(transport.close).toHaveBeenCalled();

    createTransport.mockClear();
    await expect(sendSmtpMail(credentials, message, controller.signal)).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(createTransport).not.toHaveBeenCalled();
  });
});
