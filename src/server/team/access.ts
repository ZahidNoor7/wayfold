import "server-only";
import { and, count, eq, gt, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import type { TenantScope } from "../db/context";
import { invitations, memberships, roles, tenants } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { ALL_PERMISSIONS, escalations, isPermission, type Permission } from "../rbac/permissions";

/**
 * Who is making a team change. Built from the resolved `Workspace`
 * (`{ userId: workspace.user.id, permissions, isOwner }`), never from input.
 */
export interface TeamActor {
  userId: string;
  permissions: readonly Permission[];
  isOwner: boolean;
}

export type RoleRow = typeof roles.$inferSelect;

export function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(undefined, z.flattenError(result.error).fieldErrors as Record<string, string[]>);
  }
  return result.data;
}

const idSchema = z.uuid();

/** An id that is not a UUID cannot name a record, so it is simply not found. */
export function requireId(value: unknown, what: string): asserts value is string {
  if (!idSchema.safeParse(value).success) throw new NotFoundError(what);
}

/**
 * Serialises every change to a workspace's team. Seat counting and the
 * "at least one owner" rule both read several rows and then write; without a
 * shared lock two concurrent requests could each pass the check and together
 * break it. NO KEY UPDATE keeps ordinary inserts that reference the tenant
 * (which take KEY SHARE) unblocked.
 */
export async function lockTeam(scope: TenantScope): Promise<void> {
  const rows = await scope.tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, scope.tenantId)).for("no key update");
  if (rows.length === 0) throw new ForbiddenError("This workspace is not available.");
}

export async function findRole(scope: TenantScope, roleId: string): Promise<RoleRow> {
  requireId(roleId, "Role");
  const [row] = await scope.tx
    .select()
    .from(roles)
    .where(and(eq(roles.tenantId, scope.tenantId), eq(roles.id, roleId)))
    .limit(1);
  // Same answer whether the id is unknown or belongs to another workspace.
  if (!row) throw new NotFoundError("Role");
  return row;
}

/** What a role grants in practice. Owner always means the whole catalogue. */
export function effectivePermissions(role: Pick<RoleRow, "systemKey" | "permissions">): Permission[] {
  return role.systemKey === "owner" ? [...ALL_PERMISSIONS] : role.permissions.filter(isPermission);
}

export function actorPermissions(actor: TeamActor): readonly Permission[] {
  return actor.isOwner ? ALL_PERMISSIONS : actor.permissions;
}

export const OWNER_ONLY = "Only an owner can assign or remove the Owner role.";

/**
 * The rule behind every way of handing someone a role (assigning, inviting,
 * reactivating): you cannot give out more than you hold yourself.
 */
export function assertCanGrantRole(actor: TeamActor, role: Pick<RoleRow, "systemKey" | "permissions">): void {
  if (role.systemKey === "owner" && !actor.isOwner) throw new ForbiddenError(OWNER_ONLY);
  if (escalations(actorPermissions(actor), effectivePermissions(role)).length > 0) {
    throw new ForbiddenError("You cannot give someone a role with permissions you do not hold yourself.");
  }
}

export interface Seats {
  activeMembers: number;
  /** Sent, not yet accepted, not revoked, not expired. Each one holds a seat. */
  pendingInvitations: number;
  total: number;
}

/** Seats counted against `maxTeamMembers`. */
export async function countSeats(scope: TenantScope, now: Date): Promise<Seats> {
  const [members] = await scope.tx
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.tenantId, scope.tenantId), eq(memberships.status, "active")));
  const [pending] = await scope.tx
    .select({ n: count() })
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, scope.tenantId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, now),
      ),
    );
  const activeMembers = members?.n ?? 0;
  const pendingInvitations = pending?.n ?? 0;
  return { activeMembers, pendingInvitations, total: activeMembers + pendingInvitations };
}

/**
 * Throws unless an active owner other than `membershipId` exists. Call after
 * `lockTeam`, before demoting, deactivating or removing an active owner.
 */
export async function assertAnotherOwnerRemains(scope: TenantScope, membershipId: string): Promise<void> {
  const [others] = await scope.tx
    .select({ n: count() })
    .from(memberships)
    .innerJoin(roles, and(eq(roles.tenantId, memberships.tenantId), eq(roles.id, memberships.roleId)))
    .where(
      and(
        eq(memberships.tenantId, scope.tenantId),
        eq(memberships.status, "active"),
        eq(roles.systemKey, "owner"),
        ne(memberships.id, membershipId),
      ),
    );
  if ((others?.n ?? 0) === 0) {
    throw new ConflictError("A workspace must keep at least one active owner. Make someone else an owner first.", "last_owner");
  }
}
