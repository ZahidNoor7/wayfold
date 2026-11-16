import { clearSessionCookie, getSession, requestMeta } from "@/server/auth/guards";
import { deleteSession } from "@/server/auth/sessions";
import { getPlatformRole } from "@/server/auth/workspace";
import { env } from "@/server/env";
import { endSupportSession } from "@/server/platform/support";

/** 303 so the browser follows with GET; `redirect()` would answer a POST with a method-preserving 307. */
function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

/**
 * Cookies are SameSite=Lax, so another site cannot make this request carry
 * the session. The check is a second fence: a POST that names a foreign
 * origin is refused outright.
 */
function isSameOrigin(request: Request, host: string | null): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    return originHost === host || originHost === new URL(env().APP_URL).host;
  } catch {
    return false;
  }
}

// The class of failure only: a driver error can quote row values.
function logFailure(step: string, error: unknown): void {
  console.error(`[wayfold] ending a support session failed at ${step} (${error instanceof Error ? error.name : "unknown error"})`);
}

/**
 * Ends the current support session: the session row is deleted, the end is
 * written to the workspace's audit log, the cookie is cleared, and the admin
 * is sent to sign in again. An ordinary login is left untouched.
 */
export async function POST(request: Request): Promise<Response> {
  const { ip, host } = await requestMeta();
  if (!isSameOrigin(request, host)) return new Response("Forbidden", { status: 403 });

  const session = await getSession();
  if (!session) {
    // Nothing valid behind the cookie, if there is one. Do not leave it lying around.
    await clearSessionCookie();
    return seeOther("/login");
  }
  if (!session.supportGrantId) return seeOther("/platform/support");

  try {
    const role = await getPlatformRole(session.user.id);
    // The service deletes the session and records the end in the workspace's audit log.
    // It only accepts a current platform admin.
    if (role) await endSupportSession({ userId: session.user.id, role }, session.id, { ip });
  } catch (error) {
    // Already ended, or the audit write failed. The session is removed below regardless.
    logFailure("end", error);
  }

  try {
    // Idempotent: a no-op after a clean end, and the fallback when the admin's
    // platform role was removed mid-session or the call above failed.
    await deleteSession(session.id);
  } catch (error) {
    // The row could not be removed now. It cannot be extended and expires with the grant, within the hour.
    logFailure("delete", error);
  }

  // Whatever happened above, the browser must not keep a support session cookie.
  await clearSessionCookie();
  return seeOther("/login?notice=support-ended");
}
