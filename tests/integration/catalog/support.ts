import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { withTenant, type TenantScope } from "@/server/db/context";
import { auditLogs, bookings, customers, discountRequests, inquiries, journeyEntries, personalDiscounts, reviews } from "@/server/db/schema";
import { AppError, ValidationError } from "@/server/errors";
import { unique, type TenantFixture } from "../../helpers/fixtures";

/** Runs `fn` as the workspace owner. */
export function as<T>(tenant: TenantFixture, fn: (scope: TenantScope) => Promise<T>): Promise<T> {
  return withTenant(tenant.tenantId, fn, { userId: tenant.ownerId });
}

/** The rejection of `run`, or a failed assertion when it resolves. */
export async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to be rejected, but it resolved.");
}

/** Asserts a ValidationError and returns its field errors. */
export async function fieldErrors(run: () => Promise<unknown>): Promise<Record<string, string[]>> {
  const error = await rejection(run);
  expect(error).toBeInstanceOf(ValidationError);
  return (error as ValidationError).fieldErrors ?? {};
}

export async function errorCode(run: () => Promise<unknown>): Promise<string> {
  const error = await rejection(run);
  expect(error).toBeInstanceOf(AppError);
  return (error as AppError).code;
}

export function auditActions(tenant: TenantFixture, targetId: string): Promise<string[]> {
  return as(tenant, async ({ tx }) => {
    const rows = await tx.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.targetId, targetId)).orderBy(auditLogs.createdAt);
    return rows.map((row) => row.action);
  });
}

export interface BookingSeed {
  tourId: string;
  departureId?: string | null;
  startDate?: string;
  /** `HH:MM`, for day tours. */
  slotTime?: string | null;
  status?: "pending" | "confirmed" | "completed" | "cancelled";
  adults?: number;
  children?: number;
}

/**
 * Inserts a booking row directly, inside the caller's transaction. Bookings
 * have their own module; the catalogue only needs rows to exist so its "has
 * bookings" rules can be exercised.
 */
export async function seedBookingIn({ tx }: TenantScope, seed: BookingSeed): Promise<{ id: string }> {
  const [customer] = await tx
    .insert(customers)
    .values({ name: "Guest", email: `${unique("guest")}@example.test` })
    .returning({ id: customers.id });
  const startDate = seed.startDate ?? "2031-04-09";
  const [row] = await tx
    .insert(bookings)
    .values({
      reference: unique("REF").toUpperCase(),
      tourId: seed.tourId,
      customerId: customer!.id,
      departureId: seed.departureId ?? null,
      startDate,
      endDate: startDate,
      slotTime: seed.slotTime ?? null,
      adults: seed.adults ?? 2,
      children: seed.children ?? 0,
      status: seed.status ?? "confirmed",
      currency: "USD",
      unitPriceAdult: 1000,
      unitPriceChild: 500,
      baseAmount: 2000,
      totalAmount: 2000,
      contactName: "Guest",
      contactEmail: "guest@example.test",
      tourTitle: "Seeded",
    })
    .returning({ id: bookings.id });
  return row!;
}

/** `seedBookingIn` in a transaction of its own. */
export function seedBooking(tenant: TenantFixture, seed: BookingSeed): Promise<{ id: string }> {
  return as(tenant, (scope) => seedBookingIn(scope, seed));
}

/** Inserts a review row directly; review services belong to another module. */
export function seedReview(tenant: TenantFixture, seed: { tourId: string | null; rating: number; isPublished?: boolean }): Promise<{ id: string }> {
  return as(tenant, async ({ tx }) => {
    const [row] = await tx
      .insert(reviews)
      .values({ tourId: seed.tourId, customerName: "Reviewer", rating: seed.rating, body: "A wonderful few days.", isPublished: seed.isPublished ?? true })
      .returning({ id: reviews.id });
    return row!;
  });
}

/** Rows of other modules that point at a tour, inserted directly to exercise the delete rules. */
export function seedTourMentions(tenant: TenantFixture, tourId: string): Promise<{ inquiryId: string; journeyId: string }> {
  return as(tenant, async ({ tx }) => {
    const [inquiry] = await tx
      .insert(inquiries)
      .values({ name: "Asker", email: "asker@example.test", tourId, message: "Is this tour suitable for children?" })
      .returning({ id: inquiries.id });
    const [journey] = await tx
      .insert(journeyEntries)
      .values({ title: "On the road", slug: unique("journey"), relatedTourId: tourId })
      .returning({ id: journeyEntries.id });
    return { inquiryId: inquiry!.id, journeyId: journey!.id };
  });
}

export function seedPersonalDiscount(tenant: TenantFixture, tourId: string): Promise<{ id: string }> {
  return as(tenant, async ({ tx }) => {
    const [row] = await tx
      .insert(personalDiscounts)
      .values({ customerName: "Guest", email: "guest@example.test", tourId, type: "percent", value: 10 })
      .returning({ id: personalDiscounts.id });
    return row!;
  });
}

export function seedDiscountRequest(tenant: TenantFixture, tourId: string): Promise<{ id: string }> {
  return as(tenant, async ({ tx }) => {
    const [row] = await tx
      .insert(discountRequests)
      .values({
        reference: unique("DR").toUpperCase(),
        accessTokenHash: "test-hash",
        name: "Guest",
        email: "guest@example.test",
        tourId,
        guests: 2,
        adults: 2,
        type: "percent",
        value: 10,
        reason: "Returning guest",
      })
      .returning({ id: discountRequests.id });
    return row!;
  });
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `first` in its own transaction and keeps that transaction open while
 * `meanwhile` runs, then lets it commit. `meanwhile` gets a `commit()` to end
 * the first transaction early and wait for it; if it never calls it, or
 * fails, the transaction is still released, so one failed assertion cannot
 * leave a connection (and its locks) hanging over the next test.
 */
export async function whileOpen<T>(
  tenant: TenantFixture,
  first: (scope: TenantScope) => Promise<unknown>,
  meanwhile: (commit: () => Promise<void>) => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  const done = as(tenant, async (scope) => {
    await first(scope);
    ready();
    await gate;
  });
  const commit = () => {
    release();
    return done;
  };
  try {
    // If `first` fails, `done` rejects and there is nothing to wait for.
    await Promise.race([started, done]);
    return await meanwhile(commit);
  } finally {
    release();
    await done.catch(() => undefined);
  }
}

/** Settles to the value or the rejection of `run`, and reports whether it has settled yet. */
export function watch<T>(run: () => Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  const finished = run().then(
    (value) => Object.assign(state, { settled: true, value }),
    (error: unknown) => Object.assign(state, { settled: true, error }),
  );
  return { state, finished };
}
