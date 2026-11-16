import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createSession, setActiveTenant, validateSessionToken } from "@/server/auth/sessions";
import { inWorkspace, isActiveMember, listWorkspaces, resolveWorkspace, SUPPORT_PERMISSIONS } from "@/server/auth/workspace";
import { integrations, memberships, roles } from "@/server/db/schema";
import { ALL_PERMISSIONS } from "@/server/rbac/permissions";
import { createTenant, createUser } from "../helpers/fixtures";
import { addMember, createGrant, createPlatformAdmin, sessionFor } from "../integration/foundation/support";

const owner = (t: { ownerId: string; ownerEmail: string }) => ({ id: t.ownerId, email: t.ownerEmail });
const NOT_A_MEMBER = { ok: false, reason: "not_a_member" } as const;
const SUPPORT_EXPIRED = { ok: false, reason: "support_expired" } as const;

describe("workspace isolation: membership", () => {
  it("does not resolve the owner of B into A when their session points at A", async () => {
    const a = await createTenant();
    const b = await createTenant();

    expect(await resolveWorkspace(sessionFor(owner(b), a.tenantId))).toEqual(NOT_A_MEMBER);
    // The same user in their own workspace is fine: the refusal is about A.
    expect((await resolveWorkspace(sessionFor(owner(b), b.tenantId))).ok).toBe(true);
  });

  it("does not resolve a staff member of B into A, whatever their role in B", async () => {
    const a = await createTenant();
    const b = await createTenant();
    for (const role of ["admin", "staff"] as const) {
      const member = await createUser();
      await addMember(b.tenantId, member.id, role);
      expect(await resolveWorkspace(sessionFor(member, a.tenantId))).toEqual(NOT_A_MEMBER);
    }
  });

  it("resolves a member of both tenants into each with that tenant's own role", async () => {
    const a = await createTenant();
    const b = await createTenant();
    // Owner of B, read-only staff in A.
    await addMember(a.tenantId, b.ownerId, "staff");

    const inA = await resolveWorkspace(sessionFor(owner(b), a.tenantId));
    const inB = await resolveWorkspace(sessionFor(owner(b), b.tenantId));
    if (!inA.ok || !inB.ok) throw new Error("expected both workspaces to resolve");

    expect(inA.workspace).toMatchObject({ tenantId: a.tenantId, roleName: "Staff", isOwner: false });
    expect(inA.workspace.permissions).not.toContain("tours.manage");
    expect(inA.workspace.permissions).not.toEqual(ALL_PERMISSIONS);
    expect(inB.workspace).toMatchObject({ tenantId: b.tenantId, roleName: "Owner", isOwner: true });
    expect(inB.workspace.permissions).toEqual(ALL_PERMISSIONS);
  });

  it("does not carry an active membership in B over a deactivated one in A", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await addMember(a.tenantId, b.ownerId, "admin", "deactivated");
    expect(await resolveWorkspace(sessionFor(owner(b), a.tenantId))).toEqual(NOT_A_MEMBER);
  });

  it("refuses a real database session that was pointed at a foreign tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const { token } = await createSession(b.ownerId, {}, { activeTenantId: b.tenantId });
    const session = await validateSessionToken(token);
    expect((await resolveWorkspace(session!)).ok).toBe(true);

    // Simulates a tampered or stale session row.
    await setActiveTenant(session!.id, a.tenantId);
    const repointed = await validateSessionToken(token);
    expect(repointed!.activeTenantId).toBe(a.tenantId);
    expect(await resolveWorkspace(repointed!)).toEqual(NOT_A_MEMBER);
  });

  it("gives a workspace scope that cannot see the other tenant's rows", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const resolution = await resolveWorkspace(sessionFor(owner(a), a.tenantId));
    if (!resolution.ok) throw new Error("expected a workspace");

    const seen = await inWorkspace(resolution.workspace, async ({ tx }) => ({
      roles: await tx.select({ tenantId: roles.tenantId }).from(roles).where(eq(roles.tenantId, b.tenantId)),
      members: await tx.select({ tenantId: memberships.tenantId }).from(memberships).where(eq(memberships.tenantId, b.tenantId)),
      integrations: await tx.select({ tenantId: integrations.tenantId }).from(integrations).where(eq(integrations.tenantId, b.tenantId)),
    }));
    expect(seen).toEqual({ roles: [], members: [], integrations: [] });
  });

  it("lists only the user's own workspaces and confirms membership per tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();

    expect((await listWorkspaces(a.ownerId)).map((entry) => entry.tenantId)).toEqual([a.tenantId]);
    expect((await listWorkspaces(b.ownerId)).map((entry) => entry.tenantId)).toEqual([b.tenantId]);
    expect(await isActiveMember(a.ownerId, b.tenantId)).toBe(false);
    expect(await isActiveMember(b.ownerId, a.tenantId)).toBe(false);
  });
});

describe("workspace isolation: support grants", () => {
  it("does not honour another admin's grant", async () => {
    const a = await createTenant();
    const requester = await createPlatformAdmin("support");
    const other = await createPlatformAdmin("owner");
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: requester.id });

    expect(await resolveWorkspace(sessionFor(other, a.tenantId, { supportGrantId: grantId }))).toEqual(SUPPORT_EXPIRED);
    // The admin who was actually granted access still gets in.
    expect((await resolveWorkspace(sessionFor(requester, a.tenantId, { supportGrantId: grantId }))).ok).toBe(true);
  });

  it("does not honour a grant issued by another tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const admin = await createPlatformAdmin("support");
    const grantForB = await createGrant({ tenantId: b.tenantId, requestedBy: admin.id });

    expect(await resolveWorkspace(sessionFor(admin, a.tenantId, { supportGrantId: grantForB }))).toEqual(SUPPORT_EXPIRED);

    const inB = await resolveWorkspace(sessionFor(admin, b.tenantId, { supportGrantId: grantForB }));
    if (!inB.ok) throw new Error("expected the grant to work for its own tenant");
    expect(inB.workspace.tenantId).toBe(b.tenantId);
    expect(inB.workspace.permissions).toEqual(SUPPORT_PERMISSIONS);
  });

  it("does not let a tenant's member reuse a platform admin's grant", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const admin = await createPlatformAdmin("support");
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id });

    // The owner of B holds a valid grant id for A, but did not request it.
    expect(await resolveWorkspace(sessionFor(owner(b), a.tenantId, { supportGrantId: grantId }))).toEqual(SUPPORT_EXPIRED);
  });

  it("gives a platform admin nothing without a grant", async () => {
    const a = await createTenant();
    const platformOwner = await createPlatformAdmin("owner");
    expect(await resolveWorkspace(sessionFor(platformOwner, a.tenantId))).toEqual(NOT_A_MEMBER);
  });

  it("refuses expired and denied grants for the right admin and tenant", async () => {
    const a = await createTenant();
    const admin = await createPlatformAdmin("support");
    const expired = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id, expiresAt: new Date(Date.now() - 60_000) });
    const denied = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id, status: "denied" });

    expect(await resolveWorkspace(sessionFor(admin, a.tenantId, { supportGrantId: expired }))).toEqual(SUPPORT_EXPIRED);
    expect(await resolveWorkspace(sessionFor(admin, a.tenantId, { supportGrantId: denied }))).toEqual(SUPPORT_EXPIRED);
  });

  it("never grants more than view permissions through support access", async () => {
    const a = await createTenant();
    const admin = await createPlatformAdmin("owner");
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id });

    const resolution = await resolveWorkspace(sessionFor(admin, a.tenantId, { supportGrantId: grantId }));
    if (!resolution.ok) throw new Error("expected a workspace");
    expect(resolution.workspace.permissions).toEqual(SUPPORT_PERMISSIONS);
    expect(resolution.workspace.permissions.some((permission) => !permission.endsWith(".view"))).toBe(false);
    expect(resolution.workspace.isOwner).toBe(false);
  });
});
