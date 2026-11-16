import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "../env";
import type { Permission } from "../rbac/permissions";
import { validateSessionToken, type Session } from "./sessions";
import { can, getPlatformRole, resolveWorkspace, type Workspace } from "./workspace";

/**
 * `__Host-` pins the cookie to the exact app host over HTTPS with no Domain
 * attribute, so it is never sent to (or settable from) a tenant sub-domain.
 */
export function sessionCookieName(): string {
  return env().APP_URL.startsWith("https://") ? "__Host-wf_session" : "wf_session";
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(sessionCookieName());
}

/** Current session, validated against the database once per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  return validateSessionToken(token);
});

export const getWorkspace = cache(async () => {
  const session = await getSession();
  if (!session) return null;
  return resolveWorkspace(session);
});

export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * For workspace pages and layouts. Redirects when there is no session, no
 * usable workspace, or the role lacks `permission`. Pages must still fetch
 * through tenant-scoped services: this is the gate, not the fence.
 */
export async function requireWorkspace(permission?: Permission): Promise<Workspace> {
  const session = await requireUser();
  if (!session.user.emailVerified) redirect("/verify-email");
  const resolution = await getWorkspace();
  if (!resolution || !resolution.ok) {
    if (resolution?.reason === "suspended") redirect("/workspace-suspended");
    if (resolution?.reason === "support_expired") redirect("/platform/support?expired=1");
    redirect("/workspaces");
  }
  if (permission && !can(resolution.workspace, permission)) redirect("/workspace/forbidden");
  return resolution.workspace;
}

export interface PlatformAdmin {
  session: Session;
  role: "owner" | "support";
}

export const getPlatformAdmin = cache(async (): Promise<PlatformAdmin | null> => {
  const session = await getSession();
  // A support session is scoped to one workspace; it carries no platform powers.
  if (!session || session.supportGrantId) return null;
  const role = await getPlatformRole(session.user.id);
  return role ? { session, role } : null;
});

export async function requirePlatformAdmin(minimum: "support" | "owner" = "support"): Promise<PlatformAdmin> {
  const session = await requireUser();
  const admin = await getPlatformAdmin();
  // Not-found rather than forbidden: the platform area does not advertise itself.
  if (!admin || session.id !== admin.session.id) redirect("/workspace");
  if (minimum === "owner" && admin.role !== "owner") redirect("/platform");
  return admin;
}

export async function requestMeta(): Promise<{ ip: string; userAgent: string | null; host: string | null }> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: list.get("x-real-ip") ?? forwarded ?? "unknown",
    userAgent: list.get("user-agent"),
    host: list.get("host"),
  };
}
