import { and, asc, eq } from "drizzle-orm";
import { createBookingRequest, type BookingRequestInput, type BookingRequestOptions, type BookingRequestResult } from "@/server/bookings/request";
import { withTenant } from "@/server/db/context";
import { auditLogs, availabilityBlocks, bookingEvents, bookings, customers, tenants, tourDepartures, tours } from "@/server/db/schema";
import type { TenantFixture } from "./fixtures";
import { unique } from "./fixtures";

/** A Monday. Every booking test pins the clock here so dates never drift. */
export const TODAY = "2027-03-01";
export const NOW = new Date("2027-03-01T09:00:00.000Z");

export const hoursAfter = (hours: number, from: Date = NOW) => new Date(from.getTime() + hours * 3_600_000);

type TourInsert = typeof tours.$inferInsert;
export type TourRow = typeof tours.$inferSelect;

/** Inserts a tour directly: the catalogue service belongs to another module. */
export async function createTour(tenantId: string, overrides: Partial<TourInsert> = {}): Promise<TourRow> {
  return withTenant(tenantId, async ({ tx }) => {
    const [row] = await tx
      .insert(tours)
      .values({
        slug: unique("old-city"),
        title: "Old City Walk",
        kind: "day",
        durationDays: 1,
        priceAdult: 12_000,
        childPricePercent: 50,
        maxGroupSize: 8,
        schedule: {
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          slots: [
            { time: "09:00", capacity: 8 },
            { time: "14:00", capacity: 8 },
          ],
        },
        status: "published",
        ...overrides,
      })
      .returning();
    return row!;
  });
}

export const createDayTour = (tenantId: string, overrides: Partial<TourInsert> = {}) => createTour(tenantId, overrides);

export const createDepartureTour = (tenantId: string, overrides: Partial<TourInsert> = {}) =>
  createTour(tenantId, {
    slug: unique("sheki"),
    title: "Silk Road to Sheki",
    kind: "departure",
    durationDays: 3,
    priceAdult: 69_000,
    schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [] },
    ...overrides,
  });

export const createPrivateTour = (tenantId: string, overrides: Partial<TourInsert> = {}) =>
  createTour(tenantId, {
    slug: unique("grand"),
    title: "Private Grand Tour",
    kind: "private",
    durationDays: 8,
    priceAdult: 245_000,
    schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [] },
    ...overrides,
  });

export async function createDeparture(tenantId: string, tourId: string, startDate: string, capacity = 8, isOpen = true) {
  return withTenant(tenantId, async ({ tx }) => {
    const [row] = await tx.insert(tourDepartures).values({ tourId, startDate, capacity, isOpen }).returning();
    return row!;
  });
}

export async function createBlock(tenantId: string, block: { tourId?: string | null; startDate: string; endDate: string; reason?: string }) {
  return withTenant(tenantId, async ({ tx }) => {
    const [row] = await tx
      .insert(availabilityBlocks)
      .values({ tourId: block.tourId ?? null, startDate: block.startDate, endDate: block.endDate, reason: block.reason ?? "" })
      .returning();
    return row!;
  });
}

export async function setTenantEmail(tenantId: string, email: string): Promise<void> {
  await withTenant(tenantId, ({ tx }) => tx.update(tenants).set({ email }).where(eq(tenants.id, tenantId)));
}

/** A complete, valid storefront request; tests override what they are about. */
export function requestInput(overrides: Record<string, unknown> = {}): BookingRequestInput {
  return {
    date: "2027-03-10",
    adults: 2,
    children: 0,
    name: "Eleanor Whitfield",
    email: `${unique("guest")}@example.test`,
    phone: "+44 7700 900821",
    contactMethod: "email",
    agree: true,
    ...overrides,
  } as BookingRequestInput;
}

/** Submits a request in its own transaction, like one storefront visitor. */
export function requestBooking(
  tenantId: string,
  overrides: Record<string, unknown>,
  options: Partial<BookingRequestOptions> = {},
): Promise<BookingRequestResult> {
  return withTenant(tenantId, (scope) => createBookingRequest(scope, requestInput(overrides), { today: TODAY, now: NOW, ...options }));
}

/** Runs `fn` as the tenant's owner in one transaction. */
export function asOwner<T>(tenant: TenantFixture, fn: Parameters<typeof withTenant<T>>[1]): Promise<T> {
  return withTenant(tenant.tenantId, fn, { userId: tenant.ownerId });
}

/** The error a promise rejects with; fails the test when it resolves. */
export async function errorOf(promise: Promise<unknown>): Promise<Error & { code?: string; fieldErrors?: Record<string, string[]> }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { code?: string; fieldErrors?: Record<string, string[]> };
  }
  throw new Error("Expected the promise to reject, but it resolved.");
}

export function bookingRow(tenantId: string, id: string) {
  return withTenant(tenantId, async ({ tx }) => {
    const [row] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, id)));
    return row!;
  });
}

export function allBookings(tenantId: string) {
  return withTenant(tenantId, ({ tx }) => tx.select().from(bookings).where(eq(bookings.tenantId, tenantId)).orderBy(asc(bookings.createdAt), asc(bookings.reference)));
}

export function allCustomers(tenantId: string) {
  return withTenant(tenantId, ({ tx }) => tx.select().from(customers).where(eq(customers.tenantId, tenantId)).orderBy(asc(customers.email)));
}

export function eventsOf(tenantId: string, bookingId: string) {
  return withTenant(tenantId, ({ tx }) =>
    tx
      .select({ kind: bookingEvents.kind, message: bookingEvents.message, actorId: bookingEvents.actorId })
      .from(bookingEvents)
      .where(and(eq(bookingEvents.tenantId, tenantId), eq(bookingEvents.bookingId, bookingId)))
      .orderBy(asc(bookingEvents.createdAt), asc(bookingEvents.id)),
  );
}

export function auditActions(tenantId: string, targetId?: string) {
  return withTenant(tenantId, async ({ tx }) => {
    const rows = await tx
      .select({ action: auditLogs.action, targetId: auditLogs.targetId, metadata: auditLogs.metadata, actorType: auditLogs.actorType })
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, tenantId))
      .orderBy(asc(auditLogs.createdAt));
    return targetId ? rows.filter((row) => row.targetId === targetId) : rows;
  });
}

/** Sum of seats on bookings that still hold them at `now`. */
export async function seatsSold(tenantId: string, now: Date = NOW): Promise<number> {
  const rows = await allBookings(tenantId);
  return rows
    .filter((row) => row.status === "confirmed" || (row.status === "pending" && row.holdExpiresAt !== null && row.holdExpiresAt > now))
    .reduce((sum, row) => sum + row.adults + row.children, 0);
}
