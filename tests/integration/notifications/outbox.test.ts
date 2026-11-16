import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/server/db/context";
import { auditLogs, notificationOutbox } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { enqueueNotification, enqueueTemplatedNotification, listOutbox, retryNotification, type NotificationInput } from "@/server/notifications";
import { createTenant, randomId, type TenantFixture } from "../../helpers/fixtures";
import { message, outboxRows, queue } from "./helpers";

function setStatus(tenant: TenantFixture, id: string, patch: Partial<typeof notificationOutbox.$inferInsert>) {
  return withTenant(tenant.tenantId, ({ tx }) => tx.update(notificationOutbox).set(patch).where(eq(notificationOutbox.id, id)));
}

describe("enqueueNotification", () => {
  it("stores a pending row for the current tenant, normalised", async () => {
    const tenant = await createTenant();
    const relatedId = randomId();

    await queue(tenant, { toEmail: "  Leyla@Example.TEST ", subject: "  Your booking\r\nBcc: someone@example.test  ", relatedType: "booking", relatedId });

    const rows = await outboxRows(tenant);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: tenant.tenantId,
      kind: "booking.confirmed",
      toEmail: "leyla@example.test",
      // Line breaks are folded, so the subject stays a single header line.
      subject: "Your booking Bcc: someone@example.test",
      bodyText: "Hi Leyla,\n\nGood news: your booking is confirmed.",
      status: "pending",
      attempts: 0,
      lastError: null,
      relatedType: "booking",
      relatedId,
      sentAt: null,
    });
  });

  it("shortens an over-long subject instead of refusing the message", async () => {
    const tenant = await createTenant();
    await queue(tenant, { subject: `New booking request: ${"Very long tour title ".repeat(20)}` });
    const [row] = await outboxRows(tenant);
    expect(row!.subject).toHaveLength(200);
    expect(row!.subject.endsWith("…")).toBe(true);
  });

  it("rejects invalid input with field errors and stores nothing", async () => {
    const tenant = await createTenant();
    const attempt = (overrides: Record<string, unknown>) =>
      withTenant(tenant.tenantId, (scope) => enqueueNotification(scope, { ...message(), ...overrides } as NotificationInput));

    await expect(attempt({ toEmail: "not-an-address" })).rejects.toMatchObject({ code: "validation", fieldErrors: { toEmail: expect.any(Array) } });
    await expect(attempt({ kind: "marketing.blast" })).rejects.toMatchObject({ fieldErrors: { kind: expect.any(Array) } });
    await expect(attempt({ subject: " \n " })).rejects.toMatchObject({ fieldErrors: { subject: expect.any(Array) } });
    await expect(attempt({ bodyText: "   " })).rejects.toMatchObject({ fieldErrors: { bodyText: expect.any(Array) } });
    await expect(attempt({ relatedId: "42" })).rejects.toBeInstanceOf(ValidationError);

    expect(await outboxRows(tenant)).toEqual([]);
  });

  it("is part of the caller's transaction: a rollback leaves no message behind", async () => {
    const tenant = await createTenant();
    await expect(
      withTenant(tenant.tenantId, async (scope) => {
        await enqueueNotification(scope, message());
        throw new Error("booking failed after the message was queued");
      }),
    ).rejects.toThrow("booking failed");
    expect(await outboxRows(tenant)).toEqual([]);
  });

  it("keeps messages queued in one transaction in the order they were written", async () => {
    const tenant = await createTenant();
    await withTenant(tenant.tenantId, async (scope) => {
      for (const subject of ["first", "second", "third"]) await enqueueNotification(scope, message({ subject }));
    });
    expect((await outboxRows(tenant)).map((row) => row.subject)).toEqual(["first", "second", "third"]);
  });

  it("renders a template and queues it in one step", async () => {
    const tenant = await createTenant();
    const relatedId = randomId();
    await withTenant(tenant.tenantId, (scope) =>
      enqueueTemplatedNotification(
        scope,
        "inquiry.staff_alert",
        { toEmail: tenant.ownerEmail, relatedType: "inquiry", relatedId },
        { businessName: "Caspian Trails", customerName: "Leyla", customerEmail: "leyla@example.test", message: "Do you run this in winter?" },
      ),
    );
    const [row] = await outboxRows(tenant);
    expect(row).toMatchObject({ kind: "inquiry.staff_alert", toEmail: tenant.ownerEmail, subject: "New inquiry from Leyla", relatedType: "inquiry", relatedId });
    expect(row!.bodyText).toContain("Do you run this in winter?");
  });
});

describe("listOutbox", () => {
  it("lists newest first and filters by status, kind, recipient and related record", async () => {
    const tenant = await createTenant();
    const bookingId = randomId();
    await queue(
      tenant,
      { subject: "one", kind: "booking.received", relatedType: "booking", relatedId: bookingId },
      { subject: "two", kind: "booking.staff_alert", toEmail: "staff@example.test", relatedType: "booking", relatedId: bookingId },
      { subject: "three", kind: "inquiry.staff_alert", toEmail: "staff@example.test" },
    );
    const rows = await outboxRows(tenant);
    await setStatus(tenant, rows[0]!.id, { status: "sent", sentAt: new Date(), attempts: 1 });

    const list = (filters?: Parameters<typeof listOutbox>[1]) => withTenant(tenant.tenantId, (scope) => listOutbox(scope, filters));
    const subjects = async (filters?: Parameters<typeof listOutbox>[1]) => (await list(filters)).map((entry) => entry.subject);

    expect(await subjects()).toEqual(["three", "two", "one"]);
    expect(await subjects({ status: "sent" })).toEqual(["one"]);
    expect(await subjects({ status: "pending" })).toEqual(["three", "two"]);
    expect(await subjects({ kind: "booking.staff_alert" })).toEqual(["two"]);
    expect(await subjects({ toEmail: " STAFF@example.test " })).toEqual(["three", "two"]);
    expect(await subjects({ relatedType: "booking", relatedId: bookingId })).toEqual(["two", "one"]);
    expect(await subjects({ relatedId: randomId() })).toEqual([]);
    expect(await subjects({ limit: 2 })).toEqual(["three", "two"]);
    expect(await subjects({ limit: 2, offset: 2 })).toEqual(["one"]);

    const [entry] = await list({ status: "sent" });
    expect(entry).toMatchObject({ id: rows[0]!.id, kind: "booking.received", status: "sent", attempts: 1, lastError: null, relatedId: bookingId });
    expect(entry!.sentAt).toBeInstanceOf(Date);
    // The view carries no tenant id: there is nothing to compare it with.
    expect(entry).not.toHaveProperty("tenantId");
  });

  it("rejects filters that are not valid", async () => {
    const tenant = await createTenant();
    const list = (filters: Record<string, unknown>) => withTenant(tenant.tenantId, (scope) => listOutbox(scope, filters as never));
    await expect(list({ status: "lost" })).rejects.toBeInstanceOf(ValidationError);
    await expect(list({ limit: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(list({ limit: 5000 })).rejects.toBeInstanceOf(ValidationError);
    await expect(list({ offset: -1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(list({ relatedId: "' or 1=1 --" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("retryNotification", () => {
  it("puts a failed message back in the queue with fresh attempts and records it", async () => {
    const tenant = await createTenant();
    await queue(tenant);
    const [row] = await outboxRows(tenant);
    await setStatus(tenant, row!.id, { status: "failed", attempts: 3, lastError: "The mail server is busy." });

    const retried = await withTenant(tenant.tenantId, (scope) => retryNotification(scope, row!.id), { userId: tenant.ownerId });

    expect(retried).toMatchObject({ id: row!.id, status: "pending", attempts: 0, lastError: null, sentAt: null });
    const audit = await withTenant(tenant.tenantId, ({ tx }) => tx.select().from(auditLogs).where(eq(auditLogs.action, "notification.retried")));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      tenantId: tenant.tenantId,
      actorUserId: tenant.ownerId,
      targetType: "notification",
      targetId: row!.id,
      metadata: { kind: "booking.confirmed", previousStatus: "failed" },
    });
  });

  it("re-queues a skipped message", async () => {
    const tenant = await createTenant();
    await queue(tenant);
    const [row] = await outboxRows(tenant);
    await setStatus(tenant, row!.id, { status: "skipped", lastError: "No e-mail integration." });

    const retried = await withTenant(tenant.tenantId, (scope) => retryNotification(scope, row!.id));
    expect(retried).toMatchObject({ status: "pending", attempts: 0, lastError: null });
  });

  it("never re-queues a message that was sent, and leaves a pending one alone", async () => {
    const tenant = await createTenant();
    await queue(tenant, { subject: "sent one" }, { subject: "pending one" });
    const [sent, pending] = await outboxRows(tenant);
    await setStatus(tenant, sent!.id, { status: "sent", sentAt: new Date(), attempts: 1 });
    await setStatus(tenant, pending!.id, { attempts: 2, lastError: "busy" });

    await expect(withTenant(tenant.tenantId, (scope) => retryNotification(scope, sent!.id))).rejects.toBeInstanceOf(ConflictError);
    // A pending message keeps its attempt count: retrying is not a way to reset it.
    expect(await withTenant(tenant.tenantId, (scope) => retryNotification(scope, pending!.id))).toMatchObject({ status: "pending", attempts: 2 });

    const audit = await withTenant(tenant.tenantId, ({ tx }) => tx.select().from(auditLogs).where(eq(auditLogs.action, "notification.retried")));
    expect(audit).toEqual([]);
    expect((await outboxRows(tenant)).map((row) => row.status)).toEqual(["sent", "pending"]);
  });

  it("answers an unknown or malformed id with NotFoundError", async () => {
    const tenant = await createTenant();
    for (const id of [randomId(), "42", "", "' or 1=1 --"]) {
      await expect(withTenant(tenant.tenantId, (scope) => retryNotification(scope, id)), id).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});
