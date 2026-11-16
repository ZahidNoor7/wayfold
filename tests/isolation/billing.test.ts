import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getBillingOverview, getInvoice, listInvoices, requestPlanChange } from "@/server/billing/overview";
import { getUsage } from "@/server/billing/usage";
import { withTenant } from "@/server/db/context";
import { invoices, subscriptions, tenants } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { inviteMember } from "@/server/team/invitations";
import { createTenant } from "../helpers/fixtures";
import { addBooking, addInvoice, addMedia, addPublicPlan, addTour } from "../integration/billing/helpers";
import { addMember, auditTrail, ownerActor, systemRole } from "../integration/team/helpers";

const TODAY = "2027-03-15";

describe("billing isolation: usage", () => {
  it("never includes another workspace's members, invitations, tours, media or bookings", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const staffOfA = await systemRole(a, "staff");
    await addMember(a, "staff");
    await addMember(a, "admin");
    await withTenant(a.tenantId, (scope) => inviteMember(scope, ownerActor(a), { email: "a-only@example.test", roleId: staffOfA.id }));
    const tourOfA = await addTour(a, "published");
    await addTour(a, "published");
    await addMedia(a, 9_000_000);
    await addBooking(a, tourOfA, "2027-03-10T09:00:00Z");
    await addBooking(a, tourOfA, "2027-03-11T09:00:00Z");

    const usageOfB = await withTenant(b.tenantId, (scope) => getUsage(scope, { today: TODAY }));
    const usageOfA = await withTenant(a.tenantId, (scope) => getUsage(scope, { today: TODAY }));

    expect(usageOfB).toEqual({ teamMembers: 1, pendingInvitations: 0, publishedTours: 0, storageBytes: 0, bookingsThisMonth: 0 });
    expect(usageOfA).toEqual({ teamMembers: 3, pendingInvitations: 1, publishedTours: 2, storageBytes: 9_000_000, bookingsThisMonth: 2 });

    // B's own activity moves B's numbers and leaves A's alone.
    await addMedia(b, 1_000);
    await addBooking(b, await addTour(b, "published"), "2027-03-12T09:00:00Z");
    expect(await withTenant(b.tenantId, (scope) => getUsage(scope, { today: TODAY }))).toMatchObject({
      publishedTours: 1,
      storageBytes: 1_000,
      bookingsThisMonth: 1,
    });
    expect(await withTenant(a.tenantId, (scope) => getUsage(scope, { today: TODAY }))).toEqual(usageOfA);
  });
});

describe("billing isolation: overview and invoices", () => {
  it("shows each workspace its own plan, subscription, limits and invoices", async () => {
    const a = await createTenant({ plan: { maxTeamMembers: 50, maxStorageMb: 5000 } });
    const b = await createTenant({ plan: { maxTeamMembers: 2, maxStorageMb: 10 } });
    await withPlatform(async (tx) => {
      await tx.update(subscriptions).set({ status: "past_due", cycle: "yearly", cancelAtPeriodEnd: true }).where(eq(subscriptions.tenantId, a.tenantId));
      await tx.update(tenants).set({ limitOverrides: { maxPublishedTours: 999 } }).where(eq(tenants.id, a.tenantId));
    });
    const invoiceOfA = await addInvoice(a, { amount: 123_456, description: "Annual plan for A" });
    await addMedia(a, 50 * 1024 * 1024);

    const overviewOfB = await withTenant(b.tenantId, (scope) => getBillingOverview(scope, { today: TODAY }));

    expect(overviewOfB.plan.id).toBe(b.planId);
    expect(overviewOfB.plan.limits).toMatchObject({ maxTeamMembers: 2, maxStorageMb: 10 });
    expect(overviewOfB.subscription).toMatchObject({ status: "active", cycle: "monthly", cancelAtPeriodEnd: false });
    expect(overviewOfB.entitlements.limits.maxPublishedTours).toBeNull();
    expect(overviewOfB.meters.maxStorageMb).toEqual({ used: 0, limit: 10, percent: 0 });
    expect(overviewOfB.invoices).toMatchObject({ items: [], total: 0 });
    const serialised = JSON.stringify(overviewOfB);
    expect(serialised).not.toContain(invoiceOfA.number);
    expect(serialised).not.toContain("Annual plan for A");
    expect(serialised).not.toContain(a.planId);
    expect(serialised).not.toContain(a.tenantId);
  });

  it("cannot list or read another workspace's invoices", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const invoiceOfA = await addInvoice(a);
    const invoiceOfB = await addInvoice(b);

    const listedByB = await withTenant(b.tenantId, (scope) => listInvoices(scope, { page: 1, pageSize: 100 }));
    expect(listedByB.items.map((invoice) => invoice.id)).toEqual([invoiceOfB.id]);
    expect(listedByB.total).toBe(1);

    const error = await withTenant(b.tenantId, (scope) => getInvoice(scope, invoiceOfA.id)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).message).toBe("Invoice not found.");

    // Going underneath the service does not help either: row-level security hides the row.
    const direct = await withTenant(b.tenantId, ({ tx }) => tx.select().from(invoices).where(eq(invoices.id, invoiceOfA.id)));
    expect(direct).toEqual([]);
    const subscriptionOfA = await withTenant(b.tenantId, ({ tx }) => tx.select().from(subscriptions).where(eq(subscriptions.tenantId, a.tenantId)));
    expect(subscriptionOfA).toEqual([]);
  });

  it("records a plan change request only in the requesting workspace and changes neither", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const target = await addPublicPlan({ name: "Growth", sortOrder: 20, priceMonthly: 9900 });

    await withTenant(b.tenantId, (scope) => requestPlanChange(scope, ownerActor(b), target.code), { userId: b.ownerId });

    expect(await auditTrail(a)).toEqual([]);
    expect((await auditTrail(b)).map((entry) => entry.action)).toEqual(["billing.plan_change_requested"]);
    const rows = await withPlatform((tx) => tx.select({ id: tenants.id, planId: tenants.planId }).from(tenants).where(eq(tenants.id, a.tenantId)));
    expect(rows).toEqual([{ id: a.tenantId, planId: a.planId }]);
    const [own] = await withPlatform((tx) => tx.select({ planId: tenants.planId }).from(tenants).where(eq(tenants.id, b.tenantId)));
    expect(own).toEqual({ planId: b.planId });
  });
});
