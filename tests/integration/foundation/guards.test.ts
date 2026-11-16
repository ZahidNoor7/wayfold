import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionCookie,
  getPlatformAdmin,
  getSession,
  getWorkspace,
  requestMeta,
  requirePlatformAdmin,
  requireUser,
  requireWorkspace,
  sessionCookieName,
  setSessionCookie,
} from "@/server/auth/guards";
import { createSession } from "@/server/auth/sessions";
import { tenants, users } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { withPlatform } from "@/server/platform/db";
import { ALL_PERMISSIONS } from "@/server/rbac/permissions";
import { createTenant, createUser, randomId } from "../../helpers/fixtures";
import { fakeRequest, redirectOf } from "./fake-request";
import { addMember, createGrant, createPlatformAdmin } from "./support";

// next/headers needs a live Next.js request; next/navigation is the real one,
// so redirects are the genuine NEXT_REDIRECT errors the framework throws.
vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // Tests run outside a Next.js request, where `connection()` has nothing to wait for.
  connection: () => waitForRequest(),
}));
const waitForRequest = vi.hoisted(() => vi.fn(async () => undefined));

const ORIGINAL_APP_URL = process.env.APP_URL;

beforeEach(() => {
  fakeRequest.reset();
});

afterEach(() => {
  process.env.APP_URL = ORIGINAL_APP_URL;
  resetEnvCache();
});

/** Signs `userId` in on the fake request and returns the raw token. */
async function signIn(userId: string, options: { activeTenantId?: string | null; supportGrantId?: string | null } = {}): Promise<string> {
  const { token } = await createSession(userId, {}, options);
  fakeRequest.setCookie(sessionCookieName(), token);
  return token;
}

describe("session cookie", () => {
  it("uses the __Host- prefix over HTTPS and a plain name over HTTP", () => {
    expect(sessionCookieName()).toBe("__Host-wf_session");

    process.env.APP_URL = "http://app.localhost:3000";
    resetEnvCache();
    expect(sessionCookieName()).toBe("wf_session");
  });

  it("sets an HttpOnly, Secure, SameSite=Lax cookie with no Domain", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    await setSessionCookie("raw-session-token", expiresAt);

    expect(fakeRequest.written).toEqual([
      {
        name: "__Host-wf_session",
        value: "raw-session-token",
        options: { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: expiresAt },
      },
    ]);
    // A Domain attribute would break the __Host- contract and widen the scope.
    expect(fakeRequest.written[0]!.options).not.toHaveProperty("domain");
  });

  it("drops Secure only for a plain-HTTP development origin", async () => {
    process.env.APP_URL = "http://app.localhost:3000";
    resetEnvCache();
    await setSessionCookie("raw-session-token", new Date());
    expect(fakeRequest.written[0]).toMatchObject({ name: "wf_session", options: { httpOnly: true, secure: false, sameSite: "lax", path: "/" } });
  });

  it("clears the cookie by name", async () => {
    fakeRequest.setCookie("__Host-wf_session", "raw-session-token");
    await clearSessionCookie();
    expect(fakeRequest.deleted).toEqual(["__Host-wf_session"]);
    expect(fakeRequest.cookie("__Host-wf_session")).toBeUndefined();
  });
});

describe("getSession", () => {
  it("waits for the real request before touching the database", async () => {
    waitForRequest.mockClear();
    await getSession();
    expect(waitForRequest).toHaveBeenCalledTimes(1);
  });

  it("is null without a cookie", async () => {
    expect(await getSession()).toBeNull();
  });

  it("resolves the cookie to the signed-in user", async () => {
    const user = await createUser();
    await signIn(user.id);
    expect(await getSession()).toMatchObject({ user: { id: user.id, email: user.email, emailVerified: true }, activeTenantId: null });
  });

  it("is null for a forged or stale cookie value", async () => {
    fakeRequest.setCookie(sessionCookieName(), "forged-cookie-value");
    expect(await getSession()).toBeNull();
  });

  it("ignores a token presented under any other cookie name", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);
    fakeRequest.setCookie("wf_session", token);
    fakeRequest.setCookie("session", token);
    expect(await getSession()).toBeNull();
  });

  it("is null once the user has been disabled", async () => {
    const user = await createUser();
    await signIn(user.id);
    await withPlatform((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, user.id)));
    expect(await getSession()).toBeNull();
  });
});

describe("getWorkspace", () => {
  it("is null without a session", async () => {
    expect(await getWorkspace()).toBeNull();
  });

  it("resolves the session's workspace", async () => {
    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    expect(await getWorkspace()).toMatchObject({ ok: true, workspace: { tenantId: a.tenantId, isOwner: true } });
  });

  it("reports why there is no workspace", async () => {
    const a = await createTenant();
    const stranger = await createUser();
    await signIn(stranger.id, { activeTenantId: a.tenantId });
    expect(await getWorkspace()).toEqual({ ok: false, reason: "not_a_member" });
  });
});

describe("requireUser", () => {
  it("redirects to sign-in without a session", async () => {
    expect(await redirectOf(requireUser())).toBe("/login");
  });

  it("returns the session when signed in", async () => {
    const user = await createUser();
    await signIn(user.id);
    expect((await requireUser()).user.id).toBe(user.id);
  });
});

describe("requireWorkspace", () => {
  it("redirects to sign-in without a session", async () => {
    expect(await redirectOf(requireWorkspace())).toBe("/login");
  });

  it("sends an unverified user to verify their e-mail first", async () => {
    const a = await createTenant();
    await withPlatform((tx) => tx.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, a.ownerId)));
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    expect(await redirectOf(requireWorkspace())).toBe("/verify-email");
  });

  it("sends a user with no active workspace to the switcher", async () => {
    const a = await createTenant();
    await signIn(a.ownerId);
    expect(await redirectOf(requireWorkspace())).toBe("/workspaces");
  });

  it("sends a user whose session points at someone else's workspace to the switcher", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await signIn(b.ownerId, { activeTenantId: a.tenantId });
    expect(await redirectOf(requireWorkspace())).toBe("/workspaces");
    expect(await redirectOf(requireWorkspace("tours.view"))).toBe("/workspaces");
  });

  it("sends members of a suspended workspace to the suspension page", async () => {
    const a = await createTenant();
    await withPlatform((tx) => tx.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, a.tenantId)));
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    expect(await redirectOf(requireWorkspace())).toBe("/workspace-suspended");
  });

  it("sends an expired support session back to the platform", async () => {
    const a = await createTenant();
    const admin = await createPlatformAdmin();
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id, expiresAt: new Date(Date.now() - 1_000) });
    await signIn(admin.id, { activeTenantId: a.tenantId, supportGrantId: grantId });
    expect(await redirectOf(requireWorkspace())).toBe("/platform/support?expired=1");
  });

  it("refuses a member who lacks the page's permission", async () => {
    const a = await createTenant();
    const staff = await createUser();
    await addMember(a.tenantId, staff.id, "staff");
    await signIn(staff.id, { activeTenantId: a.tenantId });

    expect(await redirectOf(requireWorkspace("tours.manage"))).toBe("/workspace/forbidden");
    expect(await redirectOf(requireWorkspace("billing.manage"))).toBe("/workspace/forbidden");
  });

  it("returns the workspace when the member holds the permission, or none is asked", async () => {
    const a = await createTenant();
    const staff = await createUser();
    await addMember(a.tenantId, staff.id, "staff");
    await signIn(staff.id, { activeTenantId: a.tenantId });

    expect(await requireWorkspace()).toMatchObject({ tenantId: a.tenantId, roleName: "Staff", isOwner: false });
    expect((await requireWorkspace("tours.view")).user.id).toBe(staff.id);
  });

  it("returns every permission for the owner", async () => {
    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    expect((await requireWorkspace("billing.manage")).permissions).toEqual(ALL_PERMISSIONS);
  });

  it("keeps a live support session read-only", async () => {
    const a = await createTenant();
    const admin = await createPlatformAdmin();
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id });
    await signIn(admin.id, { activeTenantId: a.tenantId, supportGrantId: grantId });

    expect((await requireWorkspace("bookings.view")).support?.grantId).toBe(grantId);
    expect(await redirectOf(requireWorkspace("bookings.manage"))).toBe("/workspace/forbidden");
  });
});

describe("platform administration", () => {
  it("has no platform admin without a session", async () => {
    expect(await getPlatformAdmin()).toBeNull();
    expect(await redirectOf(requirePlatformAdmin())).toBe("/login");
  });

  it("does not treat a workspace owner as platform staff", async () => {
    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    expect(await getPlatformAdmin()).toBeNull();
    // Sent to their own dashboard: the platform area does not announce itself.
    expect(await redirectOf(requirePlatformAdmin())).toBe("/workspace");
    expect(await redirectOf(requirePlatformAdmin("owner"))).toBe("/workspace");
  });

  it("recognises platform support and platform owners", async () => {
    const support = await createPlatformAdmin("support");
    await signIn(support.id);
    expect(await getPlatformAdmin()).toMatchObject({ role: "support", session: { user: { id: support.id } } });
    expect((await requirePlatformAdmin()).role).toBe("support");
    expect((await requirePlatformAdmin("support")).role).toBe("support");

    fakeRequest.reset();
    const owner = await createPlatformAdmin("owner");
    await signIn(owner.id);
    expect((await requirePlatformAdmin("owner")).role).toBe("owner");
    expect((await requirePlatformAdmin()).session.user.id).toBe(owner.id);
  });

  it("keeps support staff out of owner-only pages", async () => {
    const support = await createPlatformAdmin("support");
    await signIn(support.id);
    expect(await redirectOf(requirePlatformAdmin("owner"))).toBe("/platform");
  });

  it("gives a support session no platform powers, even for a platform owner", async () => {
    const a = await createTenant();
    const owner = await createPlatformAdmin("owner");
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: owner.id });
    await signIn(owner.id, { activeTenantId: a.tenantId, supportGrantId: grantId });

    expect(await getPlatformAdmin()).toBeNull();
    expect(await redirectOf(requirePlatformAdmin())).toBe("/workspace");
  });
});

describe("requestMeta", () => {
  it("prefers x-real-ip", async () => {
    fakeRequest.setHeaders({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "198.51.100.1, 10.0.0.1", "user-agent": "Vitest/5", host: "app.wayfold.test" });
    expect(await requestMeta()).toEqual({ ip: "203.0.113.5", userAgent: "Vitest/5", host: "app.wayfold.test" });
  });

  it("falls back to the first forwarded address", async () => {
    fakeRequest.setHeaders({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1", host: "acme.wayfold.test" });
    expect(await requestMeta()).toEqual({ ip: "198.51.100.1", userAgent: null, host: "acme.wayfold.test" });
  });

  it("reports unknown when the proxy sent no address", async () => {
    expect(await requestMeta()).toEqual({ ip: "unknown", userAgent: null, host: null });
  });

  it("never invents an identity from an unrelated header", async () => {
    fakeRequest.setHeaders({ "x-client-ip": "203.0.113.5", forwarded: "for=203.0.113.5", "x-tenant-id": randomId() });
    expect((await requestMeta()).ip).toBe("unknown");
  });
});
