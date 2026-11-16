import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, SUPPORT_SESSION_LIFETIME_MS, validateSessionToken } from "@/server/auth/sessions";
import { resolveWorkspace, SUPPORT_PERMISSIONS } from "@/server/auth/workspace";
import { withoutTenant, withTenant, withUser, type TenantScope } from "@/server/db/context";
import {
  auditLogs,
  integrations,
  invoices,
  plans,
  platformAdmins,
  platformIntegrations,
  sessions,
  subscriptions,
  supportAccessGrants,
  tenants,
} from "@/server/db/schema";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { saveIntegration } from "@/server/integrations";
import type { PlatformActor } from "@/server/platform/access";
import { getPlatformStats, getSystemHealth } from "@/server/platform/analytics";
import {
  cancelSubscription,
  issueInvoice,
  listInvoices,
  markInvoicePaid,
  renewSubscription,
  voidInvoice,
} from "@/server/platform/billing";
import { withPlatform } from "@/server/platform/db";
import {
  deletePlatformIntegration,
  listPlatformIntegrations,
  savePlatformIntegration,
  setPlatformIntegrationEnabled,
  testPlatformIntegration,
} from "@/server/platform/integrations";
import { capturePlatformEmails } from "@/server/platform/mailer";
import { createPlan as createPlanAsAdmin, deletePlan, ensureDefaultPlans, listPlans, updatePlan } from "@/server/platform/plans";
import { endSupportSession, listSupportRequests, requestSupportAccess, startSupportSession } from "@/server/platform/support";
import {
  activateTenant,
  changeTenantPlan,
  createTenantManually,
  getTenantDetail,
  listTenantAdmins,
  listTenants,
  setLimitOverrides,
  setTenantOwner,
  suspendTenant,
  updateTenant,
} from "@/server/platform/tenants";
import { ALL_PERMISSIONS } from "@/server/rbac/permissions";
import { approveSupportGrant, denySupportGrant, listSupportGrants, revokeSupportGrant } from "@/server/support";
import { createPlan, createTenant, createUser, randomId, unique, type TenantFixture } from "../helpers/fixtures";
import { holdInvoiceNumberLock, holdPlatformIntegrationsLock } from "../integration/platform/helpers";

const INSUFFICIENT_PRIVILEGE = "42501";
const REASON = "Reproducing a checkout error the owner reported";
const HOUR = 3_600_000;

/** Postgres error code of a rejected statement, wherever the driver put it. */
async function pgCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code ?? "unknown";
  }
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw");
}

async function admin(role: "owner" | "support"): Promise<PlatformActor> {
  const user = await createUser({ name: role === "owner" ? "Olive Owner" : "Sam Support" });
  await withPlatform((tx) => tx.insert(platformAdmins).values({ userId: user.id, role }));
  return { userId: user.id, role };
}

const ownerOf = (tenant: TenantFixture) => ({ userId: tenant.ownerId, permissions: [], isOwner: true });

function inTenant<T>(tenant: TenantFixture, fn: (scope: TenantScope) => Promise<T>): Promise<T> {
  return withTenant(tenant.tenantId, fn, { userId: tenant.ownerId });
}

async function approvedGrant(actor: PlatformActor, tenant: TenantFixture, hours = 2): Promise<string> {
  const { grantId } = await requestSupportAccess(actor, tenant.tenantId, REASON);
  await inTenant(tenant, (scope) => approveSupportGrant(scope, ownerOf(tenant), grantId, { hours }));
  return grantId;
}

const cloudinary = { provider: "cloudinary", config: { cloudName: "shared" }, secrets: { apiKey: "key-000001", apiSecret: "secret-000001" } };
const period = { start: "2026-01-01", end: "2026-01-31" };

describe("platform administration: role enforcement", () => {
  holdPlatformIntegrationsLock();
  holdInvoiceNumberLock();
  beforeAll(async () => {
    await ensureDefaultPlans();
  });
  afterAll(async () => {
    await withPlatform((tx) => tx.delete(platformIntegrations));
  });

  /** Every state-changing platform function, each aimed at real, existing records. */
  async function mutations() {
    const owner = await admin("owner");
    const tenant = await createTenant();
    const suspended = await createTenant();
    await suspendTenant(owner, suspended.tenantId, "Fixture for activation");
    const plan = await createPlan();
    const spare = await createPlan();
    const successor = await createUser();
    const invoice = await issueInvoice(owner, tenant.tenantId, { description: "Open invoice", amount: 1_000, period });
    await withPlatform((tx) => tx.delete(platformIntegrations));
    await savePlatformIntegration(owner, cloudinary);

    const features = { customDomain: false, integrations: [], platformStorage: false, promotions: false, removeBranding: false };
    const calls: Record<string, (actor: PlatformActor) => Promise<unknown>> = {
      createTenantManually: (actor) => createTenantManually(actor, { name: "Forbidden Tours", slug: unique("nope"), ownerEmail: `${unique("x")}@example.test` }),
      updateTenant: (actor) => updateTenant(actor, tenant.tenantId, { name: "Renamed By Support" }),
      suspendTenant: (actor) => suspendTenant(actor, tenant.tenantId, "Support tried to suspend"),
      activateTenant: (actor) => activateTenant(actor, suspended.tenantId),
      changeTenantPlan: (actor) => changeTenantPlan(actor, tenant.tenantId, { planId: plan.id }),
      setLimitOverrides: (actor) => setLimitOverrides(actor, tenant.tenantId, { maxTeamMembers: null }),
      setTenantOwner: (actor) => setTenantOwner(actor, tenant.tenantId, { userId: successor.id }),
      createPlan: (actor) =>
        createPlanAsAdmin(actor, {
          code: unique("p").replace(/-/g, "_"),
          name: "Support Plan",
          priceMonthly: 0,
          priceYearly: 0,
          maxTeamMembers: null,
          maxPublishedTours: null,
          maxStorageMb: null,
          maxBookingsPerMonth: null,
          features,
        }),
      updatePlan: (actor) => updatePlan(actor, plan.id, { priceMonthly: 1 }),
      deletePlan: (actor) => deletePlan(actor, spare.id),
      issueInvoice: (actor) => issueInvoice(actor, tenant.tenantId, { description: "Support invoice", amount: 5_000, period }),
      markInvoicePaid: (actor) => markInvoicePaid(actor, invoice.id),
      voidInvoice: (actor) => voidInvoice(actor, invoice.id),
      renewSubscription: (actor) => renewSubscription(actor, tenant.tenantId),
      cancelSubscription: (actor) => cancelSubscription(actor, tenant.tenantId, { immediately: true }),
      savePlatformIntegration: (actor) => savePlatformIntegration(actor, { ...cloudinary, config: { cloudName: "hijacked" } }),
      testPlatformIntegration: (actor) => testPlatformIntegration(actor, "media"),
      setPlatformIntegrationEnabled: (actor) => setPlatformIntegrationEnabled(actor, "media", false),
      deletePlatformIntegration: (actor) => deletePlatformIntegration(actor, "media"),
    };

    const snapshot = () =>
      withPlatform(async (tx) => ({
        tenants: await tx.select().from(tenants).where(sql`${tenants.id} in (${tenant.tenantId}, ${suspended.tenantId})`).orderBy(tenants.id),
        subscription: await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenant.tenantId)),
        plans: await tx.select().from(plans).where(sql`${plans.id} in (${plan.id}, ${spare.id})`).orderBy(plans.id),
        invoices: await tx.select().from(invoices).where(eq(invoices.tenantId, tenant.tenantId)),
        platformIntegrations: await tx.select().from(platformIntegrations),
        owners: await listTenantAdmins(owner, tenant.tenantId),
      }));
    return { calls, snapshot, tenant };
  }

  it("rejects every mutation from a support admin and leaves everything unchanged", async () => {
    const support = await admin("support");
    const { calls, snapshot } = await mutations();
    const before = await snapshot();

    for (const [name, call] of Object.entries(calls)) {
      const error = await caught(() => call(support));
      expect(error, name).toBeInstanceOf(ForbiddenError);
    }

    expect(await snapshot()).toEqual(before);
    // Refused calls are not half-done: nothing was audited in the support admin's name.
    expect(await withPlatform((tx) => tx.select().from(auditLogs).where(eq(auditLogs.actorUserId, support.userId)))).toEqual([]);
  });

  it("rejects a support admin who merely claims to be an owner", async () => {
    const support = await admin("support");
    const forged: PlatformActor = { userId: support.userId, role: "owner" };
    const { calls, snapshot } = await mutations();
    const before = await snapshot();

    for (const [name, call] of Object.entries(calls)) {
      expect(await caught(() => call(forged)), name).toBeInstanceOf(ForbiddenError);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("rejects everyone who is not a platform admin, for reads as well as writes", async () => {
    const tenant = await createTenant();
    const { calls } = await mutations();
    // A workspace owner has every tenant permission and still no platform access at all.
    const impostors: PlatformActor[] = [
      { userId: tenant.ownerId, role: "owner" },
      { userId: tenant.ownerId, role: "support" },
      { userId: randomId(), role: "owner" },
      { userId: tenant.ownerId, role: "superadmin" as never },
    ];
    const reads: Record<string, (actor: PlatformActor) => Promise<unknown>> = {
      listTenants: (actor) => listTenants(actor),
      getTenantDetail: (actor) => getTenantDetail(actor, tenant.tenantId),
      listTenantAdmins: (actor) => listTenantAdmins(actor, tenant.tenantId),
      listPlans: (actor) => listPlans(actor),
      listInvoices: (actor) => listInvoices(actor),
      listPlatformIntegrations: (actor) => listPlatformIntegrations(actor),
      getPlatformStats: (actor) => getPlatformStats(actor),
      getSystemHealth: (actor) => getSystemHealth(actor),
      listSupportRequests: (actor) => listSupportRequests(actor),
      requestSupportAccess: (actor) => requestSupportAccess(actor, tenant.tenantId, REASON),
      startSupportSession: (actor) => startSupportSession(actor, randomId()),
      endSupportSession: (actor) => endSupportSession(actor, randomId()),
    };
    for (const impostor of impostors) {
      for (const [name, call] of Object.entries({ ...reads, ...calls })) {
        expect(await caught(() => call(impostor)), `${name} as ${impostor.role}`).toBeInstanceOf(ForbiddenError);
      }
    }
    expect(await withPlatform((tx) => tx.select().from(supportAccessGrants).where(eq(supportAccessGrants.tenantId, tenant.tenantId)))).toEqual([]);
  });

  it("lets a support admin read, and lets an owner do what support could not", async () => {
    const support = await admin("support");
    const owner = await admin("owner");
    const { calls, tenant } = await mutations();

    expect((await listTenants(support, { search: tenant.slug })).total).toBe(1);
    expect((await getTenantDetail(support, tenant.tenantId)).profile.id).toBe(tenant.tenantId);
    expect((await listPlans(support)).length).toBeGreaterThan(0);
    expect((await listInvoices(support, { tenantId: tenant.tenantId })).total).toBe(1);
    expect(await listPlatformIntegrations(support)).toHaveLength(1);
    expect((await getPlatformStats(support)).tenants.total).toBeGreaterThan(0);
    expect((await getSystemHealth(support)).runtimeRole.safe).toBe(true);

    await calls.updateTenant!(owner);
    await calls.setLimitOverrides!(owner);
    expect((await getTenantDetail(support, tenant.tenantId)).profile.name).toBe("Renamed By Support");
  });
});

describe("platform administration: unreachable through the runtime role", () => {
  it("cannot read or write platform integrations", async () => {
    const tenant = await createTenant();
    const values = { provider: "cloudinary", category: unique("cat"), secretCiphertext: "wf1.a.b.c", keyVersion: "v2" };
    const attempts = [
      () => withoutTenant((tx) => tx.select().from(platformIntegrations)),
      () => inTenant(tenant, ({ tx }) => tx.select().from(platformIntegrations)),
      () => withUser(tenant.ownerId, ({ tx }) => tx.select().from(platformIntegrations)),
      () => inTenant(tenant, ({ tx }) => tx.insert(platformIntegrations).values(values)),
      () => inTenant(tenant, ({ tx }) => tx.update(platformIntegrations).set({ status: "disabled" })),
      () => inTenant(tenant, ({ tx }) => tx.delete(platformIntegrations)),
    ];
    for (const attempt of attempts) expect(await pgCode(attempt)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("cannot change plans, its own plan, limits, status, subscription or invoices", async () => {
    const tenant = await createTenant();
    const other = await createPlan();
    const features = { customDomain: true, integrations: [], platformStorage: true, promotions: true, removeBranding: true };
    const attempts: Record<string, () => Promise<unknown>> = {
      "insert plan": () => inTenant(tenant, ({ tx }) => tx.insert(plans).values({ code: unique("free"), name: "Free forever", features })),
      "update plan": () => inTenant(tenant, ({ tx }) => tx.update(plans).set({ maxTeamMembers: null }).where(eq(plans.id, tenant.planId))),
      "delete plan": () => inTenant(tenant, ({ tx }) => tx.delete(plans).where(eq(plans.id, other.id))),
      "switch plan": () => inTenant(tenant, ({ tx }) => tx.update(tenants).set({ planId: other.id }).where(eq(tenants.id, tenant.tenantId))),
      "raise limits": () =>
        inTenant(tenant, ({ tx }) => tx.update(tenants).set({ limitOverrides: { maxTeamMembers: null } }).where(eq(tenants.id, tenant.tenantId))),
      "change status": () => inTenant(tenant, ({ tx }) => tx.update(tenants).set({ status: "active" }).where(eq(tenants.id, tenant.tenantId))),
      "change slug": () => inTenant(tenant, ({ tx }) => tx.update(tenants).set({ slug: unique("mine") }).where(eq(tenants.id, tenant.tenantId))),
      "extend subscription": () =>
        inTenant(tenant, ({ tx }) =>
          tx.update(subscriptions).set({ currentPeriodEnd: new Date("2099-01-01") }).where(eq(subscriptions.tenantId, tenant.tenantId)),
        ),
      "insert invoice": () =>
        inTenant(tenant, ({ tx }) =>
          tx.insert(invoices).values({
            number: unique("INV"),
            description: "Self-issued credit",
            amount: 1,
            currency: "USD",
            status: "paid",
            periodStart: new Date(),
            periodEnd: new Date(),
          }),
        ),
      "mark invoice paid": () => inTenant(tenant, ({ tx }) => tx.update(invoices).set({ status: "paid" })),
      "become platform admin": () => inTenant(tenant, ({ tx }) => tx.insert(platformAdmins).values({ userId: tenant.ownerId, role: "owner" })),
      "create tenant": () => inTenant(tenant, ({ tx }) => tx.insert(tenants).values({ slug: unique("free"), name: "Self-made", planId: other.id })),
    };
    for (const [name, attempt] of Object.entries(attempts)) expect(await pgCode(attempt), name).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("cannot file, redirect or rewrite a support grant; it can only decide its own", async () => {
    const support = await admin("support");
    const a = await createTenant();
    const b = await createTenant();
    capturePlatformEmails();
    const { grantId } = await requestSupportAccess(support, a.tenantId, REASON);

    // Filing a request is the platform's side of the handshake.
    expect(
      await pgCode(() => inTenant(a, ({ tx }) => tx.insert(supportAccessGrants).values({ requestedBy: a.ownerId, reason: "Self-approved access", status: "approved" }))),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    for (const patch of [{ requestedBy: a.ownerId }, { reason: "Rewritten" }, { tenantId: b.tenantId }]) {
      expect(await pgCode(() => inTenant(a, ({ tx }) => tx.update(supportAccessGrants).set(patch).where(eq(supportAccessGrants.id, grantId))))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    }
    expect(await pgCode(() => inTenant(a, ({ tx }) => tx.delete(supportAccessGrants).where(eq(supportAccessGrants.id, grantId))))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );

    // Another tenant cannot even see the row, let alone approve it by raw SQL.
    const fromB = await inTenant(b, async ({ tx }) => ({
      seen: await tx.select().from(supportAccessGrants),
      updated: await tx.update(supportAccessGrants).set({ status: "approved", expiresAt: new Date(Date.now() + HOUR) }).returning(),
    }));
    expect(fromB).toEqual({ seen: [], updated: [] });
    const [stored] = await withPlatform((tx) => tx.select().from(supportAccessGrants).where(eq(supportAccessGrants.id, grantId)));
    expect(stored).toMatchObject({ status: "requested", tenantId: a.tenantId, requestedBy: support.userId, reason: REASON });
  });

  it("cannot read platform audit events, forge them, or rewrite history; nor can the platform role", async () => {
    const owner = await admin("owner");
    const tenant = await createTenant();
    const other = await createTenant();
    const plan = await createPlanAsAdmin(owner, {
      code: unique("p").replace(/-/g, "_"),
      name: "Audited",
      priceMonthly: 0,
      priceYearly: 0,
      maxTeamMembers: 1,
      maxPublishedTours: 1,
      maxStorageMb: 1,
      maxBookingsPerMonth: 1,
      features: { customDomain: false, integrations: [], platformStorage: false, promotions: false, removeBranding: false },
      isPublic: false,
    });
    await suspendTenant(owner, other.tenantId, "Visible to that tenant only");
    await activateTenant(owner, other.tenantId);
    await setLimitOverrides(owner, tenant.tenantId, { maxTeamMembers: 9 });

    // The tenant sees platform actions on itself, not platform-only events or other tenants' events.
    const seen = await inTenant(tenant, ({ tx }) => tx.select().from(auditLogs));
    expect(seen.map((row) => row.action)).toEqual(["tenant.limits_overridden"]);
    expect(seen[0]).toMatchObject({ actorType: "platform_admin", tenantId: tenant.tenantId });
    expect(await withoutTenant((tx) => tx.select().from(auditLogs).where(eq(auditLogs.targetId, plan.id)))).toEqual([]);

    const forgeries = [
      { tenantId: null, actorType: "platform_admin" as const, action: "plan.deleted" },
      { tenantId: other.tenantId, actorType: "platform_admin" as const, action: "tenant.activated" },
    ];
    for (const row of forgeries) {
      expect(await pgCode(() => inTenant(tenant, ({ tx }) => tx.insert(auditLogs).values(row)))).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect(await pgCode(() => inTenant(tenant, ({ tx }) => tx.delete(auditLogs)))).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await pgCode(() => inTenant(tenant, ({ tx }) => tx.update(auditLogs).set({ action: "nothing.happened" })))).toBe(INSUFFICIENT_PRIVILEGE);

    // Append-only holds for the platform connection too.
    expect(await pgCode(() => withPlatform((tx) => tx.delete(auditLogs).where(eq(auditLogs.targetId, plan.id))))).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await pgCode(() => withPlatform((tx) => tx.update(auditLogs).set({ action: "edited" }).where(eq(auditLogs.targetId, plan.id))))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    const [kept] = await withPlatform((tx) => tx.select().from(auditLogs).where(eq(auditLogs.targetId, plan.id)));
    expect(kept).toMatchObject({ action: "plan.created", actorUserId: owner.userId, tenantId: null });
  });
});

describe("platform views never carry tenant credentials", () => {
  it("getTenantDetail, listTenants and the dashboard expose no secret, ciphertext or hint", async () => {
    const owner = await admin("owner");
    const tenant = await createTenant();
    const API_KEY = "tenant-key-1234567";
    const API_SECRET = "tenant-secret-ABCDEFG-7654";
    const view = await inTenant(tenant, (scope) =>
      saveIntegration(scope, { provider: "cloudinary", config: { cloudName: "tenant-cloud" }, secrets: { apiKey: API_KEY, apiSecret: API_SECRET } }),
    );
    const [row] = await withPlatform((tx) => tx.select().from(integrations).where(eq(integrations.id, view.id)));
    const hints = Object.values(row!.secretHints);
    expect(hints).toHaveLength(2);

    const detail = await getTenantDetail(owner, tenant.tenantId);
    expect(detail.integrations).toEqual([
      { id: view.id, provider: "cloudinary", category: "media", label: "Default", status: "untested", isDefault: true, lastTestedAt: null, updatedAt: expect.any(Date) },
    ]);

    const outputs = {
      detail,
      list: await listTenants(owner, { search: tenant.slug }),
      admins: await listTenantAdmins(owner, tenant.tenantId),
      stats: await getPlatformStats(owner),
    };
    for (const [name, output] of Object.entries(outputs)) {
      const text = JSON.stringify(output);
      for (const forbidden of [API_KEY, API_SECRET, row!.secretCiphertext, ...hints, "7654", "secretCiphertext", "secretHints", "keyVersion", "wf1.", "passwordHash", "verificationToken"]) {
        expect(text.includes(forbidden), `${name} contains ${forbidden}`).toBe(false);
      }
    }
    // The activity feed names the event without its metadata.
    expect(detail.recentActivity.map((entry) => entry.action)).toContain("integration.created");
    expect(Object.keys(detail.recentActivity[0]!)).not.toContain("metadata");
  });
});

describe("support access: no silent impersonation", () => {
  beforeEach(() => {
    capturePlatformEmails();
  });

  it("refuses to start a session unless the grant is approved, unexpired and the admin's own", async () => {
    const support = await admin("support");
    const colleague = await admin("support");
    const platformOwner = await admin("owner");
    const tenant = await createTenant();

    const requested = (await requestSupportAccess(support, tenant.tenantId, REASON)).grantId;
    expect(await caught(() => startSupportSession(support, requested))).toBeInstanceOf(ForbiddenError);

    await inTenant(tenant, (scope) => denySupportGrant(scope, ownerOf(tenant), requested));
    expect(await caught(() => startSupportSession(support, requested))).toBeInstanceOf(ForbiddenError);

    const revoked = await approvedGrant(support, tenant);
    await inTenant(tenant, (scope) => revokeSupportGrant(scope, ownerOf(tenant), revoked));
    expect(await caught(() => startSupportSession(support, revoked))).toBeInstanceOf(ForbiddenError);

    const expired = await approvedGrant(support, tenant);
    await withPlatform((tx) => tx.update(supportAccessGrants).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(supportAccessGrants.id, expired)));
    expect(await caught(() => startSupportSession(support, expired))).toBeInstanceOf(ForbiddenError);

    // Approved but with no end date is not "forever": it is unusable.
    const openEnded = await approvedGrant(support, tenant);
    await withPlatform((tx) => tx.update(supportAccessGrants).set({ expiresAt: null }).where(eq(supportAccessGrants.id, openEnded)));
    expect(await caught(() => startSupportSession(support, openEnded))).toBeInstanceOf(ForbiddenError);

    // A live grant belongs to the admin who asked: not a colleague, not even a platform owner.
    const live = await approvedGrant(support, tenant);
    expect(await caught(() => startSupportSession(colleague, live))).toBeInstanceOf(NotFoundError);
    expect(await caught(() => startSupportSession(platformOwner, live))).toBeInstanceOf(NotFoundError);
    expect(await caught(() => startSupportSession(support, randomId()))).toBeInstanceOf(NotFoundError);
    expect(await caught(() => startSupportSession(support, "not-a-uuid"))).toBeInstanceOf(NotFoundError);

    // None of the refusals created a session or claimed that one had started.
    const supportSessions = await withPlatform((tx) => tx.select().from(sessions).where(eq(sessions.activeTenantId, tenant.tenantId)));
    expect(supportSessions).toEqual([]);
    const log = await inTenant(tenant, ({ tx }) => tx.select({ action: auditLogs.action }).from(auditLogs));
    expect(log.map((row) => row.action)).not.toContain("support.session_started");

    expect((await startSupportSession(support, live)).tenantId).toBe(tenant.tenantId);
  });

  it("gives a support session view permissions only", async () => {
    const support = await admin("support");
    const tenant = await createTenant();
    const started = await startSupportSession(support, await approvedGrant(support, tenant));
    const resolution = await resolveWorkspace((await validateSessionToken(started.token))!);
    if (!resolution.ok) throw new Error("support session did not resolve");
    const { permissions } = resolution.workspace;

    expect(permissions).toEqual(SUPPORT_PERMISSIONS);
    expect(permissions.length).toBeGreaterThan(0);
    expect(permissions.every((permission) => permission.endsWith(".view"))).toBe(true);
    expect(permissions).not.toContain("billing.view");
    for (const permission of ALL_PERMISSIONS.filter((candidate) => !candidate.endsWith(".view"))) {
      expect(permissions).not.toContain(permission);
    }
    expect(resolution.workspace.isOwner).toBe(false);
    expect(resolution.workspace.roleName).toBe("Wayfold Support");
  });

  it("never lets a session outlive its grant", async () => {
    const support = await admin("support");
    const tenant = await createTenant();

    // Two minutes left on the grant: the session gets those two minutes, not the usual hour.
    const short = await approvedGrant(support, tenant, 1);
    const grantEnds = new Date(Date.now() + 2 * 60_000);
    await withPlatform((tx) => tx.update(supportAccessGrants).set({ expiresAt: grantEnds }).where(eq(supportAccessGrants.id, short)));
    // A clock that visibly advances between "how long is left" and "write the
    // session" would otherwise let the row end a few milliseconds late.
    let drift = 0;
    const realNow = Date.now.bind(Date);
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + (drift += 7));
    const started = await startSupportSession(support, short).finally(() => clock.mockRestore());
    expect(started.expiresAt.getTime()).toBe(grantEnds.getTime());
    expect(started.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const [shortRow] = await withPlatform((tx) => tx.select().from(sessions).where(eq(sessions.supportGrantId, short)));
    expect(shortRow!.expiresAt.getTime()).toBe(grantEnds.getTime());

    // A long grant still gets the short support lifetime.
    const long = await approvedGrant(support, tenant, 72);
    const capped = await startSupportSession(support, long);
    expect(capped.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(SUPPORT_SESSION_LIFETIME_MS);

    // Using the session does not extend it, unlike an ordinary login.
    await withPlatform((tx) => tx.update(sessions).set({ lastSeenAt: new Date(Date.now() - 3 * 24 * HOUR) }).where(eq(sessions.supportGrantId, long)));
    const validated = (await validateSessionToken(capped.token))!;
    expect(validated.expiresAt.getTime()).toBe(capped.expiresAt.getTime());

    // When the grant runs out first, the still-valid session stops resolving.
    await withPlatform((tx) => tx.update(supportAccessGrants).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(supportAccessGrants.id, long)));
    expect(await validateSessionToken(capped.token)).not.toBeNull();
    expect(await resolveWorkspace(validated)).toEqual({ ok: false, reason: "support_expired" });
  });

  it("confines a grant to its workspace and its admin", async () => {
    const support = await admin("support");
    const colleague = await admin("support");
    const a = await createTenant();
    const b = await createTenant();
    const grantId = await approvedGrant(support, a);

    // Session rows planted by hand, bypassing startSupportSession entirely.
    const elsewhere = await createSession(support.userId, {}, { activeTenantId: b.tenantId, supportGrantId: grantId });
    const borrowed = await createSession(colleague.userId, {}, { activeTenantId: a.tenantId, supportGrantId: grantId });
    const invented = await createSession(support.userId, {}, { activeTenantId: b.tenantId, supportGrantId: randomId() });
    for (const planted of [elsewhere, borrowed, invented]) {
      expect(await resolveWorkspace((await validateSessionToken(planted.token))!)).toEqual({ ok: false, reason: "support_expired" });
    }

    // Without a grant a platform admin is nobody inside a workspace.
    const plain = await createSession(support.userId, {}, { activeTenantId: a.tenantId });
    expect(await resolveWorkspace((await validateSessionToken(plain.token))!)).toEqual({ ok: false, reason: "not_a_member" });
  });

  it("keeps one workspace from seeing or deciding another's support requests", async () => {
    const support = await admin("support");
    const colleague = await admin("support");
    const a = await createTenant();
    const b = await createTenant();
    const ownGrant = await approvedGrant(support, a);
    const requestedForB = (await requestSupportAccess(support, b.tenantId, REASON)).grantId;
    const approvedForB = await approvedGrant(colleague, b);

    // A lists its own request and nothing of B's.
    expect((await inTenant(a, (scope) => listSupportGrants(scope))).map((grant) => grant.id)).toEqual([ownGrant]);

    // B's ids are simply not found from inside A, whatever A tries to do with them.
    for (const attempt of [
      () => inTenant(a, (scope) => approveSupportGrant(scope, ownerOf(a), requestedForB, { hours: 72 })),
      () => inTenant(a, (scope) => denySupportGrant(scope, ownerOf(a), requestedForB)),
      () => inTenant(a, (scope) => revokeSupportGrant(scope, ownerOf(a), approvedForB)),
    ]) {
      expect(await caught(attempt)).toBeInstanceOf(NotFoundError);
    }

    // Revoking A's own grant ends A's sessions only: the colleague's session in B survives.
    const inA = await startSupportSession(support, ownGrant);
    const inB = await startSupportSession(colleague, approvedForB);
    await inTenant(a, (scope) => revokeSupportGrant(scope, ownerOf(a), ownGrant));
    expect(await validateSessionToken(inA.token)).toBeNull();
    expect(await validateSessionToken(inB.token)).not.toBeNull();

    const stored = await withPlatform((tx) => tx.select().from(supportAccessGrants).where(eq(supportAccessGrants.tenantId, b.tenantId)));
    expect(stored.map((grant) => grant.status).sort()).toEqual(["approved", "requested"]);
    expect(stored.every((grant) => grant.decidedBy === null || grant.decidedBy === b.ownerId)).toBe(true);

    // Each audit log holds its own workspace's support history and nothing else.
    const logA = await inTenant(a, ({ tx }) => tx.select().from(auditLogs));
    expect(logA.every((row) => row.tenantId === a.tenantId)).toBe(true);
    expect(logA.map((row) => row.action).sort()).toEqual([
      "support.access_approved",
      "support.access_requested",
      "support.access_revoked",
      "support.session_started",
    ]);
    const logB = await inTenant(b, ({ tx }) => tx.select().from(auditLogs));
    expect(logB.every((row) => row.tenantId === b.tenantId)).toBe(true);
    expect(logB.map((row) => row.targetId)).not.toContain(ownGrant);
  });
});
