import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, timestamptz, updatedAt } from "./columns";
import { mediaAssets } from "./media";
import { tenants } from "./tenancy";

export const tourCategories = pgTable(
  "tour_categories",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [unique("tour_categories_tenant_id_id_key").on(t.tenantId, t.id), uniqueIndex("tour_categories_tenant_slug_key").on(t.tenantId, t.slug)],
);

export const destinations = pgTable(
  "destinations",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    region: text("region").notNull().default(""),
    tagline: text("tagline").notNull().default(""),
    description: text("description").notNull().default(""),
    coverMediaId: uuid("cover_media_id"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    isPublished: boolean("is_published").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("destinations_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("destinations_tenant_slug_key").on(t.tenantId, t.slug),
    foreignKey({ name: "destinations_cover_fk", columns: [t.tenantId, t.coverMediaId], foreignColumns: [mediaAssets.tenantId, mediaAssets.id] }),
  ],
);

/**
 * How a tour is sold:
 *  - `day`: runs on set weekdays in timed slots, each with its own seat count
 *  - `departure`: fixed start dates with a shared seat count (multi-day groups)
 *  - `private`: any free date; one party at a time for the tour's full length
 */
export const tourKind = pgEnum("tour_kind", ["day", "departure", "private"]);
export const tourStatus = pgEnum("tour_status", ["draft", "published", "archived"]);

export interface TourSlot {
  /** `HH:MM`, 24-hour, in the tenant's timezone. */
  time: string;
  capacity: number;
}

export interface TourSchedule {
  /** ISO weekdays the tour runs on: 1 = Monday ... 7 = Sunday. */
  weekdays: number[];
  /** Timed slots for `day` tours. Empty for other kinds. */
  slots: TourSlot[];
}

export interface TourFaq {
  question: string;
  answer: string;
}

export const tours = pgTable(
  "tours",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** One or two sentences for cards. */
    summary: text("summary").notNull().default(""),
    description: text("description").notNull().default(""),
    categoryId: uuid("category_id"),
    destinationId: uuid("destination_id"),
    /** Free-text place line, e.g. "Sheki, Greater Caucasus". */
    place: text("place").notNull().default(""),
    kind: tourKind("kind").notNull().default("private"),
    durationDays: integer("duration_days").notNull().default(1),
    durationLabel: text("duration_label").notNull().default(""),
    /** Adult price in minor units of the tenant currency. */
    priceAdult: integer("price_adult").notNull().default(0),
    /** Child price as a percentage of the adult price. */
    childPricePercent: smallint("child_price_percent").notNull().default(50),
    childMaxAge: smallint("child_max_age").notNull().default(11),
    minGroupSize: smallint("min_group_size").notNull().default(1),
    maxGroupSize: smallint("max_group_size").notNull().default(8),
    schedule: jsonb("schedule").$type<TourSchedule>().notNull().default({ weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [] }),
    languages: text("languages").array().notNull().default([]),
    highlights: text("highlights").array().notNull().default([]),
    inclusions: text("inclusions").array().notNull().default([]),
    exclusions: text("exclusions").array().notNull().default([]),
    goodToKnow: text("good_to_know").array().notNull().default([]),
    faq: jsonb("faq").$type<TourFaq[]>().notNull().default([]),
    meetingPoint: text("meeting_point").notNull().default(""),
    meetingLatitude: doublePrecision("meeting_latitude"),
    meetingLongitude: doublePrecision("meeting_longitude"),
    cancellationPolicy: text("cancellation_policy").notNull().default(""),
    coverMediaId: uuid("cover_media_id"),
    isFeatured: boolean("is_featured").notNull().default(false),
    isPopular: boolean("is_popular").notNull().default(false),
    status: tourStatus("status").notNull().default("draft"),
    publishedAt: timestamptz("published_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("tours_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("tours_tenant_slug_key").on(t.tenantId, t.slug),
    index("tours_tenant_status_idx").on(t.tenantId, t.status),
    foreignKey({ name: "tours_category_fk", columns: [t.tenantId, t.categoryId], foreignColumns: [tourCategories.tenantId, tourCategories.id] }),
    foreignKey({ name: "tours_destination_fk", columns: [t.tenantId, t.destinationId], foreignColumns: [destinations.tenantId, destinations.id] }),
    foreignKey({ name: "tours_cover_fk", columns: [t.tenantId, t.coverMediaId], foreignColumns: [mediaAssets.tenantId, mediaAssets.id] }),
    check("tours_price_check", sql`${t.priceAdult} >= 0 and ${t.childPricePercent} between 0 and 100`),
    check("tours_duration_check", sql`${t.durationDays} >= 1`),
    check("tours_group_check", sql`${t.minGroupSize} >= 1 and ${t.maxGroupSize} >= ${t.minGroupSize}`),
  ],
);

export const tourItineraryDays = pgTable(
  "tour_itinerary_days",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    tourId: uuid("tour_id").notNull(),
    dayNumber: smallint("day_number").notNull(),
    title: text("title").notNull(),
    location: text("location").notNull().default(""),
    description: text("description").notNull().default(""),
    meta: text("meta").notNull().default(""),
  },
  (t) => [
    uniqueIndex("tour_itinerary_days_tour_day_key").on(t.tenantId, t.tourId, t.dayNumber),
    foreignKey({ name: "tour_itinerary_days_tour_fk", columns: [t.tenantId, t.tourId], foreignColumns: [tours.tenantId, tours.id] }).onDelete("cascade"),
  ],
);

export const tourMedia = pgTable(
  "tour_media",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    tourId: uuid("tour_id").notNull(),
    mediaId: uuid("media_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("tour_media_tour_media_key").on(t.tenantId, t.tourId, t.mediaId),
    foreignKey({ name: "tour_media_tour_fk", columns: [t.tenantId, t.tourId], foreignColumns: [tours.tenantId, tours.id] }).onDelete("cascade"),
    foreignKey({ name: "tour_media_media_fk", columns: [t.tenantId, t.mediaId], foreignColumns: [mediaAssets.tenantId, mediaAssets.id] }).onDelete("cascade"),
  ],
);

/** Fixed start dates for `departure` tours. */
export const tourDepartures = pgTable(
  "tour_departures",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    tourId: uuid("tour_id").notNull(),
    startDate: date("start_date").notNull(),
    startTime: time("start_time"),
    capacity: smallint("capacity").notNull(),
    isOpen: boolean("is_open").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("tour_departures_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("tour_departures_tour_date_key").on(t.tenantId, t.tourId, t.startDate),
    foreignKey({ name: "tour_departures_tour_fk", columns: [t.tenantId, t.tourId], foreignColumns: [tours.tenantId, tours.id] }).onDelete("cascade"),
    check("tour_departures_capacity_check", sql`${t.capacity} >= 1`),
  ],
);

/**
 * Dates on which nothing (tour_id null) or one tour cannot be booked:
 * holidays, guide unavailable, maintenance.
 */
export const availabilityBlocks = pgTable(
  "availability_blocks",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    tourId: uuid("tour_id"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("availability_blocks_tenant_dates_idx").on(t.tenantId, t.startDate, t.endDate),
    foreignKey({ name: "availability_blocks_tour_fk", columns: [t.tenantId, t.tourId], foreignColumns: [tours.tenantId, tours.id] }).onDelete("cascade"),
    check("availability_blocks_range_check", sql`${t.endDate} >= ${t.startDate}`),
  ],
);
