import { and, asc, eq } from "drizzle-orm";
import { withTenant, type TenantScope } from "@/server/db/context";
import { auditLogs, memberships, roles } from "@/server/db/schema";
import { ALL_PERMISSIONS, isPermission, type Permission, type SystemRoleKey } from "@/server/rbac/permissions";
import type { TeamActor } from "@/server/team/access";
import { createUser, type TenantFixture } from "../../helpers/fixtures";

/** The actor a resolved Workspace would produce for the tenant's owner. */
export const ownerActor = (tenant: TenantFixture): TeamActor => ({
  userId: tenant.ownerId,
  permissions: ALL_PERMISSIONS,
  isOwner: true,
});

/** Runs `fn` in the tenant's transaction, attributed to `userId` (the owner by default). */
export function inTenant<T>(tenant: TenantFixture, fn: (scope: TenantScope) => Promise<T>, userId: string = tenant.ownerId): Promise<T> {
  return withTenant(tenant.tenantId, fn, { userId });
}

export async function systemRole(tenant: TenantFixture, key: SystemRoleKey): Promise<{ id: string; permissions: Permission[] }> {
  const [row] = await inTenant(tenant, ({ tx }) =>
    tx
      .select({ id: roles.id, permissions: roles.permissions })
      .from(roles)
      .where(and(eq(roles.tenantId, tenant.tenantId), eq(roles.systemKey, key))),
  );
  return { id: row!.id, permissions: row!.permissions.filter(isPermission) };
}

/** A role written straight to the table, for arranging actors with an exact permission set. */
export async function customRole(tenant: TenantFixture, name: string, permissions: Permission[]): Promise<{ id: string; permissions: Permission[] }> {
  const [row] = await inTenant(tenant, ({ tx }) => tx.insert(roles).values({ name, permissions }).returning({ id: roles.id }));
  return { id: row!.id, permissions };
}

export interface MemberFixture {
  userId: string;
  email: string;
  membershipId: string;
  roleId: string;
  /** What the Workspace would hand the services for this member. */
  actor: TeamActor;
}

/** Adds a user to the tenant with a built-in role (by key) or a specific role. */
export async function addMember(
  tenant: TenantFixture,
  role: SystemRoleKey | { id: string; permissions: Permission[] },
  options: { name?: string; status?: "active" | "deactivated" } = {},
): Promise<MemberFixture> {
  const resolved = typeof role === "string" ? await systemRole(tenant, role) : role;
  const user = await createUser({ name: options.name });
  const [membership] = await inTenant(tenant, ({ tx }) =>
    tx
      .insert(memberships)
      .values({ userId: user.id, roleId: resolved.id, status: options.status ?? "active" })
      .returning({ id: memberships.id }),
  );
  const isOwner = role === "owner";
  return {
    userId: user.id,
    email: user.email,
    membershipId: membership!.id,
    roleId: resolved.id,
    actor: { userId: user.id, permissions: isOwner ? ALL_PERMISSIONS : resolved.permissions, isOwner },
  };
}

export async function ownerMembershipId(tenant: TenantFixture): Promise<string> {
  const [row] = await inTenant(tenant, ({ tx }) =>
    tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenant.tenantId), eq(memberships.userId, tenant.ownerId))),
  );
  return row!.id;
}

export interface AuditRow {
  action: string;
  targetId: string | null;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
}

export function auditTrail(tenant: TenantFixture): Promise<AuditRow[]> {
  return inTenant(tenant, ({ tx }) =>
    tx
      .select({ action: auditLogs.action, targetId: auditLogs.targetId, actorUserId: auditLogs.actorUserId, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, tenant.tenantId))
      .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id)),
  );
}

/** Postgres error code of a rejected statement, wherever the driver put it. */
export async function pgCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code ?? "unknown";
  }
}
