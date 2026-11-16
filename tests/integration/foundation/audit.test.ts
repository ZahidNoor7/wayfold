import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { recordAudit } from "@/server/audit";
import { withTenant } from "@/server/db/context";
import { auditLogs } from "@/server/db/schema";
import { withPlatform } from "@/server/platform/db";
import { createTenant } from "../../helpers/fixtures";
import { auditFor, pgCode } from "./support";

describe("recordAudit", () => {
  it("appends a row to the acting tenant's log, attributed to the user", async () => {
    const a = await createTenant();

    await withTenant(
      a.tenantId,
      (scope) =>
        recordAudit(scope, {
          action: "tour.published",
          targetType: "tour",
          targetId: "tour-123",
          metadata: { title: "Sheki day trip" },
          ip: "203.0.113.7",
        }),
      { userId: a.ownerId },
    );

    const rows = await auditFor(a.tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: a.tenantId,
      actorType: "user",
      actorUserId: a.ownerId,
      action: "tour.published",
      targetType: "tour",
      targetId: "tour-123",
      metadata: { title: "Sheki day trip" },
      ip: "203.0.113.7",
    });
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
  });

  it("records a system actor when nobody is signed in, with empty defaults", async () => {
    const a = await createTenant();
    await withTenant(a.tenantId, (scope) => recordAudit(scope, { action: "booking.hold_expired" }));

    const [row] = await auditFor(a.tenantId);
    expect(row).toMatchObject({
      actorType: "system",
      actorUserId: null,
      action: "booking.hold_expired",
      targetType: null,
      targetId: null,
      metadata: {},
      ip: null,
    });
  });

  it("lets the caller mark a support session", async () => {
    const a = await createTenant();
    await withTenant(a.tenantId, (scope) => recordAudit(scope, { action: "booking.viewed", actorType: "support_session", ip: null }), {
      userId: a.ownerId,
    });
    const [row] = await auditFor(a.tenantId);
    expect(row).toMatchObject({ actorType: "support_session", actorUserId: a.ownerId, ip: null });
  });

  it("redacts credential-like metadata before it reaches the database", async () => {
    const a = await createTenant();
    await withTenant(
      a.tenantId,
      (scope) =>
        recordAudit(scope, {
          action: "integration.created",
          metadata: {
            provider: "smtp",
            password: "hunter2-password",
            request: { headers: { authorization: "Bearer raw-bearer-value" }, attempts: [{ apiKey: "sk_live_raw" }] },
            note: "n".repeat(900),
            when: new Date("2025-03-09T10:00:00Z"),
          },
        }),
      { userId: a.ownerId },
    );

    // Read the stored JSON as text on the platform connection: nothing the
    // application does on the way out can hide what was actually written.
    const stored = await withPlatform((tx) =>
      tx.select({ metadata: auditLogs.metadata }).from(auditLogs).where(eq(auditLogs.tenantId, a.tenantId)),
    );
    const raw = JSON.stringify(stored);
    for (const leak of ["hunter2", "raw-bearer-value", "sk_live_raw"]) expect(raw).not.toContain(leak);

    expect(stored[0]!.metadata).toEqual({
      provider: "smtp",
      password: "[redacted]",
      request: { headers: { authorization: "[redacted]" }, attempts: [{ apiKey: "[redacted]" }] },
      note: `${"n".repeat(500)}…`,
      when: "2025-03-09T10:00:00.000Z",
    });
  });

  it("is rolled back together with the transaction it was written in", async () => {
    const a = await createTenant();
    await expect(
      withTenant(a.tenantId, async (scope) => {
        await recordAudit(scope, { action: "tour.deleted" });
        throw new Error("later step failed");
      }),
    ).rejects.toThrow("later step failed");
    expect(await auditFor(a.tenantId)).toEqual([]);
  });
});

describe("audit log isolation", () => {
  it("shows a tenant only its own entries", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await withTenant(a.tenantId, (scope) => recordAudit(scope, { action: "a.event" }), { userId: a.ownerId });
    await withTenant(b.tenantId, (scope) => recordAudit(scope, { action: "b.event" }), { userId: b.ownerId });

    expect((await auditFor(a.tenantId)).map((row) => row.action)).toEqual(["a.event"]);
    expect((await auditFor(b.tenantId)).map((row) => row.action)).toEqual(["b.event"]);

    // Asking for the other tenant's rows by tenant id returns nothing.
    const peek = await withTenant(a.tenantId, ({ tx }) => tx.select().from(auditLogs).where(eq(auditLogs.tenantId, b.tenantId)));
    expect(peek).toEqual([]);
  });

  it("cannot be made to write into another tenant's log with a forged scope", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const code = await pgCode(() =>
      withTenant(a.tenantId, (scope) => recordAudit({ ...scope, tenantId: b.tenantId }, { action: "forged.event" }), {
        userId: a.ownerId,
      }),
    );
    expect(code).toBe("42501");
    expect(await auditFor(b.tenantId)).toEqual([]);
  });
});
