import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/server/db/context";
import { invitations, memberships, roles } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import {
  acceptInvitation,
  inviteMember,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from "@/server/team/invitations";
import { changeMemberRole, deactivateMember, getMember, listMembers, reactivateMember, removeMember } from "@/server/team/members";
import { createRole, deleteRole, getRole, listRoles, updateRole } from "@/server/team/roles";
import { createTenant, createUser, type TenantFixture } from "../helpers/fixtures";
import { addMember, auditTrail, customRole, inTenant, ownerActor, systemRole } from "../integration/team/helpers";

/** Everything tenant A's team consists of, read with the platform connection so nothing can hide a change. */
function snapshot(tenant: TenantFixture) {
  return withPlatform(async (tx) => ({
    members: await tx.select().from(memberships).where(eq(memberships.tenantId, tenant.tenantId)).orderBy(memberships.id),
    roles: await tx.select().from(roles).where(eq(roles.tenantId, tenant.tenantId)).orderBy(roles.id),
    invitations: await tx.select().from(invitations).where(eq(invitations.tenantId, tenant.tenantId)).orderBy(invitations.id),
  }));
}

describe("team isolation: members", () => {
  it("lists only the workspace's own members", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const inA = await addMember(a, "staff", { name: "Member of A" });

    const seenByB = await inTenant(b, (scope) => listMembers(scope));

    expect(seenByB.map((member) => member.userId)).toEqual([b.ownerId]);
    expect(JSON.stringify(seenByB)).not.toContain(inA.email);
    expect(JSON.stringify(seenByB)).not.toContain(a.ownerEmail);
  });

  it("cannot read, change, deactivate, reactivate or remove another workspace's member", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const active = await addMember(a, "staff");
    const dormant = await addMember(a, "staff", { status: "deactivated" });
    const staffOfB = await systemRole(b, "staff");
    const actor = ownerActor(b);
    const before = await snapshot(a);

    const attempts = [
      () => inTenant(b, (scope) => getMember(scope, active.membershipId)),
      () => inTenant(b, (scope) => changeMemberRole(scope, actor, active.membershipId, staffOfB.id)),
      () => inTenant(b, (scope) => deactivateMember(scope, actor, active.membershipId)),
      () => inTenant(b, (scope) => reactivateMember(scope, actor, dormant.membershipId)),
      () => inTenant(b, (scope) => removeMember(scope, actor, active.membershipId)),
    ];
    for (const attempt of attempts) {
      const error = await attempt().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).message).toBe("Member not found.");
    }

    expect(await snapshot(a)).toEqual(before);
    expect(await auditTrail(b)).toEqual([]);
  });

  it("cannot give one of its own members a role that belongs to another workspace", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const memberOfB = await addMember(b, "staff");
    const adminOfA = await systemRole(a, "admin");

    for (const foreignRole of [adminOfA.id, a.ownerRoleId]) {
      await expect(inTenant(b, (scope) => changeMemberRole(scope, ownerActor(b), memberOfB.membershipId, foreignRole))).rejects.toThrow(
        "Role not found.",
      );
    }
    expect((await inTenant(b, (scope) => getMember(scope, memberOfB.membershipId))).roleId).toBe(memberOfB.roleId);

    // Underneath the service, the composite foreign key refuses the same thing.
    const direct = await inTenant(b, ({ tx }) =>
      tx.update(memberships).set({ roleId: adminOfA.id }).where(eq(memberships.id, memberOfB.membershipId)),
    ).catch((error: { code?: string; cause?: { code?: string } }) => error.code ?? error.cause?.code);
    expect(direct).toBe("23503");
  });

  it("does not let an owner of one workspace act as an owner of another", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const second = await addMember(a, "owner");
    const before = await snapshot(a);

    // B's owner presents a perfectly valid owner actor, but inside B's scope A's rows do not exist.
    await expect(inTenant(b, (scope) => removeMember(scope, ownerActor(b), second.membershipId))).rejects.toBeInstanceOf(NotFoundError);
    // And A's own scope cannot be opened by naming A in input: the tenant comes from the scope alone.
    expect(await inTenant(b, (scope) => listMembers(scope))).toHaveLength(1);
    expect(await snapshot(a)).toEqual(before);
  });
});

describe("team isolation: roles", () => {
  it("lists only the workspace's own roles", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const secret = await customRole(a, "Secret project lead", ["tours.view"]);

    const seenByB = await inTenant(b, (scope) => listRoles(scope));

    expect(seenByB.map((role) => role.id)).not.toContain(secret.id);
    expect(seenByB.map((role) => role.name)).not.toContain("Secret project lead");
    expect(seenByB.find((role) => role.systemKey === "owner")?.id).toBe(b.ownerRoleId);
    // Counts are B's own: A's members never inflate them.
    await addMember(a, "staff");
    await addMember(a, "staff");
    expect((await inTenant(b, (scope) => listRoles(scope))).find((role) => role.systemKey === "staff")?.memberCount).toBe(0);
  });

  it("cannot read, edit or delete another workspace's role", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const custom = await customRole(a, "Guide", ["tours.view"]);
    const staffOfA = await systemRole(a, "staff");
    const actor = ownerActor(b);
    const before = await snapshot(a);

    const attempts = [
      () => inTenant(b, (scope) => getRole(scope, custom.id)),
      () => inTenant(b, (scope) => updateRole(scope, actor, custom.id, { name: "Hijacked", permissions: [] })),
      () => inTenant(b, (scope) => updateRole(scope, actor, staffOfA.id, { permissions: ["billing.manage"] })),
      () => inTenant(b, (scope) => deleteRole(scope, custom.id)),
    ];
    for (const attempt of attempts) {
      const error = await attempt().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).message).toBe("Role not found.");
    }

    expect(await snapshot(a)).toEqual(before);
  });

  it("keeps role names independent between workspaces", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await inTenant(a, (scope) => createRole(scope, ownerActor(a), { name: "Dispatcher", permissions: ["bookings.view"] }));

    // The same name is free in B, and creating it there lands in B.
    const created = await inTenant(b, (scope) => createRole(scope, ownerActor(b), { name: "Dispatcher", permissions: ["tours.view"] }));

    const [stored] = await withPlatform((tx) => tx.select({ tenantId: roles.tenantId }).from(roles).where(eq(roles.id, created.id)));
    expect(stored).toEqual({ tenantId: b.tenantId });
    expect((await inTenant(a, (scope) => listRoles(scope))).find((role) => role.name === "Dispatcher")?.permissions).toEqual(["bookings.view"]);
  });
});

describe("team isolation: invitations", () => {
  it("lists only the workspace's own invitations", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const staffOfA = await systemRole(a, "staff");
    await inTenant(a, (scope) => inviteMember(scope, ownerActor(a), { email: "private-invitee@example.test", roleId: staffOfA.id }));

    const seenByB = await inTenant(b, (scope) => listInvitations(scope));

    expect(seenByB).toEqual([]);
  });

  it("cannot revoke or resend another workspace's invitation", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const staffOfA = await systemRole(a, "staff");
    const issued = await inTenant(a, (scope) => inviteMember(scope, ownerActor(a), { email: "keep-out@example.test", roleId: staffOfA.id }));
    const before = await snapshot(a);

    await expect(inTenant(b, (scope) => revokeInvitation(scope, issued.invitationId))).rejects.toThrow("Invitation not found.");
    await expect(inTenant(b, (scope) => resendInvitation(scope, ownerActor(b), issued.invitationId))).rejects.toBeInstanceOf(NotFoundError);

    expect(await snapshot(a)).toEqual(before);
  });

  it("cannot invite someone into a role of another workspace", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const adminOfA = await systemRole(a, "admin");

    await expect(
      inTenant(b, (scope) => inviteMember(scope, ownerActor(b), { email: "cross-role@example.test", roleId: adminOfA.id })),
    ).rejects.toThrow("Role not found.");
    expect(await inTenant(b, (scope) => listInvitations(scope))).toEqual([]);
    expect((await snapshot(a)).invitations).toEqual([]);
  });

  it("does not accept a workspace's invitation token inside another workspace", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const staffOfA = await systemRole(a, "staff");
    const user = await createUser();
    const issued = await inTenant(a, (scope) => inviteMember(scope, ownerActor(a), { email: user.email, roleId: staffOfA.id }));

    // The right user with the right token, but in the wrong tenant.
    const misdirected = await withTenant(
      b.tenantId,
      (scope) => acceptInvitation(scope, { token: issued.token, userId: user.id, userEmail: user.email }),
      { userId: user.id },
    ).catch((error: unknown) => error);

    expect(misdirected).toBeInstanceOf(NotFoundError);
    expect((await inTenant(b, (scope) => listMembers(scope))).map((member) => member.userId)).toEqual([b.ownerId]);
    expect((await snapshot(a)).invitations[0]?.acceptedAt).toBeNull();

    // The token is untouched and still works where it belongs.
    const accepted = await withTenant(
      a.tenantId,
      (scope) => acceptInvitation(scope, { token: issued.token, userId: user.id, userEmail: user.email }),
      { userId: user.id },
    );
    expect(accepted.roleId).toBe(staffOfA.id);
    expect((await snapshot(b)).members).toHaveLength(1);
  });

  it("counts seats per workspace, so one workspace's team never uses another's allowance", async () => {
    const a = await createTenant({ plan: { maxTeamMembers: 2 } });
    const b = await createTenant({ plan: { maxTeamMembers: 2 } });
    const staffOfA = await systemRole(a, "staff");
    const staffOfB = await systemRole(b, "staff");
    // A is full.
    await inTenant(a, (scope) => inviteMember(scope, ownerActor(a), { email: "fills-a@example.test", roleId: staffOfA.id }));

    // B still has its own free seat, and may even invite the same address.
    const inB = await inTenant(b, (scope) => inviteMember(scope, ownerActor(b), { email: "fills-a@example.test", roleId: staffOfB.id }));

    expect(inB.invitationId).toBeTruthy();
    expect(await inTenant(a, (scope) => listInvitations(scope))).toHaveLength(1);
    expect(await inTenant(b, (scope) => listInvitations(scope))).toHaveLength(1);
  });

  it("treats a member of another workspace as a stranger when inviting", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const staffOfB = await systemRole(b, "staff");

    // A's owner is an active member of A only; B may invite that address.
    const issued = await inTenant(b, (scope) => inviteMember(scope, ownerActor(b), { email: a.ownerEmail, roleId: staffOfB.id }));
    const accepted = await withTenant(
      b.tenantId,
      (scope) => acceptInvitation(scope, { token: issued.token, userId: a.ownerId, userEmail: a.ownerEmail }),
      { userId: a.ownerId },
    );

    expect(accepted.roleName).toBe("Staff");
    // Joining B as staff changes nothing about their standing in A.
    expect((await inTenant(a, (scope) => listMembers(scope))).find((member) => member.userId === a.ownerId)).toMatchObject({ isOwner: true });
    expect((await inTenant(b, (scope) => listMembers(scope))).find((member) => member.userId === a.ownerId)).toMatchObject({ isOwner: false });
  });
});
