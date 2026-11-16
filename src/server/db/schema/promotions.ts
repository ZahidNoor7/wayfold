import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgEnum, pgTable, smallint, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { tours } from "./catalog";
import { createdAt, id, tenantId, timestamptz, updatedAt } from "./columns";
import { users } from "./identity";
import { tenants } from "./tenancy";

export const discountType = pgEnum("discount_type", ["percent", "fixed"]);
export const campaignVisibility = pgEnum("campaign_visibility", ["public", "private"]);

/**
 * A campaign's status (inactive / scheduled / active / expired) is derived
 * from `is_active` and its date window; it is never stored.
 */
export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    blurb: text("blurb").notNull().default(""),
    type: discountType("type").notNull(),
    /** Whole percent for `percent`; minor units for `fixed`. */
    value: integer("value").notNull(),
    appliesToAllTours: boolean("applies_to_all_tours").notNull().default(true),
    visibility: campaignVisibility("visibility").notNull().default("public"),
    /** Lower-cased e-mails a private campaign is offered to. */
    assignedEmails: text("assigned_emails").array().notNull().default([]),
    minGuests: smallint("min_guests").notNull().default(0),
    minChildren: smallint("min_children").notNull().default(0),
    /** Travel date must be at least this many days after booking. */
    bookAheadDays: smallint("book_ahead_days").notNull().default(0),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    uses: integer("uses").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("campaigns_tenant_id_id_key").on(t.tenantId, t.id),
    index("campaigns_tenant_window_idx").on(t.tenantId, t.startsOn, t.endsOn),
    check("campaigns_value_check", sql`${t.value} > 0 and (${t.type} <> 'percent' or ${t.value} <= 90)`),
    check("campaigns_window_check", sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

export const campaignTours = pgTable(
  "campaign_tours",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull(),
    tourId: uuid("tour_id").notNull(),
  },
  (t) => [
    uniqueIndex("campaign_tours_key").on(t.tenantId, t.campaignId, t.tourId),
    foreignKey({ name: "campaign_tours_campaign_fk", columns: [t.tenantId, t.campaignId], foreignColumns: [campaigns.tenantId, campaigns.id] }).onDelete("cascade"),
    foreignKey({ name: "campaign_tours_tour_fk", columns: [t.tenantId, t.tourId], foreignColumns: [tours.tenantId, tours.id] }).onDelete("cascade"),
  ],
);

/** A single-use discount given to one e-mail address. */
export const personalDiscounts = pgTable(
  "personal_discounts",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    customerName: text("customer_name").notNull(),
    email: text("email").notNull(),
    /** Null = valid for any tour. */
    tourId: uuid("tour_id"),
    type: discountType("type").notNull(),
    value: integer("value").notNull(),
    expiresOn: date("expires_on"),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    usedByBookingId: uuid("used_by_booking_id"),
    revokedAt: timestamptz("revoked_at"),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("personal_discounts_tenant_id_id_key").on(t.tenantId, t.id),
    index("personal_discounts_tenant_email_idx").on(t.tenantId, t.email),
    foreignKey({ name: "personal_discounts_tour_fk", columns: [t.tenantId, t.tourId], foreignColumns: [tours.tenantId, tours.id] }),
    foreignKey({ name: "personal_discounts_booking_fk", columns: [t.tenantId, t.usedByBookingId], foreignColumns: [bookings.tenantId, bookings.id] }),
    check("personal_discounts_value_check", sql`${t.value} > 0 and (${t.type} <> 'percent' or ${t.value} <= 90)`),
  ],
);

export const discountRequestStatus = pgEnum("discount_request_status", ["pending", "approved", "rejected"]);

export const discountRequests = pgTable(
  "discount_requests",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    /** Human reference, unique within the tenant, e.g. `DR-1042`. */
    reference: text("reference").notNull(),
    /** Hash of the secret the customer needs, with the reference, to see status. */
    accessTokenHash: text("access_token_hash").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    tourId: uuid("tour_id").notNull(),
    /** Total party size: adults + children. */
    guests: smallint("guests").notNull(),
    adults: smallint("adults").notNull(),
    children: smallint("children").notNull().default(0),
    type: discountType("type").notNull(),
    value: integer("value").notNull(),
    reason: text("reason").notNull(),
    status: discountRequestStatus("status").notNull().default("pending"),
    decidedType: discountType("decided_type"),
    decidedValue: integer("decided_value"),
    decisionNote: text("decision_note"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamptz("decided_at"),
    usedByBookingId: uuid("used_by_booking_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("discount_requests_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("discount_requests_tenant_reference_key").on(t.tenantId, t.reference),
    // One open request per person per tour.
    uniqueIndex("discount_requests_one_pending_key")
      .on(t.tenantId, t.tourId, t.email)
      .where(sql`${t.status} = 'pending'`),
    foreignKey({ name: "discount_requests_tour_fk", columns: [t.tenantId, t.tourId], foreignColumns: [tours.tenantId, tours.id] }),
    foreignKey({ name: "discount_requests_booking_fk", columns: [t.tenantId, t.usedByBookingId], foreignColumns: [bookings.tenantId, bookings.id] }),
  ],
);
