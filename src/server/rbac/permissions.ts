/**
 * Tenant permission catalogue. This is the complete set of things a tenant
 * role can be granted. Platform administration is not expressed here at all:
 * it is a separate table (`platform_admins`) the runtime database role cannot
 * write, so no combination of tenant permissions reaches it.
 */
export const PERMISSIONS = {
  "workspace.manage": "Edit business profile, contact details and regional settings",
  "branding.manage": "Change theme, colours, fonts and logo",
  "domains.manage": "Add and verify custom domains",
  "team.view": "See team members and roles",
  "team.manage": "Invite, deactivate and reassign team members",
  "roles.manage": "Create and edit roles and their permissions",
  "tours.view": "See tours, including unpublished drafts",
  "tours.manage": "Create and edit tours, itineraries, dates and pricing",
  "tours.publish": "Publish and unpublish tours",
  "bookings.view": "See bookings and availability",
  "bookings.manage": "Confirm, reschedule, cancel and annotate bookings",
  "customers.view": "See customer profiles and history",
  "customers.manage": "Edit customer profiles and notes",
  "reviews.manage": "Add, publish and hide reviews",
  "content.manage": "Edit website pages, journal entries and enquiries",
  "media.view": "Browse the media library",
  "media.manage": "Upload, replace and delete media",
  "promotions.view": "See campaigns, personal discounts and discount requests",
  "promotions.manage": "Create and edit campaigns and personal discounts",
  "promotions.decide": "Approve or reject customer discount requests",
  "integrations.view": "See connected integrations and their status",
  "integrations.manage": "Add, test, rotate and remove integration credentials",
  "billing.view": "See plan, usage and invoices",
  "billing.manage": "Change plan and billing details",
  "analytics.view": "See workspace analytics",
  "exports.run": "Export bookings and customers",
  "audit.view": "Read the workspace audit log",
  "support.manage": "Approve or revoke platform support access",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

export type SystemRoleKey = "owner" | "admin" | "tour_manager" | "booking_manager" | "content_manager" | "staff";

export interface SystemRole {
  key: SystemRoleKey;
  name: string;
  description: string;
  permissions: Permission[];
}

const without = (...excluded: Permission[]) => ALL_PERMISSIONS.filter((p) => !excluded.includes(p));

/** Seeded into every new workspace. `owner` is fixed; the rest are editable. */
export const SYSTEM_ROLES: readonly SystemRole[] = [
  {
    key: "owner",
    name: "Owner",
    description: "Full control of the workspace, including billing and support access.",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "admin",
    name: "Administrator",
    description: "Runs the business and the team. Cannot change the plan or grant support access.",
    permissions: without("billing.manage", "support.manage"),
  },
  {
    key: "tour_manager",
    name: "Tour Manager",
    description: "Owns tours, destinations, packages and their media.",
    permissions: [
      "tours.view",
      "tours.manage",
      "tours.publish",
      "media.view",
      "media.manage",
      "bookings.view",
      "promotions.view",
      "analytics.view",
    ],
  },
  {
    key: "booking_manager",
    name: "Booking Manager",
    description: "Handles reservations and customers.",
    permissions: [
      "bookings.view",
      "bookings.manage",
      "customers.view",
      "customers.manage",
      "tours.view",
      "promotions.view",
      "exports.run",
      "analytics.view",
    ],
  },
  {
    key: "content_manager",
    name: "Content Manager",
    description: "Looks after website content, images and reviews.",
    permissions: ["content.manage", "reviews.manage", "media.view", "media.manage", "tours.view", "branding.manage"],
  },
  {
    key: "staff",
    name: "Staff",
    description: "Read-only operational access. Extend it per person with a custom role.",
    permissions: ["tours.view", "bookings.view", "customers.view", "media.view", "promotions.view"],
  },
];

export class InvalidPermissionError extends Error {
  constructor(readonly invalid: string[]) {
    super("One or more permissions are not recognised");
    this.name = "InvalidPermissionError";
  }
}

/**
 * Validates a permission list supplied by a client before it is stored on a
 * role. Unknown strings (including anything shaped like a platform privilege)
 * are rejected rather than ignored, and the result is de-duplicated.
 */
export function parsePermissions(input: readonly string[]): Permission[] {
  const invalid = input.filter((value) => !isPermission(value));
  if (invalid.length > 0) throw new InvalidPermissionError(invalid);
  return [...new Set(input as Permission[])];
}

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}

/** Permissions in `requested` that `actor` does not hold themselves. */
export function escalations(actor: readonly string[], requested: readonly Permission[]): Permission[] {
  return requested.filter((permission) => !actor.includes(permission));
}
