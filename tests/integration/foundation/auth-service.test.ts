import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { verifyPassword } from "@/server/auth/password";
import {
  changePassword,
  InvalidCredentialsError,
  InvalidTokenError,
  login,
  normaliseEmail,
  registerUser,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "@/server/auth/service";
import { validateSessionToken } from "@/server/auth/sessions";
import { hashToken } from "@/server/auth/tokens";
import { authTokens, sessions, users } from "@/server/db/schema";
import { ValidationError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { RATE_LIMITS, RateLimitError } from "@/server/rate-limit";
import { createUser, randomId, unique } from "../../helpers/fixtures";
import { rejection } from "./support";

const PASSWORD = "correct-horse-battery";
const ip = () => `ip-${unique()}`;
const freshEmail = () => `${unique("person")}@example.test`;

const userRow = async (id: string) => (await withPlatform((tx) => tx.select().from(users).where(eq(users.id, id))))[0];
const tokensOf = (userId: string) => withPlatform((tx) => tx.select().from(authTokens).where(eq(authTokens.userId, userId)));
const sessionsOf = (userId: string) => withPlatform((tx) => tx.select().from(sessions).where(eq(sessions.userId, userId)));

function expireTokens(userId: string, kind: "email_verification" | "password_reset") {
  return withPlatform((tx) =>
    tx
      .update(authTokens)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind))),
  );
}

/** A registered, verified account with a known password. */
async function account(overrides: { email?: string; password?: string } = {}) {
  const email = overrides.email ?? freshEmail();
  const password = overrides.password ?? PASSWORD;
  const registered = await registerUser({ name: "Ada Lovelace", email, password }, { ip: ip() });
  await verifyEmail(registered.verificationToken!);
  return { userId: registered.userId, email, password };
}

describe("registerUser", () => {
  it("creates an unverified account and returns a verification token", async () => {
    const email = freshEmail();
    const result = await registerUser({ name: "  Ada Lovelace  ", email, password: PASSWORD }, { ip: ip() });

    expect(result.verificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await userRow(result.userId);
    expect(row).toMatchObject({ email, name: "Ada Lovelace", status: "active", emailVerifiedAt: null });
  });

  it("stores an Argon2id hash, never the password", async () => {
    const result = await registerUser({ name: "Ada", email: freshEmail(), password: PASSWORD }, { ip: ip() });
    const row = await userRow(result.userId);
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    expect(await verifyPassword(row!.passwordHash, PASSWORD)).toBe(true);
  });

  it("stores the verification token hashed, never raw", async () => {
    const result = await registerUser({ name: "Ada", email: freshEmail(), password: PASSWORD }, { ip: ip() });
    const rows = await tokensOf(result.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "email_verification", tokenHash: hashToken(result.verificationToken!), consumedAt: null });
    expect(rows[0]!.tokenHash).not.toBe(result.verificationToken);
    expect(JSON.stringify(rows)).not.toContain(result.verificationToken);
    // About a day to use it.
    const ttl = rows[0]!.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(23 * 3_600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3_600_000);
  });

  it("stores the e-mail address trimmed and lower-cased", async () => {
    const local = unique("Mixed.Case");
    const result = await registerUser({ name: "Ada", email: `  ${local}@Example.TEST `, password: PASSWORD }, { ip: ip() });
    expect((await userRow(result.userId))!.email).toBe(`${local.toLowerCase()}@example.test`);
  });

  it("answers a duplicate e-mail like a new one, but issues no token and changes nothing", async () => {
    const email = freshEmail();
    const first = await registerUser({ name: "Original Owner", email, password: PASSWORD }, { ip: ip() });
    const before = await userRow(first.userId);

    const second = await registerUser({ name: "Someone Else", email, password: "attacker-chosen-pw" }, { ip: ip() });

    // Same shape as a fresh registration; only the token is absent.
    expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
    expect(second).toEqual({ userId: first.userId, verificationToken: null });

    const after = await userRow(first.userId);
    expect(after).toMatchObject({ name: "Original Owner", passwordHash: before!.passwordHash, emailVerifiedAt: null });
    expect(await verifyPassword(after!.passwordHash, "attacker-chosen-pw")).toBe(false);

    // The original verification token is untouched and still the only one.
    const rows = await tokensOf(first.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(first.verificationToken!));
    const matching = await withPlatform((tx) => tx.select({ id: users.id }).from(users).where(eq(users.email, email)));
    expect(matching).toHaveLength(1);
  });

  it("recognises a duplicate regardless of case and surrounding spaces", async () => {
    const email = freshEmail();
    const first = await registerUser({ name: "Ada", email, password: PASSWORD }, { ip: ip() });
    const second = await registerUser({ name: "Ada", email: `  ${email.toUpperCase()} `, password: PASSWORD }, { ip: ip() });
    expect(second).toEqual({ userId: first.userId, verificationToken: null });
  });

  it.each([
    ["a short password", { name: "Ada", email: "ada@example.test", password: "short" }, "password"],
    ["an over-long password", { name: "Ada", email: "ada@example.test", password: "p".repeat(201) }, "password"],
    ["a malformed e-mail", { name: "Ada", email: "not-an-email", password: PASSWORD }, "email"],
    ["a one-letter name", { name: "A", email: "ada@example.test", password: PASSWORD }, "name"],
    ["a missing name", { email: "ada@example.test", password: PASSWORD }, "name"],
  ])("rejects %s with a field error", async (_name, input, field) => {
    const error = (await rejection(registerUser(input, { ip: ip() }))) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors?.[field]?.length).toBeGreaterThan(0);
    expect(JSON.stringify(error.fieldErrors)).not.toContain(PASSWORD);
  });

  it("rejects input that is not an object", async () => {
    await expect(registerUser(null, { ip: ip() })).rejects.toBeInstanceOf(ValidationError);
    await expect(registerUser("ada@example.test", { ip: ip() })).rejects.toBeInstanceOf(ValidationError);
  });

  it("limits registrations per address", async () => {
    const address = ip();
    for (let i = 0; i < RATE_LIMITS.register.limit; i++) {
      await registerUser({ name: "Ada", email: freshEmail(), password: PASSWORD }, { ip: address });
    }
    const blockedEmail = freshEmail();
    const error = await rejection(registerUser({ name: "Ada", email: blockedEmail, password: PASSWORD }, { ip: address }));
    expect(error).toBeInstanceOf(RateLimitError);
    const created = await withPlatform((tx) => tx.select({ id: users.id }).from(users).where(eq(users.email, blockedEmail)));
    expect(created).toEqual([]);
  });
});

describe("verifyEmail", () => {
  it("marks the address verified", async () => {
    const result = await registerUser({ name: "Ada", email: freshEmail(), password: PASSWORD }, { ip: ip() });
    await expect(verifyEmail(result.verificationToken!)).resolves.toEqual({ userId: result.userId });
    expect((await userRow(result.userId))!.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("accepts a token only once", async () => {
    const result = await registerUser({ name: "Ada", email: freshEmail(), password: PASSWORD }, { ip: ip() });
    await verifyEmail(result.verificationToken!);
    await expect(verifyEmail(result.verificationToken!)).rejects.toBeInstanceOf(InvalidTokenError);

    const [row] = await tokensOf(result.userId);
    expect(row!.consumedAt).toBeInstanceOf(Date);
  });

  it("lets only one of two simultaneous uses succeed", async () => {
    const result = await registerUser({ name: "Ada", email: freshEmail(), password: PASSWORD }, { ip: ip() });
    const outcomes = await Promise.allSettled([verifyEmail(result.verificationToken!), verifyEmail(result.verificationToken!)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  });

  it("rejects an expired token and leaves the account unverified", async () => {
    const result = await registerUser({ name: "Ada", email: freshEmail(), password: PASSWORD }, { ip: ip() });
    await expireTokens(result.userId, "email_verification");

    await expect(verifyEmail(result.verificationToken!)).rejects.toBeInstanceOf(InvalidTokenError);
    expect((await userRow(result.userId))!.emailVerifiedAt).toBeNull();
    // An expired token is not burnt by the attempt.
    expect((await tokensOf(result.userId))[0]!.consumedAt).toBeNull();
  });

  it.each(["", "never-issued-token", "x".repeat(201)])("rejects the unusable token %j", async (token) => {
    await expect(verifyEmail(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("does not accept the stored hash as a token", async () => {
    const result = await registerUser({ name: "Ada", email: freshEmail(), password: PASSWORD }, { ip: ip() });
    await expect(verifyEmail(hashToken(result.verificationToken!))).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("does not accept a password-reset token", async () => {
    const user = await account();
    await withPlatform((tx) => tx.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, user.userId)));
    const reset = await requestPasswordReset(user.email, { ip: ip() });

    await expect(verifyEmail(reset!.token)).rejects.toBeInstanceOf(InvalidTokenError);
    expect((await userRow(user.userId))!.emailVerifiedAt).toBeNull();
  });

  it("explains a bad link without saying why it failed", async () => {
    const error = (await rejection(verifyEmail("never-issued-token"))) as InvalidTokenError;
    expect(error.code).toBe("invalid_token");
    expect(error.status).toBe(400);
    expect(error.message).toBe("This link is invalid or has expired. Request a new one.");
  });
});

describe("resendVerification", () => {
  it("issues a new token and retires the previous one", async () => {
    const result = await registerUser({ name: "Ada", email: freshEmail(), password: PASSWORD }, { ip: ip() });

    const next = await resendVerification(result.userId);
    expect(next).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(next).not.toBe(result.verificationToken);
    expect(await tokensOf(result.userId)).toHaveLength(1);

    await expect(verifyEmail(result.verificationToken!)).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(verifyEmail(next!)).resolves.toEqual({ userId: result.userId });
  });

  it("returns null for an already verified account", async () => {
    const user = await account();
    expect(await resendVerification(user.userId)).toBeNull();
  });

  it("returns null for an unknown user", async () => {
    expect(await resendVerification(randomId())).toBeNull();
  });

  it("is rate limited per user", async () => {
    const result = await registerUser({ name: "Ada", email: freshEmail(), password: PASSWORD }, { ip: ip() });
    for (let i = 0; i < RATE_LIMITS.emailVerification.limit; i++) await resendVerification(result.userId);
    await expect(resendVerification(result.userId)).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("login", () => {
  it("opens a session for the right password", async () => {
    const user = await account();
    const result = await login({ email: user.email, password: user.password }, { ip: "203.0.113.20", userAgent: "Vitest/1" });

    expect(result).toMatchObject({ userId: user.userId, emailVerified: true });
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const session = await validateSessionToken(result.token);
    expect(session?.user).toEqual({ id: user.userId, email: user.email, name: "Ada Lovelace", emailVerified: true });

    const [row] = await sessionsOf(user.userId);
    expect(row).toMatchObject({ ip: "203.0.113.20", userAgent: "Vitest/1", tokenHash: hashToken(result.token) });
    expect(row!.tokenHash).not.toBe(result.token);
  });

  it("matches the e-mail case-insensitively", async () => {
    const user = await account();
    const result = await login({ email: `  ${user.email.toUpperCase()}  `, password: user.password }, { ip: ip() });
    expect(result.userId).toBe(user.userId);
  });

  it("lets an unverified account sign in and says so", async () => {
    const email = freshEmail();
    await registerUser({ name: "Ada", email, password: PASSWORD }, { ip: ip() });
    const result = await login({ email, password: PASSWORD }, { ip: ip() });
    expect(result.emailVerified).toBe(false);
  });

  it("rejects a wrong password and opens no session", async () => {
    const user = await account();
    const error = await rejection(login({ email: user.email, password: "wrong-password-1" }, { ip: ip() }));
    expect(error).toBeInstanceOf(InvalidCredentialsError);
    expect(await sessionsOf(user.userId)).toEqual([]);
  });

  it("answers an unknown e-mail exactly like a wrong password", async () => {
    const user = await account();
    const wrongPassword = (await rejection(login({ email: user.email, password: "wrong-password-1" }, { ip: ip() }))) as InvalidCredentialsError;
    const unknownEmail = (await rejection(login({ email: freshEmail(), password: "wrong-password-1" }, { ip: ip() }))) as InvalidCredentialsError;

    expect(unknownEmail).toBeInstanceOf(InvalidCredentialsError);
    expect({ code: unknownEmail.code, status: unknownEmail.status, message: unknownEmail.message, name: unknownEmail.name }).toEqual({
      code: wrongPassword.code,
      status: wrongPassword.status,
      message: wrongPassword.message,
      name: wrongPassword.name,
    });
    expect(unknownEmail).toMatchObject({ code: "invalid_credentials", status: 401, message: "That e-mail and password do not match." });
  });

  it("rejects a disabled user with the same answer, even with the right password", async () => {
    const user = await account();
    await withPlatform((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, user.userId)));

    const error = (await rejection(login({ email: user.email, password: user.password }, { ip: ip() }))) as InvalidCredentialsError;
    expect(error).toBeInstanceOf(InvalidCredentialsError);
    expect(error.message).toBe("That e-mail and password do not match.");
    expect(await sessionsOf(user.userId)).toEqual([]);
  });

  it("rejects an account whose stored hash is a placeholder", async () => {
    const invited = await createUser();
    await expect(login({ email: invited.email, password: "!" }, { ip: ip() })).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it.each([
    ["an empty password", { email: "ada@example.test", password: "" }, "password"],
    ["a malformed e-mail", { email: "nope", password: PASSWORD }, "email"],
    ["a missing e-mail", { password: PASSWORD }, "email"],
  ])("rejects %s before touching any account", async (_name, input, field) => {
    const error = (await rejection(login(input, { ip: ip() }))) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors?.[field]?.length).toBeGreaterThan(0);
  });

  it("locks out an address after too many attempts, even for the right password", async () => {
    const user = await account();
    const address = ip();
    for (let i = 0; i < RATE_LIMITS.login.limit; i++) {
      await expect(login({ email: freshEmail(), password: "wrong-password-1" }, { ip: address })).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    const error = (await rejection(login({ email: user.email, password: user.password }, { ip: address }))) as RateLimitError;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(RATE_LIMITS.login.windowSeconds);
    expect(await sessionsOf(user.userId)).toEqual([]);

    // Another address is unaffected.
    await expect(login({ email: user.email, password: user.password }, { ip: ip() })).resolves.toMatchObject({ userId: user.userId });
  });

  it("locks out a targeted account across many addresses", async () => {
    const user = await account();
    for (let i = 0; i < RATE_LIMITS.login.limit; i++) {
      await expect(login({ email: user.email, password: "wrong-password-1" }, { ip: ip() })).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    await expect(login({ email: user.email, password: user.password }, { ip: ip() })).rejects.toBeInstanceOf(RateLimitError);
    // The limit is keyed on the normalised address, so changing case does not dodge it.
    await expect(login({ email: user.email.toUpperCase(), password: user.password }, { ip: ip() })).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("password reset", () => {
  it("issues a hashed, one-hour token for a known account", async () => {
    const user = await account();
    const reset = await requestPasswordReset(`  ${user.email.toUpperCase()} `, { ip: ip() });

    expect(reset).toEqual({ userId: user.userId, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    const rows = (await tokensOf(user.userId)).filter((row) => row.kind === "password_reset");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(reset!.token));
    expect(JSON.stringify(rows)).not.toContain(reset!.token);
    const ttl = rows[0]!.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(55 * 60_000);
    expect(ttl).toBeLessThanOrEqual(60 * 60_000);
  });

  it("returns null for an unknown address and for a disabled account", async () => {
    expect(await requestPasswordReset(freshEmail(), { ip: ip() })).toBeNull();

    const user = await account();
    await withPlatform((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, user.userId)));
    expect(await requestPasswordReset(user.email, { ip: ip() })).toBeNull();
    expect((await tokensOf(user.userId)).filter((row) => row.kind === "password_reset")).toEqual([]);
  });

  it("rejects a malformed address", async () => {
    await expect(requestPasswordReset("not-an-email", { ip: ip() })).rejects.toBeInstanceOf(ValidationError);
    await expect(requestPasswordReset(undefined, { ip: ip() })).rejects.toBeInstanceOf(ValidationError);
  });

  it("is rate limited per address and per account", async () => {
    const address = ip();
    for (let i = 0; i < RATE_LIMITS.passwordReset.limit; i++) await requestPasswordReset(freshEmail(), { ip: address });
    await expect(requestPasswordReset(freshEmail(), { ip: address })).rejects.toBeInstanceOf(RateLimitError);

    const user = await account();
    for (let i = 0; i < RATE_LIMITS.passwordReset.limit; i++) await requestPasswordReset(user.email, { ip: ip() });
    await expect(requestPasswordReset(user.email, { ip: ip() })).rejects.toBeInstanceOf(RateLimitError);
  });

  it("sets the new password, signs out every session and cannot be replayed", async () => {
    const user = await account();
    const phone = await login({ email: user.email, password: user.password }, { ip: ip() });
    const laptop = await login({ email: user.email, password: user.password }, { ip: ip() });
    const reset = await requestPasswordReset(user.email, { ip: ip() });

    await expect(resetPassword(reset!.token, "brand-new-password-9")).resolves.toEqual({ userId: user.userId });

    expect(await validateSessionToken(phone.token)).toBeNull();
    expect(await validateSessionToken(laptop.token)).toBeNull();
    expect(await sessionsOf(user.userId)).toEqual([]);

    await expect(login({ email: user.email, password: user.password }, { ip: ip() })).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(login({ email: user.email, password: "brand-new-password-9" }, { ip: ip() })).resolves.toMatchObject({ userId: user.userId });

    await expect(resetPassword(reset!.token, "attacker-replayed-pw")).rejects.toBeInstanceOf(InvalidTokenError);
    expect(await verifyPassword((await userRow(user.userId))!.passwordHash, "brand-new-password-9")).toBe(true);
  });

  it("retires the previous reset token when a new one is requested", async () => {
    const user = await account();
    const first = await requestPasswordReset(user.email, { ip: ip() });
    const second = await requestPasswordReset(user.email, { ip: ip() });
    expect(second!.token).not.toBe(first!.token);

    await expect(resetPassword(first!.token, "brand-new-password-9")).rejects.toBeInstanceOf(InvalidTokenError);
    expect(await verifyPassword((await userRow(user.userId))!.passwordHash, user.password)).toBe(true);
    await expect(resetPassword(second!.token, "brand-new-password-9")).resolves.toEqual({ userId: user.userId });
  });

  it("rejects an expired reset token and keeps the old password", async () => {
    const user = await account();
    const session = await login({ email: user.email, password: user.password }, { ip: ip() });
    const reset = await requestPasswordReset(user.email, { ip: ip() });
    await expireTokens(user.userId, "password_reset");

    await expect(resetPassword(reset!.token, "brand-new-password-9")).rejects.toBeInstanceOf(InvalidTokenError);
    expect(await verifyPassword((await userRow(user.userId))!.passwordHash, user.password)).toBe(true);
    expect(await validateSessionToken(session.token)).not.toBeNull();
  });

  it("does not accept an e-mail verification token", async () => {
    const result = await registerUser({ name: "Ada", email: freshEmail(), password: PASSWORD }, { ip: ip() });
    await expect(resetPassword(result.verificationToken!, "brand-new-password-9")).rejects.toBeInstanceOf(InvalidTokenError);
    expect(await verifyPassword((await userRow(result.userId))!.passwordHash, PASSWORD)).toBe(true);
    // The verification token is still good for its real purpose.
    await expect(verifyEmail(result.verificationToken!)).resolves.toEqual({ userId: result.userId });
  });

  it("rejects a weak new password without spending the token", async () => {
    const user = await account();
    const reset = await requestPasswordReset(user.email, { ip: ip() });

    await expect(resetPassword(reset!.token, "short")).rejects.toBeInstanceOf(ValidationError);
    await expect(resetPassword(reset!.token, "brand-new-password-9")).resolves.toEqual({ userId: user.userId });
  });

  it("verifies the address, since the reset proves control of the inbox", async () => {
    const email = freshEmail();
    const registered = await registerUser({ name: "Ada", email, password: PASSWORD }, { ip: ip() });
    const reset = await requestPasswordReset(email, { ip: ip() });
    await resetPassword(reset!.token, "brand-new-password-9");
    expect((await userRow(registered.userId))!.emailVerifiedAt).toBeInstanceOf(Date);
  });
});

describe("changePassword", () => {
  it("changes the password and signs out every other session", async () => {
    const user = await account();
    const current = await login({ email: user.email, password: user.password }, { ip: ip() });
    const other = await login({ email: user.email, password: user.password }, { ip: ip() });
    const session = await validateSessionToken(current.token);

    await changePassword(user.userId, session!.id, user.password, "brand-new-password-9");

    expect(await validateSessionToken(current.token)).not.toBeNull();
    expect(await validateSessionToken(other.token)).toBeNull();
    await expect(login({ email: user.email, password: user.password }, { ip: ip() })).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(login({ email: user.email, password: "brand-new-password-9" }, { ip: ip() })).resolves.toMatchObject({ userId: user.userId });
  });

  it("refuses when the current password is wrong", async () => {
    const user = await account();
    const current = await login({ email: user.email, password: user.password }, { ip: ip() });
    const other = await login({ email: user.email, password: user.password }, { ip: ip() });
    const session = await validateSessionToken(current.token);

    await expect(changePassword(user.userId, session!.id, "wrong-password-1", "brand-new-password-9")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(await verifyPassword((await userRow(user.userId))!.passwordHash, user.password)).toBe(true);
    expect(await validateSessionToken(other.token)).not.toBeNull();
  });

  it("refuses a weak new password before checking anything else", async () => {
    const user = await account();
    await expect(changePassword(user.userId, randomId(), user.password, "short")).rejects.toBeInstanceOf(ValidationError);
    expect(await verifyPassword((await userRow(user.userId))!.passwordHash, user.password)).toBe(true);
  });

  it("refuses for a user that does not exist", async () => {
    await expect(changePassword(randomId(), randomId(), PASSWORD, "brand-new-password-9")).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe("normaliseEmail", () => {
  it("trims and lower-cases", () => {
    expect(normaliseEmail("  Ada.Lovelace@Example.TEST ")).toBe("ada.lovelace@example.test");
  });
});
