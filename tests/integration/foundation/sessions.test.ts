import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  deleteUserSessions,
  SESSION_LIFETIME_MS,
  setActiveTenant,
  SUPPORT_SESSION_LIFETIME_MS,
  validateSessionToken,
} from "@/server/auth/sessions";
import { hashToken } from "@/server/auth/tokens";
import { sessions, users } from "@/server/db/schema";
import { withPlatform } from "@/server/platform/db";
import { createTenant, createUser, randomId } from "../../helpers/fixtures";

const DAY = 86_400_000;

const rowsOf = (userId: string) => withPlatform((tx) => tx.select().from(sessions).where(eq(sessions.userId, userId)));

function patchSession(sessionId: string, patch: Partial<typeof sessions.$inferInsert>) {
  return withPlatform((tx) => tx.update(sessions).set(patch).where(eq(sessions.id, sessionId)));
}

describe("createSession", () => {
  it("stores a keyed hash of the token, never the token itself", async () => {
    const user = await createUser();
    const { token, expiresAt } = await createSession(user.id, { ip: "203.0.113.9", userAgent: "Vitest" });

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await rowsOf(user.id);
    expect(row).toMatchObject({
      userId: user.id,
      tokenHash: hashToken(token),
      activeTenantId: null,
      supportGrantId: null,
      ip: "203.0.113.9",
      userAgent: "Vitest",
    });
    expect(row!.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row!.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it("lasts thirty days by default", async () => {
    const user = await createUser();
    const before = Date.now();
    const { expiresAt } = await createSession(user.id);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + SESSION_LIFETIME_MS);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + SESSION_LIFETIME_MS);
    expect(SESSION_LIFETIME_MS).toBe(30 * DAY);

    const [row] = await rowsOf(user.id);
    expect(row).toMatchObject({ ip: null, userAgent: null });
  });

  it("accepts a tenant, a support grant and a shorter lifetime", async () => {
    const a = await createTenant();
    const grantId = randomId();
    const before = Date.now();
    const { expiresAt } = await createSession(
      a.ownerId,
      {},
      { activeTenantId: a.tenantId, supportGrantId: grantId, lifetimeMs: SUPPORT_SESSION_LIFETIME_MS },
    );
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(SUPPORT_SESSION_LIFETIME_MS + 5_000);
    expect(SUPPORT_SESSION_LIFETIME_MS).toBe(60 * 60_000);

    const [row] = await rowsOf(a.ownerId);
    expect(row).toMatchObject({ activeTenantId: a.tenantId, supportGrantId: grantId });
  });

  it("caps the stored user agent", async () => {
    const user = await createUser();
    await createSession(user.id, { userAgent: "U".repeat(5_000) });
    const [row] = await rowsOf(user.id);
    expect(row!.userAgent).toHaveLength(400);
  });
});

describe("validateSessionToken", () => {
  it("resolves a live token to its session and user", async () => {
    const user = await createUser({ name: "Ada Lovelace" });
    const { token } = await createSession(user.id);
    const [row] = await rowsOf(user.id);

    const session = await validateSessionToken(token);
    expect(session).toEqual({
      id: row!.id,
      user: { id: user.id, email: user.email, name: "Ada Lovelace", emailVerified: true },
      activeTenantId: null,
      supportGrantId: null,
      expiresAt: row!.expiresAt,
    });
  });

  it("reports an unverified e-mail address", async () => {
    const user = await createUser();
    await withPlatform((tx) => tx.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, user.id)));
    const { token } = await createSession(user.id);
    expect((await validateSessionToken(token))?.user.emailVerified).toBe(false);
  });

  it.each([undefined, null, "", "x".repeat(201)])("returns null for the unusable token %j", async (token) => {
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("returns null for a token that was never issued", async () => {
    expect(await validateSessionToken("never-issued-token-value")).toBeNull();
  });

  it("does not accept the stored hash in place of the token", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);
    expect(await validateSessionToken(hashToken(token))).toBeNull();
    // The real token still works afterwards.
    expect(await validateSessionToken(token)).not.toBeNull();
  });

  it("deletes an expired session on sight", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);
    const [row] = await rowsOf(user.id);
    await patchSession(row!.id, { expiresAt: new Date(Date.now() - 1_000) });

    expect(await validateSessionToken(token)).toBeNull();
    expect(await rowsOf(user.id)).toEqual([]);
  });

  it("treats a session created with no lifetime left as expired", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id, {}, { lifetimeMs: -1 });
    expect(await validateSessionToken(token)).toBeNull();
    expect(await rowsOf(user.id)).toEqual([]);
  });

  it("extends an ordinary session that was last seen more than a day ago", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);
    const [row] = await rowsOf(user.id);
    const nearlyExpired = new Date(Date.now() + 2 * DAY);
    await patchSession(row!.id, { lastSeenAt: new Date(Date.now() - 2 * DAY), expiresAt: nearlyExpired });

    const before = Date.now();
    const session = await validateSessionToken(token);
    expect(session!.expiresAt.getTime()).toBeGreaterThanOrEqual(before + SESSION_LIFETIME_MS);

    const [after] = await rowsOf(user.id);
    expect(after!.expiresAt.getTime()).toBe(session!.expiresAt.getTime());
    expect(Date.now() - after!.lastSeenAt.getTime()).toBeLessThan(10_000);
  });

  it("leaves a recently seen session's expiry alone", async () => {
    const user = await createUser();
    const { token, expiresAt } = await createSession(user.id);
    const session = await validateSessionToken(token);
    expect(session!.expiresAt.getTime()).toBe(expiresAt.getTime());
    const [after] = await rowsOf(user.id);
    expect(after!.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it("never extends a support session", async () => {
    const a = await createTenant();
    const { token } = await createSession(
      a.ownerId,
      {},
      { activeTenantId: a.tenantId, supportGrantId: randomId(), lifetimeMs: SUPPORT_SESSION_LIFETIME_MS },
    );
    const [row] = await rowsOf(a.ownerId);
    const soon = new Date(Date.now() + 60_000);
    await patchSession(row!.id, { lastSeenAt: new Date(Date.now() - 2 * DAY), expiresAt: soon });

    const session = await validateSessionToken(token);
    expect(session!.expiresAt.getTime()).toBe(soon.getTime());
    expect(session!.supportGrantId).toBe(row!.supportGrantId);
    const [after] = await rowsOf(a.ownerId);
    expect(after!.expiresAt.getTime()).toBe(soon.getTime());
  });

  it("does not resolve a disabled user, even with a live session", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);
    expect(await validateSessionToken(token)).not.toBeNull();

    await withPlatform((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, user.id)));
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("stops resolving once the user is deleted", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);
    await withPlatform((tx) => tx.delete(users).where(eq(users.id, user.id)));
    expect(await validateSessionToken(token)).toBeNull();
  });
});

describe("session maintenance", () => {
  it("switches and clears the active tenant", async () => {
    const a = await createTenant();
    const { token } = await createSession(a.ownerId);
    const session = await validateSessionToken(token);

    await setActiveTenant(session!.id, a.tenantId);
    expect((await validateSessionToken(token))?.activeTenantId).toBe(a.tenantId);

    await setActiveTenant(session!.id, null);
    expect((await validateSessionToken(token))?.activeTenantId).toBeNull();
  });

  it("deletes one session and leaves the user's others alone", async () => {
    const user = await createUser();
    const first = await createSession(user.id);
    const second = await createSession(user.id);
    const session = await validateSessionToken(first.token);

    await deleteSession(session!.id);

    expect(await validateSessionToken(first.token)).toBeNull();
    expect(await validateSessionToken(second.token)).not.toBeNull();
  });

  it("signs a user out everywhere without touching anyone else", async () => {
    const user = await createUser();
    const other = await createUser();
    const mine = [await createSession(user.id), await createSession(user.id), await createSession(user.id)];
    const theirs = await createSession(other.id);

    await deleteUserSessions(user.id);

    for (const { token } of mine) expect(await validateSessionToken(token)).toBeNull();
    expect(await rowsOf(user.id)).toEqual([]);
    expect(await validateSessionToken(theirs.token)).not.toBeNull();
  });

  it("can keep the current session when signing out the rest", async () => {
    const user = await createUser();
    const current = await createSession(user.id);
    const stale = await createSession(user.id);
    const session = await validateSessionToken(current.token);

    await deleteUserSessions(user.id, session!.id);

    expect(await validateSessionToken(current.token)).not.toBeNull();
    expect(await validateSessionToken(stale.token)).toBeNull();
    expect(await rowsOf(user.id)).toHaveLength(1);
  });

  it("purges expired sessions and reports how many", async () => {
    const user = await createUser();
    const live = await createSession(user.id);
    await createSession(user.id, {}, { lifetimeMs: -60_000 });
    await createSession(user.id, {}, { lifetimeMs: -120_000 });

    const removed = await deleteExpiredSessions();

    expect(removed).toBeGreaterThanOrEqual(2);
    const left = await rowsOf(user.id);
    expect(left).toHaveLength(1);
    expect(left[0]!.tokenHash).toBe(hashToken(live.token));
  });
});
