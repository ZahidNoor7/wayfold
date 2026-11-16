import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { normaliseEmail, withAuthEmail, withoutTenant, withUser } from "../db/context";
import { authTokens, users } from "../db/schema";
import { AppError, ValidationError } from "../errors";
import { enforceRateLimit, RATE_LIMITS } from "../rate-limit";
import { burnPasswordCheck, hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyPassword } from "./password";
import { createSession, deleteUserSessions, type SessionMeta } from "./sessions";
import { generateToken, hashToken } from "./tokens";

const HOUR = 3_600_000;
const VERIFICATION_TTL_MS = 24 * HOUR;
const RESET_TTL_MS = 1 * HOUR;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid e-mail address.").max(254));
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, "That password is too long.");
export const nameSchema = z.string().trim().min(2, "Enter your name.").max(80);

export const registerSchema = z.object({ name: nameSchema, email: emailSchema, password: passwordSchema });
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX_LENGTH) });

export class InvalidCredentialsError extends AppError {
  constructor() {
    super("invalid_credentials", "That e-mail and password do not match.", 401);
  }
}

export class InvalidTokenError extends AppError {
  constructor() {
    super("invalid_token", "This link is invalid or has expired. Request a new one.", 400);
  }
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(undefined, z.flattenError(result.error).fieldErrors as Record<string, string[]>);
  }
  return result.data;
}

async function issueToken(userId: string, kind: "email_verification" | "password_reset", ttlMs: number): Promise<string> {
  const token = generateToken();
  await withoutTenant(async (tx) => {
    // One live token per purpose: issuing a new one retires the old.
    await tx.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind)));
    await tx.insert(authTokens).values({ userId, kind, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) });
  });
  return token;
}

/** Atomically consumes a token. Returns the user id, or throws if unusable. */
async function consumeToken(token: string, kind: "email_verification" | "password_reset"): Promise<string> {
  if (!token || token.length > 200) throw new InvalidTokenError();
  const [row] = await withoutTenant((tx) =>
    tx
      .update(authTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(authTokens.tokenHash, hashToken(token)),
          eq(authTokens.kind, kind),
          isNull(authTokens.consumedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: authTokens.userId }),
  );
  if (!row) throw new InvalidTokenError();
  return row.userId;
}

export interface RegisterResult {
  userId: string;
  /** Null when the address was already registered: the caller sends nothing new. */
  verificationToken: string | null;
}

/**
 * Creates an account. If the e-mail is already registered the call still
 * "succeeds" with no token, so the response cannot be used to probe which
 * addresses have accounts.
 */
export async function registerUser(input: unknown, context: { ip: string }): Promise<RegisterResult> {
  const data = parse(registerSchema, input);
  await enforceRateLimit(RATE_LIMITS.register, context.ip);
  const passwordHash = await hashPassword(data.password);

  const created = await withAuthEmail(data.email, async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1);
    if (existing) return { id: existing.id, isNew: false };
    const [row] = await tx.insert(users).values({ email: data.email, name: data.name, passwordHash }).returning({ id: users.id });
    return { id: row!.id, isNew: true };
  });

  if (!created.isNew) return { userId: created.id, verificationToken: null };
  return { userId: created.id, verificationToken: await issueToken(created.id, "email_verification", VERIFICATION_TTL_MS) };
}

export async function resendVerification(userId: string): Promise<string | null> {
  await enforceRateLimit(RATE_LIMITS.emailVerification, userId);
  const user = await withUser(userId, async ({ tx }) => {
    const [row] = await tx.select({ verified: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1);
    return row;
  });
  if (!user || user.verified) return null;
  return issueToken(userId, "email_verification", VERIFICATION_TTL_MS);
}

export async function verifyEmail(token: string): Promise<{ userId: string }> {
  const userId = await consumeToken(token, "email_verification");
  await withUser(userId, ({ tx }) => tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId)));
  return { userId };
}

export async function login(
  input: unknown,
  context: { ip: string } & SessionMeta,
): Promise<{ token: string; expiresAt: Date; userId: string; emailVerified: boolean }> {
  const data = parse(loginSchema, input);
  // Limit by address and by account, so neither one IP nor one target can be hammered.
  await enforceRateLimit(RATE_LIMITS.login, `ip:${context.ip}`);
  await enforceRateLimit(RATE_LIMITS.login, `email:${data.email}`);

  const user = await withAuthEmail(data.email, async (tx) => {
    const [row] = await tx
      .select({ id: users.id, passwordHash: users.passwordHash, status: users.status, verified: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1);
    return row ?? null;
  });

  if (!user) {
    await burnPasswordCheck(data.password);
    throw new InvalidCredentialsError();
  }
  const valid = await verifyPassword(user.passwordHash, data.password);
  if (!valid || user.status !== "active") throw new InvalidCredentialsError();

  const session = await createSession(user.id, { ip: context.ip, userAgent: context.userAgent });
  return { ...session, userId: user.id, emailVerified: user.verified !== null };
}

/** Returns a reset token for a known, active account; null otherwise. */
export async function requestPasswordReset(emailInput: unknown, context: { ip: string }): Promise<{ userId: string; token: string } | null> {
  const email = parse(emailSchema, emailInput);
  await enforceRateLimit(RATE_LIMITS.passwordReset, `ip:${context.ip}`);
  await enforceRateLimit(RATE_LIMITS.passwordReset, `email:${email}`);

  const user = await withAuthEmail(email, async (tx) => {
    const [row] = await tx.select({ id: users.id, status: users.status }).from(users).where(eq(users.email, email)).limit(1);
    return row ?? null;
  });
  if (!user || user.status !== "active") return null;
  return { userId: user.id, token: await issueToken(user.id, "password_reset", RESET_TTL_MS) };
}

export async function resetPassword(token: string, newPassword: unknown): Promise<{ userId: string }> {
  const password = parse(passwordSchema, newPassword);
  const userId = await consumeToken(token, "password_reset");
  const passwordHash = await hashPassword(password);
  // Proving control of the inbox also verifies the address.
  await withUser(userId, ({ tx }) =>
    tx.update(users).set({ passwordHash, emailVerifiedAt: new Date() }).where(eq(users.id, userId)),
  );
  await deleteUserSessions(userId);
  return { userId };
}

export async function changePassword(userId: string, currentSessionId: string, current: string, next: unknown): Promise<void> {
  const password = parse(passwordSchema, next);
  const [row] = await withUser(userId, ({ tx }) =>
    tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1),
  );
  if (!row || !(await verifyPassword(row.passwordHash, current))) throw new InvalidCredentialsError();
  const passwordHash = await hashPassword(password);
  await withUser(userId, ({ tx }) => tx.update(users).set({ passwordHash }).where(eq(users.id, userId)));
  await deleteUserSessions(userId, currentSessionId);
}

export { normaliseEmail };
