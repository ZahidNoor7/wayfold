import type { Permission } from "@/server/rbac/permissions";

export type NavIcon =
  | "overview" | "bookings" | "customers" | "inquiries" | "tours" | "destinations" | "reviews" | "journal" | "media"
  | "promotions" | "site" | "settings" | "team" | "integrations" | "billing" | "activity";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Hidden unless the member holds this permission. */
  permission?: Permission;
  /** Which counter, if any, to show as a badge. */
  badge?: "pendingBookings" | "pendingDiscountRequests" | "newInquiries";
  badgeTone?: "highlight" | "pending";
  /** Match the path exactly rather than by prefix. */
  exact?: boolean;
  /** Prefix matches that belong to another item instead. */
  excludes?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const WORKSPACE_NAV: NavGroup[] = [
  {
    label: "Business",
    items: [
      { href: "/workspace", label: "Overview", icon: "overview", exact: true },
      { href: "/workspace/bookings", label: "Bookings", icon: "bookings", permission: "bookings.view", badge: "pendingBookings", badgeTone: "highlight" },
      { href: "/workspace/customers", label: "Customers", icon: "customers", permission: "customers.view" },
      { href: "/workspace/inquiries", label: "Enquiries", icon: "inquiries", permission: "content.manage", badge: "newInquiries", badgeTone: "pending" },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/workspace/tours", label: "Tours", icon: "tours", permission: "tours.view" },
      { href: "/workspace/destinations", label: "Destinations", icon: "destinations", permission: "tours.manage" },
      { href: "/workspace/reviews", label: "Reviews", icon: "reviews", permission: "reviews.manage" },
      { href: "/workspace/journal", label: "Journal", icon: "journal", permission: "content.manage" },
      { href: "/workspace/media", label: "Media library", icon: "media", permission: "media.view" },
      { href: "/workspace/promotions", label: "Discounts & offers", icon: "promotions", permission: "promotions.view", badge: "pendingDiscountRequests", badgeTone: "pending" },
    ],
  },
  {
    label: "Website",
    items: [
      { href: "/workspace/site", label: "Pages & content", icon: "site", permission: "content.manage" },
      { href: "/workspace/settings", label: "Settings & appearance", icon: "settings", permission: "workspace.manage", excludes: ["/workspace/settings/integrations"] },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/workspace/team", label: "Team & roles", icon: "team", permission: "team.view" },
      { href: "/workspace/settings/integrations", label: "Integrations", icon: "integrations", permission: "integrations.view" },
      { href: "/workspace/billing", label: "Plan & billing", icon: "billing", permission: "billing.view" },
      { href: "/workspace/activity", label: "Activity log", icon: "activity", permission: "audit.view" },
    ],
  },
];

/** Nav groups filtered to what a member may open. Empty groups disappear. */
export function visibleNav(permissions: readonly string[]): NavGroup[] {
  return WORKSPACE_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || permissions.includes(item.permission)),
  })).filter((group) => group.items.length > 0);
}

/** Whether `item` is the current page's navigation entry. */
export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  const within = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return within && !(item.excludes ?? []).some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
