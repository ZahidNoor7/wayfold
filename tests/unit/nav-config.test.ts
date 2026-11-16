import { describe, expect, it } from "vitest";
import { isNavItemActive, visibleNav, WORKSPACE_NAV } from "@/components/workspace/nav-config";
import { ALL_PERMISSIONS, isPermission, SYSTEM_ROLES } from "@/server/rbac/permissions";

const labels = (permissions: readonly string[]) => visibleNav(permissions).map((group) => ({ group: group.label, items: group.items.map((item) => item.label) }));
const hrefs = (permissions: readonly string[]) => visibleNav(permissions).flatMap((group) => group.items.map((item) => item.href));
const allItems = WORKSPACE_NAV.flatMap((group) => group.items);

describe("visibleNav", () => {
  it("shows the owner every group and every item", () => {
    const nav = visibleNav(ALL_PERMISSIONS);
    expect(nav).toEqual(WORKSPACE_NAV);
    expect(nav.map((group) => group.label)).toEqual(["Business", "Content", "Website", "Workspace"]);
    expect(nav.flatMap((group) => group.items)).toHaveLength(allItems.length);
  });

  it("shows a member with only bookings.view the overview and bookings", () => {
    expect(labels(["bookings.view"])).toEqual([{ group: "Business", items: ["Overview", "Bookings"] }]);
    expect(hrefs(["bookings.view"])).toEqual(["/workspace", "/workspace/bookings"]);
  });

  it("drops groups that end up empty", () => {
    const nav = visibleNav(["tours.view"]);
    expect(nav.map((group) => group.label)).toEqual(["Business", "Content"]);
    expect(nav.every((group) => group.items.length > 0)).toBe(true);
    expect(labels(["team.view"])).toEqual([
      { group: "Business", items: ["Overview"] },
      { group: "Workspace", items: ["Team & roles"] },
    ]);
  });

  it("always shows items that need no permission", () => {
    const open = allItems.filter((item) => !item.permission);
    expect(open.map((item) => item.label)).toEqual(["Overview"]);

    for (const permissions of [[], ["not.a.permission"], ["bookings.view"], ALL_PERMISSIONS]) {
      for (const item of open) expect(hrefs(permissions)).toContain(item.href);
    }
    expect(labels([])).toEqual([{ group: "Business", items: ["Overview"] }]);
  });

  it("hides every guarded item from a member who lacks its permission", () => {
    for (const item of allItems.filter((entry) => entry.permission)) {
      const everythingElse = ALL_PERMISSIONS.filter((permission) => permission !== item.permission);
      expect(hrefs(everythingElse)).not.toContain(item.href);
      expect(hrefs([item.permission!])).toContain(item.href);
    }
  });

  it("matches permissions exactly, not by prefix or wildcard", () => {
    expect(labels(["bookings", "bookings.", "bookings.*", "*", "BOOKINGS.VIEW", "bookings.view "])).toEqual([{ group: "Business", items: ["Overview"] }]);
    // Holding the stronger permission does not imply the weaker one here.
    expect(hrefs(["bookings.manage"])).not.toContain("/workspace/bookings");
  });

  it("keeps the configured order of groups and items", () => {
    const nav = visibleNav(["audit.view", "media.view", "customers.view", "tours.view"]);
    expect(nav.map((group) => group.label)).toEqual(["Business", "Content", "Workspace"]);
    expect(nav[1]!.items.map((item) => item.label)).toEqual(["Tours", "Media library"]);
  });

  it("gives each built-in role a menu that only lists what it may open", () => {
    for (const role of SYSTEM_ROLES) {
      const items = visibleNav(role.permissions).flatMap((group) => group.items);
      for (const item of items) {
        if (item.permission) expect(role.permissions).toContain(item.permission);
      }
    }
    // Staff: read-only operations, no settings, team, billing or integrations.
    const staff = SYSTEM_ROLES.find((role) => role.key === "staff")!;
    expect(hrefs(staff.permissions)).toEqual([
      "/workspace",
      "/workspace/bookings",
      "/workspace/customers",
      "/workspace/tours",
      "/workspace/media",
      "/workspace/promotions",
    ]);
  });

  it("does not modify the shared configuration", () => {
    const snapshot = JSON.stringify(WORKSPACE_NAV);
    const nav = visibleNav(["bookings.view"]);
    nav[0]!.items.pop();
    expect(JSON.stringify(WORKSPACE_NAV)).toBe(snapshot);
    expect(labels(["bookings.view"])).toEqual([{ group: "Business", items: ["Overview", "Bookings"] }]);
  });
});

describe("WORKSPACE_NAV", () => {
  it("guards items only with permissions that exist", () => {
    for (const item of allItems) {
      if (item.permission) expect(isPermission(item.permission), item.href).toBe(true);
    }
  });

  it("has unique links, all inside the workspace", () => {
    const links = allItems.map((item) => item.href);
    expect(new Set(links).size).toBe(links.length);
    for (const link of links) expect(link).toMatch(/^\/workspace(\/[a-z/-]+)?$/);
  });

  it("gives a tone to every badge and a badge to every tone", () => {
    for (const item of allItems) expect(Boolean(item.badge)).toBe(Boolean(item.badgeTone));
    expect(allItems.filter((item) => item.badge).map((item) => item.badge).sort()).toEqual(["newInquiries", "pendingBookings", "pendingDiscountRequests"]);
  });
});

describe("isNavItemActive", () => {
  const settings = { href: "/workspace/settings", label: "Settings", icon: "settings" as const, excludes: ["/workspace/settings/integrations"] };
  const overview = { href: "/workspace", label: "Overview", icon: "overview" as const, exact: true };

  it("matches sub-pages by prefix but not excluded ones", () => {
    expect(isNavItemActive("/workspace/settings", settings)).toBe(true);
    expect(isNavItemActive("/workspace/settings/domains", settings)).toBe(true);
    expect(isNavItemActive("/workspace/settings/integrations", settings)).toBe(false);
    expect(isNavItemActive("/workspace/settings-other", settings)).toBe(false);
  });

  it("matches exact items only on their own path", () => {
    expect(isNavItemActive("/workspace", overview)).toBe(true);
    expect(isNavItemActive("/workspace/bookings", overview)).toBe(false);
  });
});
