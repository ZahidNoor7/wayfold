import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { bookingSeries, cancelBooking, completeBooking, confirmBooking, declineBooking } from "@/server/bookings/service";
import { withTenant } from "@/server/db/context";
import { tenants } from "@/server/db/schema";
import { ValidationError } from "@/server/errors";
import { asOwner, createDayTour, errorOf, requestBooking } from "../../helpers/bookings";
import { createTenant, type TenantFixture } from "../../helpers/fixtures";

vi.mock("@/server/promotions/engine", () => ({ findBestDiscount: vi.fn(async () => null), consumeDiscount: vi.fn(async () => undefined) }));
vi.mock("@/server/notifications/index", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

const setTimezone = (tenantId: string, timezone: string) => withTenant(tenantId, ({ tx }) => tx.update(tenants).set({ timezone }).where(eq(tenants.id, tenantId)));
const series = (t: TenantFixture, input: Record<string, unknown>) => asOwner(t, (scope) => bookingSeries(scope, input as never));
const zero = (bucket: string) => ({ bucket, requests: 0, confirmed: 0, cancelled: 0, revenue: 0 });

/**
 * Baku is UTC+4. Three requests made around the February/March boundary:
 *  - 2027-02-28 19:00Z = 23:00 Baku, February  (1 adult, 12 000) → completed
 *  - 2027-02-28 21:30Z = 01:30 Baku, 1 March   (2 adults, 24 000) → confirmed
 *  - 2027-03-01 09:00Z = 13:00 Baku, 1 March   (1 adult, 12 000) → declined
 * Tours start on 2027-03-10, 2027-04-02 and 2027-04-03.
 */
async function bakuTenant() {
  const t = await createTenant();
  await setTimezone(t.tenantId, "Asia/Baku");
  const tour = await createDayTour(t.tenantId, { priceAdult: 12_000 });
  const at = (iso: string, today: string) => ({ now: new Date(iso), today });
  const lateFeb = await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", date: "2027-03-10", adults: 1 }, at("2027-02-28T19:00:00Z", "2027-02-28"));
  const earlyMar = await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", date: "2027-04-02", adults: 2 }, at("2027-02-28T21:30:00Z", "2027-03-01"));
  const declined = await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", date: "2027-04-03", adults: 1 }, at("2027-03-01T09:00:00Z", "2027-03-01"));
  await asOwner(t, async (scope) => {
    await confirmBooking(scope, lateFeb.bookingId, { now: new Date("2027-03-01T10:00:00Z") });
    await completeBooking(scope, lateFeb.bookingId);
    await confirmBooking(scope, earlyMar.bookingId, { now: new Date("2027-03-01T10:00:00Z") });
    await declineBooking(scope, declined.bookingId);
  });
  return t;
}

describe("bookingSeries", () => {
  it("buckets requests by month in the tenant's timezone, not UTC", async () => {
    const t = await bakuTenant();
    expect(await series(t, { from: "2027-01-01", to: "2027-04-30", bucket: "month", by: "created" })).toEqual([
      zero("2027-01"),
      { bucket: "2027-02", requests: 1, confirmed: 1, cancelled: 0, revenue: 12_000 },
      // 21:30 UTC on 28 Feb is already 1 March in Baku.
      { bucket: "2027-03", requests: 2, confirmed: 1, cancelled: 1, revenue: 24_000 },
      zero("2027-04"),
    ]);

    // The same bookings in a UTC tenant fall into February.
    await setTimezone(t.tenantId, "UTC");
    const utc = await series(t, { from: "2027-02-01", to: "2027-03-31", bucket: "month", by: "created" });
    expect(utc.map((point) => [point.bucket, point.requests])).toEqual([
      ["2027-02", 2],
      ["2027-03", 1],
    ]);
  });

  it("cuts the range at local midnight and fills every day", async () => {
    const t = await bakuTenant();
    expect(await series(t, { from: "2027-02-27", to: "2027-03-02", bucket: "day", by: "created" })).toEqual([
      zero("2027-02-27"),
      { bucket: "2027-02-28", requests: 1, confirmed: 1, cancelled: 0, revenue: 12_000 },
      { bucket: "2027-03-01", requests: 2, confirmed: 1, cancelled: 1, revenue: 24_000 },
      zero("2027-03-02"),
    ]);
    // A range ending on 28 Feb (local) leaves out the request made at 01:30 on 1 March.
    expect(await series(t, { from: "2027-02-28", to: "2027-02-28", bucket: "day", by: "created" })).toEqual([
      { bucket: "2027-02-28", requests: 1, confirmed: 1, cancelled: 0, revenue: 12_000 },
    ]);
  });

  it("buckets by tour start date", async () => {
    const t = await bakuTenant();
    expect(await series(t, { from: "2027-03-01", to: "2027-04-30", bucket: "month", by: "start" })).toEqual([
      { bucket: "2027-03", requests: 1, confirmed: 1, cancelled: 0, revenue: 12_000 },
      { bucket: "2027-04", requests: 2, confirmed: 1, cancelled: 1, revenue: 24_000 },
    ]);
    const days = await series(t, { from: "2027-04-01", to: "2027-04-04", bucket: "day", by: "start" });
    expect(days.map((point) => [point.bucket, point.requests, point.cancelled])).toEqual([
      ["2027-04-01", 0, 0],
      ["2027-04-02", 1, 0],
      ["2027-04-03", 1, 1],
      ["2027-04-04", 0, 0],
    ]);
  });

  it("counts cancelled confirmed bookings as cancelled with no revenue, and spans a year end", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId, { priceAdult: 10_000 });
    const booked = await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", date: "2027-01-05" }, { now: new Date("2026-12-20T12:00:00Z"), today: "2026-12-20" });
    await asOwner(t, async (scope) => {
      await confirmBooking(scope, booked.bookingId, { now: new Date("2026-12-21T12:00:00Z") });
      await cancelBooking(scope, booked.bookingId, { kind: "by_customer", reason: "Ill" });
    });
    expect(await series(t, { from: "2026-11-15", to: "2027-02-02", bucket: "month", by: "created" })).toEqual([
      zero("2026-11"),
      { bucket: "2026-12", requests: 1, confirmed: 0, cancelled: 1, revenue: 0 },
      zero("2027-01"),
      zero("2027-02"),
    ]);
  });

  it("shows tenant B nothing of tenant A's bookings", async () => {
    const a = await bakuTenant();
    const b = await createTenant();
    for (const by of ["created", "start"] as const) {
      const seen = await series(b, { from: "2027-01-01", to: "2027-04-30", bucket: "month", by });
      expect(seen, by).toEqual(["2027-01", "2027-02", "2027-03", "2027-04"].map(zero));
    }
    // B's own booking counts for B only.
    const tourB = await createDayTour(b.tenantId);
    await requestBooking(b.tenantId, { tourId: tourB.id, slotTime: "09:00", date: "2027-04-02" }, { now: new Date("2027-03-01T09:00:00Z"), today: "2027-03-01" });
    expect((await series(b, { from: "2027-04-01", to: "2027-04-30", bucket: "month", by: "start" }))[0]!.requests).toBe(1);
    expect((await series(a, { from: "2027-04-01", to: "2027-04-30", bucket: "month", by: "start" }))[0]!.requests).toBe(2);
  });

  it("rejects bad ranges and options", async () => {
    const t = await createTenant();
    for (const bad of [
      { from: "2027-03-02", to: "2027-03-01", bucket: "day", by: "created" },
      { from: "2027-01-01", to: "2028-03-01", bucket: "day", by: "created" },
      { from: "2000-01-01", to: "2040-01-01", bucket: "month", by: "start" },
      { from: "2027-01-01", to: "2027-02-01", bucket: "week", by: "created" },
      { from: "2027-01-01", to: "2027-02-01", bucket: "day", by: "paid" },
      { from: "January", to: "2027-02-01", bucket: "day", by: "created" },
    ]) {
      expect(await errorOf(series(t, bad)), JSON.stringify(bad)).toBeInstanceOf(ValidationError);
    }
    expect(await series(t, { from: "2027-01-01", to: "2028-02-04", bucket: "day", by: "created" })).toHaveLength(400);
  });
});
