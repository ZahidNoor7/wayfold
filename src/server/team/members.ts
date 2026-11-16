import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { recordAudit } from "../audit";
import { assertWithinLimit } from "../billing/limits";
import type { TenantScope } from "../db/context";
import { memberships, roles, users } from "../db/schema";
import { ForbiddenError, NotFoundError } from "../errors";
import {
  assertAnotherOwnerRemains,
  assertCanGrantRole,
  countSeats,
  findRole,
  lockTeam,
  OWNER_ONLY,
  requireId,
  type TeamActor,
} from "./access";

export interface MemberView {
  /** Membership id: the handle every member operation takes. */
  id: string;
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  isOwner: boolean;
  status: "active" | "deactivated";
  joinedAt: Date;
}

const memberColumns = {
  id: memberships.id,
  userId: memberships.userId,
  name: users.name,
  email: users.email,
  roleId: roles.id,
  roleName: roles.name,
  roleSystemKey: roles.systemKey,
  status: memberships.status,
  joinedAt: memberships.createdAt,
};

interface MemberRow extends Omit<MemberView, "isOwner"> {
  roleSystemKey: string | null;
}

function toView({ roleSystemKey, ...row }: MemberRow): MemberView {
  return { ...row, isOwner: roleSystemKey === "owner" };
}

export async function listMembers(scope: TenantScope): Promise<MemberView[]> {
  const rows = await scope.tx
    .select(memberColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, and(eq(roles.tenantId, memberships.tenantId), eq(roles.id, memberships.roleId)))
    .where(eq(memberships.tenantId, scope.tenantId))
    .orderBy(asc(users.name), asc(memberships.createdAt));
  return rows.map(toView);
}

export async function getMember(scope: TenantScope, membershipId: string): Promise<MemberView> {
  requireId(membershipId, "Member");
  const [row] = await scope.tx
    .select(memberColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, and(eq(roles.tenantId, memberships.tenantId), eq(roles.id, memberships.roleId)))
    .where(and(eq(memberships.tenantId, scope.tenantId), eq(memberships.id, membershipId)))
    .limit(1);
  if (!row) throw new NotFoundError("Member");
  return toView(row);
}

function memberFilter(scope: TenantScope, membershipId: string) {
  return and(eq(memberships.tenantId, scope.tenantId), eq(memberships.id, membershipId));
}

export async function changeMemberRole(scope: TenantScope, actor: TeamActor, membershipId: string, roleId: string): Promise<MemberView> {
  await lockTeam(scope);
  const member = await getMember(scope, membershipId);
  if (member.userId === actor.userId) throw new ForbiddenError("You cannot change your own role.");

  const next = await findRole(scope, roleId);
  if (next.id === member.roleId) return member;

  // Taking the owner role away is as sensitive as handing it out.
  if (member.isOwner && !actor.isOwner) throw new ForbiddenError(OWNER_ONLY);
  assertCanGrantRole(actor, next);
  if (member.isOwner && member.status === "active") await assertAnotherOwnerRemains(scope, member.id);

  await scope.tx.update(memberships).set({ roleId: next.id }).where(memberFilter(scope, member.id));
  await recordAudit(scope, {
    action: "member.role_changed",
    targetType: "membership",
    targetId: member.id,
    metadata: { userId: member.userId, fromRoleId: member.roleId, fromRole: member.roleName, toRoleId: next.id, toRole: next.name },
  });
  return getMember(scope, member.id);
}

export async function deactivateMember(scope: TenantScope, actor: TeamActor, membershipId: string): Promise<MemberView> {
  await lockTeam(scope);
  const member = await getMember(scope, membershipId);
  if (member.userId === actor.userId) throw new ForbiddenError("You cannot deactivate yourself.");
  if (member.status === "deactivated") return member;

  if (member.isOwner) {
    if (!actor.isOwner) throw new ForbiddenError(OWNER_ONLY);
    await assertAnotherOwnerRemains(scope, member.id);
  }

  await scope.tx.update(memberships).set({ status: "deactivated" }).where(memberFilter(scope, member.id));
  await recordAudit(scope, {
    action: "member.deactivated",
    targetType: "membership",
    targetId: member.id,
    metadata: { userId: member.userId, roleId: member.roleId, role: member.roleName },
  });
  return getMember(scope, member.id);
}

/**
 * Brings a deactivated member back. This hands their role out again and
 * takes a seat, so both the "no more than you hold" rule and the plan's seat
 * limit are checked afresh: the plan or the role may have changed meanwhile.
 */
export async function reactivateMember(scope: TenantScope, actor: TeamActor, membershipId: string): Promise<MemberView> {
  await lockTeam(scope);
  const member = await getMember(scope, membershipId);
  if (member.status === "active") return member;

  assertCanGrantRole(actor, await findRole(scope, member.roleId));
  const seats = await countSeats(scope, new Date());
  await assertWithinLimit(scope, "maxTeamMembers", seats.total);

  await scope.tx.update(memberships).set({ status: "active" }).where(memberFilter(scope, member.id));
  await recordAudit(scope, {
    action: "member.reactivated",
    targetType: "membership",
    targetId: member.id,
    metadata: { userId: member.userId, roleId: member.roleId, role: member.roleName },
  });
  return getMember(scope, member.id);
}

export async function removeMember(scope: TenantScope, actor: TeamActor, membershipId: string): Promise<void> {
  await lockTeam(scope);
  const member = await getMember(scope, membershipId);
  if (member.userId === actor.userId) throw new ForbiddenError("You cannot remove yourself from the workspace.");

  if (member.isOwner) {
    if (!actor.isOwner) throw new ForbiddenError(OWNER_ONLY);
    if (member.status === "active") await assertAnotherOwnerRemains(scope, member.id);
  }

  await scope.tx.delete(memberships).where(memberFilter(scope, member.id));
  await recordAudit(scope, {
    action: "member.removed",
    targetType: "membership",
    targetId: member.id,
    metadata: { userId: member.userId, roleId: member.roleId, role: member.roleName },
  });
}
