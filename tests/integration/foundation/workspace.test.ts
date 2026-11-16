import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createSession, validateSessionToken } from "@/server/auth/sessions";
import {
  assertCan,
  can,
  getPlatformRole,
  inWorkspace,
  isActiveMember,
  listWorkspaces,
  resolveWorkspace,
  SUPPORT_PERMISSIONS,
  type Workspace,
} from "@/server/auth/workspace";
import { withTenant } from "@/server/db/context";
import { memberships, roles, supportAccessGrants, tenants } from "@/server/db/schema";
import { ForbiddenError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { ALL_PERMISSIONS, SYSTEM_ROLES } from "@/server/rbac/permissions";
import { createTenant, createUser, randomId } from "../../helpers/fixtures";
import { addMember, createGrant, createPlatformAdmin, sessionFor } from "./support";

const owner = (t: { ownerId: string; ownerEmail: string }) => ({ id: t.ownerId, email: t.ownerEmail });
const permissionsOf = (key: string) => SYSTEM_ROLES.find((role) => role.key === key)!.permissions;

function setMembership(tenantId: string, userId: string, status: "active" | "deactivated") {
  return withPlatform((tx) =>
    tx
      .update(memberships)
      .set({ status })
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId))),
  );
}

function suspend(tenantId: string) {
  return withPlatform((tx) => tx.update(tenants).set({ status: "suspended", suspendedReason: "Unpaid invoice" }).where(eq(tenants.id, tenantId)));
}

/** Unwraps a successful resolution, failing the test otherwise. */
async function workspaceOf(session: Parameters<typeof resolveWorkspace>[0]): Promise<Workspace> {
  const resolution = await resolveWorkspace(session);
  if (!resolution.ok) throw new Error(`Expected a workspace, got ${resolution.reason}`);
  return resolution.workspace;
}

describe("resolveWorkspace: members", () => {
  it("gives the owner every permission", async () => {
    const a = await createTenant({ name: "Caspian Trails" });
    const session = sessionFor(owner(a), a.tenantId);

    const workspace = await workspaceOf(session);
    expect(workspace).toMatchObject({
      tenantId: a.tenantId,
      tenant: { id: a.tenantId, slug: a.slug, name: "Caspian Trails", status: "active", currency: "USD", timezone: "UTC", onboardingCompleted: false },
      user: session.user,
      sessionId: session.id,
      roleName: "Owner",
      isOwner: true,
      support: null,
    });
    expect(workspace.permissions).toEqual(ALL_PERMISSIONS);
    expect(workspace.tenant.branding).toMatchObject({ theme: "emerald" });
  });

  it("gives the owner every permission even if the stored role list is stale or emptied", async () => {
    const a = await createTenant();
    await withPlatform((tx) => tx.update(roles).set({ permissions: ["tours.view"] }).where(eq(roles.id, a.ownerRoleId)));
    const workspace = await workspaceOf(sessionFor(owner(a), a.tenantId));
    expect(workspace.permissions).toEqual(ALL_PERMISSIONS);
  });

  it.each(["admin", "tour_manager", "booking_manager", "content_manager", "staff"] as const)(
    "gives a %s member exactly that role's permissions",
    async (key) => {
      const a = await createTenant();
      const member = await createUser();
      await addMember(a.tenantId, member.id, key);

      const workspace = await workspaceOf(sessionFor(member, a.tenantId));
      expect(workspace.isOwner).toBe(false);
      expect(workspace.roleName).toBe(SYSTEM_ROLES.find((role) => role.key === key)!.name);
      expect([...workspace.permissions].sort()).toEqual([...permissionsOf(key)].sort());
      expect(workspace.permissions).not.toContain("support.manage");
    },
  );

  it("drops stored permission strings that are not in the catalogue", async () => {
    const a = await createTenant();
    const member = await createUser();
    const [role] = await withTenant(a.tenantId, ({ tx }) =>
      tx
        .insert(roles)
        .values({ name: "Tampered", permissions: ["tours.view", "platform.admin", "*", "billing.manage ", "bookings.view"] })
        .returning({ id: roles.id }),
    );
    await addMember(a.tenantId, member.id, { roleId: role!.id });

    const workspace = await workspaceOf(sessionFor(member, a.tenantId));
    expect(workspace.roleName).toBe("Tampered");
    expect(workspace.permissions).toEqual(["tours.view", "bookings.view"]);
  });

  it("reports completed onboarding", async () => {
    const a = await createTenant();
    await withTenant(a.tenantId, ({ tx }) => tx.update(tenants).set({ onboardingCompletedAt: new Date() }).where(eq(tenants.id, a.tenantId)));
    expect((await workspaceOf(sessionFor(owner(a), a.tenantId))).tenant.onboardingCompleted).toBe(true);
  });

  it("works for a session loaded from the database", async () => {
    const a = await createTenant();
    const { token } = await createSession(a.ownerId, {}, { activeTenantId: a.tenantId });
    const session = await validateSessionToken(token);
    const workspace = await workspaceOf(session!);
    expect(workspace).toMatchObject({ tenantId: a.tenantId, isOwner: true, sessionId: session!.id });
  });
});

describe("resolveWorkspace: refusals", () => {
  it("needs an active tenant on the session", async () => {
    const a = await createTenant();
    expect(await resolveWorkspace(sessionFor(owner(a), null))).toEqual({ ok: false, reason: "no_active_tenant" });
  });

  it("refuses someone who is not a member", async () => {
    const a = await createTenant();
    const stranger = await createUser();
    expect(await resolveWorkspace(sessionFor(stranger, a.tenantId))).toEqual({ ok: false, reason: "not_a_member" });
  });

  it("refuses a deactivated member, and restores access on reactivation", async () => {
    const a = await createTenant();
    const member = await createUser();
    await addMember(a.tenantId, member.id, "admin");
    const session = sessionFor(member, a.tenantId);
    expect((await resolveWorkspace(session)).ok).toBe(true);

    await setMembership(a.tenantId, member.id, "deactivated");
    expect(await resolveWorkspace(session)).toEqual({ ok: false, reason: "not_a_member" });

    await setMembership(a.tenantId, member.id, "active");
    expect((await resolveWorkspace(session)).ok).toBe(true);
  });

  it("refuses a deactivated owner too", async () => {
    const a = await createTenant();
    await setMembership(a.tenantId, a.ownerId, "deactivated");
    expect(await resolveWorkspace(sessionFor(owner(a), a.tenantId))).toEqual({ ok: false, reason: "not_a_member" });
  });

  it("refuses a removed member on the very next request", async () => {
    const a = await createTenant();
    const member = await createUser();
    await addMember(a.tenantId, member.id, "staff");
    const session = sessionFor(member, a.tenantId);
    expect((await resolveWorkspace(session)).ok).toBe(true);

    await withPlatform((tx) => tx.delete(memberships).where(and(eq(memberships.tenantId, a.tenantId), eq(memberships.userId, member.id))));
    expect(await resolveWorkspace(session)).toEqual({ ok: false, reason: "not_a_member" });
  });

  it("reports a suspended workspace to its members only", async () => {
    const a = await createTenant();
    const stranger = await createUser();
    await suspend(a.tenantId);

    expect(await resolveWorkspace(sessionFor(owner(a), a.tenantId))).toEqual({ ok: false, reason: "suspended" });
    // A non-member learns nothing about the workspace's state.
    expect(await resolveWorkspace(sessionFor(stranger, a.tenantId))).toEqual({ ok: false, reason: "not_a_member" });
  });

  it("refuses a tenant id that does not exist", async () => {
    const a = await createTenant();
    expect(await resolveWorkspace(sessionFor(owner(a), randomId()))).toEqual({ ok: false, reason: "not_a_member" });
  });

  it("refuses a malformed tenant id outright", async () => {
    const a = await createTenant();
    await expect(resolveWorkspace(sessionFor(owner(a), "not-a-uuid"))).rejects.toThrow("Invalid database context");
  });
});

describe("resolveWorkspace: support sessions", () => {
  it("lets a platform admin in under an approved, unexpired grant with view-only permissions", async () => {
    const a = await createTenant();
    const admin = await createPlatformAdmin("support");
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id, expiresAt });

    const workspace = await workspaceOf(sessionFor(admin, a.tenantId, { supportGrantId: grantId }));

    expect(workspace).toMatchObject({ tenantId: a.tenantId, roleName: "Wayfold Support", isOwner: false });
    expect(workspace.support).toEqual({ grantId, expiresAt });
    expect(workspace.permissions).toEqual(SUPPORT_PERMISSIONS);
  });

  it("defines support permissions as look-but-not-touch, without billing", () => {
    expect(SUPPORT_PERMISSIONS.length).toBeGreaterThan(5);
    for (const permission of SUPPORT_PERMISSIONS) expect(permission).toMatch(/\.view$/);
    expect(SUPPORT_PERMISSIONS).not.toContain("billing.view");
    for (const forbidden of ["tours.manage", "bookings.manage", "integrations.manage", "team.manage", "support.manage", "exports.run"] as const) {
      expect(SUPPORT_PERMISSIONS).not.toContain(forbidden);
    }
  });

  it("limits even a real owner to support permissions while the session carries a grant", async () => {
    const a = await createTenant();
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: a.ownerId });
    const workspace = await workspaceOf(sessionFor(owner(a), a.tenantId, { supportGrantId: grantId }));
    expect(workspace.isOwner).toBe(false);
    expect(workspace.permissions).toEqual(SUPPORT_PERMISSIONS);
  });

  it("still admits support to a suspended workspace under a live grant", async () => {
    const a = await createTenant();
    const admin = await createPlatformAdmin();
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id });
    await suspend(a.tenantId);
    const workspace = await workspaceOf(sessionFor(admin, a.tenantId, { supportGrantId: grantId }));
    expect(workspace.tenant.status).toBe("suspended");
    expect(workspace.permissions).toEqual(SUPPORT_PERMISSIONS);
  });

  it("refuses an expired grant", async () => {
    const a = await createTenant();
    const admin = await createPlatformAdmin();
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id, expiresAt: new Date(Date.now() - 1_000) });
    expect(await resolveWorkspace(sessionFor(admin, a.tenantId, { supportGrantId: grantId }))).toEqual({ ok: false, reason: "support_expired" });
  });

  it("refuses an approved grant that has no expiry", async () => {
    const a = await createTenant();
    const admin = await createPlatformAdmin();
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id, expiresAt: null });
    expect(await resolveWorkspace(sessionFor(admin, a.tenantId, { supportGrantId: grantId }))).toEqual({ ok: false, reason: "support_expired" });
  });

  it.each(["requested", "denied", "revoked", "expired"] as const)("refuses a grant whose status is %s", async (status) => {
    const a = await createTenant();
    const admin = await createPlatformAdmin();
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id, status });
    expect(await resolveWorkspace(sessionFor(admin, a.tenantId, { supportGrantId: grantId }))).toEqual({ ok: false, reason: "support_expired" });
  });

  it("stops working the moment the tenant revokes the grant", async () => {
    const a = await createTenant();
    const admin = await createPlatformAdmin();
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id });
    const session = sessionFor(admin, a.tenantId, { supportGrantId: grantId });
    expect((await resolveWorkspace(session)).ok).toBe(true);

    // The tenant itself revokes, through its own restricted connection.
    const revoked = await withTenant(
      a.tenantId,
      ({ tx }) =>
        tx
          .update(supportAccessGrants)
          .set({ status: "revoked", decidedBy: a.ownerId, decidedAt: new Date() })
          .where(and(eq(supportAccessGrants.tenantId, a.tenantId), eq(supportAccessGrants.id, grantId)))
          .returning({ id: supportAccessGrants.id }),
      { userId: a.ownerId },
    );
    expect(revoked).toEqual([{ id: grantId }]);
    expect(await resolveWorkspace(session)).toEqual({ ok: false, reason: "support_expired" });
  });

  it("refuses a grant id that does not exist", async () => {
    const a = await createTenant();
    const admin = await createPlatformAdmin();
    expect(await resolveWorkspace(sessionFor(admin, a.tenantId, { supportGrantId: randomId() }))).toEqual({
      ok: false,
      reason: "support_expired",
    });
  });

  it("does not fall back to membership when a member's support grant is invalid", async () => {
    const a = await createTenant();
    const resolution = await resolveWorkspace(sessionFor(owner(a), a.tenantId, { supportGrantId: randomId() }));
    expect(resolution).toEqual({ ok: false, reason: "support_expired" });
  });
});

describe("can / assertCan / inWorkspace", () => {
  it("checks a permission against the workspace", () => {
    const workspace = { permissions: ["tours.view", "bookings.view"] as const };
    expect(can(workspace, "tours.view")).toBe(true);
    expect(can(workspace, "tours.manage")).toBe(false);
    expect(() => assertCan(workspace, "bookings.view")).not.toThrow();
    expect(() => assertCan(workspace, "bookings.manage")).toThrow(ForbiddenError);
    expect(() => assertCan({ permissions: [] }, "tours.view")).toThrow("You do not have permission to do that.");
  });

  it("runs work in the workspace's tenant, attributed to its user", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const workspace = await workspaceOf(sessionFor(owner(a), a.tenantId));

    const seen = await inWorkspace(workspace, async (scope) => ({
      tenantId: scope.tenantId,
      userId: scope.userId,
      roles: await scope.tx.selectDistinct({ tenantId: roles.tenantId }).from(roles),
    }));

    expect(seen.tenantId).toBe(a.tenantId);
    expect(seen.userId).toBe(a.ownerId);
    expect(seen.roles).toEqual([{ tenantId: a.tenantId }]);
    expect(seen.roles).not.toContainEqual({ tenantId: b.tenantId });
  });
});

describe("listWorkspaces", () => {
  it("lists the user's active workspaces by name with their role there", async () => {
    const zed = await createTenant({ name: "Zed Expeditions" });
    const alpha = await createTenant({ name: "Alpha Tours" });
    const hidden = await createTenant({ name: "Hidden Hikes" });
    const unrelated = await createTenant({ name: "Unrelated Outfitters" });
    const user = await createUser();
    await addMember(zed.tenantId, user.id, "staff");
    await addMember(alpha.tenantId, user.id, "admin");
    await addMember(hidden.tenantId, user.id, "admin", "deactivated");

    const list = await listWorkspaces(user.id);
    expect(list).toEqual([
      { tenantId: alpha.tenantId, slug: alpha.slug, name: "Alpha Tours", status: "active", roleName: "Administrator" },
      { tenantId: zed.tenantId, slug: zed.slug, name: "Zed Expeditions", status: "active", roleName: "Staff" },
    ]);
    expect(list.map((entry) => entry.tenantId)).not.toContain(unrelated.tenantId);
  });

  it("includes a suspended workspace, marked as such", async () => {
    const a = await createTenant();
    await suspend(a.tenantId);
    expect(await listWorkspaces(a.ownerId)).toEqual([expect.objectContaining({ tenantId: a.tenantId, status: "suspended", roleName: "Owner" })]);
  });

  it("is empty for a user with no memberships", async () => {
    const user = await createUser();
    expect(await listWorkspaces(user.id)).toEqual([]);
  });
});

describe("isActiveMember", () => {
  it("is true only for an active membership of that exact workspace", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const member = await createUser();
    await addMember(a.tenantId, member.id, "staff");

    expect(await isActiveMember(member.id, a.tenantId)).toBe(true);
    expect(await isActiveMember(member.id, b.tenantId)).toBe(false);
    expect(await isActiveMember(a.ownerId, b.tenantId)).toBe(false);
    expect(await isActiveMember(member.id, randomId())).toBe(false);

    await setMembership(a.tenantId, member.id, "deactivated");
    expect(await isActiveMember(member.id, a.tenantId)).toBe(false);
  });
});

describe("getPlatformRole", () => {
  it("returns the platform role, or null for everyone else", async () => {
    const a = await createTenant();
    const support = await createPlatformAdmin("support");
    const platformOwner = await createPlatformAdmin("owner");

    expect(await getPlatformRole(support.id)).toBe("support");
    expect(await getPlatformRole(platformOwner.id)).toBe("owner");
    // Owning a workspace confers nothing on the platform.
    expect(await getPlatformRole(a.ownerId)).toBeNull();
    expect(await getPlatformRole(randomId())).toBeNull();
  });
});
