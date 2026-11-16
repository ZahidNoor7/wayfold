import { describe, expect, it } from "vitest";
import { recordAudit } from "@/server/audit";
import { withTenant } from "@/server/db/context";
import { auditLogs } from "@/server/db/schema";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { listPlatformAudit, recordPlatformAudit } from "@/server/platform/audit";
import { withPlatform } from "@/server/platform/db";
import { getLastScheduledRun, runScheduledJobs } from "@/server/platform/jobs";
import { suspendTenant } from "@/server/platform/tenants";
import { createTenant, createUser, unique } from "../../helpers/fixtures";
import { caught, createAdmin } from "./helpers";

describe("listPlatformAudit", () => {
  it("lists tenant and platform events together, newest first, with tenant and actor names", async () => {
    const owner = await createAdmin();
    const support = await createAdmin("support");
    const tenant = await createTenant({ name: "Caspian Trails" });
    const prefix = `${unique("evt").replace(/-/g, "_")}.`;

    await withTenant(tenant.tenantId, (scope) => recordAudit(scope, { action: `${prefix}tenant_side`, targetType: "tour", targetId: "t-1", ip: "198.51.100.7" }), {
      userId: tenant.ownerId,
    });
    await withPlatform((tx) => recordPlatformAudit(tx, { admin: owner, action: `${prefix}platform_side`, targetType: "plan" }));
    await withPlatform((tx) => recordPlatformAudit(tx, { admin: null, action: `${prefix}system_side` }));

    const result = await listPlatformAudit(support, { action: prefix });
    expect(result.total).toBe(3);
    expect(result.items.map((item) => item.action)).toEqual([`${prefix}system_side`, `${prefix}platform_side`, `${prefix}tenant_side`]);
    expect(result.items[2]).toMatchObject({
      tenantId: tenant.tenantId,
      tenantName: "Caspian Trails",
      actorType: "user",
      actorName: "Test User",
      targetType: "tour",
      targetId: "t-1",
      ip: "198.51.100.7",
      metadata: {},
    });
    expect(result.items[2]!.at).toBeInstanceOf(Date);
    expect(result.items[1]).toMatchObject({ tenantId: null, tenantName: null, actorType: "platform_admin", actorName: "Olive Owner" });
    expect(result.items[0]).toMatchObject({ actorType: "system", actorName: null, tenantName: null });
  });

  it("filters by action prefix, workspace, actor type and time window, and pages with a total", async () => {
    const owner = await createAdmin();
    const a = await createTenant();
    const b = await createTenant();
    const prefix = `${unique("flt").replace(/-/g, "_")}.`;
    const at = (iso: string) => new Date(iso);

    await withPlatform((tx) =>
      tx.insert(auditLogs).values([
        { tenantId: a.tenantId, actorType: "user", action: `${prefix}one`, createdAt: at("2030-01-01T10:00:00Z") },
        { tenantId: a.tenantId, actorType: "support_session", action: `${prefix}two`, createdAt: at("2030-01-02T10:00:00Z") },
        { tenantId: b.tenantId, actorType: "platform_admin", actorUserId: owner.userId, action: `${prefix}three`, createdAt: at("2030-01-03T10:00:00Z") },
        { tenantId: null, actorType: "system", action: `${prefix}four`, createdAt: at("2030-01-04T10:00:00Z") },
        // Looks like the prefix to a naive LIKE; must not match.
        { tenantId: null, actorType: "system", action: `${prefix.replace(/_/g, "X")}decoy`, createdAt: at("2030-01-04T11:00:00Z") },
      ]),
    );

    const actions = async (input: Parameters<typeof listPlatformAudit>[1]) =>
      (await listPlatformAudit(owner, { action: prefix, ...input })).items.map((item) => item.action.slice(prefix.length));

    expect(await actions({})).toEqual(["four", "three", "two", "one"]);
    expect(await actions({ tenantId: a.tenantId })).toEqual(["two", "one"]);
    expect(await actions({ actorType: "support_session" })).toEqual(["two"]);
    expect(await actions({ actorType: "platform_admin", tenantId: b.tenantId })).toEqual(["three"]);
    // Inclusive at both ends.
    expect(await actions({ from: at("2030-01-02T10:00:00Z"), to: at("2030-01-03T10:00:00Z") })).toEqual(["three", "two"]);
    expect(await actions({ from: at("2030-01-04T00:00:00Z") })).toEqual(["four"]);
    expect(await actions({ to: at("2030-01-01T23:59:59Z") })).toEqual(["one"]);
    expect(await actions({ action: `${prefix}t` })).toEqual(["three", "two"]);

    const page = await listPlatformAudit(owner, { action: prefix, limit: 2, offset: 1 });
    expect(page.total).toBe(4);
    expect(page.items.map((item) => item.action.slice(prefix.length))).toEqual(["three", "two"]);
    expect((await listPlatformAudit(owner, { action: prefix, limit: 2, offset: 4 })).items).toEqual([]);

    // Wildcards in the filter are literal.
    expect((await listPlatformAudit(owner, { action: "%" })).total).toBe(0);
  });

  it("returns metadata redacted, even for rows written without the redacting helper", async () => {
    const support = await createAdmin("support");
    const tenant = await createTenant();
    const action = `${unique("red").replace(/-/g, "_")}.event`;

    await withTenant(tenant.tenantId, (scope) => recordAudit(scope, { action, metadata: { provider: "smtp", password: "hunter2-plaintext" } }));
    // A raw insert bypasses recordAudit, the way a careless migration might.
    await withPlatform((tx) =>
      tx.insert(auditLogs).values({
        tenantId: tenant.tenantId,
        actorType: "system",
        action,
        metadata: { apiSecret: "raw-secret-value", nested: { authorization: "Bearer raw-token" }, label: "kept" },
      }),
    );

    const { items } = await listPlatformAudit(support, { action });
    const text = JSON.stringify(items);
    for (const leak of ["hunter2-plaintext", "raw-secret-value", "raw-token"]) expect(text).not.toContain(leak);
    expect(items.map((item) => item.metadata)).toEqual(
      expect.arrayContaining([
        { provider: "smtp", password: "[redacted]" },
        { apiSecret: "[redacted]", nested: { authorization: "[redacted]" }, label: "kept" },
      ]),
    );
  });

  it("is readable by support, not by anyone else, and validates its input", async () => {
    const support = await createAdmin("support");
    const owner = await createAdmin();
    const tenant = await createTenant();
    await suspendTenant(owner, tenant.tenantId, "Visible to support in the log");

    const seen = await listPlatformAudit(support, { tenantId: tenant.tenantId, actorType: "platform_admin" });
    expect(seen.items.map((item) => item.action)).toContain("tenant.suspended");

    const stranger = await createUser();
    expect(await caught(() => listPlatformAudit({ userId: stranger.id, role: "support" }))).toBeInstanceOf(ForbiddenError);
    expect(await caught(() => listPlatformAudit({ userId: tenant.ownerId, role: "owner" }))).toBeInstanceOf(ForbiddenError);
    for (const bad of [
      { limit: 101 },
      { offset: -1 },
      { tenantId: "nope" },
      { actorType: "robot" as never },
      { from: new Date("2030-02-01"), to: new Date("2030-01-01") },
      { from: "2030-01-01" as never },
    ]) {
      expect(await caught(() => listPlatformAudit(support, bad))).toBeInstanceOf(ValidationError);
    }
  });
});

describe("getLastScheduledRun", () => {
  it("returns the latest run's summary, and is readable by support", async () => {
    const support = await createAdmin("support");
    const tenant = await createTenant();

    const report = await runScheduledJobs({ tenantIds: [tenant.tenantId] });
    const last = await getLastScheduledRun(support);
    expect(last).not.toBeNull();
    expect(last!.at).toBeInstanceOf(Date);
    expect(Date.now() - last!.at.getTime()).toBeLessThan(60_000);
    expect(last!.result).toEqual({ ...report, durationMs: expect.any(Number) });

    const stranger = await createUser();
    expect(await caught(() => getLastScheduledRun({ userId: stranger.id, role: "owner" }))).toBeInstanceOf(ForbiddenError);
  });
});
