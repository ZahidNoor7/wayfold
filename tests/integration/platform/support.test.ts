import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createSession, SUPPORT_SESSION_LIFETIME_MS, validateSessionToken } from "@/server/auth/sessions";
import { resolveWorkspace, SUPPORT_PERMISSIONS } from "@/server/auth/workspace";
import { withTenant } from "@/server/db/context";
import { auditLogs, memberships, roles, sessions, supportAccessGrants, users } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { capturePlatformEmails, stopCapturingPlatformEmails } from "@/server/platform/mailer";
import {
  effectiveGrantStatus,
  endSupportSession,
  listSupportRequests,
  requestSupportAccess,
  startSupportSession,
} from "@/server/platform/support";
import { approveSupportGrant, denySupportGrant } from "@/server/support";
import { createTenant, createUser, randomId, type TenantFixture } from "../../helpers/fixtures";
import { caught, createAdmin } from "./helpers";

const REASON = "Customer reports bookings calendar shows the wrong month";
const HOUR = 3_600_000;

function ownerActor(tenant: TenantFixture) {
  return { userId: tenant.ownerId, permissions: [], isOwner: true };
}

function asOwner<T>(tenant: TenantFixture, fn: (scope: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>): Promise<T> {
  return withTenant(tenant.tenantId, fn, { userId: tenant.ownerId });
}

async function approvedGrant(admin: { userId: string; role: "owner" | "support" }, tenant: TenantFixture, hours = 2): Promise<string> {
  const { grantId } = await requestSupportAccess(admin, tenant.tenantId, REASON);
  await asOwner(tenant, (scope) => approveSupportGrant(scope, ownerActor(tenant), grantId, { hours }));
  return grantId;
}

async function tenantLog(tenantId: string) {
  return withTenant(tenantId, ({ tx }) => tx.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)));
}

describe("support access: platform side", () => {
  afterEach(() => stopCapturingPlatformEmails());

  it("files a request, tells the tenant's deciders, and shows it in the tenant's own audit log", async () => {
    const support = await createAdmin("support");
    const tenant = await createTenant({ name: "Caspian Trails" });
    const inbox = capturePlatformEmails();

    // A second decider through a custom role, a member without the permission, and a deactivated owner.
    const [delegate, staff, former] = await Promise.all([createUser(), createUser(), createUser()]);
    await withPlatform(async (tx) => {
      const [custom] = await tx
        .insert(roles)
        .values({ tenantId: tenant.tenantId, name: "Security lead", permissions: ["support.manage", "audit.view"] })
        .returning({ id: roles.id });
      const [staffRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenant.tenantId), eq(roles.systemKey, "staff")));
      await tx.insert(memberships).values([
        { tenantId: tenant.tenantId, userId: delegate.id, roleId: custom!.id },
        { tenantId: tenant.tenantId, userId: staff.id, roleId: staffRole!.id },
        { tenantId: tenant.tenantId, userId: former.id, roleId: tenant.ownerRoleId, status: "deactivated" },
      ]);
    });

    const result = await requestSupportAccess(support, tenant.tenantId, `  ${REASON}  `, { ip: "203.0.113.9" });
    expect(result.notified).toBe(2);
    expect(inbox.map((mail) => mail.to).sort()).toEqual([tenant.ownerEmail, delegate.email].sort());
    expect(inbox[0]!.subject).toContain("Caspian Trails");
    expect(inbox[0]!.text).toContain("Sam Support");
    expect(inbox[0]!.text).toContain(REASON);
    expect(inbox[0]!.text).toContain("https://app.wayfold.test/workspace/settings/support");

    const [grant] = await withPlatform((tx) => tx.select().from(supportAccessGrants).where(eq(supportAccessGrants.id, result.grantId)));
    expect(grant).toMatchObject({ tenantId: tenant.tenantId, requestedBy: support.userId, reason: REASON, status: "requested", expiresAt: null });

    // Requesting grants nothing: no session exists and none can be started.
    expect(await withPlatform((tx) => tx.select().from(sessions).where(eq(sessions.userId, support.userId)))).toEqual([]);

    const log = await tenantLog(tenant.tenantId);
    expect(log).toEqual([
      expect.objectContaining({
        action: "support.access_requested",
        actorType: "platform_admin",
        actorUserId: support.userId,
        targetType: "support_grant",
        targetId: result.grantId,
        ip: "203.0.113.9",
      }),
    ]);
  });

  it("allows one open request per admin and workspace, and validates input", async () => {
    const support = await createAdmin("support");
    const colleague = await createAdmin("support");
    const tenant = await createTenant();
    capturePlatformEmails();

    const first = await requestSupportAccess(support, tenant.tenantId, REASON);
    expect(await caught(() => requestSupportAccess(support, tenant.tenantId, REASON))).toBeInstanceOf(ConflictError);
    // A colleague's request is their own; a decided request frees the slot.
    await requestSupportAccess(colleague, tenant.tenantId, REASON);
    await asOwner(tenant, (scope) => denySupportGrant(scope, ownerActor(tenant), first.grantId));
    await requestSupportAccess(support, tenant.tenantId, REASON);

    expect(await caught(() => requestSupportAccess(support, tenant.tenantId, "too short"))).toBeInstanceOf(ValidationError);
    expect(await caught(() => requestSupportAccess(support, randomId(), REASON))).toBeInstanceOf(NotFoundError);
    expect(await caught(() => requestSupportAccess(support, "nope", REASON))).toBeInstanceOf(NotFoundError);
    const stranger = await createUser();
    expect(await caught(() => requestSupportAccess({ userId: stranger.id, role: "support" }, tenant.tenantId, REASON))).toBeInstanceOf(ForbiddenError);
  });

  it("lists requests with their effective status", async () => {
    const support = await createAdmin("support");
    const colleague = await createAdmin("owner");
    const a = await createTenant();
    const b = await createTenant();
    capturePlatformEmails();

    const lapsed = await approvedGrant(support, a);
    await withPlatform((tx) =>
      tx.update(supportAccessGrants).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(supportAccessGrants.id, lapsed)),
    );
    const open = await requestSupportAccess(support, b.tenantId, REASON);
    const theirs = await requestSupportAccess(colleague, b.tenantId, REASON);

    const mine = await listSupportRequests(support, { mine: true });
    expect(mine.total).toBe(2);
    expect(mine.items.map((grant) => [grant.id, grant.status])).toEqual([
      [open.grantId, "requested"],
      [lapsed, "expired"],
    ]);
    expect(mine.items[1]).toMatchObject({
      tenantId: a.tenantId,
      tenantSlug: a.slug,
      tenantName: expect.any(String),
      requestedBy: support.userId,
      requesterName: "Sam Support",
      requesterEmail: support.email,
      reason: REASON,
    });

    const forB = await listSupportRequests(support, { tenantId: b.tenantId });
    expect(forB.items.map((grant) => grant.id).sort()).toEqual([open.grantId, theirs.grantId].sort());
    expect(forB.items.find((grant) => grant.id === theirs.grantId)).toMatchObject({ requesterName: "Olive Owner", requesterEmail: colleague.email });
    expect((await listSupportRequests(support)).total).toBeGreaterThanOrEqual(3);
    expect(await caught(() => listSupportRequests(support, { limit: 0 }))).toBeInstanceOf(ValidationError);
    expect(await caught(() => listSupportRequests(support, { status: "pending" as never }))).toBeInstanceOf(ValidationError);

    expect(effectiveGrantStatus("approved", null)).toBe("expired");
    expect(effectiveGrantStatus("approved", new Date(Date.now() + HOUR))).toBe("approved");
    expect(effectiveGrantStatus("revoked", new Date(Date.now() + HOUR))).toBe("revoked");
  });

  it("filters requests by effective status and pages through them with a total", async () => {
    const support = await createAdmin("support");
    const tenant = await createTenant();
    capturePlatformEmails();
    const asOwnerOf = (fn: Parameters<typeof asOwner>[1]) => asOwner(tenant, fn);

    const denied = (await requestSupportAccess(support, tenant.tenantId, REASON)).grantId;
    await asOwnerOf((scope) => denySupportGrant(scope, ownerActor(tenant), denied));
    const live = await approvedGrant(support, tenant, 4);
    const lapsed = await approvedGrant(support, tenant, 1);
    await withPlatform((tx) => tx.update(supportAccessGrants).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(supportAccessGrants.id, lapsed)));
    const storedExpired = await approvedGrant(support, tenant, 1);
    await withPlatform((tx) => tx.update(supportAccessGrants).set({ status: "expired" }).where(eq(supportAccessGrants.id, storedExpired)));
    const waiting = (await requestSupportAccess(support, tenant.tenantId, REASON)).grantId;

    const by = async (status: "requested" | "approved" | "denied" | "revoked" | "expired") => {
      const result = await listSupportRequests(support, { tenantId: tenant.tenantId, status });
      expect(result.total).toBe(result.items.length);
      expect(result.items.every((grant) => grant.status === status)).toBe(true);
      return result.items.map((grant) => grant.id).sort();
    };
    expect(await by("requested")).toEqual([waiting]);
    expect(await by("approved")).toEqual([live]);
    expect(await by("denied")).toEqual([denied]);
    expect(await by("revoked")).toEqual([]);
    expect(await by("expired")).toEqual([lapsed, storedExpired].sort());

    const all = await listSupportRequests(support, { tenantId: tenant.tenantId });
    expect(all.total).toBe(5);
    const pages = [];
    for (let offset = 0; offset < 5; offset += 2) {
      const page = await listSupportRequests(support, { tenantId: tenant.tenantId, limit: 2, offset });
      expect(page.total).toBe(5);
      pages.push(...page.items.map((grant) => grant.id));
    }
    expect(pages).toEqual(all.items.map((grant) => grant.id));
    expect(await caught(() => listSupportRequests(support, { offset: -1 }))).toBeInstanceOf(ValidationError);
  });

  it("starts a view-only session under an approved grant and records it for the tenant", async () => {
    const support = await createAdmin("support");
    const tenant = await createTenant();
    capturePlatformEmails();
    const grantId = await approvedGrant(support, tenant, 2);

    const started = await startSupportSession(support, grantId, { ip: "203.0.113.9", userAgent: "Support Console" });
    expect(started.tenantId).toBe(tenant.tenantId);
    const lifetime = started.expiresAt.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(SUPPORT_SESSION_LIFETIME_MS - 5_000);
    expect(lifetime).toBeLessThanOrEqual(SUPPORT_SESSION_LIFETIME_MS);

    const session = await validateSessionToken(started.token);
    expect(session).toMatchObject({ activeTenantId: tenant.tenantId, supportGrantId: grantId, user: { id: support.userId } });

    const resolution = await resolveWorkspace(session!);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error("unreachable");
    expect(resolution.workspace).toMatchObject({ tenantId: tenant.tenantId, roleName: "Wayfold Support", isOwner: false, support: { grantId } });
    expect(resolution.workspace.permissions).toEqual(SUPPORT_PERMISSIONS);

    const log = await tenantLog(tenant.tenantId);
    expect(log.find((row) => row.action === "support.session_started")).toMatchObject({
      actorType: "platform_admin",
      actorUserId: support.userId,
      targetId: grantId,
      ip: "203.0.113.9",
    });
  });

  it("ends a support session, and only the admin's own", async () => {
    const support = await createAdmin("support");
    const colleague = await createAdmin("support");
    const tenant = await createTenant();
    capturePlatformEmails();
    const grantId = await approvedGrant(support, tenant);
    const started = await startSupportSession(support, grantId);
    const session = (await validateSessionToken(started.token))!;

    // An ordinary login of the same admin is not a support session.
    const login = await createSession(support.userId);
    const ordinary = (await validateSessionToken(login.token))!;

    expect(await caught(() => endSupportSession(colleague, session.id))).toBeInstanceOf(NotFoundError);
    expect(await caught(() => endSupportSession(support, ordinary.id))).toBeInstanceOf(NotFoundError);
    expect(await caught(() => endSupportSession(support, "nope"))).toBeInstanceOf(NotFoundError);
    expect(await validateSessionToken(started.token)).not.toBeNull();

    await endSupportSession(support, session.id, { ip: "203.0.113.9" });
    expect(await validateSessionToken(started.token)).toBeNull();
    expect(await validateSessionToken(login.token)).not.toBeNull();
    expect(await caught(() => endSupportSession(support, session.id))).toBeInstanceOf(NotFoundError);

    const log = await tenantLog(tenant.tenantId);
    expect(log.filter((row) => row.action === "support.session_ended")).toEqual([
      expect.objectContaining({ actorType: "platform_admin", actorUserId: support.userId, targetId: grantId }),
    ]);
  });

  it("stops a disabled admin from using a session that was already open", async () => {
    const support = await createAdmin("support");
    const tenant = await createTenant();
    capturePlatformEmails();
    const started = await startSupportSession(support, await approvedGrant(support, tenant));
    await withPlatform((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, support.userId)));
    expect(await validateSessionToken(started.token)).toBeNull();
  });
});
