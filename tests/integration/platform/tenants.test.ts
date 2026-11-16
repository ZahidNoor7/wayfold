import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetPassword } from "@/server/auth/service";
import { resolveWorkspace } from "@/server/auth/workspace";
import { getEntitlements } from "@/server/billing/limits";
import { withTenant } from "@/server/db/context";
import { integrations, memberships, roles, subscriptions, tenantDomains, tenants, tours, users } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { capturePlatformEmails, stopCapturingPlatformEmails } from "@/server/platform/mailer";
import { ensureDefaultPlans } from "@/server/platform/plans";
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
import { createPlan, createTenant, createUser, randomId, unique } from "../../helpers/fixtures";
import { auditBy, caught, createAdmin } from "./helpers";

// This file never has a platform mailer: other test files configure one in the
// shared database, and what happens without one is exactly what is under test.
vi.mock("@/server/platform/integrations", async (original) => ({
  ...(await original<typeof import("@/server/platform/integrations")>()),
  resolvePlatformIntegration: vi.fn(async () => null),
}));

function sessionFor(tenantId: string, user: { id: string; email: string }) {
  return {
    id: randomId(),
    user: { id: user.id, email: user.email, name: "Member", emailVerified: true },
    activeTenantId: tenantId,
    supportGrantId: null,
    expiresAt: new Date(Date.now() + 60_000),
  };
}

describe("tenant administration", () => {
  beforeAll(async () => {
    await ensureDefaultPlans();
  });
  afterEach(() => stopCapturingPlatformEmails());

  describe("listTenants", () => {
    it("lists workspaces with owner e-mail, plan and member count", async () => {
      const owner = await createAdmin();
      const tag = unique("acme");
      const a = await createTenant({ name: `${tag} Alpha` });
      const b = await createTenant({ name: `${tag} Beta` });
      const extra = await createUser();
      await withPlatform(async (tx) => {
        const [staff] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.tenantId, b.tenantId), eq(roles.systemKey, "staff")));
        await tx.insert(memberships).values({ tenantId: b.tenantId, userId: extra.id, roleId: staff!.id });
      });

      const result = await listTenants(owner, { search: tag, sort: "name_asc" });
      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.id)).toEqual([a.tenantId, b.tenantId]);
      expect(result.items[0]).toMatchObject({ slug: a.slug, status: "active", ownerEmail: a.ownerEmail, memberCount: 1, plan: { id: a.planId } });
      expect(result.items[0]!.createdAt).toBeInstanceOf(Date);
      expect(result.items[1]).toMatchObject({ ownerEmail: b.ownerEmail, memberCount: 2 });

      expect((await listTenants(owner, { search: tag, sort: "name_desc" })).items.map((item) => item.id)).toEqual([b.tenantId, a.tenantId]);
      expect((await listTenants(owner, { search: tag, sort: "members_desc" })).items[0]!.id).toBe(b.tenantId);
      expect((await listTenants(owner, { search: tag, sort: "created_asc" })).items.map((item) => item.id)).toEqual([a.tenantId, b.tenantId]);
      expect((await listTenants(owner, { search: tag })).items.map((item) => item.id)).toEqual([b.tenantId, a.tenantId]);

      // Paging keeps the total and walks the same order.
      const page = await listTenants(owner, { search: tag, sort: "name_asc", limit: 1, offset: 1 });
      expect(page.total).toBe(2);
      expect(page.items.map((item) => item.id)).toEqual([b.tenantId]);
    });

    it("searches by slug and owner e-mail and filters by status and plan", async () => {
      const owner = await createAdmin();
      const a = await createTenant();
      const b = await createTenant();
      await suspendTenant(owner, b.tenantId, "Chargeback under review");

      expect((await listTenants(owner, { search: a.slug.toUpperCase() })).items.map((item) => item.id)).toEqual([a.tenantId]);
      expect((await listTenants(owner, { search: b.ownerEmail })).items.map((item) => item.id)).toEqual([b.tenantId]);
      expect((await listTenants(owner, { planId: a.planId })).items.map((item) => item.id)).toEqual([a.tenantId]);
      expect((await listTenants(owner, { planId: b.planId, status: "active" })).items).toEqual([]);
      expect((await listTenants(owner, { planId: b.planId, status: "suspended" })).items.map((item) => item.id)).toEqual([b.tenantId]);

      // Wildcards in the search box are literal text, not patterns.
      expect((await listTenants(owner, { search: "%" })).total).toBe(0);
      expect((await listTenants(owner, { search: "biz_" })).total).toBe(0);
      expect((await listTenants(owner)).total).toBeGreaterThanOrEqual(2);
    });

    it("validates paging and filters", async () => {
      const owner = await createAdmin();
      expect(await caught(() => listTenants(owner, { limit: 500 }))).toBeInstanceOf(ValidationError);
      expect(await caught(() => listTenants(owner, { planId: "nope" }))).toBeInstanceOf(ValidationError);
      expect(await caught(() => listTenants(owner, { sort: "random" as never }))).toBeInstanceOf(ValidationError);
    });
  });

  describe("getTenantDetail", () => {
    it("returns profile, plan, subscription, limits, usage, domains, administrators, integrations and activity", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant({ plan: { maxTeamMembers: 4, maxPublishedTours: 10, maxStorageMb: 500, maxBookingsPerMonth: 50 } });
      await setLimitOverrides(owner, tenant.tenantId, { maxPublishedTours: 25, maxStorageMb: null });

      await withPlatform(async (tx) => {
        await tx.insert(tenantDomains).values([
          { tenantId: tenant.tenantId, domain: `${tenant.slug}.example.test`, verificationToken: "verify-me-privately", status: "verified", isPrimary: true },
          { tenantId: tenant.tenantId, domain: `alt-${tenant.slug}.example.test`, verificationToken: "pending-token" },
        ]);
        await tx.insert(tours).values([
          { tenantId: tenant.tenantId, slug: "one", title: "One", status: "published" },
          { tenantId: tenant.tenantId, slug: "two", title: "Two", status: "draft" },
        ]);
        await tx.insert(integrations).values({
          tenantId: tenant.tenantId,
          provider: "cloudinary",
          category: "media",
          isDefault: true,
          status: "connected",
          config: { cloudName: "demo" },
          secretCiphertext: "wf1.CIPHERTEXT-MARKER.tag.body",
          keyVersion: "v2",
          secretHints: { apiSecret: "••••••••HINT" },
        });
      });

      const detail = await getTenantDetail(owner, tenant.tenantId);
      expect(detail.profile).toMatchObject({ id: tenant.tenantId, slug: tenant.slug, status: "active", suspendedReason: null, onboardingCompleted: false });
      expect(detail.plan).toMatchObject({ id: tenant.planId });
      expect(detail.subscription).toMatchObject({ status: "active", cycle: "monthly", provider: "manual", cancelAtPeriodEnd: false });
      expect(detail.limits).toEqual({
        plan: { maxTeamMembers: 4, maxPublishedTours: 10, maxStorageMb: 500, maxBookingsPerMonth: 50 },
        overrides: { maxPublishedTours: 25, maxStorageMb: null },
        effective: { maxTeamMembers: 4, maxPublishedTours: 25, maxStorageMb: null, maxBookingsPerMonth: 50 },
      });
      expect(detail.usage).toEqual({ teamMembers: 1, publishedTours: 1, storageBytes: 0, storageMb: 0, bookingsThisMonth: 0 });
      expect(detail.domains.map((domain) => [domain.domain, domain.status, domain.isPrimary])).toEqual([
        [`${tenant.slug}.example.test`, "verified", true],
        [`alt-${tenant.slug}.example.test`, "pending", false],
      ]);
      expect(detail.administrators).toEqual([
        expect.objectContaining({ userId: tenant.ownerId, email: tenant.ownerEmail, roleKey: "owner", status: "active", emailVerified: true }),
      ]);
      expect(detail.integrations).toEqual([
        expect.objectContaining({ provider: "cloudinary", category: "media", status: "connected", isDefault: true, label: "Default" }),
      ]);
      expect(detail.recentActivity[0]).toMatchObject({ action: "tenant.limits_overridden", actorType: "platform_admin", actorUserId: owner.userId });

      // The limits the tenant is actually held to match what the platform sees.
      const entitlements = await withTenant(tenant.tenantId, (scope) => getEntitlements(scope));
      expect(entitlements.limits).toEqual(detail.limits.effective);
    });

    it("answers not-found for unknown and malformed ids", async () => {
      const owner = await createAdmin();
      expect(await caught(() => getTenantDetail(owner, randomId()))).toBeInstanceOf(NotFoundError);
      expect(await caught(() => getTenantDetail(owner, "1 or 1=1"))).toBeInstanceOf(NotFoundError);
    });
  });

  describe("createTenantManually", () => {
    it("creates the owner account, provisions the workspace and e-mails a set-password link", async () => {
      const owner = await createAdmin();
      const inbox = capturePlatformEmails();
      const email = `${unique("founder")}@Example.Test`;
      const name = `Silk Road ${unique("co")}`;

      const created = await createTenantManually(owner, { name, ownerEmail: email, ownerName: "Fatima Founder" });
      expect(created).toMatchObject({ ownerCreated: true, setupEmailDelivered: true, setupToken: null });
      expect(created.slug).toMatch(/^silk-road-co-/);

      const detail = await getTenantDetail(owner, created.tenantId);
      expect(detail.profile.name).toBe(name);
      expect(detail.administrators).toEqual([
        expect.objectContaining({ userId: created.ownerUserId, email: email.toLowerCase(), name: "Fatima Founder", roleKey: "owner", emailVerified: false }),
      ]);
      expect(detail.subscription).toMatchObject({ status: "active" });

      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({ to: email.toLowerCase() });
      const token = new URL(inbox[0]!.text.match(/https:\/\/\S+/)![0]).searchParams.get("token")!;
      // The link is a normal single-use reset: it sets the password and proves the address.
      await resetPassword(token, "a-brand-new-passphrase");
      const [account] = await withPlatform((tx) => tx.select().from(users).where(eq(users.id, created.ownerUserId)));
      expect(account!.emailVerifiedAt).not.toBeNull();
      expect(account!.passwordHash.startsWith("$argon2")).toBe(true);

      const audit = (await auditBy(owner.userId)).find((row) => row.action === "tenant.created");
      expect(audit).toMatchObject({ tenantId: created.tenantId, actorType: "platform_admin", targetId: created.tenantId });
      expect(JSON.stringify(audit!.metadata)).not.toContain(token);
    });

    it("hands back the setup token only when the e-mail could not be delivered", async () => {
      const owner = await createAdmin();
      // No capture and no platform mailer: delivery reports not_configured.
      const created = await createTenantManually(owner, { name: "Undelivered Tours", slug: unique("undeliv"), ownerEmail: `${unique("o")}@example.test` });
      expect(created.setupEmailDelivered).toBe(false);
      expect(created.setupToken).toEqual(expect.any(String));
      await resetPassword(created.setupToken!, "another-long-passphrase");
    });

    it("reuses an existing account as owner and puts the workspace on the requested plan", async () => {
      const owner = await createAdmin();
      const inbox = capturePlatformEmails();
      const existing = await createUser();
      const plan = await createPlan();

      const created = await createTenantManually(owner, { name: "Caspian Trails", slug: unique("caspian"), ownerEmail: existing.email, planCode: plan.code });
      expect(created).toMatchObject({ ownerUserId: existing.id, ownerCreated: false, setupEmailDelivered: null, setupToken: null });
      expect(inbox).toEqual([]);
      expect((await getTenantDetail(owner, created.tenantId)).plan.id).toBe(plan.id);
    });

    it("rejects bad input without leaving an account behind", async () => {
      const owner = await createAdmin();
      const taken = await createTenant();
      const email = `${unique("ghost")}@example.test`;

      const cases: [Parameters<typeof createTenantManually>[1], string][] = [
        [{ name: "Fine Name", slug: taken.slug, ownerEmail: email }, "slug"],
        [{ name: "Fine Name", slug: "admin", ownerEmail: email }, "slug"],
        [{ name: "Fine Name", slug: "Bad Slug!", ownerEmail: email }, "slug"],
        [{ name: "!!!", ownerEmail: email }, "slug"],
        [{ name: "Fine Name", slug: unique("ok"), ownerEmail: email, planCode: "no-such-plan" }, "planCode"],
        [{ name: "x", slug: unique("ok"), ownerEmail: email }, "name"],
        [{ name: "Fine Name", slug: unique("ok"), ownerEmail: "not-an-email" }, "ownerEmail"],
      ];
      for (const [input, field] of cases) {
        const error = await caught(() => createTenantManually(owner, input));
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.fieldErrors).toHaveProperty(field);
      }
      const leftovers = await withPlatform((tx) => tx.select({ id: users.id }).from(users).where(eq(users.email, email)));
      expect(leftovers).toEqual([]);
    });

    it("refuses a disabled account as owner", async () => {
      const owner = await createAdmin();
      const disabled = await createUser();
      await withPlatform((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, disabled.id)));
      const error = await caught(() => createTenantManually(owner, { name: "Fine Name", slug: unique("ok"), ownerEmail: disabled.email }));
      expect(error).toBeInstanceOf(ConflictError);
    });
  });

  describe("updateTenant", () => {
    it("renames a workspace and changes its address, auditing which fields changed", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant();
      const slug = unique("moved");

      expect(await updateTenant(owner, tenant.tenantId, { name: "  Renamed Tours ", slug: slug.toUpperCase() })).toEqual({
        id: tenant.tenantId,
        name: "Renamed Tours",
        slug,
      });
      const [row] = await withPlatform((tx) => tx.select().from(tenants).where(eq(tenants.id, tenant.tenantId)));
      expect(row).toMatchObject({ name: "Renamed Tours", slug });

      const audit = (await auditBy(owner.userId)).find((entry) => entry.action === "tenant.updated")!;
      expect(audit.metadata).toMatchObject({ fields: ["name", "slug"], previousSlug: tenant.slug, slug });

      // Saving the same values is a no-op and writes no audit row.
      await updateTenant(owner, tenant.tenantId, { name: "Renamed Tours", slug });
      await updateTenant(owner, tenant.tenantId, {});
      expect((await auditBy(owner.userId)).filter((entry) => entry.action === "tenant.updated")).toHaveLength(1);
    });

    it("rejects invalid, reserved and taken addresses", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant();
      const other = await createTenant();
      for (const slug of ["ab", "has--double", "-leading", "billing", other.slug]) {
        const error = await caught(() => updateTenant(owner, tenant.tenantId, { slug }));
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.fieldErrors).toHaveProperty("slug");
      }
      expect(await caught(() => updateTenant(owner, tenant.tenantId, { name: "x" }))).toBeInstanceOf(ValidationError);
      expect(await caught(() => updateTenant(owner, randomId(), { name: "Nobody Home" }))).toBeInstanceOf(NotFoundError);
    });
  });

  describe("suspendTenant / activateTenant", () => {
    it("locks members out while suspended and lets them back in on activation", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant();
      const session = sessionFor(tenant.tenantId, { id: tenant.ownerId, email: tenant.ownerEmail });
      expect((await resolveWorkspace(session)).ok).toBe(true);

      await suspendTenant(owner, tenant.tenantId, "  Payment dispute  ");
      expect(await resolveWorkspace(session)).toEqual({ ok: false, reason: "suspended" });
      expect((await getTenantDetail(owner, tenant.tenantId)).profile).toMatchObject({ status: "suspended", suspendedReason: "Payment dispute" });
      expect(await caught(() => suspendTenant(owner, tenant.tenantId, "Again"))).toBeInstanceOf(ConflictError);

      await activateTenant(owner, tenant.tenantId);
      expect((await resolveWorkspace(session)).ok).toBe(true);
      expect((await getTenantDetail(owner, tenant.tenantId)).profile).toMatchObject({ status: "active", suspendedReason: null });
      expect(await caught(() => activateTenant(owner, tenant.tenantId))).toBeInstanceOf(ConflictError);

      const actions = (await auditBy(owner.userId)).map((row) => row.action);
      expect(actions).toEqual(expect.arrayContaining(["tenant.suspended", "tenant.activated"]));
    });

    it("needs a reason and an existing workspace", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant();
      expect(await caught(() => suspendTenant(owner, tenant.tenantId, " "))).toBeInstanceOf(ValidationError);
      expect(await caught(() => suspendTenant(owner, randomId(), "No such workspace"))).toBeInstanceOf(NotFoundError);
      expect(await caught(() => activateTenant(owner, randomId()))).toBeInstanceOf(NotFoundError);
    });
  });

  describe("changeTenantPlan", () => {
    it("moves the tenant and its subscription to the new plan together", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant({ plan: { maxTeamMembers: 2 } });
      const bigger = await createPlan({ maxTeamMembers: 40 });

      expect(await changeTenantPlan(owner, tenant.tenantId, { planId: bigger.id, cycle: "yearly" })).toEqual({ planId: bigger.id, planCode: bigger.code });
      const detail = await getTenantDetail(owner, tenant.tenantId);
      expect(detail.plan.id).toBe(bigger.id);
      expect(detail.subscription).toMatchObject({ cycle: "yearly", status: "active" });
      const [subscription] = await withPlatform((tx) => tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenant.tenantId)));
      expect(subscription!.planId).toBe(bigger.id);
      // The tenant's own entitlements follow immediately.
      expect((await withTenant(tenant.tenantId, (scope) => getEntitlements(scope))).limits.maxTeamMembers).toBe(40);

      // By code, keeping the billing cycle.
      const original = await withPlatform((tx) => tx.query.plans.findFirst({ where: (plan, { eq: equals }) => equals(plan.id, tenant.planId) }));
      await changeTenantPlan(owner, tenant.tenantId, { planCode: original!.code });
      expect((await getTenantDetail(owner, tenant.tenantId)).subscription).toMatchObject({ cycle: "yearly" });
    });

    it("creates the subscription row when a workspace has none", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant();
      const plan = await createPlan();
      await withPlatform((tx) => tx.delete(subscriptions).where(eq(subscriptions.tenantId, tenant.tenantId)));
      expect((await getTenantDetail(owner, tenant.tenantId)).subscription).toBeNull();

      await changeTenantPlan(owner, tenant.tenantId, { planId: plan.id });
      expect((await getTenantDetail(owner, tenant.tenantId)).subscription).toMatchObject({ status: "active", cycle: "monthly" });
    });

    it("rejects unknown plans and ambiguous input", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant();
      expect(await caught(() => changeTenantPlan(owner, tenant.tenantId, { planId: randomId() }))).toBeInstanceOf(NotFoundError);
      expect(await caught(() => changeTenantPlan(owner, tenant.tenantId, { planCode: "no-such-plan" }))).toBeInstanceOf(NotFoundError);
      expect(await caught(() => changeTenantPlan(owner, tenant.tenantId, {}))).toBeInstanceOf(ValidationError);
      expect(await caught(() => changeTenantPlan(owner, tenant.tenantId, { planId: randomId(), planCode: "both" }))).toBeInstanceOf(ValidationError);
      expect(await caught(() => changeTenantPlan(owner, randomId(), { planCode: "free" }))).toBeInstanceOf(NotFoundError);
    });
  });

  describe("setLimitOverrides", () => {
    it("replaces the override set and validates every value", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant({ plan: { maxTeamMembers: 3 } });

      expect(await setLimitOverrides(owner, tenant.tenantId, { maxTeamMembers: 0, maxBookingsPerMonth: null })).toEqual({
        maxTeamMembers: 0,
        maxBookingsPerMonth: null,
      });
      // Replaced, not merged: the earlier keys are gone.
      expect(await setLimitOverrides(owner, tenant.tenantId, { maxStorageMb: 9_000 })).toEqual({ maxStorageMb: 9_000 });
      expect(await setLimitOverrides(owner, tenant.tenantId, {})).toEqual({});
      expect((await getTenantDetail(owner, tenant.tenantId)).limits.effective.maxTeamMembers).toBe(3);

      for (const bad of [{ maxTeamMembers: -1 }, { maxStorageMb: 1.5 }, { maxPublishedTours: "10" }, { unknownLimit: 5 }]) {
        expect(await caught(() => setLimitOverrides(owner, tenant.tenantId, bad as never))).toBeInstanceOf(ValidationError);
      }
      expect(await caught(() => setLimitOverrides(owner, randomId(), {}))).toBeInstanceOf(NotFoundError);
    });
  });

  describe("listTenantAdmins / setTenantOwner", () => {
    it("transfers ownership to another account and demotes the previous owner", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant();
      const successor = await createUser({ name: "Next Owner" });

      const result = await setTenantOwner(owner, tenant.tenantId, { email: successor.email.toUpperCase() });
      expect(result).toEqual({ ownerUserId: successor.id, previousOwnerUserIds: [tenant.ownerId] });

      const admins = await listTenantAdmins(owner, tenant.tenantId);
      expect(admins.map((admin) => [admin.userId, admin.roleKey])).toEqual([
        [successor.id, "owner"],
        [tenant.ownerId, "admin"],
      ]);
      // The new owner really does resolve as owner; the old one as an administrator.
      const asNew = await resolveWorkspace(sessionFor(tenant.tenantId, successor));
      expect(asNew.ok && asNew.workspace.isOwner).toBe(true);
      const asOld = await resolveWorkspace(sessionFor(tenant.tenantId, { id: tenant.ownerId, email: tenant.ownerEmail }));
      expect(asOld.ok && asOld.workspace.isOwner).toBe(false);

      const audit = (await auditBy(owner.userId)).find((row) => row.action === "tenant.owner_changed")!;
      expect(audit).toMatchObject({ tenantId: tenant.tenantId, targetId: successor.id });
    });

    it("promotes an existing, deactivated member by id and re-activates them", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant();
      const member = await createUser();
      await withPlatform(async (tx) => {
        const [staff] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.tenantId, tenant.tenantId), eq(roles.systemKey, "staff")));
        await tx.insert(memberships).values({ tenantId: tenant.tenantId, userId: member.id, roleId: staff!.id, status: "deactivated" });
      });

      await setTenantOwner(owner, tenant.tenantId, { userId: member.id });
      const admins = await listTenantAdmins(owner, tenant.tenantId);
      expect(admins.find((admin) => admin.userId === member.id)).toMatchObject({ roleKey: "owner", status: "active" });

      // Naming the current owner again changes nothing and demotes nobody.
      expect(await setTenantOwner(owner, tenant.tenantId, { userId: member.id })).toEqual({ ownerUserId: member.id, previousOwnerUserIds: [] });
    });

    it("leaves previous owners in place when the workspace deleted its Administrator role", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant();
      const successor = await createUser();
      await withPlatform((tx) => tx.delete(roles).where(and(eq(roles.tenantId, tenant.tenantId), eq(roles.systemKey, "admin"))));

      await setTenantOwner(owner, tenant.tenantId, { userId: successor.id });
      const admins = await listTenantAdmins(owner, tenant.tenantId);
      expect(admins.map((admin) => admin.roleKey)).toEqual(["owner", "owner"]);
    });

    it("rejects unknown or disabled accounts and ambiguous input", async () => {
      const owner = await createAdmin();
      const tenant = await createTenant();
      const disabled = await createUser();
      await withPlatform((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, disabled.id)));

      expect(await caught(() => setTenantOwner(owner, tenant.tenantId, { userId: randomId() }))).toBeInstanceOf(NotFoundError);
      expect(await caught(() => setTenantOwner(owner, tenant.tenantId, { email: "nobody@example.test" }))).toBeInstanceOf(NotFoundError);
      expect(await caught(() => setTenantOwner(owner, tenant.tenantId, { userId: disabled.id }))).toBeInstanceOf(ConflictError);
      expect(await caught(() => setTenantOwner(owner, tenant.tenantId, {}))).toBeInstanceOf(ValidationError);
      expect(await caught(() => setTenantOwner(owner, randomId(), { userId: tenant.ownerId }))).toBeInstanceOf(NotFoundError);
      expect(await caught(() => listTenantAdmins(owner, randomId()))).toBeInstanceOf(NotFoundError);

      await withPlatform((tx) => tx.delete(memberships).where(eq(memberships.tenantId, tenant.tenantId)));
      await withPlatform((tx) => tx.delete(roles).where(and(eq(roles.tenantId, tenant.tenantId), eq(roles.systemKey, "owner"))));
      expect(await caught(() => setTenantOwner(owner, tenant.tenantId, { userId: tenant.ownerId }))).toBeInstanceOf(ConflictError);
    });
  });

  it("rejects an actor whose platform_admins row is missing or weaker than claimed", async () => {
    const tenant = await createTenant();
    const stranger = await createUser();
    const support = await createAdmin("support");

    // Claims a role the table does not back.
    expect(await caught(() => listTenants({ userId: stranger.id, role: "owner" }))).toBeInstanceOf(ForbiddenError);
    expect(await caught(() => suspendTenant({ userId: support.userId, role: "owner" }, tenant.tenantId, "Forged role"))).toBeInstanceOf(ForbiddenError);
    expect(await caught(() => listTenants({ userId: "not-a-uuid", role: "support" }))).toBeInstanceOf(ForbiddenError);
    expect(await caught(() => listTenants({ userId: support.userId, role: "root" as never }))).toBeInstanceOf(ForbiddenError);
    expect((await getTenantDetail(support, tenant.tenantId)).profile.status).toBe("active");
  });
});
