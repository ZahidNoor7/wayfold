import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { confirmBooking, declineBooking, reopenBooking, rescheduleBooking } from "@/server/bookings/service";
import { archiveTour, updateTour } from "@/server/catalog/tours";
import { unpublishTour } from "@/server/catalog/publishing";
import { withTenant, type TenantScope } from "@/server/db/context";
import { tours } from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/server/errors";
import { allBookings, asOwner, bookingRow, createDayTour, NOW, requestBooking, seatsSold } from "../../helpers/bookings";
import { createTenant, type TenantFixture } from "../../helpers/fixtures";

vi.mock("@/server/promotions/engine", () => ({ findBestDiscount: vi.fn(async () => null), consumeDiscount: vi.fn(async () => undefined) }));
vi.mock("@/server/notifications/index", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

const DATE = "2027-03-10";
const schedule = (capacity: number) => ({ weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [{ time: "09:00", capacity }] });

/** A published day tour complete enough for the catalogue to accept edits to it. */
const publishedTour = (tenantId: string) => createDayTour(tenantId, { summary: "Walk the old city.", schedule: schedule(8) });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `edit` in its own transaction and keeps that transaction open (locks
 * held, nothing committed) until `release` is called.
 */
function holdOpen(t: TenantFixture, edit: (scope: TenantScope) => Promise<unknown>) {
  let release!: () => void;
  let ready!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const editing = new Promise<void>((resolve) => (ready = resolve));
  const done = asOwner(t, async (scope) => {
    await edit(scope);
    ready();
    await gate;
  });
  return { editing, release, done };
}

/** Starts `run`, gives it time to reach (and block on) the lock, then lets the open edit commit. */
async function raceBehind<T>(held: ReturnType<typeof holdOpen>, run: () => Promise<T>): Promise<PromiseSettledResult<T>> {
  await held.editing;
  const attempt = Promise.allSettled([run()]);
  await sleep(300);
  held.release();
  await held.done;
  return (await attempt)[0]!;
}

const reasonOf = (result: PromiseSettledResult<unknown>) => (result.status === "rejected" ? (result.reason as { code?: string }) : null);

describe("bookings racing catalogue edits", () => {
  it("refuses seats a schedule cut removed while the request waited: 3 sold, 8 → 5, request for 4", async () => {
    const t = await createTenant();
    const tour = await publishedTour(t.tenantId);
    await requestBooking(t.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", adults: 3 });

    const cut = holdOpen(t, (scope) => updateTour(scope, tour.id, { schedule: schedule(5) }));
    const result = await raceBehind(cut, () => requestBooking(t.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", adults: 4 }));

    expect(result.status).toBe("rejected");
    expect(reasonOf(result)).toMatchObject({ code: "slot_taken", seatsLeft: 2 });
    expect(await seatsSold(t.tenantId)).toBe(3);
    // Two seats are still there to sell.
    await requestBooking(t.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", adults: 2 });
    expect(await seatsSold(t.tenantId)).toBe(5);
  });

  it("refuses seats on a slot the cut reached before any booking existed on it", async () => {
    // No booking on the slot, so the catalogue takes no unit lock: only the
    // share lock on the tour row makes the request wait for the new capacity.
    const t = await createTenant();
    const tour = await publishedTour(t.tenantId);

    const cut = holdOpen(t, (scope) => updateTour(scope, tour.id, { schedule: schedule(3) }));
    const result = await raceBehind(cut, () => requestBooking(t.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", adults: 4 }));

    expect(reasonOf(result)).toMatchObject({ code: "slot_taken", seatsLeft: 3 });
    expect(await allBookings(t.tenantId)).toEqual([]);
  });

  it("applies a party-size cut that committed while the request waited", async () => {
    const t = await createTenant();
    const tour = await publishedTour(t.tenantId);
    const cut = holdOpen(t, (scope) => updateTour(scope, tour.id, { maxGroupSize: 2 }));
    const result = await raceBehind(cut, () => requestBooking(t.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", adults: 3 }));
    expect(result.status === "rejected" && result.reason).toBeInstanceOf(ValidationError);
    expect(await allBookings(t.tenantId)).toEqual([]);
  });

  it("never ends above the final capacity when the cut and the request start together", async () => {
    for (let round = 0; round < 6; round += 1) {
      const t = await createTenant();
      const tour = await publishedTour(t.tenantId);
      await requestBooking(t.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", adults: 3 });

      const [edit, booking] = await Promise.allSettled([
        asOwner(t, (scope) => updateTour(scope, tour.id, { schedule: schedule(5) })),
        requestBooking(t.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", adults: 4 }),
      ]);

      // Exactly one side wins: the cut (booking refused) or the booking (cut refused).
      expect([edit.status, booking.status].sort(), `round ${round}`).toEqual(["fulfilled", "rejected"]);
      if (booking.status === "rejected") expect(reasonOf(booking)?.code).toBe("slot_taken");
      if (edit.status === "rejected") expect(edit.reason).toBeInstanceOf(ValidationError);

      const [current] = await withTenant(t.tenantId, ({ tx }) => tx.select({ schedule: tours.schedule }).from(tours).where(eq(tours.id, tour.id)));
      expect(await seatsSold(t.tenantId)).toBeLessThanOrEqual(current!.schedule.slots[0]!.capacity);
    }
  });

  it.each([
    ["unpublished", unpublishTour],
    ["archived", archiveTour],
  ] as const)("refuses a request for a tour %s while the request waited", async (_label, takeDown) => {
    const t = await createTenant();
    const tour = await publishedTour(t.tenantId);
    const held = holdOpen(t, (scope) => takeDown(scope, tour.id));
    const result = await raceBehind(held, () => requestBooking(t.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", adults: 1 }));
    expect(result.status === "rejected" && result.reason).toBeInstanceOf(NotFoundError);
    expect(await allBookings(t.tenantId)).toEqual([]);
  });

  it("stops a request whose tour changed how it is sold while the request waited", async () => {
    // The lock taken was for a day-tour slot; the tour is now private, so that lock guards nothing.
    const t = await createTenant();
    const tour = await publishedTour(t.tenantId);
    const held = holdOpen(t, (scope) => updateTour(scope, tour.id, { kind: "private" }));
    const result = await raceBehind(held, () => requestBooking(t.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", adults: 1 }));
    expect(reasonOf(result)).toMatchObject({ code: "tour_changed", status: 409 });
    expect(await allBookings(t.tenantId)).toEqual([]);
  });

  it("checks reopen and reschedule against the capacity committed while they waited", async () => {
    const t = await createTenant();
    const tour = await publishedTour(t.tenantId);
    const other = "2027-03-11";
    // 3 confirmed on the 10th, a declined request for 3 on the 10th, 3 pending on the 11th.
    const sold = await requestBooking(t.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", adults: 3 });
    await asOwner(t, (scope) => confirmBooking(scope, sold.bookingId, { now: NOW }));
    const dropped = await requestBooking(t.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", adults: 3 });
    await asOwner(t, (scope) => declineBooking(scope, dropped.bookingId));
    const moving = await requestBooking(t.tenantId, { tourId: tour.id, date: other, slotTime: "09:00", adults: 3 });
    const cutTo = (capacity: number) => holdOpen(t, (scope) => updateTour(scope, tour.id, { schedule: schedule(capacity) }));

    // 3 + 3 fit in 8 but not in the 5 committed while the reopen waited.
    const reopened = await raceBehind(cutTo(5), () => asOwner(t, (scope) => reopenBooking(scope, dropped.bookingId, { now: NOW })));
    expect(reasonOf(reopened)?.code).toBe("booking_clash");
    expect((await bookingRow(t.tenantId, dropped.bookingId)).status).toBe("cancelled");

    // Moving 3 onto the 10th fits in 5 but not in the 4 committed while the move waited.
    const moved = await raceBehind(cutTo(4), () => asOwner(t, (scope) => rescheduleBooking(scope, moving.bookingId, { date: DATE }, { now: NOW })));
    expect(reasonOf(moved)?.code).toBe("booking_clash");
    expect((await bookingRow(t.tenantId, moving.bookingId)).startDate).toBe(other);
    expect(await seatsSold(t.tenantId)).toBe(6);
  });
});
