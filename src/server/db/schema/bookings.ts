import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
import { tourDepartures, tours } from "./catalog";
import { createdAt, id, tenantId, timestamptz, updatedAt } from "./columns";
import { users } from "./identity";
import { tenants } from "./tenancy";

export const contactMethod = pgEnum("contact_method", ["email", "whatsapp", "phone"]);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Lower-cased. One profile per e-mail per tenant. */
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    country: text("country").notNull().default(""),
    language: text("language").notNull().default(""),
    preferredContact: contactMethod("preferred_contact").notNull().default("email"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("customers_tenant_id_id_key").on(t.tenantId, t.id), uniqueIndex("customers_tenant_email_key").on(t.tenantId, t.email)],
);

export const customerNotes = pgTable(
  "customer_notes",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull(),
    body: text("body").notNull(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("customer_notes_customer_idx").on(t.tenantId, t.customerId),
    foreignKey({ name: "customer_notes_customer_fk", columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id] }).onDelete("cascade"),
  ],
);

export const bookingStatus = pgEnum("booking_status", ["pending", "confirmed", "completed", "cancelled"]);
export const bookingCancelKind = pgEnum("booking_cancel_kind", ["declined", "by_customer", "by_business", "expired"]);
export const paymentStatus = pgEnum("payment_status", ["unpaid", "deposit_paid", "paid", "refunded"]);
export const discountSource = pgEnum("discount_source", ["campaign", "personal", "request"]);

export interface BookingParticipant {
  name: string;
  age?: number | null;
}

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    /** Human reference, unique within the tenant, e.g. `AJ-SHE-4821`. */
    reference: text("reference").notNull(),
    tourId: uuid("tour_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    departureId: uuid("departure_id"),
    startDate: date("start_date").notNull(),
    /** Inclusive last day: start_date + duration_days - 1. */
    endDate: date("end_date").notNull(),
    slotTime: time("slot_time"),
    alternativeDate: date("alternative_date"),
    adults: smallint("adults").notNull(),
    children: smallint("children").notNull().default(0),
    participants: jsonb("participants").$type<BookingParticipant[]>().notNull().default([]),
    status: bookingStatus("status").notNull().default("pending"),
    cancelKind: bookingCancelKind("cancel_kind"),
    cancelReason: text("cancel_reason"),
    /** A pending request holds its seats until this moment. */
    holdExpiresAt: timestamptz("hold_expires_at"),

    // Price snapshot, computed on the server at submission. Minor units.
    currency: text("currency").notNull(),
    unitPriceAdult: integer("unit_price_adult").notNull(),
    unitPriceChild: integer("unit_price_child").notNull(),
    baseAmount: integer("base_amount").notNull(),
    discountAmount: integer("discount_amount").notNull().default(0),
    totalAmount: integer("total_amount").notNull(),
    discountSource: discountSource("discount_source"),
    discountRefId: uuid("discount_ref_id"),
    discountLabel: text("discount_label"),
    paymentStatus: paymentStatus("payment_status").notNull().default("unpaid"),
    amountPaid: integer("amount_paid").notNull().default(0),

    // Contact snapshot as entered at booking time.
    contactName: text("contact_name").notNull(),
    contactEmail: text("contact_email").notNull(),
    contactPhone: text("contact_phone").notNull().default(""),
    country: text("country").notNull().default(""),
    language: text("language").notNull().default(""),
    pickup: text("pickup").notNull().default(""),
    contactMethod: contactMethod("contact_method").notNull().default("email"),
    customerNotes: text("customer_notes").notNull().default(""),
    tourTitle: text("tour_title").notNull(),

    confirmedAt: timestamptz("confirmed_at"),
    completedAt: timestamptz("completed_at"),
    cancelledAt: timestamptz("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("bookings_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("bookings_tenant_reference_key").on(t.tenantId, t.reference),
    index("bookings_tenant_status_idx").on(t.tenantId, t.status, t.startDate),
    index("bookings_tenant_tour_date_idx").on(t.tenantId, t.tourId, t.startDate),
    index("bookings_tenant_customer_idx").on(t.tenantId, t.customerId),
    index("bookings_tenant_created_idx").on(t.tenantId, t.createdAt),
    foreignKey({ name: "bookings_tour_fk", columns: [t.tenantId, t.tourId], foreignColumns: [tours.tenantId, tours.id] }),
    foreignKey({ name: "bookings_customer_fk", columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id] }),
    foreignKey({ name: "bookings_departure_fk", columns: [t.tenantId, t.departureId], foreignColumns: [tourDepartures.tenantId, tourDepartures.id] }),
    check("bookings_party_check", sql`${t.adults} >= 1 and ${t.children} >= 0`),
    check("bookings_amounts_check", sql`${t.baseAmount} >= 0 and ${t.discountAmount} >= 0 and ${t.discountAmount} <= ${t.baseAmount} and ${t.totalAmount} = ${t.baseAmount} - ${t.discountAmount}`),
    check("bookings_dates_check", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

export const bookingEventKind = pgEnum("booking_event_kind", ["created", "status", "reschedule", "payment", "note", "notification"]);

/** Timeline of a booking: status changes, notes, notifications. Append-only by convention. */
export const bookingEvents = pgTable(
  "booking_events",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").notNull(),
    kind: bookingEventKind("kind").notNull(),
    message: text("message").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("booking_events_booking_idx").on(t.tenantId, t.bookingId, t.createdAt),
    foreignKey({ name: "booking_events_booking_fk", columns: [t.tenantId, t.bookingId], foreignColumns: [bookings.tenantId, bookings.id] }).onDelete("cascade"),
  ],
);

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    tourId: uuid("tour_id").notNull(),
    date: date("date").notNull(),
    slotTime: time("slot_time"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    partySize: smallint("party_size").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("waitlist_entries_unique_key").on(t.tenantId, t.tourId, t.date, t.email),
    foreignKey({ name: "waitlist_entries_tour_fk", columns: [t.tenantId, t.tourId], foreignColumns: [tours.tenantId, tours.id] }).onDelete("cascade"),
  ],
);
