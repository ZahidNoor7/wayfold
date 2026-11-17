import { boolean, date, foreignKey, index, integer, jsonb, pgEnum, pgTable, smallint, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { destinations, tours } from "./catalog";
import { createdAt, id, tenantId, timestamptz, updatedAt } from "./columns";
import { users } from "./identity";
import { mediaAssets } from "./media";
import { tenants } from "./tenancy";

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    tourId: uuid("tour_id"),
    customerName: text("customer_name").notNull(),
    country: text("country").notNull().default(""),
    rating: smallint("rating").notNull(),
    title: text("title").notNull().default(""),
    body: text("body").notNull(),
    reviewedOn: date("reviewed_on").notNull().defaultNow(),
    isVerified: boolean("is_verified").notNull().default(false),
    isFeatured: boolean("is_featured").notNull().default(false),
    isPublished: boolean("is_published").notNull().default(true),
    avatarMediaId: uuid("avatar_media_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("reviews_tenant_id_id_key").on(t.tenantId, t.id),
    index("reviews_tenant_published_idx").on(t.tenantId, t.isPublished, t.reviewedOn),
    foreignKey({ name: "reviews_tour_fk", columns: [t.tenantId, t.tourId], foreignColumns: [tours.tenantId, tours.id] }),
    foreignKey({ name: "reviews_avatar_fk", columns: [t.tenantId, t.avatarMediaId], foreignColumns: [mediaAssets.tenantId, mediaAssets.id] }),
    check("reviews_rating_check", sql`${t.rating} between 1 and 5`),
  ],
);

/** Photos and videos attached to a review, in display order. */
export const reviewMedia = pgTable(
  "review_media",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    reviewId: uuid("review_id").notNull(),
    mediaId: uuid("media_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("review_media_key").on(t.tenantId, t.reviewId, t.mediaId),
    foreignKey({ name: "review_media_review_fk", columns: [t.tenantId, t.reviewId], foreignColumns: [reviews.tenantId, reviews.id] }).onDelete("cascade"),
    foreignKey({ name: "review_media_media_fk", columns: [t.tenantId, t.mediaId], foreignColumns: [mediaAssets.tenantId, mediaAssets.id] }).onDelete("cascade"),
  ],
);

/** Travel journal ("My Journey") entries. */
export const journeyEntries = pgTable(
  "journey_entries",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    destinationId: uuid("destination_id"),
    location: text("location").notNull().default(""),
    visitedOn: date("visited_on"),
    category: text("category").notNull().default(""),
    teaser: text("teaser").notNull().default(""),
    description: text("description").notNull().default(""),
    highlights: text("highlights").array().notNull().default([]),
    coverMediaId: uuid("cover_media_id"),
    relatedTourId: uuid("related_tour_id"),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("journey_entries_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("journey_entries_tenant_slug_key").on(t.tenantId, t.slug),
    foreignKey({ name: "journey_entries_destination_fk", columns: [t.tenantId, t.destinationId], foreignColumns: [destinations.tenantId, destinations.id] }),
    foreignKey({ name: "journey_entries_cover_fk", columns: [t.tenantId, t.coverMediaId], foreignColumns: [mediaAssets.tenantId, mediaAssets.id] }),
    foreignKey({ name: "journey_entries_tour_fk", columns: [t.tenantId, t.relatedTourId], foreignColumns: [tours.tenantId, tours.id] }),
  ],
);

export const journeyEntryMedia = pgTable(
  "journey_entry_media",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id").notNull(),
    mediaId: uuid("media_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("journey_entry_media_key").on(t.tenantId, t.entryId, t.mediaId),
    foreignKey({ name: "journey_entry_media_entry_fk", columns: [t.tenantId, t.entryId], foreignColumns: [journeyEntries.tenantId, journeyEntries.id] }).onDelete("cascade"),
    foreignKey({ name: "journey_entry_media_media_fk", columns: [t.tenantId, t.mediaId], foreignColumns: [mediaAssets.tenantId, mediaAssets.id] }).onDelete("cascade"),
  ],
);

export const inquiryStatus = pgEnum("inquiry_status", ["new", "read", "archived"]);

/** Messages from a storefront contact form. */
export const inquiries = pgTable(
  "inquiries",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    tourId: uuid("tour_id"),
    message: text("message").notNull(),
    /** Date the visitor would like to travel, if they gave one. */
    preferredDate: date("preferred_date"),
    status: inquiryStatus("status").notNull().default("new"),
    createdAt: createdAt(),
  },
  (t) => [
    index("inquiries_tenant_status_idx").on(t.tenantId, t.status, t.createdAt),
    foreignKey({ name: "inquiries_tour_fk", columns: [t.tenantId, t.tourId], foreignColumns: [tours.tenantId, tours.id] }),
  ],
);

/**
 * Per-tenant settings and structured website content, one row per tenant.
 * Shapes are defined and validated in `server/settings`.
 */
export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .default(sql`app_current_tenant()`)
    .references(() => tenants.id, { onDelete: "cascade" }),
  booking: jsonb("booking").$type<Record<string, unknown>>().notNull().default({}),
  promotions: jsonb("promotions").$type<Record<string, unknown>>().notNull().default({}),
  site: jsonb("site").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updatedAt(),
});

export const outboxStatus = pgEnum("outbox_status", ["pending", "sent", "failed", "skipped"]);

/**
 * Outgoing customer and staff notifications. Delivery uses the tenant's own
 * e-mail integration; with none configured a message is marked `skipped`
 * rather than sent through anyone else's account.
 */
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    relatedType: text("related_type"),
    relatedId: uuid("related_id"),
    createdAt: createdAt(),
    sentAt: timestamptz("sent_at"),
  },
  (t) => [index("notification_outbox_tenant_status_idx").on(t.tenantId, t.status, t.createdAt)],
);

/**
 * A private link that lets the customer of a completed booking write a
 * review. Only a SHA-256 of the token is stored, so the link cannot be
 * rebuilt from the database; asking for a new link rotates the token. One row
 * per booking: once a review is submitted through it (`used_at`), it is spent.
 */
export const reviewRequests = pgTable(
  "review_requests",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    usedAt: timestamptz("used_at"),
    /** The review written through this link. No foreign key: deleting the review leaves the link spent. */
    reviewId: uuid("review_id"),
    /** Files the customer uploaded through this link; only these can be attached to the review. */
    uploadedMediaIds: uuid("uploaded_media_ids").array().notNull().default(sql`'{}'::uuid[]`),
    /** Upload signatures handed out, capped so one link cannot fill the business's storage. */
    uploadCount: integer("upload_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("review_requests_booking_key").on(t.tenantId, t.bookingId),
    uniqueIndex("review_requests_token_key").on(t.tokenHash),
    foreignKey({ name: "review_requests_booking_fk", columns: [t.tenantId, t.bookingId], foreignColumns: [bookings.tenantId, bookings.id] }).onDelete("cascade"),
  ],
);
