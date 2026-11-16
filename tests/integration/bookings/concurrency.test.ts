import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { BookingClashError, confirmBooking, findClashes } from "@/server/bookings/service";
import { lockUnit } from "@/server/bookings/shared";
import { appDatabase } from "@/server/db/client";
import { withTenant } from "@/server/db/context";
import { LimitExceededError } from "@/server/errors";
import {
  allBookings,
  allCustomers,
  asOwner,
  createDayTour,
  createDeparture,
  createDepartureTour,
  createPrivateTour,
  hoursAfter,
  NOW,
  requestBooking,
  seatsSold,
} from "../../helpers/bookings";
import { createTenant, unique } from "../../helpers/fixtures";

vi.mock("@/server/promotions/engine", () => ({ findBestDiscount: vi.fn(async () => null), consumeDiscount: vi.fn(async () => undefined) }));
vi.mock("@/server/notifications/index", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

interface Outcome {
  won: number;
  codes: string[];
}

/** Fires every request at once, each in its own transaction, like separate visitors. */
async function race(attempts: (() => Promise<unknown>)[]): Promise<Outcome> {
  const settled = await Promise.allSettled(attempts.map((attempt) => attempt()));
  const lost = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  return { won: settled.length - lost.length, codes: lost.map((result) => (result.reason as { code?: string }).code ?? `unexpected: ${String(result.reason)}`) };
}

describe("double booking under concurrency", () => {
  it("never sells more seats than a day slot has: 8 visitors race for the last 5 seats", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const slot = { tourId: tour.id, date: "2027-03-10", slotTime: "09:00" };
    await requestBooking(t.tenantId, { ...slot, adults: 3 }); // 5 of 8 seats left

    // Each party takes 2 seats: only two parties fit (4 seats), a third would need 6.
    const outcome = await race(Array.from({ length: 8 }, () => () => requestBooking(t.tenantId, { ...slot, adults: 1, children: 1 })));

    expect(outcome.won).toBe(2);
    expect(outcome.codes).toEqual(Array(6).fill("slot_taken"));
    expect(await seatsSold(t.tenantId)).toBe(7);
    expect(await seatsSold(t.tenantId)).toBeLessThanOrEqual(8);
    expect(await allBookings(t.tenantId)).toHaveLength(3);
    // A lost race leaves nothing behind.
    expect(await allCustomers(t.tenantId)).toHaveLength(3);
    expect(await asOwner(t, (scope) => findClashes(scope, { now: NOW }))).toEqual([]);
  });

  it("fills a slot exactly when single seats race: 12 visitors, 8 seats", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const slot = { tourId: tour.id, date: "2027-03-10", slotTime: "14:00", adults: 1 };

    const outcome = await race(Array.from({ length: 12 }, () => () => requestBooking(t.tenantId, slot)));

    expect(outcome.won).toBe(8);
    expect(outcome.codes).toEqual(Array(4).fill("slot_taken"));
    expect(await seatsSold(t.tenantId)).toBe(8);
    const references = (await allBookings(t.tenantId)).map((row) => row.reference);
    expect(new Set(references).size).toBe(8);
  });

  it("keeps different slots and dates independent while they are booked at once", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const units = [
      { date: "2027-03-10", slotTime: "09:00" },
      { date: "2027-03-10", slotTime: "14:00" },
      { date: "2027-03-11", slotTime: "09:00" },
    ];
    // Two full parties per unit: one must win and one must lose, for each unit.
    const outcome = await race(units.flatMap((unit) => [1, 2].map(() => () => requestBooking(t.tenantId, { tourId: tour.id, ...unit, adults: 8 }))));
    expect(outcome.won).toBe(3);
    expect(outcome.codes).toEqual(Array(3).fill("slot_taken"));
    const rows = await allBookings(t.tenantId);
    expect(new Set(rows.map((row) => `${row.startDate} ${row.slotTime}`)).size).toBe(3);
  });

  it("never oversells a departure: 9 parties of 2 race for 8 seats", async () => {
    const t = await createTenant();
    const tour = await createDepartureTour(t.tenantId);
    await createDeparture(t.tenantId, tour.id, "2027-03-10", 8);

    const outcome = await race(Array.from({ length: 9 }, () => () => requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10", adults: 2 })));

    expect(outcome.won).toBe(4);
    expect(outcome.codes).toEqual(Array(5).fill("slot_taken"));
    expect(await seatsSold(t.tenantId)).toBe(8);
  });

  it("gives overlapping private dates to exactly one party, even across two private tours", async () => {
    const t = await createTenant();
    const grand = await createPrivateTour(t.tenantId, { durationDays: 8 });
    const wine = await createPrivateTour(t.tenantId, { durationDays: 2, title: "Private Wine Route" });

    // All six spans contain the 14th of March, so at most one can exist.
    const attempts = [
      { tourId: grand.id, date: "2027-03-10" },
      { tourId: grand.id, date: "2027-03-12" },
      { tourId: grand.id, date: "2027-03-14" },
      { tourId: wine.id, date: "2027-03-13" },
      { tourId: wine.id, date: "2027-03-14" },
      { tourId: wine.id, date: "2027-03-13" },
    ];
    const outcome = await race(attempts.map((attempt) => () => requestBooking(t.tenantId, attempt)));

    expect(outcome.won).toBe(1);
    expect(outcome.codes).toEqual(Array(5).fill("slot_taken"));
    expect(await allBookings(t.tenantId)).toHaveLength(1);
  });

  it("holds the monthly plan limit when requests for different dates arrive together", async () => {
    // The limit is below the test pool's three connections, so without the
    // tenant-wide quota lock three requests would all count zero and all pass.
    const t = await createTenant({ plan: { maxBookingsPerMonth: 2 } });
    const tour = await createDayTour(t.tenantId);
    const dates = ["2027-03-10", "2027-03-11", "2027-03-12", "2027-03-13", "2027-03-14", "2027-03-15", "2027-03-16"];

    const settled = await Promise.allSettled(dates.map((date) => requestBooking(t.tenantId, { tourId: tour.id, date, slotTime: "09:00", adults: 1 })));

    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(settled.length - failures.length).toBe(2);
    for (const failure of failures) expect(failure.reason).toBeInstanceOf(LimitExceededError);
    expect(await allBookings(t.tenantId)).toHaveLength(2);
  });

  it("creates one customer profile when the same person submits several requests at once", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const email = `${unique("twice")}@example.test`;
    const dates = ["2027-03-10", "2027-03-11", "2027-03-12", "2027-03-13"];

    const outcome = await race(dates.map((date) => () => requestBooking(t.tenantId, { tourId: tour.id, date, slotTime: "09:00", adults: 1, email })));

    expect(outcome).toEqual({ won: 4, codes: [] });
    const customers = await allCustomers(t.tenantId);
    expect(customers).toHaveLength(1);
    expect(new Set((await allBookings(t.tenantId)).map((row) => row.customerId))).toEqual(new Set([customers[0]!.id]));
  });

  it("lets only one of two lapsed requests be confirmed onto the same seats", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const slot = { tourId: tour.id, date: "2027-03-20", slotTime: "09:00", adults: 5 };
    // The second request only fits because the first one's hold has lapsed.
    const first = await requestBooking(t.tenantId, slot);
    const later = hoursAfter(30);
    const second = await requestBooking(t.tenantId, slot, { today: "2027-03-02", now: later });
    const afterBoth = hoursAfter(60);

    const settled = await Promise.allSettled(
      [first, second].map((booking) => asOwner(t, (scope) => confirmBooking(scope, booking.bookingId, { now: afterBoth }))),
    );

    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason).toBeInstanceOf(BookingClashError);
    const rows = await allBookings(t.tenantId);
    expect(rows.map((row) => row.status).sort()).toEqual(["confirmed", "pending"]);
    expect(await seatsSold(t.tenantId, afterBoth)).toBe(5);
  });

  it("refuses to take a booking lock in a transaction whose snapshot is fixed before the lock", async () => {
    const t = await createTenant();
    // READ COMMITTED, the level withTenant uses, is accepted.
    await expect(withTenant(t.tenantId, (scope) => lockUnit(scope, "private"))).resolves.toBeUndefined();

    for (const isolationLevel of ["repeatable read", "serializable"] as const) {
      const attempt = appDatabase().transaction(
        async (tx) => {
          await tx.execute(sql`select set_config('app.tenant_id', ${t.tenantId}, true)`);
          await lockUnit({ tenantId: t.tenantId, userId: null, tx }, "private");
        },
        { isolationLevel },
      );
      await expect(attempt, isolationLevel).rejects.toThrow(/READ COMMITTED/);
    }
  });
});
