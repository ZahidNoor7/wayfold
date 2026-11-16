/**
 * Plain-language wording for the workspace activity log. Action codes are
 * `area.verb` strings written by the server (`booking.confirmed`); people
 * read sentences. Unknown codes fall back to the raw code so nothing is
 * hidden when the server learns a new event before this table does.
 */

const ACTION_LABELS: Record<string, string> = {
  // Bookings
  "booking.received": "Received a booking request",
  "booking.created": "Created a booking",
  "booking.confirmed": "Confirmed a booking",
  "booking.completed": "Marked a booking as completed",
  "booking.cancelled": "Cancelled or declined a booking",
  "booking.reopened": "Reopened a booking as pending",
  "booking.expired": "Let an unanswered booking request expire",
  "booking.rescheduled": "Changed the date of a booking",
  "booking.payment_updated": "Updated the payment status of a booking",
  "booking.note_added": "Added a note to a booking",
  "booking.exported": "Exported bookings",
  "booking.waitlist_joined": "Added someone to a tour's waiting list",
  "booking.staff_alert": "Alerted the team about a booking",
  // Customers and enquiries
  "customer.updated": "Updated a customer profile",
  "customer.note_added": "Added a note to a customer",
  "customer.note_deleted": "Deleted a note from a customer",
  "customer.exported": "Exported customers",
  "inquiry.deleted": "Deleted an enquiry",
  "inquiry.staff_alert": "Alerted the team about an enquiry",
  // Catalogue
  "tour.created": "Created a tour",
  "tour.updated": "Edited a tour",
  "tour.duplicated": "Duplicated a tour",
  "tour.published": "Published a tour",
  "tour.unpublished": "Unpublished a tour",
  "tour.archived": "Archived a tour",
  "tour.restored": "Restored an archived tour",
  "tour.deleted": "Deleted a tour",
  "destination.deleted": "Deleted a destination",
  "category.deleted": "Deleted a category",
  // Content
  "review.created": "Added a review",
  "review.updated": "Edited a review",
  "review.published": "Published a review",
  "review.hidden": "Hid a review",
  "review.featured": "Featured a review",
  "review.unfeatured": "Stopped featuring a review",
  "review.deleted": "Deleted a review",
  "journey_entry.created": "Wrote a journal entry",
  "journey_entry.updated": "Edited a journal entry",
  "journey_entry.published": "Published a journal entry",
  "journey_entry.unpublished": "Unpublished a journal entry",
  "journey_entry.deleted": "Deleted a journal entry",
  "site_content.updated": "Edited the website pages",
  "media.uploaded": "Uploaded a file to the media library",
  "media.replaced": "Replaced a file in the media library",
  "media.deleted": "Deleted a file from the media library",
  // Discounts
  "promotions.campaign_created": "Created a discount campaign",
  "promotions.campaign_updated": "Edited a discount campaign",
  "promotions.campaign_activated": "Switched on a discount campaign",
  "promotions.campaign_deactivated": "Switched off a discount campaign",
  "promotions.campaign_deleted": "Deleted a discount campaign",
  "promotions.personal_discount_assigned": "Gave a customer a personal discount",
  "promotions.personal_discount_revoked": "Withdrew a personal discount",
  "promotions.request_submitted": "Received a discount request",
  "promotions.request_approved": "Approved a discount request",
  "promotions.request_rejected": "Declined a discount request",
  "promotions.discount_redeemed": "A discount was used on a booking",
  "promotions.settings_changed": "Changed the discount settings",
  // Workspace
  "workspace.profile_updated": "Edited the business profile",
  "workspace.branding_updated": "Changed the website's look",
  "workspace.onboarding_completed": "Finished setting up the workspace",
  "domain.added": "Added a custom domain",
  "domain.verified": "Verified a custom domain",
  "domain.primary_changed": "Changed the primary domain",
  "domain.removed": "Removed a custom domain",
  "integration.created": "Connected an integration",
  "integration.updated": "Changed an integration's settings",
  "integration.credentials_rotated": "Replaced an integration's credentials",
  "integration.tested": "Tested an integration",
  "integration.enabled": "Switched on an integration",
  "integration.disabled": "Switched off an integration",
  "integration.default_changed": "Changed the default integration",
  "integration.deleted": "Removed an integration",
  "notification.retried": "Retried sending a notification",
  // Team
  "member.role_changed": "Changed a team member's role",
  "member.deactivated": "Deactivated a team member",
  "member.reactivated": "Reactivated a team member",
  "member.removed": "Removed a team member",
  "invitation.created": "Invited someone to the team",
  "invitation.resent": "Sent an invitation again",
  "invitation.revoked": "Withdrew an invitation",
  "invitation.accepted": "Joined the team",
  "role.created": "Created a role",
  "role.updated": "Changed a role",
  "role.deleted": "Deleted a role",
  // Plan and billing
  "billing.plan_change_requested": "Asked to change the plan",
  "tenant.plan_changed": "Changed the workspace's plan",
  "tenant.limits_overridden": "Adjusted the workspace's plan limits",
  "tenant.created": "Created the workspace",
  "tenant.updated": "Updated the workspace account",
  "tenant.suspended": "Suspended the workspace",
  "tenant.activated": "Reactivated the workspace",
  "tenant.owner_changed": "Changed the workspace owner",
  "invoice.issued": "Issued an invoice",
  "invoice.paid": "Marked an invoice as paid",
  "invoice.voided": "Voided an invoice",
  "subscription.renewed": "Renewed the subscription",
  "subscription.cancelled": "Cancelled the subscription",
  // Support access
  "support.access_requested": "Asked for support access",
  "support.access_approved": "Approved support access",
  "support.access_denied": "Turned down support access",
  "support.access_revoked": "Ended support access",
  "support.session_started": "Started a support session",
  "support.session_ended": "Ended a support session",
};

/** A sentence for an action code, or the code itself when it is not known. */
export function auditActionLabel(action: string): string {
  return Object.hasOwn(ACTION_LABELS, action) ? ACTION_LABELS[action]! : action;
}

export interface AuditArea {
  /** The action prefix the server filters by, e.g. `booking`. */
  value: string;
  label: string;
}

/** Filter choices, in the order the sidebar lists the same parts of the product. */
export const AUDIT_AREAS: readonly AuditArea[] = [
  { value: "booking", label: "Bookings" },
  { value: "customer", label: "Customers" },
  { value: "inquiry", label: "Enquiries" },
  { value: "tour", label: "Tours" },
  { value: "destination", label: "Destinations" },
  { value: "category", label: "Categories" },
  { value: "review", label: "Reviews" },
  { value: "journey_entry", label: "Journal" },
  { value: "media", label: "Media library" },
  { value: "promotions", label: "Discounts & offers" },
  { value: "site_content", label: "Website pages" },
  { value: "workspace", label: "Workspace settings" },
  { value: "domain", label: "Domains" },
  { value: "integration", label: "Integrations" },
  { value: "notification", label: "Notifications" },
  { value: "member", label: "Team members" },
  { value: "invitation", label: "Invitations" },
  { value: "role", label: "Roles" },
  { value: "billing", label: "Plan requests" },
  { value: "tenant", label: "Workspace account" },
  { value: "invoice", label: "Invoices" },
  { value: "subscription", label: "Subscription" },
  { value: "support", label: "Support access" },
];

export function isAuditArea(value: string | undefined): value is string {
  return value !== undefined && AUDIT_AREAS.some((area) => area.value === value);
}

/** Support activity is called out visually wherever it appears. */
export function isSupportActivity(entry: { action: string; actorType: string }): boolean {
  return entry.actorType === "support_session" || entry.action.startsWith("support.");
}

const TARGET_LABELS: Record<string, string> = {
  booking: "Booking",
  customer: "Customer",
  inquiry: "Enquiry",
  tour: "Tour",
  destination: "Destination",
  category: "Category",
  tour_category: "Category",
  waitlist_entry: "Waiting list entry",
  promotion_settings: "Discount settings",
  site_content: "Website pages",
  workspace: "Workspace",
  user: "Person",
  review: "Review",
  journey_entry: "Journal entry",
  media: "File",
  media_asset: "File",
  campaign: "Campaign",
  personal_discount: "Personal discount",
  discount_request: "Discount request",
  domain: "Domain",
  integration: "Integration",
  membership: "Team member",
  invitation: "Invitation",
  role: "Role",
  plan: "Plan",
  invoice: "Invoice",
  subscription: "Subscription",
  tenant: "Workspace",
  support_grant: "Support access",
  notification: "Notification",
};

/** Metadata fields that name the record better than its id does, in order of preference. */
const NAMING_KEYS = ["reference", "number", "title", "name", "email", "hostname", "domain", "code", "toPlan"] as const;

/** `Booking AB-4821`, `Tour Old City Walk`, `Role` — or null when there is no target. */
export function auditTargetLabel(entry: { targetType: string | null; metadata: Record<string, unknown> }): string | null {
  if (!entry.targetType) return null;
  const type = TARGET_LABELS[entry.targetType] ?? humaniseKey(entry.targetType);
  for (const key of NAMING_KEYS) {
    const value = entry.metadata[key];
    if (typeof value === "string" && value.trim()) return `${type} ${value.trim()}`;
    if (typeof value === "number") return `${type} ${value}`;
  }
  return type;
}

/** `fromRole` → `From role`, `role_id` → `Role ID`. */
export function humaniseKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word === "id" ? "ID" : word === "ip" ? "IP" : word === "url" ? "URL" : word));
  if (words.length === 0) return key;
  const [first, ...rest] = words;
  return [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join(" ");
}

/** One metadata value as text. Nested values are shown compactly rather than dropped. */
export function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    return value.every((item) => typeof item === "string" || typeof item === "number")
      ? value.join(", ")
      : JSON.stringify(value);
  }
  return JSON.stringify(value);
}

export interface MetadataRow {
  key: string;
  label: string;
  value: string;
}

/** Key/value rows for the details of an entry, in the order they were written. */
export function metadataRows(metadata: Record<string, unknown> | null | undefined): MetadataRow[] {
  if (!metadata) return [];
  return Object.entries(metadata).map(([key, value]) => ({ key, label: humaniseKey(key), value: formatMetadataValue(value) }));
}
