import "server-only";
import { and, eq } from "drizzle-orm";
import { withTenant, withUser, type TenantScope } from "../db/context";
import { memberships, platformAdmins, roles, supportAccessGrants, tenants, type TenantBranding } from "../db/schema";
import { ForbiddenError } from "../errors";
import { ALL_PERMISSIONS, isPermission, type Permission } from "../rbac/permissions";
import type { Session, SessionUser } from "./sessions";

export interface WorkspaceTenant {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
  currency: string;
  timezone: string;
  branding: TenantBranding;
  onboardingCompleted: boolean;
}

export interface Workspace {
  tenantId: string;
  tenant: WorkspaceTenant;
  user: SessionUser;
  sessionId: string;
  roleName: string;
  isOwner: boolean;
  permissions: readonly Permission[];
  /** Set when a platform admin is acting under an approved support grant. */
  support: { grantId: string; expiresAt: Date } | null;
}

export type WorkspaceResolution =
  | { ok: true; workspace: Workspace }
  | { ok: false; reason: "no_active_tenant" | "not_a_member" | "suspended" | "support_expired" };

/** What a support session may do: look, not touch. */
export const SUPPORT_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter(
  (permission) => permission.endsWith(".view") && permission !== "billing.view",
);

/**
 * Turns a session into a workspace by re-checking, on every request, that the
 * user is still an active member of the session's tenant (or holds a live
 * support grant for it). The tenant id comes from the server-side session row,
 * never from the request.
 */
export async function resolveWorkspace(session: Session): Promise<WorkspaceResolution> {
  const tenantId = session.activeTenantId;
  if (!tenantId) return { ok: false, reason: "no_active_tenant" };

  return withTenant(
    tenantId,
    async ({ tx }): Promise<WorkspaceResolution> => {
      const [tenant] = await tx
        .select({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          status: tenants.status,
          currency: tenants.currency,
          timezone: tenants.timezone,
          branding: tenants.branding,
          onboardingCompletedAt: tenants.onboardingCompletedAt,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!tenant) return { ok: false, reason: "not_a_member" };

      const base = {
        tenantId,
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status,
          currency: tenant.currency,
          timezone: tenant.timezone,
          branding: tenant.branding,
          onboardingCompleted: tenant.onboardingCompletedAt !== null,
        },
        user: session.user,
        sessionId: session.id,
      };

      if (session.supportGrantId) {
        const [grant] = await tx
          .select({ id: supportAccessGrants.id, expiresAt: supportAccessGrants.expiresAt })
          .from(supportAccessGrants)
          .where(
            and(
              eq(supportAccessGrants.id, session.supportGrantId),
              eq(supportAccessGrants.tenantId, tenantId),
              eq(supportAccessGrants.requestedBy, session.user.id),
              eq(supportAccessGrants.status, "approved"),
            ),
          )
          .limit(1);
        if (!grant?.expiresAt || grant.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "support_expired" };
        return {
          ok: true,
          workspace: {
            ...base,
            roleName: "Wayfold Support",
            isOwner: false,
            permissions: SUPPORT_PERMISSIONS,
            support: { grantId: grant.id, expiresAt: grant.expiresAt },
          },
        };
      }

      const [membership] = await tx
        .select({ roleName: roles.name, systemKey: roles.systemKey, permissions: roles.permissions })
        .from(memberships)
        .innerJoin(roles, and(eq(roles.tenantId, memberships.tenantId), eq(roles.id, memberships.roleId)))
        // Explicit tenant filter: the "own memberships" policy also exposes this
        // user's memberships in other workspaces, and those must never match here.
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, session.user.id), eq(memberships.status, "active")))
        .limit(1);
      if (!membership) return { ok: false, reason: "not_a_member" };
      if (tenant.status === "suspended") return { ok: false, reason: "suspended" };

      const isOwner = membership.systemKey === "owner";
      return {
        ok: true,
        workspace: {
          ...base,
          roleName: membership.roleName,
          isOwner,
          // The owner role always means "everything", including permissions
          // added to the catalogue after the workspace was created.
          permissions: isOwner ? ALL_PERMISSIONS : membership.permissions.filter(isPermission),
          support: null,
        },
      };
    },
    { userId: session.user.id },
  );
}

export function can(workspace: Pick<Workspace, "permissions">, permission: Permission): boolean {
  return workspace.permissions.includes(permission);
}

export function assertCan(workspace: Pick<Workspace, "permissions">, permission: Permission): void {
  if (!can(workspace, permission)) throw new ForbiddenError();
}

/** Runs `fn` in the workspace's tenant transaction, attributed to its user. */
export function inWorkspace<T>(workspace: Workspace, fn: (scope: TenantScope) => Promise<T>): Promise<T> {
  return withTenant(workspace.tenantId, fn, { userId: workspace.user.id });
}

export interface WorkspaceSummary {
  tenantId: string;
  slug: string;
  name: string;
  roleName: string;
  status: "active" | "suspended";
}

/** Workspaces the user is an active member of, for the switcher. */
export async function listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  const rows = await withUser(userId, ({ tx }) =>
    tx
      .select({ tenantId: tenants.id, slug: tenants.slug, name: tenants.name, status: tenants.status })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(tenants.name),
  );
  // Role names sit behind tenant row-level security, so read each in its own scope.
  return Promise.all(
    rows.map(async (row) => {
      const [role] = await withTenant(
        row.tenantId,
        ({ tx }) =>
          tx
            .select({ name: roles.name })
            .from(memberships)
            .innerJoin(roles, and(eq(roles.tenantId, memberships.tenantId), eq(roles.id, memberships.roleId)))
            .where(and(eq(memberships.tenantId, row.tenantId), eq(memberships.userId, userId)))
            .limit(1),
        { userId },
      );
      return { ...row, roleName: role?.name ?? "" };
    }),
  );
}

/** True when the user is an active member of `tenantId`. Used before switching. */
export async function isActiveMember(userId: string, tenantId: string): Promise<boolean> {
  const rows = await withUser(userId, ({ tx }) =>
    tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId), eq(memberships.status, "active")))
      .limit(1),
  );
  return rows.length > 0;
}

export async function getPlatformRole(userId: string): Promise<"owner" | "support" | null> {
  const rows = await withUser(userId, ({ tx }) =>
    tx.select({ role: platformAdmins.role }).from(platformAdmins).where(eq(platformAdmins.userId, userId)).limit(1),
  );
  return rows[0]?.role ?? null;
}
