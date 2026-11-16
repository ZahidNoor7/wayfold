import "server-only";
import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import { generateToken, hashToken } from "../auth/tokens";
import { assertWithinLimit } from "../billing/limits";
import { normaliseEmail, type TenantScope } from "../db/context";
import { invitations, memberships, roles, users } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { assertCanGrantRole, countSeats, findRole, lockTeam, parse, requireId, type TeamActor } from "./access";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid e-mail address."));

export const inviteMemberSchema = z.object({
  email: emailSchema,
  roleId: z.uuid("Choose a role."),
});
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(1).max(200),
  userId: z.uuid(),
  userEmail: z.string().trim().toLowerCase().min(1).max(254),
});
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;

export type InvitationStatus = "pending" | "expired" | "accepted" | "revoked";

export interface InvitationView {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  /** Null once the inviter has left the workspace. */
  invitedByName: string | null;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
}

/** The raw token exists only in this return value: e-mail it, never store it. */
export interface IssuedInvitation {
  invitationId: string;
  token: string;
  expiresAt: Date;
}

type InvitationRow = typeof invitations.$inferSelect;

function statusOf(row: Pick<InvitationRow, "acceptedAt" | "revokedAt" | "expiresAt">, now: Date): InvitationStatus {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return "revoked";
  return row.expiresAt.getTime() > now.getTime() ? "pending" : "expired";
}

async function findInvitation(scope: TenantScope, invitationId: string): Promise<InvitationRow> {
  requireId(invitationId, "Invitation");
  const [row] = await scope.tx
    .select()
    .from(invitations)
    .where(and(eq(invitations.tenantId, scope.tenantId), eq(invitations.id, invitationId)))
    .limit(1);
  if (!row) throw new NotFoundError("Invitation");
  return row;
}

async function assertNotActiveMember(scope: TenantScope, email: string): Promise<void> {
  const [member] = await scope.tx
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, scope.tenantId), eq(memberships.status, "active"), eq(users.email, email)))
    .limit(1);
  if (member) throw new ConflictError("That person is already a member of this workspace.", "already_member");
}

/**
 * Invites an e-mail address to the workspace. A pending invitation holds a
 * seat, so the plan limit counts active members plus pending invitations;
 * the team lock makes that count and the insert one atomic step.
 */
export async function inviteMember(scope: TenantScope, actor: TeamActor, raw: InviteMemberInput): Promise<IssuedInvitation> {
  const input = parse(inviteMemberSchema, raw);
  const now = new Date();
  await lockTeam(scope);

  const role = await findRole(scope, input.roleId);
  assertCanGrantRole(actor, role);
  await assertNotActiveMember(scope, input.email);

  const open = and(
    eq(invitations.tenantId, scope.tenantId),
    eq(invitations.email, input.email),
    isNull(invitations.acceptedAt),
    isNull(invitations.revokedAt),
  );
  const [pending] = await scope.tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(open, gt(invitations.expiresAt, now)))
    .limit(1);
  if (pending) throw new ConflictError("An invitation for that e-mail address is already pending.", "invitation_pending");

  // A lapsed invitation for the same address is superseded, so an address
  // never has two invitations that could both be brought back to life.
  await scope.tx
    .update(invitations)
    .set({ revokedAt: now })
    .where(and(open, lte(invitations.expiresAt, now)));

  const seats = await countSeats(scope, now);
  await assertWithinLimit(scope, "maxTeamMembers", seats.total);

  const token = generateToken();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const [created] = await scope.tx
    .insert(invitations)
    .values({
      tenantId: scope.tenantId,
      email: input.email,
      roleId: role.id,
      tokenHash: hashToken(token),
      invitedBy: actor.userId,
      expiresAt,
    })
    .returning({ id: invitations.id });
  const invitationId = created!.id;

  await recordAudit(scope, {
    action: "invitation.created",
    targetType: "invitation",
    targetId: invitationId,
    metadata: { email: input.email, roleId: role.id, role: role.name },
  });
  return { invitationId, token, expiresAt };
}

/** Every invitation of the workspace, newest first. Never includes the token hash. */
export async function listInvitations(scope: TenantScope): Promise<InvitationView[]> {
  const now = new Date();
  const rows = await scope.tx
    .select({
      id: invitations.id,
      email: invitations.email,
      roleId: invitations.roleId,
      roleName: roles.name,
      invitedByName: users.name,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .innerJoin(roles, and(eq(roles.tenantId, invitations.tenantId), eq(roles.id, invitations.roleId)))
    .leftJoin(users, eq(users.id, invitations.invitedBy))
    .where(eq(invitations.tenantId, scope.tenantId))
    .orderBy(desc(invitations.createdAt), desc(invitations.id));
  return rows.map(({ acceptedAt, revokedAt, ...row }) => ({
    ...row,
    status: statusOf({ acceptedAt, revokedAt, expiresAt: row.expiresAt }, now),
  }));
}

export async function revokeInvitation(scope: TenantScope, invitationId: string): Promise<void> {
  // Locked so a revoke and an accept of the same invitation cannot both win.
  await lockTeam(scope);
  const invitation = await findInvitation(scope, invitationId);
  if (invitation.acceptedAt) throw new ConflictError("This invitation has already been accepted.", "invitation_used");
  if (invitation.revokedAt) return;

  await scope.tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.tenantId, scope.tenantId), eq(invitations.id, invitation.id)));
  await recordAudit(scope, {
    action: "invitation.revoked",
    targetType: "invitation",
    targetId: invitation.id,
    metadata: { email: invitation.email, roleId: invitation.roleId },
  });
}

/**
 * Issues a fresh token and a fresh seven days. The old link stops working
 * because only the new hash is stored. An expired invitation no longer holds
 * a seat, so reviving one goes through the seat limit again.
 */
export async function resendInvitation(scope: TenantScope, actor: TeamActor, invitationId: string): Promise<IssuedInvitation> {
  const now = new Date();
  await lockTeam(scope);
  const invitation = await findInvitation(scope, invitationId);
  if (invitation.acceptedAt) throw new ConflictError("This invitation has already been accepted.", "invitation_used");
  if (invitation.revokedAt) throw new ConflictError("This invitation was revoked. Send a new one instead.", "invitation_revoked");

  // The role may have gained permissions since the invitation was first sent.
  assertCanGrantRole(actor, await findRole(scope, invitation.roleId));
  await assertNotActiveMember(scope, invitation.email);
  if (statusOf(invitation, now) === "expired") {
    const seats = await countSeats(scope, now);
    await assertWithinLimit(scope, "maxTeamMembers", seats.total);
  }

  const token = generateToken();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  await scope.tx
    .update(invitations)
    .set({ tokenHash: hashToken(token), expiresAt })
    .where(and(eq(invitations.tenantId, scope.tenantId), eq(invitations.id, invitation.id)));
  await recordAudit(scope, {
    action: "invitation.resent",
    targetType: "invitation",
    targetId: invitation.id,
    metadata: { email: invitation.email, roleId: invitation.roleId },
  });
  return { invitationId: invitation.id, token, expiresAt };
}

export interface AcceptedInvitation {
  membershipId: string;
  roleId: string;
  roleName: string;
}

/**
 * Turns an invitation into a membership. Runs inside the invitation's own
 * tenant: the caller resolves which tenant a token belongs to (a platform
 * lookup, because no tenant context exists before that) and opens the scope
 * with the accepting user as `userId`. A token presented in any other tenant
 * simply does not exist here.
 */
export async function acceptInvitation(scope: TenantScope, raw: AcceptInvitationInput): Promise<AcceptedInvitation> {
  const input = parse(acceptInvitationSchema, raw);
  const now = new Date();
  await lockTeam(scope);

  const [invitation] = await scope.tx
    .select()
    .from(invitations)
    .where(and(eq(invitations.tenantId, scope.tenantId), eq(invitations.tokenHash, hashToken(input.token))))
    .limit(1);
  if (!invitation) throw new NotFoundError("Invitation");
  if (invitation.revokedAt) throw new ConflictError("This invitation has been withdrawn.", "invitation_revoked");
  if (invitation.acceptedAt) throw new ConflictError("This invitation has already been used.", "invitation_used");
  if (invitation.expiresAt.getTime() <= now.getTime()) {
    throw new ConflictError("This invitation has expired. Ask for a new one.", "invitation_expired");
  }

  // The account itself is the authority on who is accepting, not the caller's
  // word: it must be readable in this transaction, active, and have proven it
  // owns the invited address.
  const [user] = await scope.tx
    .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt, status: users.status })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!user || user.status !== "active") throw new ForbiddenError("Sign in to accept this invitation.");
  const invited = normaliseEmail(invitation.email);
  if (normaliseEmail(user.email) !== invited || input.userEmail !== invited) {
    throw new ForbiddenError("This invitation was sent to a different e-mail address.");
  }
  if (!user.emailVerifiedAt) throw new ForbiddenError("Verify your e-mail address before accepting this invitation.");

  const role = await findRole(scope, invitation.roleId);
  const [existing] = await scope.tx
    .select({ id: memberships.id, status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.tenantId, scope.tenantId), eq(memberships.userId, input.userId)))
    .limit(1);
  if (existing?.status === "active") throw new ConflictError("You are already a member of this workspace.", "already_member");

  // This invitation is one of the seats counted, so it is taken out before
  // asking whether the new member fits. Still fails if the plan shrank.
  const seats = await countSeats(scope, now);
  await assertWithinLimit(scope, "maxTeamMembers", seats.total - 1);

  let membershipId: string;
  if (existing) {
    await scope.tx
      .update(memberships)
      .set({ status: "active", roleId: role.id })
      .where(and(eq(memberships.tenantId, scope.tenantId), eq(memberships.id, existing.id)));
    membershipId = existing.id;
  } else {
    const [created] = await scope.tx
      .insert(memberships)
      .values({ tenantId: scope.tenantId, userId: input.userId, roleId: role.id })
      .returning({ id: memberships.id });
    membershipId = created!.id;
  }

  await scope.tx
    .update(invitations)
    .set({ acceptedAt: now })
    .where(and(eq(invitations.tenantId, scope.tenantId), eq(invitations.id, invitation.id)));
  await recordAudit(scope, {
    action: "invitation.accepted",
    targetType: "invitation",
    targetId: invitation.id,
    metadata: { membershipId, userId: input.userId, roleId: role.id, role: role.name, reactivated: Boolean(existing) },
  });
  return { membershipId, roleId: role.id, roleName: role.name };
}
