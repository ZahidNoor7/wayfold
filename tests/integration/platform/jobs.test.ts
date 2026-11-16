import { desc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createSession, validateSessionToken } from "@/server/auth/sessions";
import { withTenant } from "@/server/db/context";
import { auditLogs, bookings, customers, integrations, notificationOutbox, sessions, tenants, tours } from "@/server/db/schema";
import { saveIntegration } from "@/server/integrations";
import { enqueueNotification } from "@/server/notifications";
import { withPlatform } from "@/server/platform/db";
import { NOTIFICATIONS_PER_TENANT, runScheduledJobs } from "@/server/platform/jobs";
import { createTenant, createUser, unique, type TenantFixture } from "../../helpers/fixtures";

// The network edge: nodemailer's transport is replaced, nothing else.
const transport = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: transport.sendMail, close: transport.close }) },
}));

// Fault injection for the two jobs that cannot be made to fail with data
// alone. When not armed, the real functions run unchanged.
const fault = vi.hoisted(() => ({ holdsFor: new Set<string>(), sessions: false }));
vi.mock("@/server/bookings/service", async (original) => {
  const actual = await original<typeof import("@/server/bookings/service")>();
  return {
    ...actual,
    expireStaleHolds: (...args: Parameters<typeof actual.expireStaleHolds>) => {
      if (fault.holdsFor.has(args[0].tenantId)) throw new Error("secret-detail: hold expiry exploded for guest@example.test");
      return actual.expireStaleHolds(...args);
    },
  };
});
vi.mock("@/server/auth/sessions", async (original) => {
  const actual = await original<typeof import("@/server/auth/sessions")>();
  return {
    ...actual,
    deleteExpiredSessions: () => {
      if (fault.sessions) throw new Error("secret-detail: session cleanup exploded");
      return actual.deleteExpiredSessions();
    },
  };
});

const NOW = new Date("2027-03-10T12:00:00Z");
const SMTP_PASSWORD = "pw-jobs-Sup3r-s3cret!";

function connectSmtp(tenant: TenantFixture) {
  return withTenant(
    tenant.tenantId,
    (scope) =>
      saveIntegration(scope, {
        provider: "smtp",
        config: { host: "smtp.jobs.example", port: 587, secure: false, requireTLS: true, fromName: "Jobs Tours", fromEmail: "bookings@jobs.example" },
        secrets: { username: "mailer@jobs.example", password: SMTP_PASSWORD },
      }),
    { userId: tenant.ownerId },
  );
}

/** A pending booking request whose hold ends at `holdExpiresAt`. */
async function pendingBooking(tenant: TenantFixture, holdExpiresAt: Date, status: "pending" | "confirmed" = "pending"): Promise<string> {
  return withPlatform(async (tx) => {
    const [tour] = await tx.insert(tours).values({ tenantId: tenant.tenantId, slug: unique("tour"), title: "Sheki Day Trip" }).returning({ id: tours.id });
    const [customer] = await tx
      .insert(customers)
      .values({ tenantId: tenant.tenantId, name: "Leyla Guest", email: `${unique("guest")}@example.test` })
      .returning({ id: customers.id });
    const [booking] = await tx
      .insert(bookings)
      .values({
        tenantId: tenant.tenantId,
        reference: unique("WF"),
        tourId: tour!.id,
        customerId: customer!.id,
        startDate: "2027-06-01",
        endDate: "2027-06-01",
        adults: 2,
        status,
        holdExpiresAt,
        currency: "USD",
        unitPriceAdult: 5_000,
        unitPriceChild: 2_500,
        baseAmount: 10_000,
        totalAmount: 10_000,
        contactName: "Leyla Guest",
        contactEmail: "leyla.guest@example.test",
        tourTitle: "Sheki Day Trip",
      })
      .returning({ id: bookings.id });
    return booking!.id;
  });
}

async function bookingRow(id: string) {
  const [row] = await withPlatform((tx) => tx.select().from(bookings).where(eq(bookings.id, id)));
  return row!;
}

function outbox(tenant: TenantFixture) {
  return withPlatform((tx) => tx.select().from(notificationOutbox).where(eq(notificationOutbox.tenantId, tenant.tenantId)));
}

function queue(tenant: TenantFixture, count = 1) {
  return withTenant(tenant.tenantId, async (scope) => {
    for (let i = 0; i < count; i++) {
      await enqueueNotification(scope, {
        kind: "booking.confirmed",
        toEmail: "leyla.guest@example.test",
        subject: `Your booking ${i} is confirmed`,
        bodyText: "PRIVATE-BODY: see you at the meeting point.",
      });
    }
  });
}

async function lastRunAudit() {
  const [row] = await withPlatform((tx) =>
    tx.select().from(auditLogs).where(eq(auditLogs.action, "jobs.scheduled_run")).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(1),
  );
  return row!;
}

describe("runScheduledJobs", () => {
  let errorLog: MockInstance<typeof console.error>;

  beforeEach(() => {
    errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    transport.sendMail.mockReset().mockResolvedValue({ messageId: "<1@jobs>", accepted: ["leyla.guest@example.test"], rejected: [] });
    transport.close.mockReset();
  });
  afterEach(() => {
    errorLog.mockRestore();
    fault.holdsFor.clear();
    fault.sessions = false;
  });

  const logged = () => errorLog.mock.calls.map((call) => String(call[0])).join("\n");

  it("expires stale holds and delivers through each workspace's own mailer, or parks the message when there is none", async () => {
    const withMail = await createTenant();
    const withoutMail = await createTenant();
    await connectSmtp(withMail);

    const stale = await pendingBooking(withMail, new Date(NOW.getTime() - 60_000));
    const exactlyNow = await pendingBooking(withoutMail, NOW);
    const fresh = await pendingBooking(withMail, new Date(NOW.getTime() + 60_000));
    const confirmed = await pendingBooking(withMail, new Date(NOW.getTime() - 60_000), "confirmed");
    await queue(withoutMail);

    const report = await runScheduledJobs({ now: NOW, tenantIds: [withMail.tenantId, withoutMail.tenantId] });
    expect(report).toEqual({
      tenants: 2,
      holdsExpired: 2,
      // One cancellation notice sent; one cancellation notice and one queued message parked.
      notifications: { sent: 1, failed: 0, skipped: 2, retrying: 0, deferred: 0 },
      sessionsDeleted: expect.any(Number),
      errors: { holds: 0, notifications: 0, sessions: 0 },
    });

    expect(await bookingRow(stale)).toMatchObject({ status: "cancelled", cancelKind: "expired", cancelledAt: NOW });
    expect(await bookingRow(exactlyNow)).toMatchObject({ status: "cancelled", cancelKind: "expired" });
    expect((await bookingRow(fresh)).status).toBe("pending");
    expect((await bookingRow(confirmed)).status).toBe("confirmed");

    // The notice queued by the first transaction went out in the second, through this tenant's SMTP account.
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    expect(transport.sendMail.mock.calls[0]![0]).toMatchObject({
      from: { name: "Jobs Tours", address: "bookings@jobs.example" },
      to: "leyla.guest@example.test",
    });
    expect((await outbox(withMail)).map((row) => row.status)).toEqual(["sent"]);
    // No mailer of its own means no delivery at all, never somebody else's account.
    expect((await outbox(withoutMail)).map((row) => row.status).sort()).toEqual(["skipped", "skipped"]);

    // The expiry is in each tenant's own audit log, written under its own row-level security.
    const tenantLog = await withTenant(withMail.tenantId, ({ tx }) => tx.select().from(auditLogs).where(eq(auditLogs.action, "booking.expired")));
    expect(tenantLog).toEqual([expect.objectContaining({ tenantId: withMail.tenantId, targetId: stale, actorType: "system" })]);

    // Running again finds nothing left to do.
    const again = await runScheduledJobs({ now: NOW, tenantIds: [withMail.tenantId, withoutMail.tenantId] });
    expect(again).toMatchObject({ tenants: 2, holdsExpired: 0, notifications: { sent: 0, failed: 0, skipped: 0, retrying: 0, deferred: 0 } });
  });

  it("carries on when one workspace's delivery fails, and counts the failure without its details", async () => {
    const broken = await createTenant();
    const healthy = await createTenant();
    await connectSmtp(broken);
    await connectSmtp(healthy);
    // The stored credential can no longer be opened: delivery for this workspace throws.
    await withPlatform((tx) => tx.update(integrations).set({ secretCiphertext: "wf1.AAAA.BBBB.CCCC" }).where(eq(integrations.tenantId, broken.tenantId)));

    const brokenHold = await pendingBooking(broken, new Date(NOW.getTime() - 1));
    const healthyHold = await pendingBooking(healthy, new Date(NOW.getTime() - 1));

    // Listed first by id or not, the healthy workspace must be fully processed.
    const report = await runScheduledJobs({ now: NOW, tenantIds: [broken.tenantId, healthy.tenantId], tenantBatch: 1 });
    expect(report).toMatchObject({
      tenants: 2,
      holdsExpired: 2,
      notifications: { sent: 1, failed: 0, skipped: 0, retrying: 0, deferred: 0 },
      errors: { holds: 0, notifications: 1, sessions: 0 },
    });

    // Hold expiry committed for both, in a transaction separate from the failed delivery.
    expect((await bookingRow(brokenHold)).status).toBe("cancelled");
    expect((await bookingRow(healthyHold)).status).toBe("cancelled");
    expect((await outbox(healthy)).map((row) => row.status)).toEqual(["sent"]);
    // The failed workspace's message is untouched and waits for the next run.
    expect((await outbox(broken)).map((row) => [row.status, row.attempts])).toEqual([["pending", 0]]);

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(logged()).toContain("deliver-notifications");
    expect(logged()).toContain(broken.tenantId);
    expect(logged()).toContain("SecretDecryptionError");
    for (const leak of [SMTP_PASSWORD, "wf1.", "leyla.guest@example.test", "mailer@jobs.example"]) expect(logged()).not.toContain(leak);
  });

  it("carries on when hold expiry or session cleanup fails", async () => {
    const failing = await createTenant();
    const fine = await createTenant();
    const failingHold = await pendingBooking(failing, new Date(NOW.getTime() - 1));
    const fineHold = await pendingBooking(fine, new Date(NOW.getTime() - 1));
    await queue(failing);
    fault.holdsFor.add(failing.tenantId);
    fault.sessions = true;

    const report = await runScheduledJobs({ now: NOW, tenantIds: [failing.tenantId, fine.tenantId] });
    expect(report).toEqual({
      tenants: 2,
      holdsExpired: 1,
      notifications: { sent: 0, failed: 0, skipped: 2, retrying: 0, deferred: 0 },
      sessionsDeleted: 0,
      errors: { holds: 1, notifications: 0, sessions: 1 },
    });
    // The failed job rolled back alone; the same workspace's other job still ran.
    expect((await bookingRow(failingHold)).status).toBe("pending");
    expect((await bookingRow(fineHold)).status).toBe("cancelled");
    expect((await outbox(failing)).map((row) => row.status)).toEqual(["skipped"]);

    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(logged()).toContain(`expire-holds failed for workspace ${failing.tenantId} (Error)`);
    expect(logged()).toContain("delete-expired-sessions failed (Error)");
    expect(logged()).not.toContain("secret-detail");
    expect(logged()).not.toContain("guest@example.test");

    // The summary still gets written, with the error counts.
    expect((await lastRunAudit()).metadata).toMatchObject({ errors: { holds: 1, notifications: 0, sessions: 1 } });
  });

  it("skips suspended workspaces and removes expired sessions", async () => {
    const active = await createTenant();
    const suspended = await createTenant();
    await withPlatform((tx) => tx.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, suspended.tenantId)));
    const hold = await pendingBooking(suspended, new Date(NOW.getTime() - 1));
    await queue(suspended);

    const user = await createUser();
    const live = await createSession(user.id);
    const expired = await createSession(user.id, {}, { lifetimeMs: -60_000 });

    const report = await runScheduledJobs({ now: NOW, tenantIds: [active.tenantId, suspended.tenantId, "not-a-uuid"] });
    expect(report.tenants).toBe(1);
    expect(report.sessionsDeleted).toBeGreaterThanOrEqual(1);
    expect((await bookingRow(hold)).status).toBe("pending");
    expect((await outbox(suspended)).map((row) => row.status)).toEqual(["pending"]);

    expect(await validateSessionToken(live.token)).not.toBeNull();
    const left = await withPlatform((tx) => tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id)));
    expect(left).toHaveLength(1);
    expect(await validateSessionToken(expired.token)).toBeNull();
  });

  it("walks every workspace in batches and caps what one workspace can send per run", async () => {
    const three = await Promise.all([createTenant(), createTenant(), createTenant()]);
    await connectSmtp(three[0]!);
    await queue(three[0]!, NOTIFICATIONS_PER_TENANT + 3);
    const ids = three.map((tenant) => tenant.tenantId);

    for (const tenantBatch of [1, 2, 3, 500, 0, Number.NaN, 10_000]) {
      const report = await runScheduledJobs({ now: NOW, tenantIds: ids, tenantBatch, today: tenantBatch === 1 ? "2027-03-10" : "not-a-date" });
      expect(report.tenants).toBe(3);
    }
    // First run sent the cap, the second the remainder; the rest found nothing.
    expect(transport.sendMail).toHaveBeenCalledTimes(NOTIFICATIONS_PER_TENANT + 3);
    expect((await outbox(three[0]!)).every((row) => row.status === "sent")).toBe(true);
  });

  it("records one platform audit row per run, with totals and nothing else", async () => {
    const tenant = await createTenant();
    await pendingBooking(tenant, new Date(NOW.getTime() - 1));
    await queue(tenant);
    const before = await withPlatform((tx) => tx.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.action, "jobs.scheduled_run")));

    const report = await runScheduledJobs({ now: NOW, tenantIds: [tenant.tenantId] });

    const after = await withPlatform((tx) => tx.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.action, "jobs.scheduled_run")));
    expect(after.length).toBe(before.length + 1);
    const audit = await lastRunAudit();
    expect(audit).toMatchObject({ actorType: "system", actorUserId: null, tenantId: null, targetType: "job" });
    expect(audit.metadata).toEqual({
      tenants: 1,
      holdsExpired: 1,
      notifications: report.notifications,
      sessionsDeleted: report.sessionsDeleted,
      errors: { holds: 0, notifications: 0, sessions: 0 },
      durationMs: expect.any(Number),
    });
    const text = JSON.stringify(audit.metadata);
    for (const leak of ["PRIVATE-BODY", "leyla.guest@example.test", tenant.tenantId]) expect(text).not.toContain(leak);

    // Platform-only: the workspace cannot see the platform's job summaries.
    const seen = await withTenant(tenant.tenantId, ({ tx }) => tx.select().from(auditLogs).where(eq(auditLogs.action, "jobs.scheduled_run")));
    expect(seen).toEqual([]);
  });
});
