import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createSession, validateSessionToken } from "@/server/auth/sessions";
import { resolveWorkspace } from "@/server/auth/workspace";
import { withTenant, type TenantScope } from "@/server/db/context";
import { auditLogs, platformAdmins, sessions, supportAccessGrants } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { capturePlatformEmails } from "@/server/platform/mailer";
import { requestSupportAccess, startSupportSession } from "@/server/platform/support";
import type { Permission } from "@/server/rbac/permissions";
import {
  approveSupportGrant,
  denySupportGrant,
  listSupportGrants,
  MAX_SUPPORT_ACCESS_HOURS,
  revokeSupportGrant,
  type SupportActor,
} from "@/server/support";
import { createTenant, createUser, randomId, type TenantFixture } from "../../helpers/fixtures";

const REASON = "Tour photos fail to upload for one team member";
const HOUR = 3_600_000;

async function caught(run: () => Promise<unknown>): Promise<Error & { code?: string; fieldErrors?: Record<string, string[]> }> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the call to throw");
}

async function supportAdmin() {
  const user = await createUser({ name: "Sam Support" });
  await withPlatform((tx) => tx.insert(platformAdmins).values({ userId: user.id, role: "support" }));
  return { userId: user.id, role: "support" as const };
}

const owner = (tenant: TenantFixture): SupportActor => ({ userId: tenant.ownerId, permissions: [], isOwner: true });

function as<T>(tenant: TenantFixture, fn: (scope: TenantScope) => Promise<T>, userId = tenant.ownerId): Promise<T> {
  return withTenant(tenant.tenantId, fn, { userId });
}

async function tenantLog(tenant: TenantFixture) {
  return as(tenant, ({ tx }) => tx.select().from(auditLogs).where(eq(auditLogs.tenantId, tenant.tenantId)));
}

describe("support access: workspace side", () => {
  beforeEach(() => {
    capturePlatformEmails();
  });

  it("lists the workspace's requests, newest first", async () => {
    const admin = await supportAdmin();
    const tenant = await createTenant();
    expect(await as(tenant, (scope) => listSupportGrants(scope))).toEqual([]);

    const first = await requestSupportAccess(admin, tenant.tenantId, REASON);
    await as(tenant, (scope) => denySupportGrant(scope, owner(tenant), first.grantId));
    const second = await requestSupportAccess(admin, tenant.tenantId, `${REASON} (again)`);

    const grants = await as(tenant, (scope) => listSupportGrants(scope));
    expect(grants.map((grant) => [grant.id, grant.status])).toEqual([
      [second.grantId, "requested"],
      [first.grantId, "denied"],
    ]);
    expect(grants[0]).toMatchObject({ requestedBy: admin.userId, reason: `${REASON} (again)`, decidedBy: null, decidedAt: null, expiresAt: null });
    expect(grants[1]).toMatchObject({ decidedBy: tenant.ownerId });
    expect(grants[1]!.decidedAt).toBeInstanceOf(Date);
  });

  it("approves a request for a bounded number of hours and audits the decision", async () => {
    const admin = await supportAdmin();
    const tenant = await createTenant();
    const { grantId } = await requestSupportAccess(admin, tenant.tenantId, REASON);

    const before = Date.now();
    const approved = await as(tenant, (scope) => approveSupportGrant(scope, owner(tenant), grantId, { hours: 6 }));
    expect(approved).toMatchObject({ id: grantId, status: "approved", decidedBy: tenant.ownerId });
    expect(approved.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 6 * HOUR);
    expect(approved.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 6 * HOUR);

    const log = await tenantLog(tenant);
    expect(log.find((row) => row.action === "support.access_approved")).toMatchObject({
      actorType: "user",
      actorUserId: tenant.ownerId,
      targetType: "support_grant",
      targetId: grantId,
    });

    // A decision is final: it cannot be approved again, extended or flipped to denied.
    for (const again of [
      () => as(tenant, (scope) => approveSupportGrant(scope, owner(tenant), grantId, { hours: 72 })),
      () => as(tenant, (scope) => denySupportGrant(scope, owner(tenant), grantId)),
    ]) {
      const error = await caught(again);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.code).toBe("support_grant_state");
    }
    const [stored] = await withPlatform((tx) => tx.select().from(supportAccessGrants).where(eq(supportAccessGrants.id, grantId)));
    expect(stored!.expiresAt!.getTime()).toBe(approved.expiresAt!.getTime());
  });

  it("limits access to 72 hours and whole hours", async () => {
    const admin = await supportAdmin();
    const tenant = await createTenant();
    const { grantId } = await requestSupportAccess(admin, tenant.tenantId, REASON);

    expect(MAX_SUPPORT_ACCESS_HOURS).toBe(72);
    for (const hours of [0, -1, 73, 1.5, 10_000, "24" as never, undefined as never]) {
      const error = await caught(() => as(tenant, (scope) => approveSupportGrant(scope, owner(tenant), grantId, { hours })));
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.fieldErrors).toHaveProperty("hours");
    }
    expect((await as(tenant, (scope) => listSupportGrants(scope)))[0]!.status).toBe("requested");

    const approved = await as(tenant, (scope) => approveSupportGrant(scope, owner(tenant), grantId, { hours: 72 }));
    expect(approved.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 72 * HOUR);
  });

  it("denies a request, after which no session can be started", async () => {
    const admin = await supportAdmin();
    const tenant = await createTenant();
    const { grantId } = await requestSupportAccess(admin, tenant.tenantId, REASON);

    const denied = await as(tenant, (scope) => denySupportGrant(scope, owner(tenant), grantId));
    expect(denied).toMatchObject({ status: "denied", expiresAt: null, decidedBy: tenant.ownerId });
    expect(await caught(() => startSupportSession(admin, grantId))).toBeInstanceOf(ForbiddenError);
    expect((await tenantLog(tenant)).map((row) => row.action)).toContain("support.access_denied");
    expect(await caught(() => as(tenant, (scope) => revokeSupportGrant(scope, owner(tenant), grantId)))).toBeInstanceOf(ConflictError);
  });

  it("revokes approved access and ends every session opened under it, and only those", async () => {
    const admin = await supportAdmin();
    const tenant = await createTenant();
    const other = await createTenant();
    const { grantId } = await requestSupportAccess(admin, tenant.tenantId, REASON);
    await as(tenant, (scope) => approveSupportGrant(scope, owner(tenant), grantId, { hours: 4 }));

    const { grantId: otherGrant } = await requestSupportAccess(admin, other.tenantId, REASON);
    await as(other, (scope) => approveSupportGrant(scope, owner(other), otherGrant, { hours: 4 }));

    const first = await startSupportSession(admin, grantId);
    const second = await startSupportSession(admin, grantId);
    const elsewhere = await startSupportSession(admin, otherGrant);
    const ownLogin = await createSession(admin.userId);
    const ownerLogin = await createSession(tenant.ownerId, {}, { activeTenantId: tenant.tenantId });

    const revoked = await as(tenant, (scope) => revokeSupportGrant(scope, owner(tenant), grantId));
    expect(revoked.status).toBe("revoked");

    expect(await validateSessionToken(first.token)).toBeNull();
    expect(await validateSessionToken(second.token)).toBeNull();
    // Untouched: the other workspace's support session, the admin's own login, the owner's login.
    expect(await validateSessionToken(elsewhere.token)).not.toBeNull();
    expect(await validateSessionToken(ownLogin.token)).not.toBeNull();
    expect(await validateSessionToken(ownerLogin.token)).not.toBeNull();

    expect(await caught(() => startSupportSession(admin, grantId))).toBeInstanceOf(ForbiddenError);
    const audit = (await tenantLog(tenant)).find((row) => row.action === "support.access_revoked")!;
    expect(audit.metadata).toMatchObject({ sessionsEnded: 2, requestedBy: admin.userId });
    expect(await caught(() => as(tenant, (scope) => revokeSupportGrant(scope, owner(tenant), grantId)))).toBeInstanceOf(ConflictError);
  });

  it("makes a revoked grant useless even to a session that somehow survived", async () => {
    const admin = await supportAdmin();
    const tenant = await createTenant();
    const { grantId } = await requestSupportAccess(admin, tenant.tenantId, REASON);
    await as(tenant, (scope) => approveSupportGrant(scope, owner(tenant), grantId, { hours: 4 }));
    await startSupportSession(admin, grantId);
    await as(tenant, (scope) => revokeSupportGrant(scope, owner(tenant), grantId));

    // Re-create the session row by hand, as if the delete had been missed.
    const planted = await createSession(admin.userId, {}, { activeTenantId: tenant.tenantId, supportGrantId: grantId });
    const session = (await validateSessionToken(planted.token))!;
    expect(await resolveWorkspace(session)).toEqual({ ok: false, reason: "support_expired" });
  });

  it("shows an approved grant as expired once its window has passed", async () => {
    const admin = await supportAdmin();
    const tenant = await createTenant();
    const { grantId } = await requestSupportAccess(admin, tenant.tenantId, REASON);
    await as(tenant, (scope) => approveSupportGrant(scope, owner(tenant), grantId, { hours: 1 }));
    await withPlatform((tx) => tx.update(supportAccessGrants).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(supportAccessGrants.id, grantId)));

    expect((await as(tenant, (scope) => listSupportGrants(scope)))[0]!.status).toBe("expired");
    const error = await caught(() => as(tenant, (scope) => denySupportGrant(scope, owner(tenant), grantId)));
    expect(error.message).toContain("expired");
  });

  it("requires support.manage, held by the member the transaction belongs to", async () => {
    const admin = await supportAdmin();
    const tenant = await createTenant();
    const { grantId } = await requestSupportAccess(admin, tenant.tenantId, REASON);

    const manager: SupportActor = { userId: tenant.ownerId, permissions: ["support.manage"] };
    const viewer: SupportActor = { userId: tenant.ownerId, permissions: ["team.view", "audit.view", "integrations.manage"] as Permission[] };
    for (const run of [
      (scope: TenantScope) => approveSupportGrant(scope, viewer, grantId, { hours: 1 }),
      (scope: TenantScope) => denySupportGrant(scope, viewer, grantId),
      (scope: TenantScope) => revokeSupportGrant(scope, viewer, grantId),
    ]) {
      expect(await caught(() => as(tenant, run))).toBeInstanceOf(ForbiddenError);
    }

    // The actor has to be the user of the tenant transaction, and there has to be one.
    const someoneElse = await createUser();
    expect(await caught(() => as(tenant, (scope) => approveSupportGrant(scope, { ...manager, userId: someoneElse.id }, grantId, { hours: 1 })))).toBeInstanceOf(
      ForbiddenError,
    );
    expect(
      await caught(() => withTenant(tenant.tenantId, (scope) => approveSupportGrant(scope, manager, grantId, { hours: 1 }))),
    ).toBeInstanceOf(ForbiddenError);
    expect((await as(tenant, (scope) => listSupportGrants(scope)))[0]!.status).toBe("requested");

    // The permission alone, without being owner, is enough.
    expect((await as(tenant, (scope) => approveSupportGrant(scope, manager, grantId, { hours: 1 }))).status).toBe("approved");
  });

  it("cannot be approved from inside a support session", async () => {
    const admin = await supportAdmin();
    const tenant = await createTenant();
    const { grantId } = await requestSupportAccess(admin, tenant.tenantId, REASON);
    await as(tenant, (scope) => approveSupportGrant(scope, owner(tenant), grantId, { hours: 1 }));
    const started = await startSupportSession(admin, grantId);
    const resolution = await resolveWorkspace((await validateSessionToken(started.token))!);
    if (!resolution.ok) throw new Error("unreachable");
    const { workspace } = resolution;

    // The support engineer files a second request and tries to approve it with their own session.
    await as(tenant, (scope) => revokeSupportGrant(scope, owner(tenant), grantId));
    const { grantId: next } = await requestSupportAccess(admin, tenant.tenantId, `${REASON} (follow-up)`);
    const actor: SupportActor = { userId: workspace.user.id, permissions: workspace.permissions, isOwner: workspace.isOwner };
    const error = await caught(() => as(tenant, (scope) => approveSupportGrant(scope, actor, next, { hours: 72 }), admin.userId));
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(await withPlatform((tx) => tx.select().from(sessions).where(eq(sessions.supportGrantId, next)))).toEqual([]);
  });

  it("answers not-found for unknown and malformed ids", async () => {
    const tenant = await createTenant();
    for (const id of [randomId(), "not-a-uuid", ""]) {
      expect(await caught(() => as(tenant, (scope) => approveSupportGrant(scope, owner(tenant), id, { hours: 1 })))).toBeInstanceOf(NotFoundError);
      expect(await caught(() => as(tenant, (scope) => denySupportGrant(scope, owner(tenant), id)))).toBeInstanceOf(NotFoundError);
      expect(await caught(() => as(tenant, (scope) => revokeSupportGrant(scope, owner(tenant), id)))).toBeInstanceOf(NotFoundError);
    }
  });
});
