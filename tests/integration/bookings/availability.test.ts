import { describe, expect, it, vi } from "vitest";
import { getTourAvailability } from "@/server/bookings/availability";
import { confirmBooking } from "@/server/bookings/service";
import { withTenant } from "@/server/db/context";
import { NotFoundError, ValidationError } from "@/server/errors";
import { updateBookingSettings } from "@/server/settings/tenant-settings";
import {
  asOwner,
  createBlock,
  createDayTour,
  createDeparture,
  createDepartureTour,
  createPrivateTour,
  errorOf,
  hoursAfter,
  NOW,
  requestBooking,
  TODAY,
} from "../../helpers/bookings";
import { createTenant, randomId } from "../../helpers/fixtures";

vi.mock("@/server/promotions/engine", () => ({ findBestDiscount: vi.fn(async () => null), consumeDiscount: vi.fn(async () => undefined) }));
vi.mock("@/server/notifications/index", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

const calendar = (tenantId: string, tourId: string, from: string, to: string, extra: { now?: Date; includeUnpublished?: boolean } = {}) =>
  withTenant(tenantId, (scope) => getTourAvailability(scope, tourId, { from, to, today: TODAY, now: NOW, ...extra }));

describe("getTourAvailability", () => {
  it("reports day-tour slots from real bookings and frees them when a hold expires", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10", slotTime: "09:00", adults: 4, children: 2 });
    const confirmed = await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10", slotTime: "14:00", adults: 3 });
    await asOwner(t, (scope) => confirmBooking(scope, confirmed.bookingId, { now: NOW }));

    const result = await calendar(t.tenantId, tour.id, "2027-03-09", "2027-03-11");
    expect(result).toMatchObject({ tourId: tour.id, kind: "day", durationDays: 1, maxGroupSize: 8 });
    expect(result.days.map((day) => [day.date, day.state, day.seatsLeft])).toEqual([
      ["2027-03-09", "open", 16],
      ["2027-03-10", "limited", 7],
      ["2027-03-11", "open", 16],
    ]);
    expect(result.days[1]!.slots).toEqual([
      { time: "09:00", capacity: 8, seatsLeft: 2, state: "limited" },
      { time: "14:00", capacity: 8, seatsLeft: 5, state: "open" },
    ]);

    // A day later the pending request's hold has run out; the confirmed one still counts.
    const later = await calendar(t.tenantId, tour.id, "2027-03-10", "2027-03-10", { now: hoursAfter(25) });
    expect(later.days[0]).toMatchObject({ state: "open", seatsLeft: 13 });
    expect(later.days[0]!.slots![0]).toMatchObject({ seatsLeft: 8, state: "open" });
  });

  it("reports departures only on their dates, with seats from real bookings", async () => {
    const t = await createTenant();
    const tour = await createDepartureTour(t.tenantId);
    const open = await createDeparture(t.tenantId, tour.id, "2027-03-10", 8);
    await createDeparture(t.tenantId, tour.id, "2027-03-12", 8, false);
    await createDeparture(t.tenantId, tour.id, "2027-03-13", 4);
    await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10", adults: 3, children: 2 });
    await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-13", adults: 4 });

    const result = await calendar(t.tenantId, tour.id, "2027-03-10", "2027-03-13");
    expect(result.days.map((day) => [day.date, day.state, day.reason, day.seatsLeft])).toEqual([
      ["2027-03-10", "limited", null, 3],
      ["2027-03-11", "closed", "no_departure", 0],
      ["2027-03-12", "closed", "departure_closed", 0],
      ["2027-03-13", "full", "sold_out", 0],
    ]);
    expect(result.days[0]).toMatchObject({ departureId: open.id, endDate: "2027-03-12", capacity: 8 });
  });

  it("shows a private span as on hold, then booked, across two different private tours", async () => {
    const t = await createTenant();
    const grand = await createPrivateTour(t.tenantId, { durationDays: 8 });
    const short = await createPrivateTour(t.tenantId, { durationDays: 2, title: "Private Wine Route" });
    const held = await requestBooking(t.tenantId, { tourId: grand.id, date: "2027-03-10", adults: 2 }); // 10th – 17th

    const states = async () => (await calendar(t.tenantId, short.id, "2027-03-08", "2027-03-18")).days.map((day) => day.state);
    // A 2-day tour starting on the 9th would end on the 10th and collide.
    expect(await states()).toEqual(["open", "hold", "hold", "hold", "hold", "hold", "hold", "hold", "hold", "hold", "open"]);

    await asOwner(t, (scope) => confirmBooking(scope, held.bookingId, { now: NOW }));
    expect(await states()).toEqual(["open", "full", "full", "full", "full", "full", "full", "full", "full", "full", "open"]);
    const own = await calendar(t.tenantId, grand.id, "2027-03-02", "2027-03-03");
    // Starting on the 2nd ends on the 9th: free. Starting on the 3rd would reach the 10th.
    expect(own.days.map((day) => [day.state, day.reason, day.endDate])).toEqual([
      ["open", null, "2027-03-09"],
      ["full", "booked", "2027-03-10"],
    ]);
  });

  it("does not let seat-based bookings block a private tour, or the reverse", async () => {
    const t = await createTenant();
    const day = await createDayTour(t.tenantId);
    const priv = await createPrivateTour(t.tenantId, { durationDays: 3 });
    await requestBooking(t.tenantId, { tourId: day.id, date: "2027-03-10", slotTime: "09:00", adults: 8 });
    await requestBooking(t.tenantId, { tourId: priv.id, date: "2027-03-12", adults: 2 });

    expect((await calendar(t.tenantId, priv.id, "2027-03-09", "2027-03-09")).days[0]!.state).toBe("open");
    expect((await calendar(t.tenantId, day.id, "2027-03-12", "2027-03-12")).days[0]).toMatchObject({ state: "open", seatsLeft: 16 });
  });

  it("applies tenant settings and availability blocks", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const other = await createDayTour(t.tenantId);
    await withTenant(t.tenantId, (scope) => updateBookingSettings(scope, { minNoticeDays: 2, horizonDays: 7, weeklyDaysOff: [7] }));
    await createBlock(t.tenantId, { startDate: "2027-03-04", endDate: "2027-03-04", reason: "Novruz" });
    await createBlock(t.tenantId, { tourId: tour.id, startDate: "2027-03-05", endDate: "2027-03-05" });

    const result = await calendar(t.tenantId, tour.id, "2027-02-28", "2027-03-09");
    expect(result.days.map((day) => [day.date, day.state, day.reason])).toEqual([
      ["2027-02-28", "past", "past"],
      ["2027-03-01", "closed", "min_notice"],
      ["2027-03-02", "closed", "min_notice"],
      ["2027-03-03", "open", null],
      ["2027-03-04", "closed", "blocked"],
      ["2027-03-05", "closed", "blocked"],
      ["2027-03-06", "open", null],
      ["2027-03-07", "closed", "day_off"],
      ["2027-03-08", "open", null],
      ["2027-03-09", "closed", "beyond_horizon"],
    ]);
    // The block on one tour leaves the other tour open that day.
    expect((await calendar(t.tenantId, other.id, "2027-03-05", "2027-03-05")).days[0]!.state).toBe("open");
  });

  it("hides draft and archived tours from the public but not from the dashboard", async () => {
    const t = await createTenant();
    const draft = await createDayTour(t.tenantId, { status: "draft" });
    const archived = await createDayTour(t.tenantId, { status: "archived" });

    for (const tour of [draft, archived]) {
      expect(await errorOf(calendar(t.tenantId, tour.id, "2027-03-10", "2027-03-10"))).toBeInstanceOf(NotFoundError);
      const forStaff = await calendar(t.tenantId, tour.id, "2027-03-10", "2027-03-10", { includeUnpublished: true });
      expect(forStaff.days[0]!.state).toBe("open");
    }
  });

  it("answers not found for unknown and malformed tour ids", async () => {
    const t = await createTenant();
    expect(await errorOf(calendar(t.tenantId, randomId(), "2027-03-10", "2027-03-10"))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(calendar(t.tenantId, "1 or 1=1", "2027-03-10", "2027-03-10"))).toBeInstanceOf(NotFoundError);
  });

  it("rejects bad or oversized date ranges", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    expect(await errorOf(calendar(t.tenantId, tour.id, "2027-02-30", "2027-03-10"))).toBeInstanceOf(ValidationError);
    expect(await errorOf(calendar(t.tenantId, tour.id, "2027-03-10", "tomorrow"))).toBeInstanceOf(ValidationError);
    expect(await errorOf(calendar(t.tenantId, tour.id, "2027-03-10", "2027-03-09"))).toBeInstanceOf(ValidationError);
    expect(await errorOf(calendar(t.tenantId, tour.id, "2027-03-10", "2028-04-14"))).toBeInstanceOf(ValidationError);
    expect(
      await errorOf(withTenant(t.tenantId, (scope) => getTourAvailability(scope, tour.id, { from: "2027-03-10", to: "2027-03-10", today: "now" }))),
    ).toBeInstanceOf(ValidationError);
    // 400 days is the largest window.
    expect((await calendar(t.tenantId, tour.id, "2027-03-10", "2028-04-12")).days).toHaveLength(400);
  });

  it("uses the server clock when none is given", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    // Held from the fixed test clock in 2027, which is still in the future for the real clock.
    await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10", slotTime: "09:00", adults: 2 });
    const result = await withTenant(t.tenantId, (scope) => getTourAvailability(scope, tour.id, { from: "2027-03-10", to: "2027-03-10", today: TODAY }));
    expect(result.days[0]!.seatsLeft).toBe(new Date() < hoursAfter(24) ? 14 : 16);
  });
});
