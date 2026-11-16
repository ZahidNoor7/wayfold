import "server-only";
import { and, asc, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { recordAudit } from "../audit";
import { toCsv } from "../bookings/csv";
import { assertId, escapeLike, normaliseTime, parse } from "../bookings/shared";
import { normaliseEmail, type TenantScope } from "../db/context";
import { bookings, customerNotes, customers, users } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";

export type CustomerRow = typeof customers.$inferSelect;
export type ContactMethod = CustomerRow["preferredContact"];

const CONTACT_METHODS = ["email", "whatsapp", "phone"] as const;
/**
 * Lower-cased, then checked with the same rule the notification outbox
 * applies, so an address accepted here can always be written to.
 */
export const customerEmailSchema = z
  .string()
  .max(254, "Enter a valid email, e.g. name@example.com.")
  .transform(normaliseEmail)
  .pipe(z.email("Enter a valid email, e.g. name@example.com."));

/** Booking figures derived by SQL, never stored on the profile. */
export interface CustomerStats {
  bookingCount: number;
  /** Sum of the totals of confirmed and completed bookings, minor units. */
  totalSpent: number;
  lastBookingAt: Date | null;
}

export type CustomerListItem = CustomerRow & CustomerStats;

const onOwnBookings = and(eq(bookings.tenantId, customers.tenantId), eq(bookings.customerId, customers.id));

const statColumns = {
  bookingCount: sql<number>`count(${bookings.id})`.mapWith(Number),
  totalSpent: sql<number>`coalesce(sum(${bookings.totalAmount}) filter (where ${bookings.status} in ('confirmed', 'completed')), 0)`.mapWith(Number),
  lastBookingAt: sql<Date | null>`max(${bookings.createdAt})`.mapWith(bookings.createdAt),
};

function searchCondition(search: string | undefined): SQL | undefined {
  if (!search) return undefined;
  const pattern = `%${escapeLike(search)}%`;
  return or(ilike(customers.name, pattern), ilike(customers.email, pattern), ilike(customers.phone, pattern));
}

export const listCustomersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  sort: z.enum(["name", "newest", "top_spenders", "recent_booking"]).default("name"),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});
export type ListCustomersInput = z.input<typeof listCustomersSchema>;

export async function listCustomers(scope: TenantScope, raw: ListCustomersInput = {}): Promise<{ rows: CustomerListItem[]; total: number }> {
  const input = parse(listCustomersSchema, raw);
  const where = and(eq(customers.tenantId, scope.tenantId), searchCondition(input.search));

  const order = {
    name: [asc(customers.name), asc(customers.id)],
    newest: [desc(customers.createdAt), asc(customers.id)],
    top_spenders: [desc(statColumns.totalSpent), asc(customers.name), asc(customers.id)],
    recent_booking: [sql`${statColumns.lastBookingAt} desc nulls last`, asc(customers.name), asc(customers.id)],
  }[input.sort];

  const rows = await scope.tx
    .select({ customer: customers, ...statColumns })
    .from(customers)
    .leftJoin(bookings, onOwnBookings)
    .where(where)
    .groupBy(customers.id)
    .orderBy(...order)
    .limit(input.limit)
    .offset(input.offset);

  const [count] = await scope.tx
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(customers)
    .where(where);

  return {
    rows: rows.map(({ customer, ...stats }) => ({ ...customer, ...stats })),
    total: count?.total ?? 0,
  };
}

async function findCustomer(scope: TenantScope, id: string): Promise<CustomerRow> {
  assertId(id, "Customer");
  const [row] = await scope.tx
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, scope.tenantId), eq(customers.id, id)))
    .limit(1);
  // Same answer whether the id is unknown or belongs to another tenant.
  if (!row) throw new NotFoundError("Customer");
  return row;
}

export interface CustomerBooking {
  id: string;
  reference: string;
  tourId: string;
  tourTitle: string;
  startDate: string;
  endDate: string;
  slotTime: string | null;
  adults: number;
  children: number;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  /** Why it was cancelled; null unless `status` is `cancelled`. */
  cancelKind: "declined" | "by_customer" | "by_business" | "expired" | null;
  paymentStatus: "unpaid" | "deposit_paid" | "paid" | "refunded";
  totalAmount: number;
  currency: string;
  createdAt: Date;
}

export interface CustomerNote {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
}

export interface CustomerProfile {
  customer: CustomerRow;
  stats: CustomerStats;
  bookings: CustomerBooking[];
  notes: CustomerNote[];
}

/** Profile, booking history (newest first) and internal notes of one customer. */
export async function getCustomer(scope: TenantScope, id: string): Promise<CustomerProfile> {
  const customer = await findCustomer(scope, id);

  const history = await scope.tx
    .select({
      id: bookings.id,
      reference: bookings.reference,
      tourId: bookings.tourId,
      tourTitle: bookings.tourTitle,
      startDate: bookings.startDate,
      endDate: bookings.endDate,
      slotTime: bookings.slotTime,
      adults: bookings.adults,
      children: bookings.children,
      status: bookings.status,
      cancelKind: bookings.cancelKind,
      paymentStatus: bookings.paymentStatus,
      totalAmount: bookings.totalAmount,
      currency: bookings.currency,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.customerId, id)))
    .orderBy(desc(bookings.createdAt), desc(bookings.id));

  const [stats] = await scope.tx
    .select(statColumns)
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.customerId, id)));

  return {
    customer,
    stats: stats ?? { bookingCount: 0, totalSpent: 0, lastBookingAt: null },
    bookings: history.map((row) => ({
      ...row,
      slotTime: row.slotTime ? normaliseTime(row.slotTime) : null,
      // A reopened booking keeps no stale reason, but never trust that alone.
      cancelKind: row.status === "cancelled" ? row.cancelKind : null,
    })),
    notes: await listNotes(scope, id),
  };
}

async function listNotes(scope: TenantScope, customerId: string): Promise<CustomerNote[]> {
  return scope.tx
    .select({
      id: customerNotes.id,
      body: customerNotes.body,
      authorId: customerNotes.authorId,
      authorName: users.name,
      createdAt: customerNotes.createdAt,
    })
    .from(customerNotes)
    .leftJoin(users, eq(users.id, customerNotes.authorId))
    .where(and(eq(customerNotes.tenantId, scope.tenantId), eq(customerNotes.customerId, customerId)))
    .orderBy(desc(customerNotes.createdAt), desc(customerNotes.id));
}

export const updateCustomerSchema = z.object({
  name: z.string().trim().min(2, "Please enter the customer's full name.").max(120).optional(),
  email: customerEmailSchema.optional(),
  phone: z.string().trim().max(40).optional(),
  country: z.string().trim().max(80).optional(),
  language: z.string().trim().max(40).optional(),
  preferredContact: z.enum(CONTACT_METHODS).optional(),
  marketingOptIn: z.boolean().optional(),
});
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;

/**
 * Edits a profile. One profile per e-mail per tenant: moving a profile onto
 * an address another customer of this tenant already has is a conflict.
 * Past bookings keep the contact details entered at booking time.
 */
export async function updateCustomer(scope: TenantScope, id: string, raw: UpdateCustomerInput): Promise<CustomerRow> {
  const existing = await findCustomer(scope, id);
  const input = parse(updateCustomerSchema, raw);
  const changes = Object.fromEntries(
    Object.entries(input).filter(([key, value]) => value !== undefined && value !== existing[key as keyof CustomerRow]),
  ) as Partial<z.output<typeof updateCustomerSchema>>;
  if (Object.keys(changes).length === 0) return existing;

  if (changes.email) {
    const taken = await scope.tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, scope.tenantId), eq(customers.email, changes.email), ne(customers.id, id)))
      .limit(1);
    if (taken.length > 0) throw new ConflictError("Another customer already uses that e-mail address.", "email_taken");
  }

  const [row] = (await scope.tx
    .update(customers)
    .set(changes)
    .where(and(eq(customers.tenantId, scope.tenantId), eq(customers.id, id)))
    .returning()) as [CustomerRow];

  await recordAudit(scope, {
    action: "customer.updated",
    targetType: "customer",
    targetId: id,
    // Field names only: the values are personal data.
    metadata: { fields: Object.keys(changes) },
  });
  return row;
}

export function setMarketingOptIn(scope: TenantScope, id: string, optIn: boolean): Promise<CustomerRow> {
  return updateCustomer(scope, id, { marketingOptIn: optIn });
}

export function setPreferredContact(scope: TenantScope, id: string, method: ContactMethod): Promise<CustomerRow> {
  return updateCustomer(scope, id, { preferredContact: method });
}

export const customerNoteSchema = z.object({ body: z.string().trim().min(1, "Write a note first.").max(4000) });

export async function addCustomerNote(scope: TenantScope, customerId: string, body: string): Promise<CustomerNote> {
  await findCustomer(scope, customerId);
  const input = parse(customerNoteSchema, { body });
  const [row] = (await scope.tx
    .insert(customerNotes)
    .values({ tenantId: scope.tenantId, customerId, body: input.body, authorId: scope.userId })
    .returning()) as [typeof customerNotes.$inferSelect];
  await recordAudit(scope, { action: "customer.note_added", targetType: "customer", targetId: customerId, metadata: { noteId: row.id } });
  const notes = await listNotes(scope, customerId);
  return notes.find((note) => note.id === row.id)!;
}

export async function deleteCustomerNote(scope: TenantScope, customerId: string, noteId: string): Promise<void> {
  await findCustomer(scope, customerId);
  assertId(noteId, "Note");
  const removed = await scope.tx
    .delete(customerNotes)
    .where(and(eq(customerNotes.tenantId, scope.tenantId), eq(customerNotes.customerId, customerId), eq(customerNotes.id, noteId)))
    .returning({ id: customerNotes.id });
  if (removed.length === 0) throw new NotFoundError("Note");
  await recordAudit(scope, { action: "customer.note_deleted", targetType: "customer", targetId: customerId, metadata: { noteId } });
}

/** Rows one export may contain; larger books are exported in filtered parts. */
export const MAX_EXPORT_ROWS = 10_000;

export async function exportCustomersCsv(scope: TenantScope, filters: { search?: string } = {}): Promise<string> {
  const input = parse(z.object({ search: z.string().trim().max(120).optional() }), filters);
  const rows = await scope.tx
    .select({ customer: customers, ...statColumns })
    .from(customers)
    .leftJoin(bookings, onOwnBookings)
    .where(and(eq(customers.tenantId, scope.tenantId), searchCondition(input.search)))
    .groupBy(customers.id)
    .orderBy(asc(customers.name), asc(customers.id))
    .limit(MAX_EXPORT_ROWS);

  await recordAudit(scope, { action: "customer.exported", targetType: "customer", metadata: { rows: rows.length } });

  return toCsv(
    ["Name", "Email", "Phone", "Country", "Language", "Preferred contact", "Marketing opt-in", "Bookings", "Total spent (minor units)", "Last booking", "Customer since"],
    rows.map(({ customer, bookingCount, totalSpent, lastBookingAt }) => [
      customer.name,
      customer.email,
      customer.phone,
      customer.country,
      customer.language,
      customer.preferredContact,
      customer.marketingOptIn,
      bookingCount,
      totalSpent,
      lastBookingAt,
      customer.createdAt,
    ]),
  );
}

export interface BookingContact {
  name: string;
  /** Already lower-cased. */
  email: string;
  phone: string;
  country: string;
  language: string;
  preferredContact: ContactMethod;
}

/**
 * Finds or creates the profile for the e-mail on a booking request, inside
 * the booking's transaction. The form is public, so an existing profile is
 * never overwritten by it: a stranger who types a known address must not be
 * able to rename that customer. Only blank fields are filled in, and the
 * booking itself keeps the contact details exactly as entered.
 */
export async function upsertCustomerForBooking(scope: TenantScope, contact: BookingContact): Promise<CustomerRow> {
  const keepOrFill = (column: AnyPgColumn) => sql`case when ${column} = '' then excluded.${sql.identifier(column.name)} else ${column} end`;

  const [row] = (await scope.tx
    .insert(customers)
    .values({ tenantId: scope.tenantId, ...contact, email: normaliseEmail(contact.email) })
    .onConflictDoUpdate({
      target: [customers.tenantId, customers.email],
      set: {
        phone: keepOrFill(customers.phone),
        country: keepOrFill(customers.country),
        language: keepOrFill(customers.language),
      },
    })
    .returning()) as [CustomerRow];
  return row;
}
