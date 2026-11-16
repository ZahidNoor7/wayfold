"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import type { Workspace } from "@/server/auth/workspace";
import { NotFoundError } from "@/server/errors";
import { PLATFORM_LINKS, sendPlatformEmail, workspaceInvitationMessage } from "@/server/platform/mailer";
import type { TeamActor } from "@/server/team/access";
import { inviteMember, inviteMemberSchema, listInvitations, resendInvitation, revokeInvitation } from "@/server/team/invitations";
import { changeMemberRole, deactivateMember, reactivateMember, removeMember } from "@/server/team/members";
import { createRole, createRoleSchema, deleteRole, getRole, updateRole, updateRoleSchema } from "@/server/team/roles";

// The services answer "not found" for any id that is not this workspace's,
// so ids only need to be plausible strings here.
const id = z.string().min(1).max(64);

function actorOf(workspace: Workspace): TeamActor {
  return { userId: workspace.user.id, permissions: workspace.permissions, isOwner: workspace.isOwner };
}

/** Seats appear on the billing page too. */
function refresh(): void {
  revalidatePath("/workspace/team");
  revalidatePath("/workspace/billing");
}

/**
 * Queues the invitation e-mail for after the response. The token exists only
 * here and in the message: it is never returned to the browser.
 */
function sendInvitation(
  workspace: Workspace,
  afterCommit: (task: () => unknown) => void,
  invitation: { email: string; roleName: string; token: string; expiresAt: Date },
): void {
  const message = workspaceInvitationMessage({
    tenantName: workspace.tenant.name,
    roleName: invitation.roleName,
    inviterName: workspace.user.name,
    url: PLATFORM_LINKS.invitation(invitation.token),
    expiresAt: invitation.expiresAt,
  });
  // Only once the invitation row is committed: never e-mail a link that does not exist.
  afterCommit(() => sendPlatformEmail({ to: invitation.email, ...message }));
}

/* ----------------------------------------------------------------- members */

const memberSchema = z.object({ membershipId: id });

export const changeMemberRoleAction = workspaceAction(
  "team.manage",
  memberSchema.extend({ roleId: id }),
  async ({ workspace, scope, input }) => {
    const member = await changeMemberRole(scope, actorOf(workspace), input.membershipId, input.roleId);
    refresh();
    return { name: member.name, roleName: member.roleName };
  },
);

export const deactivateMemberAction = workspaceAction("team.manage", memberSchema, async ({ workspace, scope, input }) => {
  const member = await deactivateMember(scope, actorOf(workspace), input.membershipId);
  refresh();
  return { name: member.name };
});

export const reactivateMemberAction = workspaceAction("team.manage", memberSchema, async ({ workspace, scope, input }) => {
  const member = await reactivateMember(scope, actorOf(workspace), input.membershipId);
  refresh();
  return { name: member.name };
});

export const removeMemberAction = workspaceAction("team.manage", memberSchema, async ({ workspace, scope, input }) => {
  await removeMember(scope, actorOf(workspace), input.membershipId);
  refresh();
  return null;
});

/* ------------------------------------------------------------- invitations */

export const inviteMemberAction = workspaceAction("team.manage", inviteMemberSchema, async ({ workspace, scope, input, afterCommit }) => {
  const issued = await inviteMember(scope, actorOf(workspace), input);
  const role = await getRole(scope, input.roleId);
  sendInvitation(workspace, afterCommit, { email: input.email, roleName: role.name, token: issued.token, expiresAt: issued.expiresAt });
  refresh();
  return { email: input.email };
});

const invitationSchema = z.object({ invitationId: id });

export const resendInvitationAction = workspaceAction("team.manage", invitationSchema, async ({ workspace, scope, input, afterCommit }) => {
  const issued = await resendInvitation(scope, actorOf(workspace), input.invitationId);
  const invitation = (await listInvitations(scope)).find((item) => item.id === issued.invitationId);
  if (!invitation) throw new NotFoundError("Invitation");
  sendInvitation(workspace, afterCommit, { email: invitation.email, roleName: invitation.roleName, token: issued.token, expiresAt: issued.expiresAt });
  refresh();
  return { email: invitation.email };
});

export const revokeInvitationAction = workspaceAction("team.manage", invitationSchema, async ({ scope, input }) => {
  await revokeInvitation(scope, input.invitationId);
  refresh();
  return null;
});

/* ------------------------------------------------------------------- roles */

export const createRoleAction = workspaceAction("roles.manage", createRoleSchema, async ({ workspace, scope, input }) => {
  const role = await createRole(scope, actorOf(workspace), input);
  refresh();
  return { id: role.id, name: role.name };
});

export const updateRoleAction = workspaceAction("roles.manage", updateRoleSchema.extend({ roleId: id }), async ({ workspace, scope, input }) => {
  const { roleId, ...changes } = input;
  const role = await updateRole(scope, actorOf(workspace), roleId, changes);
  refresh();
  return { id: role.id, name: role.name };
});

export const deleteRoleAction = workspaceAction("roles.manage", z.object({ roleId: id }), async ({ scope, input }) => {
  const { name } = await getRole(scope, input.roleId);
  await deleteRole(scope, input.roleId);
  refresh();
  return { name };
});
