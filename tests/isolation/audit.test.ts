import { describe, expect, it } from "vitest";
import { recordAudit } from "@/server/audit";
import { listAuditEntries } from "@/server/audit/read";
import { withTenant } from "@/server/db/context";
import { createTenant, type TenantFixture } from "../helpers/fixtures";
import { addMember, inTenant } from "../integration/team/helpers";

function record(tenant: TenantFixture, action: string, userId: string, metadata: Record<string, unknown> = {}) {
  return withTenant(tenant.tenantId, (scope) => recordAudit(scope, { action, targetType: "tour", targetId: "x", metadata }), { userId });
}

describe("audit isolation", () => {
  it("never lists another workspace's entries", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const memberOfA = await addMember(a, "staff", { name: "Only In A" });
    await record(a, "isolation.secret_of_a", memberOfA.userId, { note: "private to A" });
    await record(b, "isolation.entry_of_b", b.ownerId);

    const seenByB = await inTenant(b, (scope) => listAuditEntries(scope, { limit: 100 }));

    expect(seenByB.items.map((item) => item.action)).toContain("isolation.entry_of_b");
    expect(seenByB.items.map((item) => item.action)).not.toContain("isolation.secret_of_a");
    const serialised = JSON.stringify(seenByB);
    expect(serialised).not.toContain("private to A");
    expect(serialised).not.toContain("Only In A");
    expect(serialised).not.toContain(a.tenantId);
  });

  it("returns nothing when B filters by A's people, areas or targets", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const memberOfA = await addMember(a, "staff");
    await record(a, "isolation_only_a.done", memberOfA.userId);

    const asB = (input: Parameters<typeof listAuditEntries>[1]) => inTenant(b, (scope) => listAuditEntries(scope, input));

    expect((await asB({ actorUserId: memberOfA.userId })).items).toEqual([]);
    expect((await asB({ actorUserId: a.ownerId })).items).toEqual([]);
    expect((await asB({ action: "isolation_only_a" })).items).toEqual([]);
  });

  it("does not follow A's cursor into A's log", async () => {
    const a = await createTenant();
    const b = await createTenant();
    for (let i = 0; i < 3; i += 1) await record(a, `cursor_iso.a_${i}`, a.ownerId);
    await record(b, "cursor_iso.b_only", b.ownerId);

    const pageOfA = await inTenant(a, (scope) => listAuditEntries(scope, { action: "cursor_iso", limit: 1 }));
    expect(pageOfA.nextCursor).not.toBeNull();

    // The cursor is only a position in time; in B it can only ever reach B's rows.
    const replayedInB = await withTenant(b.tenantId, (scope) => listAuditEntries(scope, { action: "cursor_iso", cursor: pageOfA.nextCursor! }), {
      userId: b.ownerId,
    });
    expect(replayedInB.items.every((item) => item.action === "cursor_iso.b_only")).toBe(true);
  });

  it("does not name a person of another workspace who appears as an actor", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const memberOfA = await addMember(a, "staff", { name: "Named Only In A" });
    // A row in B attributed to A's member (e.g. a forged or stale user id).
    await record(b, "isolation.foreign_actor", memberOfA.userId);

    const seenByB = await inTenant(b, (scope) => listAuditEntries(scope, { action: "isolation" }));

    expect(seenByB.items).toHaveLength(1);
    expect(seenByB.items[0]).toMatchObject({ actorUserId: memberOfA.userId, actorName: "Former member" });
    expect(JSON.stringify(seenByB)).not.toContain("Named Only In A");
    expect(JSON.stringify(seenByB)).not.toContain(memberOfA.email);
  });
});
