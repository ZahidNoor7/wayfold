import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { invitations, roles } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { ALL_PERMISSIONS, SYSTEM_ROLES } from "@/server/rbac/permissions";
import { inviteMember, revokeInvitation } from "@/server/team/invitations";
import { changeMemberRole } from "@/server/team/members";
import { createRole, deleteRole, getRole, listRoles, updateRole } from "@/server/team/roles";
import { createTenant, createUser, randomId, type TenantFixture } from "../../helpers/fixtures";
import { addMember, auditTrail, customRole, inTenant, ownerActor, systemRole } from "./helpers";

function storedPermissions(tenant: TenantFixture, roleId: string) {
  return inTenant(tenant, async ({ tx }) => {
    const [row] = await tx.select({ permissions: roles.permissions }).from(roles).where(eq(roles.id, roleId));
    return row?.permissions;
  });
}

describe("listing roles", () => {
  it("returns built-in roles in their usual order, then custom roles, with usage counts", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    await addMember(tenant, "staff");
    await addMember(tenant, "staff", { status: "deactivated" });
    await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: "list-roles@example.test", roleId: staff.id }));
    await inTenant(tenant, (scope) => createRole(scope, ownerActor(tenant), { name: "Zebra guide", permissions: ["tours.view"] }));
    await inTenant(tenant, (scope) => createRole(scope, ownerActor(tenant), { name: "Accountant", permissions: ["billing.view"] }));

    const list = await inTenant(tenant, (scope) => listRoles(scope));

    expect(list.map((role) => role.name)).toEqual([...SYSTEM_ROLES.map((role) => role.name), "Accountant", "Zebra guide"]);
    expect(list.find((role) => role.systemKey === "owner")).toMatchObject({ isSystem: true, memberCount: 1, permissions: ALL_PERMISSIONS });
    expect(list.find((role) => role.systemKey === "staff")).toMatchObject({ memberCount: 2, openInvitationCount: 1 });
    expect(list.find((role) => role.name === "Accountant")).toMatchObject({
      isSystem: false,
      systemKey: null,
      memberCount: 0,
      openInvitationCount: 0,
      permissions: ["billing.view"],
    });
  });
});

describe("creating a role", () => {
  it("stores a de-duplicated permission list and records it with before and after", async () => {
    const tenant = await createTenant();

    const role = await inTenant(tenant, (scope) =>
      createRole(scope, ownerActor(tenant), {
        name: "  Guide lead ",
        description: " Looks after guides ",
        permissions: ["tours.view", "tours.manage", "tours.view"],
      }),
    );

    expect(role).toMatchObject({
      name: "Guide lead",
      description: "Looks after guides",
      permissions: ["tours.view", "tours.manage"],
      isSystem: false,
      memberCount: 0,
    });
    expect(await inTenant(tenant, (scope) => getRole(scope, role.id))).toMatchObject({ id: role.id, name: "Guide lead" });
    expect((await auditTrail(tenant)).find((entry) => entry.action === "role.created")).toMatchObject({
      targetId: role.id,
      actorUserId: tenant.ownerId,
      metadata: { name: "Guide lead", before: [], after: ["tours.view", "tours.manage"] },
    });
  });

  it.each([["platform.admin"], ["*"], ["tours.*"], ["TOURS.VIEW"], [""]])("rejects the unknown permission %j", async (bogus) => {
    const tenant = await createTenant();

    const error = await inTenant(tenant, (scope) =>
      createRole(scope, ownerActor(tenant), { name: "Sneaky", permissions: ["tours.view", bogus] }),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors?.permissions?.[0]).toContain("Unknown permission");
    expect((await inTenant(tenant, (scope) => listRoles(scope))).map((role) => role.name)).not.toContain("Sneaky");
  });

  it("refuses a role with permissions the actor does not hold, so roles.manage cannot be used to escalate", async () => {
    const tenant = await createTenant();
    const roleEditor = await addMember(tenant, await customRole(tenant, "Role editor", ["roles.manage", "team.manage", "tours.view"]));

    for (const permissions of [["billing.manage"], ["tours.view", "support.manage"], [...ALL_PERMISSIONS]]) {
      await expect(
        inTenant(tenant, (scope) => createRole(scope, roleEditor.actor, { name: "Power grab", permissions }), roleEditor.userId),
      ).rejects.toThrow("A role cannot include permissions you do not hold yourself.");
    }
    expect((await inTenant(tenant, (scope) => listRoles(scope))).map((role) => role.name)).not.toContain("Power grab");

    // Within their own permissions it works, but it buys them nothing new.
    const allowed = await inTenant(tenant, (scope) => createRole(scope, roleEditor.actor, { name: "Tour reader", permissions: ["tours.view"] }), roleEditor.userId);
    expect(allowed.permissions).toEqual(["tours.view"]);
  });

  it("refuses a duplicate name, ignoring case, and validates the name", async () => {
    const tenant = await createTenant();
    const actor = ownerActor(tenant);
    await inTenant(tenant, (scope) => createRole(scope, actor, { name: "Dispatcher", permissions: [] }));

    await expect(inTenant(tenant, (scope) => createRole(scope, actor, { name: "dispatcher", permissions: [] }))).rejects.toMatchObject({
      code: "role_name_taken",
    });
    await expect(inTenant(tenant, (scope) => createRole(scope, actor, { name: "STAFF", permissions: [] }))).rejects.toBeInstanceOf(ConflictError);

    const tooShort = await inTenant(tenant, (scope) => createRole(scope, actor, { name: " x ", permissions: [] })).catch((error: unknown) => error);
    expect((tooShort as ValidationError).fieldErrors).toHaveProperty("name");
    const notAList = await inTenant(tenant, (scope) =>
      createRole(scope, actor, { name: "Valid name", permissions: "tours.view" as unknown as string[] }),
    ).catch((error: unknown) => error);
    expect((notAList as ValidationError).fieldErrors).toHaveProperty("permissions");
  });
});

describe("editing a role", () => {
  it("never changes the owner role", async () => {
    const tenant = await createTenant();
    const secondOwner = await addMember(tenant, "owner");

    for (const actor of [ownerActor(tenant), secondOwner.actor]) {
      await expect(inTenant(tenant, (scope) => updateRole(scope, actor, tenant.ownerRoleId, { permissions: ["tours.view"] }))).rejects.toThrow(
        "The Owner role cannot be changed.",
      );
    }
    expect(await storedPermissions(tenant, tenant.ownerRoleId)).toEqual(ALL_PERMISSIONS);
  });

  it("refuses to let anyone edit the role they hold themselves", async () => {
    const tenant = await createTenant();
    const roleEditor = await addMember(tenant, await customRole(tenant, "Role editor", ["roles.manage", "tours.view"]));

    await expect(
      inTenant(tenant, (scope) => updateRole(scope, roleEditor.actor, roleEditor.roleId, { permissions: ["roles.manage"] }), roleEditor.userId),
    ).rejects.toThrow("You cannot edit the role you hold yourself.");
    expect(await storedPermissions(tenant, roleEditor.roleId)).toEqual(["roles.manage", "tours.view"]);
  });

  it("changes a built-in role's permissions but not its name or description", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const actor = ownerActor(tenant);

    const updated = await inTenant(tenant, (scope) =>
      // Sending the unchanged name back, as a form would, is fine.
      updateRole(scope, actor, staff.id, { name: "Staff", permissions: ["tours.view", "bookings.view", "bookings.manage"] }),
    );
    expect(updated).toMatchObject({ name: "Staff", systemKey: "staff", permissions: ["tours.view", "bookings.view", "bookings.manage"] });

    const renamed = await inTenant(tenant, (scope) => updateRole(scope, actor, staff.id, { name: "Crew", description: "New words" })).catch(
      (error: unknown) => error,
    );
    expect(renamed).toBeInstanceOf(ValidationError);
    expect((renamed as ValidationError).fieldErrors).toEqual({
      name: ["Built-in roles cannot be renamed."],
      description: ["The description of a built-in role cannot be changed."],
    });
  });

  it("renames a custom role and records permission changes with before and after", async () => {
    const tenant = await createTenant();
    const actor = ownerActor(tenant);
    const role = await inTenant(tenant, (scope) => createRole(scope, actor, { name: "Guide", permissions: ["tours.view", "media.view"] }));
    await addMember(tenant, { id: role.id, permissions: role.permissions });

    const updated = await inTenant(tenant, (scope) =>
      updateRole(scope, actor, role.id, { name: "Senior guide", description: "Leads groups", permissions: ["tours.view", "tours.manage"] }),
    );

    expect(updated).toMatchObject({
      name: "Senior guide",
      description: "Leads groups",
      permissions: ["tours.view", "tours.manage"],
      memberCount: 1,
    });
    expect((await auditTrail(tenant)).find((entry) => entry.action === "role.updated")).toMatchObject({
      targetId: role.id,
      metadata: {
        name: "Senior guide",
        before: ["tours.view", "media.view"],
        after: ["tours.view", "tours.manage"],
        added: ["tours.manage"],
        removed: ["media.view"],
      },
    });

    // A name-only edit leaves the permissions alone.
    const again = await inTenant(tenant, (scope) => updateRole(scope, actor, role.id, { name: "Lead guide" }));
    expect(again).toMatchObject({ name: "Lead guide", description: "Leads groups", permissions: ["tours.view", "tours.manage"] });
    await expect(inTenant(tenant, (scope) => updateRole(scope, actor, role.id, { name: "administrator" }))).rejects.toMatchObject({
      code: "role_name_taken",
    });
  });

  it("refuses to add permissions the actor does not hold, or ones outside the catalogue", async () => {
    const tenant = await createTenant();
    const roleEditor = await addMember(tenant, await customRole(tenant, "Role editor", ["roles.manage", "team.manage", "tours.view"]));
    const target = await customRole(tenant, "Helper", ["tours.view"]);

    await expect(
      inTenant(tenant, (scope) => updateRole(scope, roleEditor.actor, target.id, { permissions: ["tours.view", "billing.manage"] }), roleEditor.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      inTenant(tenant, (scope) => updateRole(scope, roleEditor.actor, target.id, { permissions: ["platform.admin"] }), roleEditor.userId),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      inTenant(tenant, (scope) => updateRole(scope, ownerActor(tenant), target.id, { permissions: ["*"] })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await storedPermissions(tenant, target.id)).toEqual(["tours.view"]);
  });

  it("cannot be combined with a role change to escalate through a second role", async () => {
    const tenant = await createTenant();
    const roleEditor = await addMember(tenant, await customRole(tenant, "Role editor", ["roles.manage", "team.manage", "tours.view"]));
    const accomplice = await addMember(tenant, "staff");
    const admin = await systemRole(tenant, "admin");

    // Cannot widen another role and cannot move anyone into a wider one.
    await expect(
      inTenant(tenant, (scope) => updateRole(scope, roleEditor.actor, accomplice.roleId, { permissions: [...ALL_PERMISSIONS] }), roleEditor.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      inTenant(tenant, (scope) => changeMemberRole(scope, roleEditor.actor, accomplice.membershipId, admin.id), roleEditor.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("treats an unknown role as not found", async () => {
    const tenant = await createTenant();
    await expect(inTenant(tenant, (scope) => updateRole(scope, ownerActor(tenant), randomId(), { name: "Ghost" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(inTenant(tenant, (scope) => getRole(scope, "nope"))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleting a role", () => {
  it("refuses to delete any built-in role", async () => {
    const tenant = await createTenant();
    for (const key of ["owner", "admin", "staff"] as const) {
      const role = await systemRole(tenant, key);
      await expect(inTenant(tenant, (scope) => deleteRole(scope, role.id))).rejects.toThrow("Built-in roles cannot be deleted.");
    }
    expect(await inTenant(tenant, (scope) => listRoles(scope))).toHaveLength(SYSTEM_ROLES.length);
  });

  it("is blocked while a member holds the role, even a deactivated one", async () => {
    const tenant = await createTenant();
    const role = await customRole(tenant, "Seasonal", ["tours.view"]);
    const member = await addMember(tenant, role, { status: "deactivated" });
    const staff = await systemRole(tenant, "staff");

    await expect(inTenant(tenant, (scope) => deleteRole(scope, role.id))).rejects.toMatchObject({ code: "role_in_use" });

    await inTenant(tenant, (scope) => changeMemberRole(scope, ownerActor(tenant), member.membershipId, staff.id));
    await inTenant(tenant, (scope) => deleteRole(scope, role.id));
    await expect(inTenant(tenant, (scope) => getRole(scope, role.id))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is blocked while an invitation would grant the role, then succeeds and records the removed permissions", async () => {
    const tenant = await createTenant();
    const role = await customRole(tenant, "Temp", ["tours.view", "media.view"]);
    const user = await createUser();
    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: user.email, roleId: role.id }));

    const blocked = await inTenant(tenant, (scope) => deleteRole(scope, role.id)).catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(ConflictError);
    expect(blocked).toMatchObject({ code: "role_in_use" });

    await inTenant(tenant, (scope) => revokeInvitation(scope, issued.invitationId));
    await inTenant(tenant, (scope) => deleteRole(scope, role.id));

    expect((await inTenant(tenant, (scope) => listRoles(scope))).map((entry) => entry.id)).not.toContain(role.id);
    // The revoked invitation went with the role it pointed at.
    expect(await inTenant(tenant, ({ tx }) => tx.select().from(invitations).where(eq(invitations.id, issued.invitationId)))).toEqual([]);
    expect((await auditTrail(tenant)).find((entry) => entry.action === "role.deleted")).toMatchObject({
      targetId: role.id,
      metadata: { name: "Temp", before: ["tours.view", "media.view"], after: [] },
    });
  });

  it("treats an unknown role as not found", async () => {
    const tenant = await createTenant();
    await expect(inTenant(tenant, (scope) => deleteRole(scope, randomId()))).rejects.toBeInstanceOf(NotFoundError);
  });
});
