import { describe, expect, it } from "vitest";
import { recordAudit } from "@/server/audit";
import { decodeAuditCursor, encodeAuditCursor, listAuditEntries } from "@/server/audit/read";
import { withTenant } from "@/server/db/context";
import { auditLogs } from "@/server/db/schema";
import { ValidationError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { recordPlatformAudit } from "@/server/platform/audit";
import { removeMember } from "@/server/team/members";
import { createTenant, createUser, randomId, type TenantFixture } from "../../helpers/fixtures";
import { addMember, inTenant, ownerActor } from "../team/helpers";

/** Writes an entry exactly as the runtime role would, with an optional fixed time. */
function addEntry(
  tenant: TenantFixture,
  entry: { action: string; userId?: string | null; actorType?: "user" | "support_session" | "system"; targetType?: string; at?: Date; metadata?: Record<string, unknown> },
) {
  const userId = entry.userId === undefined ? tenant.ownerId : entry.userId;
  return withTenant(
    tenant.tenantId,
    async (scope) => {
      if (!entry.at) {
        await recordAudit(scope, { action: entry.action, targetType: entry.targetType, targetId: "t-1", metadata: entry.metadata, actorType: entry.actorType });
        return;
      }
      await scope.tx.insert(auditLogs).values({
        tenantId: scope.tenantId,
        actorType: entry.actorType ?? (userId ? "user" : "system"),
        actorUserId: userId,
        action: entry.action,
        targetType: entry.targetType ?? null,
        metadata: entry.metadata ?? {},
        createdAt: entry.at,
      });
    },
    { userId },
  );
}

const list = (tenant: TenantFixture, input: Parameters<typeof listAuditEntries>[1] = {}) => inTenant(tenant, (scope) => listAuditEntries(scope, input));

describe("listAuditEntries", () => {
  it("lists newest first and names who acted", async () => {
    const a = await createTenant();
    const member = await addMember(a, "staff", { name: "Rena Aliyeva" });
    const leaver = await addMember(a, "staff", { name: "Gone Person" });
    const admin = await createUser({ name: "Platform Person" });

    await addEntry(a, { action: "test.by_owner", at: new Date("2026-01-01T10:00:00Z"), metadata: { reference: "AB-1" } });
    await addEntry(a, { action: "test.by_member", userId: member.userId, at: new Date("2026-01-02T10:00:00Z") });
    await addEntry(a, { action: "test.by_leaver", userId: leaver.userId, at: new Date("2026-01-03T10:00:00Z") });
    await addEntry(a, { action: "test.by_support", userId: admin.id, actorType: "support_session", at: new Date("2026-01-04T10:00:00Z") });
    await addEntry(a, { action: "test.by_system", userId: null, at: new Date("2026-01-05T10:00:00Z") });
    await withPlatform((tx) => recordPlatformAudit(tx, { admin: { userId: admin.id, role: "owner" }, tenantId: a.tenantId, action: "test.by_platform" }));
    await inTenant(a, (scope) => removeMember(scope, ownerActor(a), leaver.membershipId));

    const page = await list(a, { action: "test" });

    expect(page.items.map((item) => item.action)).toEqual([
      "test.by_platform",
      "test.by_system",
      "test.by_support",
      "test.by_leaver",
      "test.by_member",
      "test.by_owner",
    ]);
    const byAction = new Map(page.items.map((item) => [item.action, item]));
    expect(byAction.get("test.by_owner")).toMatchObject({ actorType: "user", actorUserId: a.ownerId, actorName: "Test User", metadata: { reference: "AB-1" } });
    expect(byAction.get("test.by_member")?.actorName).toBe("Rena Aliyeva");
    expect(byAction.get("test.by_leaver")?.actorName).toBe("Former member");
    expect(byAction.get("test.by_support")?.actorName).toBe("Wayfold support");
    expect(byAction.get("test.by_system")?.actorName).toBe("System");
    expect(byAction.get("test.by_platform")?.actorName).toBe("Wayfold");
    expect(JSON.stringify(page)).not.toContain("Platform Person");
    expect(page.nextCursor).toBeNull();
  });

  it("filters by area, person, kind of actor, target and time", async () => {
    const a = await createTenant();
    const member = await addMember(a, "staff");
    await addEntry(a, { action: "area_one.created", targetType: "tour", at: new Date("2027-02-01T00:00:00Z") });
    await addEntry(a, { action: "areaxone.created", at: new Date("2027-02-02T00:00:00Z") });
    await addEntry(a, { action: "area_one.updated", userId: member.userId, targetType: "booking", at: new Date("2027-02-03T00:00:00Z") });
    await addEntry(a, { action: "area_one.viewed", userId: member.userId, actorType: "support_session", at: new Date("2027-02-04T00:00:00Z") });

    const actions = async (input: Parameters<typeof listAuditEntries>[1]) => (await list(a, input)).items.map((item) => item.action);

    // `_` is a literal character here, not a wildcard.
    expect(await actions({ action: "area_one" })).toEqual(["area_one.viewed", "area_one.updated", "area_one.created"]);
    expect(await actions({ action: "area_one." })).toEqual(["area_one.viewed", "area_one.updated", "area_one.created"]);
    expect(await actions({ action: "area_one.up" })).toEqual(["area_one.updated"]);
    expect(await actions({ action: "area", actorUserId: member.userId })).toEqual([]);
    expect(await actions({ actorUserId: member.userId })).toEqual(["area_one.viewed", "area_one.updated"]);
    expect(await actions({ actorUserId: member.userId, actorType: "user" })).toEqual(["area_one.updated"]);
    expect(await actions({ targetType: "tour" })).toEqual(["area_one.created"]);
    expect(
      await actions({ action: "area_one", from: new Date("2027-02-01T00:00:00Z"), to: new Date("2027-02-03T00:00:00Z") }),
    ).toEqual(["area_one.created"]);
    expect(await actions({ action: "area_one", from: new Date("2027-02-03T00:00:00Z") })).toEqual(["area_one.viewed", "area_one.updated"]);
  });

  it("pages with a cursor without skipping or repeating entries that share a timestamp", async () => {
    const a = await createTenant();
    const at = new Date("2027-03-01T12:00:00Z");
    for (let i = 0; i < 5; i += 1) await addEntry(a, { action: `page_test.same_${i}`, at });
    await addEntry(a, { action: "page_test.newest", at: new Date("2027-03-02T12:00:00Z") });
    await addEntry(a, { action: "page_test.oldest", at: new Date("2027-02-28T12:00:00Z") });

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await list(a, { action: "page_test", limit: 2, cursor });
      seen.push(...page.items.map((item) => item.action));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(4);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen[0]).toBe("page_test.newest");
    expect(seen.at(-1)).toBe("page_test.oldest");
  });

  it("keeps microsecond order across pages", async () => {
    const a = await createTenant();
    // Written in quick succession: timestamps differ below the millisecond.
    for (let i = 0; i < 4; i += 1) await addEntry(a, { action: `micro.entry_${i}` });

    const first = await list(a, { action: "micro", limit: 2 });
    const second = await list(a, { action: "micro", limit: 2, cursor: first.nextCursor! });

    expect([...first.items, ...second.items].map((item) => item.action)).toEqual(["micro.entry_3", "micro.entry_2", "micro.entry_1", "micro.entry_0"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects malformed input and cursors it did not issue", async () => {
    const a = await createTenant();
    await expect(list(a, { cursor: "not a cursor" })).rejects.toBeInstanceOf(ValidationError);
    await expect(list(a, { cursor: Buffer.from("2027|x").toString("base64url") })).rejects.toBeInstanceOf(ValidationError);
    await expect(list(a, { limit: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(list(a, { limit: 101 })).rejects.toBeInstanceOf(ValidationError);
    await expect(list(a, { action: "member%" })).rejects.toBeInstanceOf(ValidationError);
    await expect(list(a, { actorUserId: "nope" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns an empty page for a workspace without matching entries", async () => {
    const a = await createTenant();
    expect(await list(a, { action: "nothing_here" })).toEqual({ items: [], nextCursor: null });
    expect(await list(a, { actorUserId: randomId() })).toEqual({ items: [], nextCursor: null });
  });
});

describe("audit cursors", () => {
  it("round-trips a position", () => {
    const position = { at: "2027-03-01T12:00:00.123456Z", id: randomId() };
    expect(decodeAuditCursor(encodeAuditCursor(position))).toEqual(position);
  });

  it("refuses anything else", () => {
    const id = randomId();
    expect(decodeAuditCursor("")).toBeNull();
    expect(decodeAuditCursor("has spaces")).toBeNull();
    expect(decodeAuditCursor(Buffer.from(`2027-03-01T12:00:00.123456Z|${id}|extra`).toString("base64url"))).toBeNull();
    expect(decodeAuditCursor(Buffer.from(`2027-03-01T12:00:00Z|${id}`).toString("base64url"))).toBeNull();
    expect(decodeAuditCursor(Buffer.from("2027-03-01T12:00:00.123456Z|not-a-uuid").toString("base64url"))).toBeNull();
    expect(decodeAuditCursor(Buffer.from("2027-03-01T12:00:00.123456Z").toString("base64url"))).toBeNull();
  });
});
