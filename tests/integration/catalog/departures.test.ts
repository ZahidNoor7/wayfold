import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addAvailabilityBlock, listAvailabilityBlocks, removeAvailabilityBlock } from "@/server/catalog/availability";
import { addDeparture, countUpcomingDepartures, listDepartures, removeDeparture, updateDeparture } from "@/server/catalog/departures";
import { createTour } from "@/server/catalog/tours";
import { bookings } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { FIXTURE_TODAY, createDepartureFixture, createTourFixture } from "../../helpers/catalog";
import { createTenant, randomId, type TenantFixture } from "../../helpers/fixtures";
import { as, fieldErrors, rejection, seedBooking } from "./support";

const TODAY = FIXTURE_TODAY; // 2031-03-10
const today = { today: TODAY };

async function departureTour(tenant: TenantFixture) {
  return createTourFixture(tenant.tenantId, { title: "Silk Road to Sheki", kind: "departure", durationDays: 3 });
}

describe("departures", () => {
  it("adds departures to a departure tour and lists them by date", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);

    const later = await as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: "2031-05-08", capacity: 8 }, today));
    const sooner = await as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: "2031-04-17", startTime: "07:45", capacity: 6, isOpen: false }, today));

    expect(later).toEqual({
      id: later.id,
      tourId: tour.id,
      startDate: "2031-05-08",
      startTime: null,
      capacity: 8,
      isOpen: true,
      seatsBooked: 0,
      seatsLeft: 8,
    });
    expect(sooner).toMatchObject({ startTime: "07:45", capacity: 6, isOpen: false });
    expect((await as(tenant, (scope) => listDepartures(scope, tour.id))).map((departure) => departure.id)).toEqual([sooner.id, later.id]);
  });

  it("accepts today but not a past date, judged by the caller's `today`", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);

    expect(await fieldErrors(() => as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: "2031-03-09", capacity: 8 }, today)))).toEqual({
      startDate: ["Choose a date that is not in the past."],
    });
    expect((await as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: TODAY, capacity: 8 }, today))).startDate).toBe(TODAY);
    // A tenant east of UTC is already on the next day: yesterday's "today" is now the past.
    expect(
      await fieldErrors(() => as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: "2031-03-10", capacity: 8 }, { today: "2031-03-11" }))),
    ).toHaveProperty("startDate");
  });

  it("requires a real `today` from the caller", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);
    const departure = await createDepartureFixture(tenant.tenantId, tour.id);
    for (const bad of ["", "2031-02-30", "today"]) {
      expect(await rejection(() => as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: "2031-05-01", capacity: 8 }, { today: bad })))).toBeInstanceOf(
        RangeError,
      );
      expect(await rejection(() => as(tenant, (scope) => updateDeparture(scope, departure.id, { capacity: 9 }, { today: bad })))).toBeInstanceOf(RangeError);
      expect(await rejection(() => as(tenant, (scope) => countUpcomingDepartures(scope, tour.id, bad)))).toBeInstanceOf(RangeError);
    }
  });

  it("validates the date, time and capacity", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);
    const cases: [Record<string, unknown>, string][] = [
      [{ startDate: "2031-02-30", capacity: 8 }, "startDate"],
      [{ startDate: "17/04/2031", capacity: 8 }, "startDate"],
      [{ capacity: 8 }, "startDate"],
      [{ startDate: "2031-05-01", capacity: 0 }, "capacity"],
      [{ startDate: "2031-05-01", capacity: -3 }, "capacity"],
      [{ startDate: "2031-05-01", capacity: 2.5 }, "capacity"],
      [{ startDate: "2031-05-01", capacity: 1000 }, "capacity"],
      [{ startDate: "2031-05-01" }, "capacity"],
      [{ startDate: "2031-05-01", capacity: 8, startTime: "7am" }, "startTime"],
      [{ startDate: "2031-05-01", capacity: 8, startTime: "25:00" }, "startTime"],
    ];
    for (const [input, field] of cases) {
      const errors = await fieldErrors(() => as(tenant, (scope) => addDeparture(scope, tour.id, input as never, today)));
      expect(errors, JSON.stringify(input)).toHaveProperty(field);
    }
    expect((await as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: "2031-05-01", capacity: 1 }, today))).capacity).toBe(1);
  });

  it("allows one departure per tour per date", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);
    const other = await departureTour(tenant);
    await as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: "2031-05-01", capacity: 8 }, today));

    expect(await fieldErrors(() => as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: "2031-05-01", capacity: 4 }, today)))).toEqual({
      startDate: ["This tour already departs on that date."],
    });
    // A different tour may leave on the same day.
    expect((await as(tenant, (scope) => addDeparture(scope, other.id, { startDate: "2031-05-01", capacity: 4 }, today))).tourId).toBe(other.id);
  });

  it("only gives departure dates to departure tours", async () => {
    const tenant = await createTenant();
    for (const kind of ["day", "private"] as const) {
      const tour = await as(tenant, (scope) => createTour(scope, { title: `A ${kind} tour`, kind }));
      const error = await rejection(() => as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: "2031-05-01", capacity: 8 }, today)));
      expect(error, kind).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors).toHaveProperty("kind");
      expect(await as(tenant, (scope) => listDepartures(scope, tour.id))).toEqual([]);
    }
  });

  it("answers not found for unknown tours and departures", async () => {
    const tenant = await createTenant();
    for (const id of [randomId(), "nope"]) {
      expect(await rejection(() => as(tenant, (scope) => addDeparture(scope, id, { startDate: "2031-05-01", capacity: 8 }, today)))).toBeInstanceOf(NotFoundError);
      expect(await rejection(() => as(tenant, (scope) => listDepartures(scope, id)))).toBeInstanceOf(NotFoundError);
      expect(await rejection(() => as(tenant, (scope) => updateDeparture(scope, id, { capacity: 4 }, today)))).toBeInstanceOf(NotFoundError);
      expect(await rejection(() => as(tenant, (scope) => removeDeparture(scope, id)))).toBeInstanceOf(NotFoundError);
    }
  });

  it("counts seats held by pending and confirmed bookings only", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);
    const departure = await createDepartureFixture(tenant.tenantId, tour.id, { capacity: 8 });
    const empty = await createDepartureFixture(tenant.tenantId, tour.id, { startDate: "2031-06-01", capacity: 4 });

    await seedBooking(tenant, { tourId: tour.id, departureId: departure.id, status: "confirmed", adults: 2, children: 1 });
    await seedBooking(tenant, { tourId: tour.id, departureId: departure.id, status: "pending", adults: 2 });
    await seedBooking(tenant, { tourId: tour.id, departureId: departure.id, status: "cancelled", adults: 4 });
    await seedBooking(tenant, { tourId: tour.id, departureId: departure.id, status: "completed", adults: 3 });
    // A booking of the tour that is not on a departure does not count anywhere.
    await seedBooking(tenant, { tourId: tour.id, status: "confirmed", adults: 6 });

    const listed = await as(tenant, (scope) => listDepartures(scope, tour.id));
    expect(listed.map((row) => [row.id, row.seatsBooked, row.seatsLeft])).toEqual([
      [departure.id, 5, 3],
      [empty.id, 0, 4],
    ]);
  });

  it("filters the list by start date and by open status", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);
    const dates = ["2031-04-01", "2031-05-01", "2031-06-01"];
    const [, closed] = await Promise.all(
      dates.map((startDate, index) => createDepartureFixture(tenant.tenantId, tour.id, { startDate, isOpen: index !== 1 })),
    );

    const from = await as(tenant, (scope) => listDepartures(scope, tour.id, { from: "2031-05-01" }));
    expect(from.map((departure) => departure.startDate)).toEqual(["2031-05-01", "2031-06-01"]);
    const open = await as(tenant, (scope) => listDepartures(scope, tour.id, { openOnly: true }));
    expect(open.map((departure) => departure.startDate)).toEqual(["2031-04-01", "2031-06-01"]);
    expect(open.map((departure) => departure.id)).not.toContain(closed!.id);

    expect(await as(tenant, (scope) => countUpcomingDepartures(scope, tour.id, "2031-04-01"))).toBe(2);
    expect(await as(tenant, (scope) => countUpcomingDepartures(scope, tour.id, "2031-04-02"))).toBe(1);
    expect(await as(tenant, (scope) => countUpcomingDepartures(scope, tour.id, "2031-06-02"))).toBe(0);
  });

  it("updates capacity, time, open flag and date", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);
    const departure = await createDepartureFixture(tenant.tenantId, tour.id, { startDate: "2031-05-01", capacity: 8 });

    const updated = await as(tenant, (scope) => updateDeparture(scope, departure.id, { capacity: 12, startTime: "06:30", isOpen: false }, today));
    expect(updated).toMatchObject({ startDate: "2031-05-01", capacity: 12, startTime: "06:30", isOpen: false, seatsLeft: 12 });

    const moved = await as(tenant, (scope) => updateDeparture(scope, departure.id, { startDate: "2031-05-15", startTime: null }, today));
    expect(moved).toMatchObject({ startDate: "2031-05-15", startTime: null, capacity: 12 });

    expect(await rejection(() => as(tenant, (scope) => updateDeparture(scope, departure.id, {}, today)))).toBeInstanceOf(ValidationError);
    expect(await fieldErrors(() => as(tenant, (scope) => updateDeparture(scope, departure.id, { capacity: 0 }, today)))).toHaveProperty("capacity");
  });

  it("will not move a departure into the past or onto another departure's date", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);
    const first = await createDepartureFixture(tenant.tenantId, tour.id, { startDate: "2031-05-01" });
    const second = await createDepartureFixture(tenant.tenantId, tour.id, { startDate: "2031-06-01" });

    expect(await fieldErrors(() => as(tenant, (scope) => updateDeparture(scope, second.id, { startDate: "2031-03-09" }, today)))).toHaveProperty("startDate");
    expect(await fieldErrors(() => as(tenant, (scope) => updateDeparture(scope, second.id, { startDate: "2031-05-01" }, today)))).toEqual({
      startDate: ["This tour already departs on that date."],
    });
    // Re-sending its own date is not a move, even once that date has passed.
    const unchanged = await as(tenant, (scope) => updateDeparture(scope, first.id, { startDate: "2031-05-01", capacity: 10 }, { today: "2031-07-01" }));
    expect(unchanged).toMatchObject({ startDate: "2031-05-01", capacity: 10 });
  });

  it("protects seats that are already booked", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);
    const departure = await createDepartureFixture(tenant.tenantId, tour.id, { startDate: "2031-05-01", capacity: 8 });
    await seedBooking(tenant, { tourId: tour.id, departureId: departure.id, status: "confirmed", adults: 3, children: 2 });

    expect(await fieldErrors(() => as(tenant, (scope) => updateDeparture(scope, departure.id, { capacity: 4 }, today)))).toEqual({
      capacity: ["5 seats are already booked on this departure."],
    });
    const tight = await as(tenant, (scope) => updateDeparture(scope, departure.id, { capacity: 5 }, today));
    expect(tight).toMatchObject({ capacity: 5, seatsBooked: 5, seatsLeft: 0 });

    // The date is fixed while seats are held.
    expect(await rejection(() => as(tenant, (scope) => updateDeparture(scope, departure.id, { startDate: "2031-05-02" }, today)))).toBeInstanceOf(ConflictError);
    expect((await as(tenant, (scope) => listDepartures(scope, tour.id)))[0]!.startDate).toBe("2031-05-01");
  });

  it("lets capacity shrink to exactly the seats held", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);
    const departure = await createDepartureFixture(tenant.tenantId, tour.id, { capacity: 8 });
    await seedBooking(tenant, { tourId: tour.id, departureId: departure.id, status: "pending", adults: 1 });
    await seedBooking(tenant, { tourId: tour.id, departureId: departure.id, status: "cancelled", adults: 1 });
    expect(await as(tenant, (scope) => updateDeparture(scope, departure.id, { capacity: 1 }, today))).toMatchObject({ seatsBooked: 1, seatsLeft: 0 });
  });

  it("removes a departure nobody has booked", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);
    const departure = await createDepartureFixture(tenant.tenantId, tour.id);
    await as(tenant, (scope) => removeDeparture(scope, departure.id));
    expect(await as(tenant, (scope) => listDepartures(scope, tour.id))).toEqual([]);
    expect(await rejection(() => as(tenant, (scope) => removeDeparture(scope, departure.id)))).toBeInstanceOf(NotFoundError);
  });

  it("will not remove a departure with active bookings", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);
    for (const status of ["pending", "confirmed"] as const) {
      const departure = await createDepartureFixture(tenant.tenantId, tour.id, { startDate: status === "pending" ? "2031-05-01" : "2031-06-01" });
      await seedBooking(tenant, { tourId: tour.id, departureId: departure.id, status });

      const error = await rejection(() => as(tenant, (scope) => removeDeparture(scope, departure.id)));
      expect(error, status).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).message).toContain("active bookings");
    }
    expect(await as(tenant, (scope) => listDepartures(scope, tour.id))).toHaveLength(2);
  });

  it("keeps a departure that only has past bookings, and lets it be closed instead", async () => {
    const tenant = await createTenant();
    const tour = await departureTour(tenant);
    const departure = await createDepartureFixture(tenant.tenantId, tour.id);
    const booking = await seedBooking(tenant, { tourId: tour.id, departureId: departure.id, status: "completed" });

    const error = await rejection(() => as(tenant, (scope) => removeDeparture(scope, departure.id)));
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).message).toContain("past bookings");
    expect((await as(tenant, (scope) => updateDeparture(scope, departure.id, { isOpen: false }, today))).isOpen).toBe(false);

    // With the booking gone entirely, removal goes through.
    await as(tenant, ({ tx }) => tx.delete(bookings).where(eq(bookings.id, booking.id)));
    await as(tenant, (scope) => removeDeparture(scope, departure.id));
    expect(await as(tenant, (scope) => listDepartures(scope, tour.id))).toEqual([]);
  });
});

describe("availability blocks", () => {
  it("adds business-wide and tour-specific blocks", async () => {
    const tenant = await createTenant();
    const tour = await createTourFixture(tenant.tenantId, { title: "Old City Walk" });

    const holiday = await as(tenant, (scope) => addAvailabilityBlock(scope, { startDate: "2031-03-20", endDate: "2031-03-24", reason: "  Novruz  " }));
    const guideAway = await as(tenant, (scope) => addAvailabilityBlock(scope, { tourId: tour.id, startDate: "2031-04-02", endDate: "2031-04-02" }));
    const explicitNull = await as(tenant, (scope) => addAvailabilityBlock(scope, { tourId: null, startDate: "2031-01-01", endDate: "2031-01-01" }));

    expect(holiday).toEqual({ id: holiday.id, tourId: null, tourTitle: null, startDate: "2031-03-20", endDate: "2031-03-24", reason: "Novruz" });
    expect(guideAway).toEqual({ id: guideAway.id, tourId: tour.id, tourTitle: "Old City Walk", startDate: "2031-04-02", endDate: "2031-04-02", reason: "" });
    expect(explicitNull.tourId).toBeNull();

    const all = await as(tenant, (scope) => listAvailabilityBlocks(scope));
    expect(all.map((block) => block.id)).toEqual([explicitNull.id, holiday.id, guideAway.id]);
  });

  it("requires valid dates with the start on or before the end", async () => {
    const tenant = await createTenant();
    expect(await fieldErrors(() => as(tenant, (scope) => addAvailabilityBlock(scope, { startDate: "2031-03-24", endDate: "2031-03-20" })))).toEqual({
      endDate: ["The last day cannot be before the first day."],
    });
    expect(await fieldErrors(() => as(tenant, (scope) => addAvailabilityBlock(scope, { startDate: "2031-02-30", endDate: "2031-03-01" })))).toHaveProperty(
      "startDate",
    );
    expect(await fieldErrors(() => as(tenant, (scope) => addAvailabilityBlock(scope, { startDate: "2031-03-01", endDate: "soon" })))).toHaveProperty("endDate");
    expect(
      await fieldErrors(() => as(tenant, (scope) => addAvailabilityBlock(scope, { startDate: "2031-03-01", endDate: "2031-03-01", reason: "x".repeat(201) }))),
    ).toHaveProperty("reason");
    expect(
      await fieldErrors(() => as(tenant, (scope) => addAvailabilityBlock(scope, { tourId: "nope", startDate: "2031-03-01", endDate: "2031-03-01" }))),
    ).toHaveProperty("tourId");
    expect(await as(tenant, (scope) => listAvailabilityBlocks(scope))).toEqual([]);
  });

  it("answers not found for a tour that does not exist", async () => {
    const tenant = await createTenant();
    expect(
      await rejection(() => as(tenant, (scope) => addAvailabilityBlock(scope, { tourId: randomId(), startDate: "2031-03-01", endDate: "2031-03-01" }))),
    ).toBeInstanceOf(NotFoundError);
    expect(await rejection(() => as(tenant, (scope) => listAvailabilityBlocks(scope, { tourId: randomId() })))).toBeInstanceOf(NotFoundError);
  });

  it("lists the blocks that affect one tour: its own and the business-wide ones", async () => {
    const tenant = await createTenant();
    const [walk, wine] = await Promise.all([createTourFixture(tenant.tenantId), createTourFixture(tenant.tenantId)]);
    const [wide, forWalk, forWine] = await as(tenant, async (scope) => [
      await addAvailabilityBlock(scope, { startDate: "2031-05-01", endDate: "2031-05-01", reason: "Holiday" }),
      await addAvailabilityBlock(scope, { tourId: walk!.id, startDate: "2031-05-10", endDate: "2031-05-12" }),
      await addAvailabilityBlock(scope, { tourId: wine!.id, startDate: "2031-05-20", endDate: "2031-05-22" }),
    ]);

    expect((await as(tenant, (scope) => listAvailabilityBlocks(scope, { tourId: walk!.id }))).map((block) => block.id)).toEqual([wide!.id, forWalk!.id]);
    expect((await as(tenant, (scope) => listAvailabilityBlocks(scope, { tourId: wine!.id }))).map((block) => block.id)).toEqual([wide!.id, forWine!.id]);
    expect(await as(tenant, (scope) => listAvailabilityBlocks(scope))).toHaveLength(3);
  });

  it("filters by an overlapping date window, inclusive at both ends", async () => {
    const tenant = await createTenant();
    const [early, middle, late] = await as(tenant, async (scope) => [
      await addAvailabilityBlock(scope, { startDate: "2031-05-01", endDate: "2031-05-05" }),
      await addAvailabilityBlock(scope, { startDate: "2031-05-10", endDate: "2031-05-12" }),
      await addAvailabilityBlock(scope, { startDate: "2031-05-20", endDate: "2031-05-25" }),
    ]);
    const ids = async (filters: Parameters<typeof listAvailabilityBlocks>[1]) =>
      (await as(tenant, (scope) => listAvailabilityBlocks(scope, filters))).map((block) => block.id);

    expect(await ids({ from: "2031-05-05", to: "2031-05-10" })).toEqual([early!.id, middle!.id]);
    expect(await ids({ from: "2031-05-06", to: "2031-05-09" })).toEqual([]);
    expect(await ids({ from: "2031-05-12" })).toEqual([middle!.id, late!.id]);
    expect(await ids({ to: "2031-05-09" })).toEqual([early!.id]);
    expect(await rejection(() => as(tenant, (scope) => listAvailabilityBlocks(scope, { from: "May" })))).toBeInstanceOf(ValidationError);
  });

  it("removes a block once, then answers not found", async () => {
    const tenant = await createTenant();
    const block = await as(tenant, (scope) => addAvailabilityBlock(scope, { startDate: "2031-05-01", endDate: "2031-05-01" }));
    await as(tenant, (scope) => removeAvailabilityBlock(scope, block.id));
    expect(await as(tenant, (scope) => listAvailabilityBlocks(scope))).toEqual([]);
    for (const id of [block.id, randomId(), "nope"]) {
      expect(await rejection(() => as(tenant, (scope) => removeAvailabilityBlock(scope, id)))).toBeInstanceOf(NotFoundError);
    }
  });
});
