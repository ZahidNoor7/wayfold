import { describe, expect, it } from "vitest";
import {
  canGrantRole,
  grantableRoles,
  groupPermissions,
  invitationExpiry,
  memberLockReason,
  permissionCount,
  roleDeleteBlock,
  roleEditBlock,
  seatsFull,
  seatSummary,
} from "./team-display";

const owner = { userId: "o", isOwner: true, permissions: [] as string[] };
const manager = { userId: "m", isOwner: false, permissions: ["team.view", "team.manage", "tours.view"] };

describe("seats", () => {
  it("describes usage against the plan", () => {
    expect(seatSummary(4, 5)).toBe("4 of 5 seats used (including pending invitations)");
    expect(seatSummary(1, 1)).toBe("1 of 1 seat used (including pending invitations)");
    expect(seatSummary(1, null)).toBe("1 seat used (including pending invitations). Your plan has no seat limit.");
    expect(seatSummary(3, null)).toBe("3 seats used (including pending invitations). Your plan has no seat limit.");
  });

  it("knows when the plan is full", () => {
    expect(seatsFull(5, 5)).toBe(true);
    expect(seatsFull(6, 5)).toBe(true);
    expect(seatsFull(4, 5)).toBe(false);
    expect(seatsFull(400, null)).toBe(false);
  });
});

describe("granting roles", () => {
  const ownerRole = { systemKey: "owner", permissions: [] };
  const staff = { systemKey: "staff", permissions: ["tours.view"] };
  const admin = { systemKey: "admin", permissions: ["tours.view", "billing.view"] };

  it("lets only owners make owners", () => {
    expect(canGrantRole(owner, ownerRole)).toBe(true);
    expect(canGrantRole(manager, ownerRole)).toBe(false);
  });

  it("allows roles within what the actor holds", () => {
    expect(canGrantRole(manager, staff)).toBe(true);
    expect(canGrantRole(manager, admin)).toBe(false);
    expect(canGrantRole(owner, admin)).toBe(true);
    expect(grantableRoles(manager, [ownerRole, staff, admin])).toEqual([staff]);
  });
});

describe("memberLockReason", () => {
  it("protects your own row", () => {
    expect(memberLockReason({ userId: "m", isOwner: false }, manager)).toMatch(/^This is you\./);
  });

  it("protects owners from non-owners", () => {
    expect(memberLockReason({ userId: "x", isOwner: true }, manager)).toBe("Only an owner can change or remove another owner.");
    expect(memberLockReason({ userId: "x", isOwner: true }, owner)).toBeNull();
    expect(memberLockReason({ userId: "x", isOwner: false }, manager)).toBeNull();
  });
});

describe("roleDeleteBlock", () => {
  it("explains what blocks a delete", () => {
    expect(roleDeleteBlock({ isSystem: true, memberCount: 0, openInvitationCount: 0 })).toBe("Built-in roles cannot be deleted.");
    expect(roleDeleteBlock({ isSystem: false, memberCount: 1, openInvitationCount: 0 })).toBe(
      "1 person has this role. Move them to another role before deleting it.",
    );
    expect(roleDeleteBlock({ isSystem: false, memberCount: 3, openInvitationCount: 2 })).toBe(
      "3 people have this role. Move them all to another role before deleting it.",
    );
    expect(roleDeleteBlock({ isSystem: false, memberCount: 0, openInvitationCount: 1 })).toBe(
      "1 open invitation uses this role. Revoke it before deleting the role.",
    );
    expect(roleDeleteBlock({ isSystem: false, memberCount: 0, openInvitationCount: 2 })).toBe(
      "2 open invitations use this role. Revoke them before deleting the role.",
    );
    expect(roleDeleteBlock({ isSystem: false, memberCount: 0, openInvitationCount: 0 })).toBeNull();
  });
});

describe("roleEditBlock", () => {
  it("keeps the owner role and your own role fixed", () => {
    expect(roleEditBlock({ id: "r1", systemKey: "owner" }, null)).toMatch(/Owner role/);
    expect(roleEditBlock({ id: "r2", systemKey: null }, "r2")).toMatch(/role you hold/);
    expect(roleEditBlock({ id: "r2", systemKey: "staff" }, "r1")).toBeNull();
    expect(roleEditBlock({ id: "r2", systemKey: null }, null)).toBeNull();
  });
});

describe("invitationExpiry", () => {
  const now = new Date("2027-01-10T12:00:00Z");
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

  it("counts down and up in whole days", () => {
    expect(invitationExpiry(at(72), now)).toEqual({ text: "Expires in 3 days", expired: false });
    expect(invitationExpiry(at(25), now)).toEqual({ text: "Expires in 1 day", expired: false });
    expect(invitationExpiry(at(5), now)).toEqual({ text: "Expires today", expired: false });
    expect(invitationExpiry(at(-5), now)).toEqual({ text: "Expired today", expired: true });
    expect(invitationExpiry(at(0), now)).toEqual({ text: "Expired today", expired: true });
    expect(invitationExpiry(at(-30), now)).toEqual({ text: "Expired yesterday", expired: true });
    expect(invitationExpiry(at(-100), now)).toEqual({ text: "Expired 4 days ago", expired: true });
  });
});

describe("groupPermissions", () => {
  it("groups by area in a fixed order and keeps unknown ones", () => {
    const groups = groupPermissions({
      "team.view": "See team",
      "bookings.view": "See bookings",
      "exports.run": "Export",
      "brand_new.thing": "Something new",
      "roles.manage": "Edit roles",
    });
    expect(groups.map((group) => group.id)).toEqual(["bookings", "team", "other"]);
    expect(groups[0]!.items).toEqual([
      { key: "bookings.view", description: "See bookings" },
      { key: "exports.run", description: "Export" },
    ]);
    expect(groups[1]!.items.map((item) => item.key)).toEqual(["team.view", "roles.manage"]);
    expect(groups[2]).toEqual({ id: "other", label: "Other", items: [{ key: "brand_new.thing", description: "Something new" }] });
  });

  it("is empty for an empty catalogue", () => {
    expect(groupPermissions({})).toEqual([]);
  });
});

describe("permissionCount", () => {
  it("summarises a role", () => {
    expect(permissionCount(28, 28)).toBe("All permissions");
    expect(permissionCount(5, 28)).toBe("5 of 28 permissions");
    expect(permissionCount(0, 1)).toBe("0 of 1 permission");
    expect(permissionCount(0, 0)).toBe("0 of 0 permissions");
  });
});
