import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { withoutTenant, withUser } from "../db/context";
import { sessions, users } from "../db/schema";
import { generateToken, hashToken } from "./tokens";

const DAY = 86_400_000;
export const SESSION_LIFETIME_MS = 30 * DAY;
const REFRESH_AFTER_MS = 1 * DAY;
/** Support-access sessions are deliberately short. */
export const SUPPORT_SESSION_LIFETIME_MS = 60 * 60_000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export interface Session {
  id: string;
  user: SessionUser;
  activeTenantId: string | null;
  /** Present only while a platform admin is inside a workspace under a grant. */
  supportGrantId: string | null;
  expiresAt: Date;
}

export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export async function createSession(
  userId: string,
  meta: SessionMeta = {},
  options: { activeTenantId?: string | null; supportGrantId?: string | null; lifetimeMs?: number } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + (options.lifetimeMs ?? SESSION_LIFETIME_MS));
  await withoutTenant((tx) =>
    tx.insert(sessions).values({
      tokenHash: hashToken(token),
      userId,
      activeTenantId: options.activeTenantId ?? null,
      supportGrantId: options.supportGrantId ?? null,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      expiresAt,
    }),
  );
  return { token, expiresAt };
}

/**
 * Resolves a cookie value to a live session, or null. Expired sessions are
 * deleted on sight; disabled users never resolve.
 */
export async function validateSessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token || token.length > 200) return null;
  const tokenHash = hashToken(token);

  const row = await withoutTenant(async (tx) => {
    const [found] = await tx.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
    if (!found) return null;
    if (found.expiresAt.getTime() <= Date.now()) {
      await tx.delete(sessions).where(eq(sessions.id, found.id));
      return null;
    }
    // Sliding expiry for ordinary sessions; support sessions never extend.
    if (!found.supportGrantId && Date.now() - found.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
      const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
      await tx.update(sessions).set({ lastSeenAt: new Date(), expiresAt }).where(eq(sessions.id, found.id));
      found.expiresAt = expiresAt;
    }
    return found;
  });
  if (!row) return null;

  const user = await withUser(row.userId, async ({ tx }) => {
    const [found] = await tx
      .select({ id: users.id, email: users.email, name: users.name, emailVerifiedAt: users.emailVerifiedAt, status: users.status })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);
    return found ?? null;
  });
  if (!user || user.status !== "active") return null;

  return {
    id: row.id,
    user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerifiedAt !== null },
    activeTenantId: row.activeTenantId,
    supportGrantId: row.supportGrantId,
    expiresAt: row.expiresAt,
  };
}

export async function setActiveTenant(sessionId: string, tenantId: string | null): Promise<void> {
  await withoutTenant((tx) => tx.update(sessions).set({ activeTenantId: tenantId }).where(eq(sessions.id, sessionId)));
}

export async function deleteSession(sessionId: string): Promise<void> {
  await withoutTenant((tx) => tx.delete(sessions).where(eq(sessions.id, sessionId)));
}

/** Signs a user out everywhere, e.g. after a password change. */
export async function deleteUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await withoutTenant(async (tx) => {
    const rows = await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
    for (const row of rows) {
      if (row.id !== exceptSessionId) await tx.delete(sessions).where(eq(sessions.id, row.id));
    }
  });
}

export async function deleteExpiredSessions(): Promise<number> {
  const removed = await withoutTenant((tx) =>
    tx.delete(sessions).where(and(lt(sessions.expiresAt, new Date()))).returning({ id: sessions.id }),
  );
  return removed.length;
}
