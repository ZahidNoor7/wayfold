import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { closeDatabases } from "@/server/db/client";
import { resetRuntimeRoleCheck } from "@/server/db/context";
import {
  auditLogs,
  bookings,
  customers,
  integrations,
  invoices,
  mediaAssets,
  notificationOutbox,
  plans,
  subscriptions,
  tenants,
  tours,
} from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { getPlatformStats, getSystemHealth } from "@/server/platform/analytics";
import { withPlatform } from "@/server/platform/db";
import { suspendTenant } from "@/server/platform/tenants";
import { createTenant, createUser, unique } from "../../helpers/fixtures";
import journal from "../../../drizzle/meta/_journal.json";
import { caught, createAdmin } from "./helpers";

/** A workspace with one tour and one customer, ready to hold bookings. */
async function tenantWithCatalogue() {
  const tenant = await createTenant();
  const ids = await withPlatform(async (tx) => {
    const [tour] = await tx.insert(tours).values({ tenantId: tenant.tenantId, slug: "tour", title: "Tour" }).returning({ id: tours.id });
    const [customer] = await tx
      .insert(customers)
      .values({ tenantId: tenant.tenantId, name: "Guest", email: `${unique("guest")}@example.test` })
      .returning({ id: customers.id });
    return { tourId: tour!.id, customerId: customer!.id };
  });
  return { ...tenant, ...ids };
}

function booking(tenant: { tenantId: string; tourId: string; customerId: string }, status: "pending" | "confirmed" | "completed" | "cancelled", createdAt: string) {
  return {
    tenantId: tenant.tenantId,
    reference: unique("WF"),
    tourId: tenant.tourId,
    customerId: tenant.customerId,
    startDate: "2030-06-01",
    endDate: "2030-06-01",
    adults: 2,
    status,
    currency: "USD",
    unitPriceAdult: 5_000,
    unitPriceChild: 2_500,
    baseAmount: 10_000,
    totalAmount: 10_000,
    contactName: "Guest",
    contactEmail: "guest@example.test",
    tourTitle: "Tour",
    createdAt: new Date(createdAt),
  };
}

describe("platform analytics", () => {
  it("counts tenants and reports a 30-day registration series ending today", async () => {
    const owner = await createAdmin();
    // A window nothing else writes into, so the figures are exact.
    const today = "2001-03-31";
    const [a, b, c, outside] = await Promise.all([createTenant(), createTenant(), createTenant(), createTenant()]);
    await withPlatform(async (tx) => {
      await tx.update(tenants).set({ createdAt: new Date("2001-03-31T23:59:59Z") }).where(eq(tenants.id, a!.tenantId));
      await tx.update(tenants).set({ createdAt: new Date("2001-03-25T00:00:00Z") }).where(eq(tenants.id, b!.tenantId));
      await tx.update(tenants).set({ createdAt: new Date("2001-03-02T12:00:00Z") }).where(eq(tenants.id, c!.tenantId));
      // One second before the window opens.
      await tx.update(tenants).set({ createdAt: new Date("2001-03-01T23:59:59Z") }).where(eq(tenants.id, outside!.tenantId));
    });
    await suspendTenant(owner, c!.tenantId, "Testing suspended counts");

    const stats = await getPlatformStats(owner, { today });
    expect(stats.today).toBe(today);
    expect(stats.tenants.total).toBe(stats.tenants.active + stats.tenants.suspended);
    expect(stats.tenants.total).toBeGreaterThanOrEqual(4);
    expect(stats.tenants.suspended).toBeGreaterThanOrEqual(1);

    expect(stats.registrations.last7Days).toBe(2);
    expect(stats.registrations.last30Days).toBe(3);
    expect(stats.registrations.daily).toHaveLength(30);
    expect(stats.registrations.daily[0]).toEqual({ date: "2001-03-02", count: 1 });
    expect(stats.registrations.daily[29]).toEqual({ date: "2001-03-31", count: 1 });
    expect(stats.registrations.daily.find((day) => day.date === "2001-03-25")!.count).toBe(1);
    expect(stats.registrations.daily.reduce((total, day) => total + day.count, 0)).toBe(3);
  });

  it("estimates MRR from active subscriptions and totals paid invoices by month", async () => {
    const owner = await createAdmin();
    // A currency of its own keeps these sums independent of every other test.
    const currency = `X${Array.from(randomBytes(6), (byte) => String.fromCharCode(65 + (byte % 26))).join("")}`;
    const [monthly, yearly, cancelled, trialing] = await Promise.all([createTenant(), createTenant(), createTenant(), createTenant()]);

    await withPlatform(async (tx) => {
      for (const tenant of [monthly!, yearly!, cancelled!, trialing!]) {
        await tx.update(plans).set({ priceMonthly: 4_900, priceYearly: 50_000, currency }).where(eq(plans.id, tenant.planId));
      }
      await tx.update(subscriptions).set({ cycle: "yearly" }).where(eq(subscriptions.tenantId, yearly!.tenantId));
      await tx.update(subscriptions).set({ status: "cancelled" }).where(eq(subscriptions.tenantId, cancelled!.tenantId));
      await tx.update(subscriptions).set({ status: "trialing" }).where(eq(subscriptions.tenantId, trialing!.tenantId));

      const invoice = (number: string, amount: number, status: "open" | "paid" | "void", paidAt: string | null) => ({
        tenantId: monthly!.tenantId,
        number: `${unique("T")}-${number}`,
        description: "Analytics fixture",
        amount,
        currency,
        status,
        periodStart: new Date("2001-01-01T00:00:00Z"),
        periodEnd: new Date("2001-01-31T00:00:00Z"),
        paidAt: paidAt ? new Date(paidAt) : null,
      });
      await tx.insert(invoices).values([
        invoice("1", 1_000, "paid", "2002-05-03T10:00:00Z"),
        invoice("2", 2_500, "paid", "2002-05-28T10:00:00Z"),
        invoice("3", 700, "paid", "2002-06-15T00:00:00Z"),
        invoice("4", 9_999, "open", null),
        invoice("5", 8_888, "void", null),
        // Paid, but more than twelve months before `today`.
        invoice("6", 5_000, "paid", "2001-06-30T23:59:59Z"),
      ]);
    });

    const stats = await getPlatformStats(owner, { today: "2002-06-15" });
    // 4,900 monthly + round(50,000 / 12) = 4,167 yearly; cancelled and trialing do not count.
    expect(stats.mrr.find((row) => row.currency === currency)).toEqual({ currency, amount: 9_067 });
    expect(stats.revenueByMonth.filter((row) => row.currency === currency)).toEqual([
      { month: "2002-05", currency, amount: 3_500, invoices: 2 },
      { month: "2002-06", currency, amount: 700, invoices: 1 },
    ]);

    expect(stats.subscriptions.byPlan.find((row) => row.planId === monthly!.planId)).toMatchObject({ count: 1 });
    expect(stats.subscriptions.byStatus.cancelled).toBeGreaterThanOrEqual(1);
    expect(stats.subscriptions.byStatus.trialing).toBeGreaterThanOrEqual(1);
    expect(stats.subscriptions.byStatus.active).toBeGreaterThanOrEqual(2);
    const total = Object.values(stats.subscriptions.byStatus).reduce((sum, n) => sum + n, 0);
    expect(stats.subscriptions.byPlan.reduce((sum, row) => sum + row.count, 0)).toBe(total);
  });

  it("reports bookings across every workspace, by status and by day", async () => {
    const owner = await createAdmin();
    const a = await tenantWithCatalogue();
    const b = await tenantWithCatalogue();
    const before = await getPlatformStats(owner, { today: "2003-08-30" });

    await withPlatform((tx) =>
      tx.insert(bookings).values([
        booking(a, "pending", "2003-08-30T08:00:00Z"),
        booking(a, "confirmed", "2003-08-30T21:00:00Z"),
        booking(b, "cancelled", "2003-08-01T00:00:00Z"),
        booking(b, "completed", "2003-07-31T23:59:59Z"),
      ]),
    );

    const stats = await getPlatformStats(owner, { today: "2003-08-30" });
    expect(stats.bookings.daily).toHaveLength(30);
    expect(stats.bookings.daily[0]).toEqual({ date: "2003-08-01", count: 1 });
    expect(stats.bookings.daily[29]).toEqual({ date: "2003-08-30", count: 2 });
    expect(stats.bookings.daily.reduce((total, day) => total + day.count, 0)).toBe(3);
    expect(before.bookings.daily.reduce((total, day) => total + day.count, 0)).toBe(0);

    expect(stats.bookings.total).toBe(Object.values(stats.bookings.byStatus).reduce((sum, n) => sum + n, 0));
    expect(stats.bookings.total).toBeGreaterThanOrEqual(before.bookings.total + 4);
    for (const status of ["pending", "confirmed", "completed", "cancelled"] as const) {
      expect(stats.bookings.byStatus[status]).toBeGreaterThanOrEqual(before.bookings.byStatus[status] + 1);
    }
  });

  it("totals storage, ranks the heaviest workspaces and counts integrations by provider and status", async () => {
    const owner = await createAdmin();
    const heavy = await createTenant();
    const light = await createTenant();
    const provider = `probe_${unique("p").slice(-8).replace(/-/g, "_")}`;
    // Far beyond anything another test stores, so the ranking is certain.
    const HUGE = 9_000_000_000_000;

    await withPlatform(async (tx) => {
      const asset = (tenantId: string, bytes: number) => ({
        tenantId,
        storageOwner: "platform" as const,
        provider: "cloudinary",
        publicId: unique("asset"),
        resourceType: "image" as const,
        url: "https://res.example.test/x.jpg",
        bytes,
      });
      await tx.insert(mediaAssets).values([asset(heavy.tenantId, HUGE), asset(heavy.tenantId, 1_000), asset(light.tenantId, HUGE - 5)]);

      const connection = (tenantId: string, status: "connected" | "error", label: string) => ({
        tenantId,
        provider,
        category: "media",
        label,
        status,
        secretCiphertext: "wf1.x.y.z",
        keyVersion: "v2",
      });
      await tx
        .insert(integrations)
        .values([connection(heavy.tenantId, "connected", "A"), connection(heavy.tenantId, "error", "B"), connection(light.tenantId, "connected", "A")]);
    });

    const stats = await getPlatformStats(owner);
    expect(stats.today).toBe(new Date().toISOString().slice(0, 10));
    expect(stats.storage.totalBytes).toBeGreaterThanOrEqual(2 * HUGE + 995);
    expect(stats.storage.topTenants.length).toBeLessThanOrEqual(5);
    expect(stats.storage.topTenants.slice(0, 2)).toEqual([
      { tenantId: heavy.tenantId, name: expect.any(String), slug: heavy.slug, bytes: HUGE + 1_000 },
      { tenantId: light.tenantId, name: expect.any(String), slug: light.slug, bytes: HUGE - 5 },
    ]);
    expect(stats.integrations.filter((row) => row.provider === provider)).toEqual([
      { provider, status: "connected", count: 2 },
      { provider, status: "error", count: 1 },
    ]);
    // Aggregates only: no credential material is part of the dashboard.
    expect(JSON.stringify(stats)).not.toContain("wf1.");
  });

  it("shows the latest platform events, including system jobs, but not ordinary tenant activity", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();
    const member = await createUser();
    await withPlatform((tx) =>
      tx.insert(auditLogs).values({ tenantId: tenant.tenantId, actorType: "user", actorUserId: member.id, action: "tour.published-by-tenant" }),
    );
    await suspendTenant(owner, tenant.tenantId, "Shows up in the operational log");

    const stats = await getPlatformStats(owner);
    expect(stats.recentActivity.length).toBeLessThanOrEqual(20);
    expect(stats.recentActivity.find((row) => row.actorUserId === owner.userId)).toMatchObject({
      action: "tenant.suspended",
      actorType: "platform_admin",
      tenantId: tenant.tenantId,
    });
    expect(stats.recentActivity.some((row) => row.action === "tour.published-by-tenant")).toBe(false);
    for (let i = 1; i < stats.recentActivity.length; i++) {
      expect(stats.recentActivity[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(stats.recentActivity[i]!.createdAt.getTime());
    }
  });

  it("validates the date and lets support read but nobody else", async () => {
    const support = await createAdmin("support");
    const stranger = await createUser();
    expect((await getPlatformStats(support, { today: "2001-03-31" })).registrations.daily).toHaveLength(30);
    expect(await caught(() => getPlatformStats(support, { today: "31/03/2001" }))).toBeInstanceOf(ValidationError);
    expect(await caught(() => getPlatformStats(support, { today: "2001-02-30" }))).toBeInstanceOf(ValidationError);
    expect(await caught(() => getPlatformStats({ userId: stranger.id, role: "support" }))).toBeInstanceOf(ForbiddenError);
    expect(await caught(() => getSystemHealth({ userId: stranger.id, role: "owner" }))).toBeInstanceOf(ForbiddenError);
  });
});

describe("system health", () => {
  const original = process.env.DATABASE_URL!;

  async function useRuntimeUrl(url: string): Promise<void> {
    await closeDatabases();
    process.env.DATABASE_URL = url;
    resetEnvCache();
    resetRuntimeRoleCheck();
  }

  afterEach(async () => {
    await useRuntimeUrl(original);
  });

  it("reports a healthy installation and the notification backlog", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();
    const before = await getSystemHealth(owner);
    const message = (status: "pending" | "failed" | "sent", createdAt: string) => ({
      tenantId: tenant.tenantId,
      kind: "booking.received",
      toEmail: "guest@example.test",
      subject: "Subject",
      bodyText: "Body",
      status,
      createdAt: new Date(createdAt),
    });
    await withPlatform((tx) =>
      tx
        .insert(notificationOutbox)
        .values([message("pending", "1999-01-02T03:04:05Z"), message("pending", "2020-01-01T00:00:00Z"), message("failed", "1998-01-01T00:00:00Z"), message("sent", "1997-01-01T00:00:00Z")]),
    );

    const health = await getSystemHealth(owner);
    expect(health.database).toEqual({ platformReachable: true, runtimeReachable: true });
    expect(health.runtimeRole).toEqual({ safe: true, problem: null });
    // Read from the migration ledger itself: this database has had every migration the build ships.
    expect(health.migrations).toEqual({ expected: journal.entries.length, applied: journal.entries.length, pending: 0 });
    // At least: other workspaces queue notifications while this runs.
    expect(health.outbox.pending).toBeGreaterThanOrEqual(before.outbox.pending + 2);
    expect(health.outbox.failed).toBeGreaterThanOrEqual(before.outbox.failed + 1);
    expect(health.outbox.oldestPendingAt?.toISOString()).toBe("1999-01-02T03:04:05.000Z");

    expect((await getPlatformStats(owner)).health.runtimeRole.safe).toBe(true);
  });

  it("does not need a second connection from a pool that only has one", async () => {
    const owner = await createAdmin();
    const previous = process.env.DATABASE_POOL_MAX;
    process.env.DATABASE_POOL_MAX = "1";
    await useRuntimeUrl(original);
    try {
      // Would wait forever if a probe asked for a connection while the dashboard's transaction held the only one.
      const stats = await getPlatformStats(owner);
      expect(stats.health.database).toEqual({ platformReachable: true, runtimeReachable: true });
      expect((await getSystemHealth(owner)).runtimeRole.safe).toBe(true);
    } finally {
      process.env.DATABASE_POOL_MAX = previous;
    }
  });

  it("flags a runtime connection that is not restricted by row-level security", async () => {
    const owner = await createAdmin();
    // The classic misconfiguration: the app is pointed at the platform login.
    await useRuntimeUrl(process.env.DATABASE_PLATFORM_URL!);

    const health = await getSystemHealth(owner);
    expect(health.database.runtimeReachable).toBe(false);
    expect(health.runtimeRole.safe).toBe(false);
    expect(health.runtimeRole.problem).toContain("wayfold_platform");
  });

  it("reports an unreachable runtime database without failing the whole dashboard", async () => {
    const owner = await createAdmin();
    // Nothing listens on port 1.
    await useRuntimeUrl("postgres://wf_app:wf_app_local@127.0.0.1:1/unreachable");

    const health = await getSystemHealth(owner);
    expect(health.database).toEqual({ platformReachable: true, runtimeReachable: false });
    expect(health.runtimeRole).toEqual({ safe: false, problem: "The runtime role could not be checked." });
    expect(health.migrations).toEqual({ expected: journal.entries.length, applied: journal.entries.length, pending: 0 });
  });
});
