import "server-only";
import { setActiveTenant, type Session } from "@/server/auth/sessions";
import { can, getPlatformRole, listWorkspaces, resolveWorkspace } from "@/server/auth/workspace";
import { ForbiddenError } from "@/server/errors";
import { safeNextPath } from "./safe-next";

/**
 * A support session is pinned to the one workspace its grant covers. Moving it
 * to another workspace is never allowed, whichever screen asks.
 */
export function assertOwnSession(session: Session): void {
  if (session.supportGrantId) throw new ForbiddenError("End the support session before switching workspace.");
}

/**
 * Makes `tenantId` the session's active workspace and says where to land:
 * first-run setup, the suspended notice, or the dashboard. The caller has
 * already checked that the user is an active member.
 */
export async function enterWorkspace(session: Session, tenantId: string): Promise<string> {
  assertOwnSession(session);
  await setActiveTenant(session.id, tenantId);
  const resolution = await resolveWorkspace({ ...session, activeTenantId: tenantId });
  if (!resolution.ok) return resolution.reason === "suspended" ? "/workspace-suspended" : "/workspaces";
  const { workspace } = resolution;
  if (!workspace.tenant.onboardingCompleted && can(workspace, "workspace.manage")) return "/onboarding";
  return "/workspace";
}

/**
 * Where a freshly signed-in user goes. `next` is honoured only when it is a
 * same-origin path (see `safeNextPath`).
 */
export async function destinationAfterSignIn(session: Session, next: unknown): Promise<string> {
  if (!session.user.emailVerified) return "/verify-email";

  const safe = safeNextPath(next);
  const workspaces = await listWorkspaces(session.user.id);

  if (workspaces.length === 1) {
    const home = await enterWorkspace(session, workspaces[0]!.tenantId);
    return safe ?? home;
  }
  if (safe) return safe;
  if (workspaces.length === 0 && (await getPlatformRole(session.user.id))) return "/platform";
  return "/workspaces";
}
