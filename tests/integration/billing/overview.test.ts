import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  getBillingOverview,
  getInvoice,
  listInvoices,
  listPublicPlans,
  meter,
  requestPlanChange,
  type BillingActor,
} from "@/server/billing/overview";
import { withTenant } from "@/server/db/context";
import { plans, subscriptions, tenants } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { inviteMember } from "@/server/team/invitations";
import { createTenant, randomId, type TenantFixture } from "../../helpers/fixtures";
import { auditTrail, ownerActor, pgCode, systemRole } from "../team/helpers";
import { addBooking, addInvoice, addMedia, addPublicPlan, addTour } from "./helpers";

const INSUFFICIENT_PRIVILEGE = "42501";

const billingOwner = (tenant: TenantFixture): BillingActor => ownerActor(tenant);

function platformState(tenant: TenantFixture) {
  return withPlatform(async (tx) => {
    const [workspace] = await tx
      .select({ planId: tenants.planId, limitOverrides: tenants.limitOverrides })
      .from(tenants)
      .where(eq(tenants.id, tenant.tenantId));
    const [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenant.tenantId));
    return { workspace: workspace!, subscription: subscription! };
  });
}

describe("billing overview", () => {
  it("shows the plan, subscription, entitlements and usage against the limits", async () => {
    const tenant = await createTenant({ plan: { maxTeamMembers: 4, maxPublishedTours: 10, maxStorageMb: 100, maxBookingsPerMonth: 50 } });
    const staff = await systemRole(tenant, "staff");
    await withTenant(tenant.tenantId, (scope) => inviteMember(scope, ownerActor(tenant), { email: "overview@example.test", roleId: staff.id }));
    const tour = await addTour(tenant, "published");
    await addMedia(tenant, 25 * 1024 * 1024);
    await addBooking(tenant, tour, "2027-03-05T10:00:00Z");

    const overview = await withTenant(tenant.tenantId, (scope) => getBillingOverview(scope, { today: "2027-03-15" }));

    expect(overview.plan).toMatchObject({
      id: tenant.planId,
      priceMonthly: 0,
      priceYearly: 0,
      currency: "USD",
      limits: { maxTeamMembers: 4, maxPublishedTours: 10, maxStorageMb: 100, maxBookingsPerMonth: 50 },
    });
    expect(overview.plan.features).toMatchObject({ customDomain: true, promotions: true });
    expect(overview.plan.name).toBe(overview.entitlements.plan.name);

    expect(overview.subscription).toMatchObject({ status: "active", cycle: "monthly", cancelAtPeriodEnd: false });
    expect(overview.subscription!.currentPeriodEnd.getTime()).toBeGreaterThan(overview.subscription!.currentPeriodStart.getTime());

    expect(overview.entitlements).toMatchObject({ subscriptionStatus: "active", limits: { maxTeamMembers: 4, maxStorageMb: 100 } });
    expect(overview.usage).toEqual({ teamMembers: 1, pendingInvitations: 1, publishedTours: 1, storageBytes: 26_214_400, bookingsThisMonth: 1 });
    expect(overview.meters).toEqual({
      // The owner plus one pending invitation: two of four seats.
      maxTeamMembers: { used: 2, limit: 4, percent: 50 },
      maxPublishedTours: { used: 1, limit: 10, percent: 10 },
      maxStorageMb: { used: 25, limit: 100, percent: 25 },
      maxBookingsPerMonth: { used: 1, limit: 50, percent: 2 },
    });
    expect(overview.invoices).toEqual({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 });
  });

  it("applies platform-set overrides to the effective limits and reports unlimited as null", async () => {
    const tenant = await createTenant({ plan: { maxTeamMembers: 2, maxPublishedTours: null } });
    await withPlatform((tx) => tx.update(tenants).set({ limitOverrides: { maxTeamMembers: 10 } }).where(eq(tenants.id, tenant.tenantId)));

    const overview = await withTenant(tenant.tenantId, (scope) => getBillingOverview(scope, { today: "2027-03-15" }));

    // The plan card shows what the plan sells; the meters show what this workspace actually gets.
    expect(overview.plan.limits.maxTeamMembers).toBe(2);
    expect(overview.meters.maxTeamMembers).toEqual({ used: 1, limit: 10, percent: 10 });
    expect(overview.meters.maxPublishedTours).toEqual({ used: 0, limit: null, percent: null });
  });

  it("reflects the subscription the platform set", async () => {
    const tenant = await createTenant();
    const start = new Date("2027-01-01T00:00:00Z");
    const end = new Date("2028-01-01T00:00:00Z");
    await withPlatform((tx) =>
      tx
        .update(subscriptions)
        .set({ status: "past_due", cycle: "yearly", currentPeriodStart: start, currentPeriodEnd: end, cancelAtPeriodEnd: true, providerRef: "sub_secret" })
        .where(eq(subscriptions.tenantId, tenant.tenantId)),
    );

    const overview = await withTenant(tenant.tenantId, (scope) => getBillingOverview(scope, { today: "2027-03-15" }));

    expect(overview.subscription).toEqual({ status: "past_due", cycle: "yearly", currentPeriodStart: start, currentPeriodEnd: end, cancelAtPeriodEnd: true });
    expect(overview.entitlements.subscriptionStatus).toBe("past_due");
    expect(JSON.stringify(overview)).not.toContain("sub_secret");
  });

  it("reports no subscription rather than failing when the row is missing", async () => {
    const tenant = await createTenant();
    await withPlatform((tx) => tx.delete(subscriptions).where(eq(subscriptions.tenantId, tenant.tenantId)));

    const overview = await withTenant(tenant.tenantId, (scope) => getBillingOverview(scope, { today: "2027-03-15" }));

    expect(overview.subscription).toBeNull();
    expect(overview.entitlements.subscriptionStatus).toBe("none");
  });

  it("computes percentages, including over-use and a zero allowance", () => {
    expect(meter(3, 4)).toEqual({ used: 3, limit: 4, percent: 75 });
    expect(meter(1, 3)).toEqual({ used: 1, limit: 3, percent: 33.3 });
    expect(meter(6, 4)).toEqual({ used: 6, limit: 4, percent: 150 });
    expect(meter(0, 0)).toEqual({ used: 0, limit: 0, percent: 0 });
    expect(meter(2, 0)).toEqual({ used: 2, limit: 0, percent: 100 });
    expect(meter(9, null)).toEqual({ used: 9, limit: null, percent: null });
  });
});

describe("invoice history", () => {
  it("lists invoices newest first, in pages, without provider internals", async () => {
    const tenant = await createTenant();
    const numbers: string[] = [];
    for (let month = 1; month <= 5; month += 1) {
      const invoice = await addInvoice(tenant, { issuedAt: new Date(Date.UTC(2027, month - 1, 1)), amount: 1000 * month });
      numbers.push(invoice.number);
    }
    const newestFirst = [...numbers].reverse();

    const first = await withTenant(tenant.tenantId, (scope) => listInvoices(scope, { page: 1, pageSize: 2 }));
    const third = await withTenant(tenant.tenantId, (scope) => listInvoices(scope, { page: 3, pageSize: 2 }));
    const beyond = await withTenant(tenant.tenantId, (scope) => listInvoices(scope, { page: 9, pageSize: 2 }));
    const defaults = await withTenant(tenant.tenantId, (scope) => listInvoices(scope));

    expect(first).toMatchObject({ total: 5, page: 1, pageSize: 2, pageCount: 3 });
    expect(first.items.map((invoice) => invoice.number)).toEqual(newestFirst.slice(0, 2));
    expect(first.items[0]).toMatchObject({ amount: 5000, currency: "USD", status: "paid", description: "Monthly subscription" });
    expect(third.items.map((invoice) => invoice.number)).toEqual(newestFirst.slice(4));
    expect(beyond).toMatchObject({ items: [], total: 5 });
    expect(defaults.items).toHaveLength(5);
    expect(defaults.pageSize).toBe(20);
    expect(JSON.stringify(defaults)).not.toContain("ch_internal_reference");
    expect(Object.keys(defaults.items[0]!)).not.toContain("tenantId");
  });

  it("includes the requested invoice page in the overview", async () => {
    const tenant = await createTenant();
    await addInvoice(tenant, { issuedAt: new Date("2027-01-01T00:00:00Z") });
    const latest = await addInvoice(tenant, { issuedAt: new Date("2027-02-01T00:00:00Z"), status: "open" });

    const overview = await withTenant(tenant.tenantId, (scope) =>
      getBillingOverview(scope, { today: "2027-03-15", invoices: { page: 1, pageSize: 1 } }),
    );

    expect(overview.invoices).toMatchObject({ total: 2, pageCount: 2, pageSize: 1 });
    expect(overview.invoices.items).toHaveLength(1);
    expect(overview.invoices.items[0]).toMatchObject({ id: latest.id, status: "open", paidAt: null });
  });

  it("reads one invoice by id and rejects bad paging", async () => {
    const tenant = await createTenant();
    const invoice = await addInvoice(tenant);

    expect(await withTenant(tenant.tenantId, (scope) => getInvoice(scope, invoice.id))).toMatchObject({ id: invoice.id, number: invoice.number });
    await expect(withTenant(tenant.tenantId, (scope) => getInvoice(scope, randomId()))).rejects.toBeInstanceOf(NotFoundError);
    await expect(withTenant(tenant.tenantId, (scope) => getInvoice(scope, "INV-1"))).rejects.toBeInstanceOf(NotFoundError);

    for (const paging of [{ page: 0 }, { pageSize: 0 }, { pageSize: 101 }, { page: 1.5 }]) {
      await expect(withTenant(tenant.tenantId, (scope) => listInvoices(scope, paging))).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe("plan picker", () => {
  it("lists public plans in display order and leaves private plans out", async () => {
    const tenant = await createTenant(); // its own plan is private
    const growth = await addPublicPlan({ name: "Growth", sortOrder: 20, priceMonthly: 9900 });
    const starter = await addPublicPlan({ name: "Starter", sortOrder: 10, priceMonthly: 2900 });
    const basic = await addPublicPlan({ name: "Basic", sortOrder: 10, priceMonthly: 1900 });
    const hidden = await addPublicPlan({ name: "Hidden", sortOrder: 5, priceMonthly: 100, isPublic: false });

    const list = await listPublicPlans();

    const ids = list.map((plan) => plan.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(tenant.planId);
    // Same sort order: the cheaper plan first.
    expect(ids.indexOf(basic.id)).toBeLessThan(ids.indexOf(starter.id));
    expect(ids.indexOf(starter.id)).toBeLessThan(ids.indexOf(growth.id));
    expect(list.find((plan) => plan.id === starter.id)).toMatchObject({
      code: starter.code,
      name: "Starter",
      description: "Starter plan",
      priceMonthly: 2900,
      priceYearly: 29000,
      currency: "USD",
      limits: { maxTeamMembers: 5, maxPublishedTours: null, maxStorageMb: null, maxBookingsPerMonth: null },
      features: { customDomain: false, integrations: ["email"] },
    });
  });
});

describe("requesting a plan change", () => {
  it("records the request and returns the target plan without changing anything", async () => {
    const tenant = await createTenant();
    const target = await addPublicPlan({ name: "Growth", sortOrder: 20, priceMonthly: 9900 });
    const before = await platformState(tenant);

    const plan = await withTenant(tenant.tenantId, (scope) => requestPlanChange(scope, billingOwner(tenant), ` ${target.code} `), {
      userId: tenant.ownerId,
    });

    expect(plan).toMatchObject({ id: target.id, code: target.code, name: "Growth", priceMonthly: 9900 });
    expect(await platformState(tenant)).toEqual(before);
    const [fromPlan] = await withPlatform((tx) => tx.select({ code: plans.code }).from(plans).where(eq(plans.id, tenant.planId)));
    expect((await auditTrail(tenant)).find((entry) => entry.action === "billing.plan_change_requested")).toMatchObject({
      targetId: target.id,
      actorUserId: tenant.ownerId,
      metadata: { fromPlan: fromPlan!.code, toPlan: target.code, requestedBy: tenant.ownerId },
    });
  });

  it("refuses the current plan, private plans, unknown codes and actors without billing rights", async () => {
    const tenant = await createTenant();
    const target = await addPublicPlan({ name: "Growth", sortOrder: 20, priceMonthly: 9900 });
    const hidden = await addPublicPlan({ name: "Enterprise", sortOrder: 30, priceMonthly: 99900, isPublic: false });
    const actor = billingOwner(tenant);
    const request = (who: BillingActor, code: string) => withTenant(tenant.tenantId, (scope) => requestPlanChange(scope, who, code));

    await expect(request(actor, hidden.code)).rejects.toBeInstanceOf(NotFoundError);
    await expect(request(actor, "no-such-plan")).rejects.toThrow("Plan not found.");
    await expect(request(actor, "   ")).rejects.toBeInstanceOf(ValidationError);
    await expect(request({ userId: randomId(), isOwner: false, permissions: ["billing.view"] }, target.code)).rejects.toBeInstanceOf(ForbiddenError);

    // A non-owner who was granted billing.manage may ask.
    expect((await request({ userId: tenant.ownerId, isOwner: false, permissions: ["billing.manage"] }, target.code)).id).toBe(target.id);

    // Once the platform has actually moved the workspace, asking for the same plan is a conflict.
    await withPlatform((tx) => tx.update(tenants).set({ planId: target.id }).where(eq(tenants.id, tenant.tenantId)));
    const same = await request(actor, target.code).catch((error: unknown) => error);
    expect(same).toBeInstanceOf(ConflictError);
    expect(same).toMatchObject({ code: "same_plan" });
  });
});

describe("what the runtime database role may change about billing", () => {
  it("cannot update subscriptions, plans or its own plan and limits", async () => {
    const tenant = await createTenant({ plan: { maxTeamMembers: 2 } });
    const target = await addPublicPlan({ name: "Growth", sortOrder: 20, priceMonthly: 9900 });
    const before = await platformState(tenant);
    const inOwnTenant = (run: Parameters<typeof withTenant>[1]) => pgCode(() => withTenant(tenant.tenantId, run, { userId: tenant.ownerId }));

    expect(
      await inOwnTenant(({ tx }) => tx.update(subscriptions).set({ planId: target.id, status: "active" }).where(eq(subscriptions.tenantId, tenant.tenantId))),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await inOwnTenant(({ tx }) => tx.delete(subscriptions).where(eq(subscriptions.tenantId, tenant.tenantId)))).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await inOwnTenant(({ tx }) => tx.update(plans).set({ maxTeamMembers: null }).where(eq(plans.id, tenant.planId)))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect(await inOwnTenant(({ tx }) => tx.update(plans).set({ priceMonthly: 0 }).where(eq(plans.id, target.id)))).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await inOwnTenant(({ tx }) => tx.update(tenants).set({ planId: target.id }).where(eq(tenants.id, tenant.tenantId)))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect(
      await inOwnTenant(({ tx }) => tx.update(tenants).set({ limitOverrides: { maxTeamMembers: null } }).where(eq(tenants.id, tenant.tenantId))),
    ).toBe(INSUFFICIENT_PRIVILEGE);

    expect(await platformState(tenant)).toEqual(before);
    const [plan] = await withPlatform((tx) => tx.select({ maxTeamMembers: plans.maxTeamMembers }).from(plans).where(eq(plans.id, tenant.planId)));
    expect(plan).toEqual({ maxTeamMembers: 2 });
  });
});
