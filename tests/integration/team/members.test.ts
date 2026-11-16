import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, LimitExceededError, NotFoundError } from "@/server/errors";
import { inviteMember, revokeInvitation } from "@/server/team/invitations";
import { changeMemberRole, deactivateMember, getMember, listMembers, reactivateMember, removeMember } from "@/server/team/members";
import { createTenant, randomId } from "../../helpers/fixtures";
import { addMember, auditTrail, customRole, inTenant, ownerActor, ownerMembershipId, systemRole } from "./helpers";

describe("listing members", () => {
  it("returns each member's name, e-mail, role, status and join date", async () => {
    const tenant = await createTenant();
    const staff = await addMember(tenant, "staff", { name: "Aysel Karimova" });
    const former = await addMember(tenant, "admin", { name: "Zaur Aliyev", status: "deactivated" });

    const members = await inTenant(tenant, (scope) => listMembers(scope));

    expect(members).toHaveLength(3);
    expect(members.find((member) => member.id === staff.membershipId)).toMatchObject({
      userId: staff.userId,
      name: "Aysel Karimova",
      email: staff.email,
      roleId: staff.roleId,
      roleName: "Staff",
      isOwner: false,
      status: "active",
    });
    expect(members.find((member) => member.id === staff.membershipId)!.joinedAt).toBeInstanceOf(Date);
    expect(members.find((member) => member.id === former.membershipId)).toMatchObject({ status: "deactivated", roleName: "Administrator" });
    expect(members.find((member) => member.userId === tenant.ownerId)).toMatchObject({ isOwner: true, roleName: "Owner" });
    // Sorted by name.
    expect(members.map((member) => member.name)).toEqual([...members.map((member) => member.name)].sort());
  });
});

describe("changing a member's role", () => {
  it("moves the member to the new role and records it", async () => {
    const tenant = await createTenant();
    const member = await addMember(tenant, "staff");
    const admin = await systemRole(tenant, "admin");

    const updated = await inTenant(tenant, (scope) => changeMemberRole(scope, ownerActor(tenant), member.membershipId, admin.id));

    expect(updated).toMatchObject({ id: member.membershipId, roleId: admin.id, roleName: "Administrator" });
    const entry = (await auditTrail(tenant)).find((row) => row.action === "member.role_changed");
    expect(entry).toMatchObject({
      targetId: member.membershipId,
      actorUserId: tenant.ownerId,
      metadata: { userId: member.userId, fromRoleId: member.roleId, toRoleId: admin.id, fromRole: "Staff", toRole: "Administrator" },
    });
  });

  it("does nothing when the member already has that role", async () => {
    const tenant = await createTenant();
    const member = await addMember(tenant, "staff");

    const same = await inTenant(tenant, (scope) => changeMemberRole(scope, ownerActor(tenant), member.membershipId, member.roleId));

    expect(same.roleId).toBe(member.roleId);
    expect((await auditTrail(tenant)).map((row) => row.action)).not.toContain("member.role_changed");
  });

  it("refuses to let a member change their own role", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const ownerMembership = await ownerMembershipId(tenant);

    await expect(inTenant(tenant, (scope) => changeMemberRole(scope, ownerActor(tenant), ownerMembership, staff.id))).rejects.toThrow(
      "You cannot change your own role.",
    );

    const admin = await addMember(tenant, "admin");
    await expect(
      inTenant(tenant, (scope) => changeMemberRole(scope, admin.actor, admin.membershipId, staff.id), admin.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await inTenant(tenant, (scope) => getMember(scope, admin.membershipId))).roleId).toBe(admin.roleId);
  });

  it("lets only an owner hand out the owner role", async () => {
    const tenant = await createTenant();
    const admin = await addMember(tenant, "admin");
    const target = await addMember(tenant, "staff");

    await expect(
      inTenant(tenant, (scope) => changeMemberRole(scope, admin.actor, target.membershipId, tenant.ownerRoleId), admin.userId),
    ).rejects.toThrow("Only an owner can assign or remove the Owner role.");

    // Even an actor who somehow holds every permission is not an owner.
    const allButOwner = { ...admin.actor, permissions: ownerActor(tenant).permissions };
    await expect(
      inTenant(tenant, (scope) => changeMemberRole(scope, allButOwner, target.membershipId, tenant.ownerRoleId), admin.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const promoted = await inTenant(tenant, (scope) => changeMemberRole(scope, ownerActor(tenant), target.membershipId, tenant.ownerRoleId));
    expect(promoted.isOwner).toBe(true);
  });

  it("lets only an owner take the owner role away", async () => {
    const tenant = await createTenant();
    const secondOwner = await addMember(tenant, "owner");
    const admin = await addMember(tenant, "admin");
    const staff = await systemRole(tenant, "staff");

    await expect(
      inTenant(tenant, (scope) => changeMemberRole(scope, admin.actor, secondOwner.membershipId, staff.id), admin.userId),
    ).rejects.toThrow("Only an owner can assign or remove the Owner role.");

    const demoted = await inTenant(tenant, (scope) => changeMemberRole(scope, ownerActor(tenant), secondOwner.membershipId, staff.id));
    expect(demoted).toMatchObject({ isOwner: false, roleName: "Staff" });
  });

  it("refuses a role that carries permissions the actor does not hold", async () => {
    const tenant = await createTenant();
    const teamLead = await addMember(tenant, await customRole(tenant, "Team lead", ["team.view", "team.manage", "tours.view", "bookings.view"]));
    const target = await addMember(tenant, "staff");
    const admin = await systemRole(tenant, "admin");
    const within = await customRole(tenant, "Tour reader", ["tours.view", "bookings.view"]);

    await expect(
      inTenant(tenant, (scope) => changeMemberRole(scope, teamLead.actor, target.membershipId, admin.id), teamLead.userId),
    ).rejects.toThrow("You cannot give someone a role with permissions you do not hold yourself.");
    expect((await inTenant(tenant, (scope) => getMember(scope, target.membershipId))).roleId).toBe(target.roleId);

    // A role entirely inside the actor's own permissions is fine.
    const moved = await inTenant(tenant, (scope) => changeMemberRole(scope, teamLead.actor, target.membershipId, within.id), teamLead.userId);
    expect(moved.roleId).toBe(within.id);
  });

  it("treats an unknown member or role as not found", async () => {
    const tenant = await createTenant();
    const member = await addMember(tenant, "staff");
    const actor = ownerActor(tenant);

    await expect(inTenant(tenant, (scope) => changeMemberRole(scope, actor, randomId(), member.roleId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(tenant, (scope) => changeMemberRole(scope, actor, member.membershipId, randomId()))).rejects.toThrow("Role not found.");
    await expect(inTenant(tenant, (scope) => changeMemberRole(scope, actor, "not-an-id", member.roleId))).rejects.toThrow("Member not found.");
    await expect(inTenant(tenant, (scope) => changeMemberRole(scope, actor, member.membershipId, "'; drop table roles;--"))).rejects.toThrow(
      "Role not found.",
    );
  });
});

describe("the last active owner", () => {
  it("cannot be demoted, deactivated or removed", async () => {
    const tenant = await createTenant();
    const second = await addMember(tenant, "owner");
    const staff = await systemRole(tenant, "staff");
    const firstOwnerMembership = await ownerMembershipId(tenant);

    // The first owner deactivates the second, leaving one active owner...
    await inTenant(tenant, (scope) => deactivateMember(scope, ownerActor(tenant), second.membershipId));

    // ...and the second, still holding a stale session, tries to take over.
    const stale = second.actor;
    for (const attempt of [
      () => inTenant(tenant, (scope) => changeMemberRole(scope, stale, firstOwnerMembership, staff.id)),
      () => inTenant(tenant, (scope) => deactivateMember(scope, stale, firstOwnerMembership)),
      () => inTenant(tenant, (scope) => removeMember(scope, stale, firstOwnerMembership)),
    ]) {
      const error = await attempt().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({ code: "last_owner" });
    }

    expect(await inTenant(tenant, (scope) => getMember(scope, firstOwnerMembership))).toMatchObject({ isOwner: true, status: "active" });
  });

  it("can step down once another active owner exists", async () => {
    const tenant = await createTenant();
    const second = await addMember(tenant, "owner");
    const staff = await systemRole(tenant, "staff");
    const firstOwnerMembership = await ownerMembershipId(tenant);

    const demoted = await inTenant(tenant, (scope) => changeMemberRole(scope, second.actor, firstOwnerMembership, staff.id), second.userId);
    expect(demoted.isOwner).toBe(false);

    // Now the second owner is the last one, and nobody can demote them.
    await expect(
      inTenant(tenant, (scope) => changeMemberRole(scope, { ...ownerActor(tenant) }, second.membershipId, staff.id)),
    ).rejects.toMatchObject({ code: "last_owner" });
  });

  it("does not count a deactivated owner as cover", async () => {
    const tenant = await createTenant();
    const dormant = await addMember(tenant, "owner", { status: "deactivated" });
    const third = await addMember(tenant, "owner");
    const firstOwnerMembership = await ownerMembershipId(tenant);

    await inTenant(tenant, (scope) => removeMember(scope, ownerActor(tenant), third.membershipId));
    await expect(inTenant(tenant, (scope) => deactivateMember(scope, dormant.actor, firstOwnerMembership))).rejects.toMatchObject({
      code: "last_owner",
    });

    // A deactivated owner is not "the last active owner", so it can be removed.
    await inTenant(tenant, (scope) => removeMember(scope, ownerActor(tenant), dormant.membershipId));
    expect(await inTenant(tenant, (scope) => listMembers(scope))).toHaveLength(1);
  });
});

describe("deactivating and reactivating", () => {
  it("deactivates a member, records it, and is harmless to repeat", async () => {
    const tenant = await createTenant();
    const member = await addMember(tenant, "staff");

    const first = await inTenant(tenant, (scope) => deactivateMember(scope, ownerActor(tenant), member.membershipId));
    const again = await inTenant(tenant, (scope) => deactivateMember(scope, ownerActor(tenant), member.membershipId));

    expect(first.status).toBe("deactivated");
    expect(again.status).toBe("deactivated");
    expect((await auditTrail(tenant)).filter((row) => row.action === "member.deactivated")).toHaveLength(1);
  });

  it("refuses to let a member deactivate themselves", async () => {
    const tenant = await createTenant();
    const admin = await addMember(tenant, "admin");

    await expect(inTenant(tenant, (scope) => deactivateMember(scope, admin.actor, admin.membershipId), admin.userId)).rejects.toThrow(
      "You cannot deactivate yourself.",
    );
    await expect(
      inTenant(tenant, async (scope) => deactivateMember(scope, ownerActor(tenant), await ownerMembershipId(tenant))),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets only an owner deactivate or remove an owner", async () => {
    const tenant = await createTenant();
    const secondOwner = await addMember(tenant, "owner");
    const admin = await addMember(tenant, "admin");

    await expect(inTenant(tenant, (scope) => deactivateMember(scope, admin.actor, secondOwner.membershipId), admin.userId)).rejects.toThrow(
      "Only an owner can assign or remove the Owner role.",
    );
    await expect(inTenant(tenant, (scope) => removeMember(scope, admin.actor, secondOwner.membershipId), admin.userId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await inTenant(tenant, (scope) => getMember(scope, secondOwner.membershipId))).status).toBe("active");
  });

  it("reactivates a member and records it", async () => {
    const tenant = await createTenant();
    const member = await addMember(tenant, "staff", { status: "deactivated" });

    const back = await inTenant(tenant, (scope) => reactivateMember(scope, ownerActor(tenant), member.membershipId));
    const again = await inTenant(tenant, (scope) => reactivateMember(scope, ownerActor(tenant), member.membershipId));

    expect(back.status).toBe("active");
    expect(again.status).toBe("active");
    expect((await auditTrail(tenant)).filter((row) => row.action === "member.reactivated")).toHaveLength(1);
  });

  it("re-checks the seat limit on reactivation, counting pending invitations", async () => {
    const tenant = await createTenant({ plan: { maxTeamMembers: 2 } });
    const member = await addMember(tenant, "staff");
    const staff = await systemRole(tenant, "staff");
    const actor = ownerActor(tenant);

    await inTenant(tenant, (scope) => deactivateMember(scope, actor, member.membershipId));
    // The freed seat is taken by an invitation.
    const invitation = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: "seat-taker@example.test", roleId: staff.id }));

    const blocked = await inTenant(tenant, (scope) => reactivateMember(scope, actor, member.membershipId)).catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(LimitExceededError);
    expect(blocked).toMatchObject({ limit: "maxTeamMembers", code: "plan_limit" });
    expect((await inTenant(tenant, (scope) => getMember(scope, member.membershipId))).status).toBe("deactivated");

    await inTenant(tenant, (scope) => revokeInvitation(scope, invitation.invitationId));
    expect((await inTenant(tenant, (scope) => reactivateMember(scope, actor, member.membershipId))).status).toBe("active");
  });

  it("refuses to reactivate someone into a role beyond the actor's own permissions", async () => {
    const tenant = await createTenant();
    const teamLead = await addMember(tenant, await customRole(tenant, "Team lead", ["team.view", "team.manage", "tours.view"]));
    const dormantAdmin = await addMember(tenant, "admin", { status: "deactivated" });
    const dormantOwner = await addMember(tenant, "owner", { status: "deactivated" });

    await expect(
      inTenant(tenant, (scope) => reactivateMember(scope, teamLead.actor, dormantAdmin.membershipId), teamLead.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      inTenant(tenant, (scope) => reactivateMember(scope, teamLead.actor, dormantOwner.membershipId), teamLead.userId),
    ).rejects.toThrow("Only an owner can assign or remove the Owner role.");
  });
});

describe("removing a member", () => {
  it("deletes the membership and records it", async () => {
    const tenant = await createTenant();
    const member = await addMember(tenant, "staff");

    await inTenant(tenant, (scope) => removeMember(scope, ownerActor(tenant), member.membershipId));

    expect((await inTenant(tenant, (scope) => listMembers(scope))).map((row) => row.id)).not.toContain(member.membershipId);
    await expect(inTenant(tenant, (scope) => getMember(scope, member.membershipId))).rejects.toBeInstanceOf(NotFoundError);
    expect((await auditTrail(tenant)).find((row) => row.action === "member.removed")).toMatchObject({
      targetId: member.membershipId,
      metadata: { userId: member.userId, role: "Staff" },
    });
  });

  it("refuses self-removal and unknown ids", async () => {
    const tenant = await createTenant();
    const admin = await addMember(tenant, "admin");

    await expect(inTenant(tenant, (scope) => removeMember(scope, admin.actor, admin.membershipId), admin.userId)).rejects.toThrow(
      "You cannot remove yourself from the workspace.",
    );
    await expect(inTenant(tenant, (scope) => removeMember(scope, ownerActor(tenant), randomId()))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(tenant, (scope) => deactivateMember(scope, ownerActor(tenant), randomId()))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(tenant, (scope) => reactivateMember(scope, ownerActor(tenant), randomId()))).rejects.toBeInstanceOf(NotFoundError);
  });
});
