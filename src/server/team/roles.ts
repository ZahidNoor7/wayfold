import "server-only";
import { and, count, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { TenantScope } from "../db/context";
import { invitations, memberships, roles } from "../db/schema";
import { ConflictError, ForbiddenError, ValidationError } from "../errors";
import { escalations, InvalidPermissionError, parsePermissions, SYSTEM_ROLES, type Permission } from "../rbac/permissions";
import { actorPermissions, effectivePermissions, findRole, lockTeam, parse, type RoleRow, type TeamActor } from "./access";

const name = z.string().trim().min(2, "Give the role a name of at least 2 characters.").max(60);
const description = z.string().trim().max(300);
// Plain strings here; the catalogue check happens in `validatePermissions` so
// an unknown value is reported by name instead of as a generic schema error.
const permissions = z.array(z.string().max(64)).max(100);

export const createRoleSchema = z.object({ name, description: description.default(""), permissions });
export type CreateRoleInput = z.input<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: name.optional(),
  description: description.optional(),
  permissions: permissions.optional(),
});
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

export interface RoleView {
  id: string;
  /** `owner`, `admin`, ... for built-in roles; null for custom ones. */
  systemKey: string | null;
  isSystem: boolean;
  name: string;
  description: string;
  permissions: Permission[];
  /** Everyone holding the role, deactivated members included. */
  memberCount: number;
  /** Invitations not yet accepted or revoked that would grant the role. */
  openInvitationCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function toView(row: RoleRow, memberCount: number, openInvitationCount: number): RoleView {
  return {
    id: row.id,
    systemKey: row.systemKey,
    isSystem: row.systemKey !== null,
    name: row.name,
    description: row.description,
    permissions: effectivePermissions(row),
    memberCount,
    openInvitationCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Checks a requested permission list against the catalogue and against the
 * actor. Anything outside the catalogue (`platform.admin`, `*`, a typo) is
 * rejected, never dropped silently; anything the actor does not hold is
 * refused, so `roles.manage` alone can never mint a more powerful role.
 */
function validatePermissions(actor: TeamActor, requested: readonly string[]): Permission[] {
  let parsed: Permission[];
  try {
    parsed = parsePermissions(requested);
  } catch (error) {
    if (!(error instanceof InvalidPermissionError)) throw error;
    throw new ValidationError(undefined, {
      permissions: [`Unknown permission: ${error.invalid.map((value) => value.slice(0, 64)).join(", ")}`],
    });
  }
  if (escalations(actorPermissions(actor), parsed).length > 0) {
    throw new ForbiddenError("A role cannot include permissions you do not hold yourself.");
  }
  return parsed;
}

async function assertNameIsFree(scope: TenantScope, roleName: string, exceptRoleId?: string): Promise<void> {
  const [taken] = await scope.tx
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(
        eq(roles.tenantId, scope.tenantId),
        sql`lower(${roles.name}) = ${roleName.toLowerCase()}`,
        exceptRoleId ? ne(roles.id, exceptRoleId) : undefined,
      ),
    )
    .limit(1);
  if (taken) throw new ConflictError("A role with that name already exists.", "role_name_taken");
}

const openInvitation = and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

async function usage(scope: TenantScope, roleId: string): Promise<{ members: number; openInvitations: number }> {
  const [members] = await scope.tx
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.tenantId, scope.tenantId), eq(memberships.roleId, roleId)));
  const [open] = await scope.tx
    .select({ n: count() })
    .from(invitations)
    .where(and(eq(invitations.tenantId, scope.tenantId), eq(invitations.roleId, roleId), openInvitation));
  return { members: members?.n ?? 0, openInvitations: open?.n ?? 0 };
}

const SYSTEM_ORDER = new Map<string, number>(SYSTEM_ROLES.map((role, index) => [role.key, index]));

/** Built-in roles first, in their usual order, then custom roles by name. */
export async function listRoles(scope: TenantScope): Promise<RoleView[]> {
  const rows = await scope.tx.select().from(roles).where(eq(roles.tenantId, scope.tenantId));
  const members = await scope.tx
    .select({ roleId: memberships.roleId, n: count() })
    .from(memberships)
    .where(eq(memberships.tenantId, scope.tenantId))
    .groupBy(memberships.roleId);
  const open = await scope.tx
    .select({ roleId: invitations.roleId, n: count() })
    .from(invitations)
    .where(and(eq(invitations.tenantId, scope.tenantId), openInvitation))
    .groupBy(invitations.roleId);

  const memberCounts = new Map(members.map((row) => [row.roleId, row.n]));
  const openCounts = new Map(open.map((row) => [row.roleId, row.n]));
  const rank = (row: RoleRow) => (row.systemKey === null ? SYSTEM_ORDER.size : (SYSTEM_ORDER.get(row.systemKey) ?? SYSTEM_ORDER.size));

  return rows
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map((row) => toView(row, memberCounts.get(row.id) ?? 0, openCounts.get(row.id) ?? 0));
}

export async function getRole(scope: TenantScope, roleId: string): Promise<RoleView> {
  const row = await findRole(scope, roleId);
  const { members, openInvitations } = await usage(scope, row.id);
  return toView(row, members, openInvitations);
}

export async function createRole(scope: TenantScope, actor: TeamActor, raw: CreateRoleInput): Promise<RoleView> {
  const input = parse(createRoleSchema, raw);
  const granted = validatePermissions(actor, input.permissions);
  await lockTeam(scope);
  await assertNameIsFree(scope, input.name);

  const [row] = await scope.tx
    .insert(roles)
    .values({ tenantId: scope.tenantId, name: input.name, description: input.description, permissions: granted })
    .returning();
  await recordAudit(scope, {
    action: "role.created",
    targetType: "role",
    targetId: row!.id,
    metadata: { name: row!.name, before: [], after: granted },
  });
  return toView(row!, 0, 0);
}

/**
 * Edits a role. Owner is fixed. Other built-in roles keep their name and
 * description (the rest of the product refers to them) but their permissions
 * can be tuned. Nobody edits the role they hold, which closes the obvious
 * way of granting yourself more.
 */
export async function updateRole(scope: TenantScope, actor: TeamActor, roleId: string, raw: UpdateRoleInput): Promise<RoleView> {
  const input = parse(updateRoleSchema, raw);
  await lockTeam(scope);
  const role = await findRole(scope, roleId);
  if (role.systemKey === "owner") throw new ForbiddenError("The Owner role cannot be changed.");

  const [own] = await scope.tx
    .select({ roleId: memberships.roleId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, scope.tenantId), eq(memberships.userId, actor.userId)))
    .limit(1);
  if (own?.roleId === role.id) throw new ForbiddenError("You cannot edit the role you hold yourself.");

  const fieldErrors: Record<string, string[]> = {};
  if (role.systemKey !== null) {
    if (input.name !== undefined && input.name !== role.name) fieldErrors.name = ["Built-in roles cannot be renamed."];
    if (input.description !== undefined && input.description !== role.description) {
      fieldErrors.description = ["The description of a built-in role cannot be changed."];
    }
  }
  if (Object.keys(fieldErrors).length > 0) throw new ValidationError(undefined, fieldErrors);

  const before = effectivePermissions(role);
  const after = input.permissions === undefined ? before : validatePermissions(actor, input.permissions);
  const nextName = input.name ?? role.name;
  if (nextName !== role.name) await assertNameIsFree(scope, nextName, role.id);

  const [row] = await scope.tx
    .update(roles)
    .set({ name: nextName, description: input.description ?? role.description, permissions: after })
    .where(and(eq(roles.tenantId, scope.tenantId), eq(roles.id, role.id)))
    .returning();
  await recordAudit(scope, {
    action: "role.updated",
    targetType: "role",
    targetId: role.id,
    metadata: {
      name: nextName,
      before,
      after,
      added: after.filter((permission) => !before.includes(permission)),
      removed: before.filter((permission) => !after.includes(permission)),
    },
  });
  const { members, openInvitations } = await usage(scope, role.id);
  return toView(row!, members, openInvitations);
}

export async function deleteRole(scope: TenantScope, roleId: string): Promise<void> {
  await lockTeam(scope);
  const role = await findRole(scope, roleId);
  if (role.systemKey !== null) throw new ForbiddenError("Built-in roles cannot be deleted.");

  const { members, openInvitations } = await usage(scope, role.id);
  if (members > 0) throw new ConflictError("Move this role's members to another role before deleting it.", "role_in_use");
  if (openInvitations > 0) {
    throw new ConflictError("Revoke the invitations that use this role before deleting it.", "role_in_use");
  }

  // Finished invitations (accepted or revoked) still reference the role and
  // would block the delete. They are history the audit log already holds.
  await scope.tx
    .delete(invitations)
    .where(
      and(
        eq(invitations.tenantId, scope.tenantId),
        eq(invitations.roleId, role.id),
        or(isNotNull(invitations.acceptedAt), isNotNull(invitations.revokedAt)),
      ),
    );
  await scope.tx.delete(roles).where(and(eq(roles.tenantId, scope.tenantId), eq(roles.id, role.id)));
  await recordAudit(scope, {
    action: "role.deleted",
    targetType: "role",
    targetId: role.id,
    metadata: { name: role.name, before: effectivePermissions(role), after: [] },
  });
}
