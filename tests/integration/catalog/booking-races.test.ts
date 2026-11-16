import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBookingRequest } from "@/server/bookings/request";
import { bookableUnit, lockUnit } from "@/server/bookings/shared";
import { listDepartures, removeDeparture, updateDeparture } from "@/server/catalog/departures";
import { getTour, updateTour } from "@/server/catalog/tours";
import { withTenant, type TenantScope } from "@/server/db/context";
import { bookings } from "@/server/db/schema";
import { AppError, ConflictError, ValidationError } from "@/server/errors";
import { requestInput } from "../../helpers/bookings";
import { FIXTURE_TODAY, createDepartureFixture, createPublishedTourFixture } from "../../helpers/catalog";
import { createTenant, type TenantFixture } from "../../helpers/fixtures";
import { as, seedBookingIn, sleep, watch, whileOpen } from "./support";

const today = { today: FIXTURE_TODAY };
/** The server clock at the fixed "today": holds placed now are still alive. */
const NOW = new Date(`${FIXTURE_TODAY}T09:00:00.000Z`);
const DATE = "2031-04-09";
/** Long enough for an unblocked edit to have finished many times over. */
const BLOCKED_FOR_MS = 250;

/** One storefront visitor asking for seats, in a transaction of their own. */
function request(tenant: TenantFixture, overrides: Record<string, unknown>) {
  return withTenant(tenant.tenantId, (scope) => createBookingRequest(scope, requestInput({ date: DATE, ...overrides }), { today: FIXTURE_TODAY, now: NOW }));
}

/** A booking request that has taken its lock and written its booking, but has not committed yet. */
const placing = (overrides: Record<string, unknown>) => (scope: TenantScope) =>
  createBookingRequest(scope, requestInput({ date: DATE, ...overrides }), { today: FIXTURE_TODAY, now: NOW });

/** Seats on bookings that hold them, straight from the table. */
async function seatsHeld(tenant: TenantFixture, tourId: string): Promise<number> {
  const rows = await as(tenant, ({ tx }) => tx.select().from(bookings).where(eq(bookings.tourId, tourId)));
  return rows.filter((row) => row.status === "pending" || row.status === "confirmed").reduce((sum, row) => sum + row.adults + row.children, 0);
}

describe("departure edits racing booking requests", () => {
  it("never sells more seats than the capacity when a cut races a request for the last seats", async () => {
    for (let round = 0; round < 8; round += 1) {
      const tenant = await createTenant();
      const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "departure" });
      const [departure] = await as(tenant, (scope) => listDepartures(scope, tour.id));
      expect(departure).toMatchObject({ startDate: DATE, capacity: 8 });
      await request(tenant, { tourId: tour.id, adults: 4 });

      // Four seats are left. One visitor asks for all four while the owner cuts the departure to six.
      const [booked, cut] = await Promise.allSettled([
        request(tenant, { tourId: tour.id, adults: 3, children: 1 }),
        // Staggered a little differently each round, so both orders get exercised.
        sleep(round % 4).then(() => as(tenant, (scope) => updateDeparture(scope, departure!.id, { capacity: 6 }, today))),
      ]);

      const [after] = await as(tenant, (scope) => listDepartures(scope, tour.id));
      const held = await seatsHeld(tenant, tour.id);
      const context = `round ${round}: booking ${booked.status}, cut ${cut.status}, ${held} seats on ${after!.capacity}`;

      expect(held, context).toBeLessThanOrEqual(after!.capacity);
      expect(after!.seatsBooked, context).toBe(held);
      // Exactly one of the two is refused, with a message meant for a person.
      expect([booked.status, cut.status].sort(), context).toEqual(["fulfilled", "rejected"]);
      if (booked.status === "rejected") {
        expect(booked.reason, context).toBeInstanceOf(ConflictError);
        expect(booked.reason, context).toMatchObject({ code: "slot_taken" });
        expect([held, after!.capacity], context).toEqual([4, 6]);
      } else {
        expect((cut as PromiseRejectedResult).reason, context).toBeInstanceOf(ValidationError);
        expect(((cut as PromiseRejectedResult).reason as ValidationError).fieldErrors, context).toEqual({
          capacity: ["8 seats are already booked on this departure."],
        });
        expect([held, after!.capacity], context).toEqual([8, 8]);
      }
    }
  });

  it("makes a capacity cut wait for a booking that is being placed, then counts it", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "departure" });
    const [departure] = await as(tenant, (scope) => listDepartures(scope, tour.id));

    const cut = await whileOpen(tenant, placing({ tourId: tour.id, adults: 6 }), async (commit) => {
      const edit = watch(() => as(tenant, (scope) => updateDeparture(scope, departure!.id, { capacity: 4 }, today)));
      await sleep(BLOCKED_FOR_MS);
      // Without the shared lock the cut would have gone through by now, blind to the six seats.
      expect(edit.state.settled).toBe(false);
      await commit();
      await edit.finished;
      return edit.state;
    });

    expect(cut.error).toBeInstanceOf(ValidationError);
    expect((cut.error as ValidationError).fieldErrors).toEqual({ capacity: ["6 seats are already booked on this departure."] });
    expect((await as(tenant, (scope) => listDepartures(scope, tour.id)))[0]).toMatchObject({ capacity: 8, seatsBooked: 6, seatsLeft: 2 });
  });

  it("lets the cut through when the booking in progress is abandoned", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "departure" });
    const [departure] = await as(tenant, (scope) => listDepartures(scope, tour.id));

    const abandoned = as(tenant, async (scope) => {
      await createBookingRequest(scope, requestInput({ date: DATE, tourId: tour.id, adults: 6 }), { today: FIXTURE_TODAY, now: NOW });
      // Stand-in for any failure after the booking was written: the whole request rolls back.
      throw new Error("connection lost");
    });
    await expect(abandoned).rejects.toThrow("connection lost");

    const cut = await as(tenant, (scope) => updateDeparture(scope, departure!.id, { capacity: 4 }, today));
    expect(cut).toMatchObject({ capacity: 4, seatsBooked: 0, seatsLeft: 4 });
  });

  it("refuses the request that arrives after the cut", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "departure" });
    const [departure] = await as(tenant, (scope) => listDepartures(scope, tour.id));

    // The owner's cut holds the departure's lock, uncommitted.
    const visitor = await whileOpen(
      tenant,
      (scope) => updateDeparture(scope, departure!.id, { capacity: 2 }, today),
      async (commit) => {
        const attempt = watch(() => request(tenant, { tourId: tour.id, adults: 3 }));
        await sleep(BLOCKED_FOR_MS);
        expect(attempt.state.settled).toBe(false);
        await commit();
        await attempt.finished;
        return attempt.state;
      },
    );

    // The visitor saw eight seats when the page loaded, but is checked against the two that remain.
    expect(visitor.error).toMatchObject({ code: "slot_taken" });
    expect(await seatsHeld(tenant, tour.id)).toBe(0);
  });

  it("refuses a request that races the departure being closed, in whichever order they land", async () => {
    for (let round = 0; round < 4; round += 1) {
      const tenant = await createTenant();
      const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "departure" });
      const [departure] = await as(tenant, (scope) => listDepartures(scope, tour.id));

      const visitor = await whileOpen(
        tenant,
        (scope) => updateDeparture(scope, departure!.id, { isOpen: false }, today),
        async (commit) => {
          const attempt = watch(() => request(tenant, { tourId: tour.id, adults: 2 }));
          await sleep(round * 20);
          await commit();
          await attempt.finished;
          return attempt.state;
        },
      );

      // The request may have read "open" before the lock; it is still refused because it re-reads under it.
      expect(visitor.error, `round ${round}`).toBeInstanceOf(AppError);
      expect(await seatsHeld(tenant, tour.id), `round ${round}`).toBe(0);
    }
  });

  it("never removes a departure from under a booking, and never fails with a database error", async () => {
    for (let round = 0; round < 6; round += 1) {
      const tenant = await createTenant();
      const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "departure" });
      // A second date keeps the tour publishable whichever way the race goes.
      await createDepartureFixture(tenant.tenantId, tour.id, { startDate: "2031-06-01" });
      const departure = (await as(tenant, (scope) => listDepartures(scope, tour.id))).find((row) => row.startDate === DATE)!;

      const [booked, removed] = await Promise.allSettled([
        request(tenant, { tourId: tour.id, adults: 2 }),
        sleep(round % 3).then(() => as(tenant, (scope) => removeDeparture(scope, departure.id))),
      ]);

      const remaining = await as(tenant, (scope) => listDepartures(scope, tour.id));
      const held = await seatsHeld(tenant, tour.id);
      const context = `round ${round}: booking ${booked.status}, removal ${removed.status}`;
      expect([booked.status, removed.status].sort(), context).toEqual(["fulfilled", "rejected"]);
      for (const outcome of [booked, removed]) {
        if (outcome.status === "rejected") expect(outcome.reason, context).toBeInstanceOf(AppError);
      }
      if (booked.status === "fulfilled") {
        expect(remaining.map((row) => row.id), context).toContain(departure.id);
        expect(held, context).toBe(2);
        expect((removed as PromiseRejectedResult).reason, context).toBeInstanceOf(ConflictError);
      } else {
        expect(remaining.map((row) => row.id), context).not.toContain(departure.id);
        expect(held, context).toBe(0);
      }
    }
  });

  it("makes removal wait for a booking that is being placed", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "departure" });
    const [departure] = await as(tenant, (scope) => listDepartures(scope, tour.id));

    const removal = await whileOpen(tenant, placing({ tourId: tour.id, adults: 2 }), async (commit) => {
      const attempt = watch(() => as(tenant, (scope) => removeDeparture(scope, departure!.id)));
      await sleep(BLOCKED_FOR_MS);
      expect(attempt.state.settled).toBe(false);
      await commit();
      await attempt.finished;
      return attempt.state;
    });

    expect(removal.error).toBeInstanceOf(ConflictError);
    expect((removal.error as ConflictError).message).toContain("active bookings");
  });
});

describe("tour edits racing booking requests", () => {
  const slots = (capacity: number) => ({ weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [{ time: "09:00", capacity }] });

  it("makes a start-time capacity cut wait for a booking that is being placed, then counts it", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "day", schedule: slots(8) });

    // First booking on this date and time: there was nothing to see, and no unit to lock, before it started.
    const cut = await whileOpen(tenant, placing({ tourId: tour.id, slotTime: "09:00", adults: 6 }), async (commit) => {
      const edit = watch(() => as(tenant, (scope) => updateTour(scope, tour.id, { schedule: slots(4) })));
      await sleep(BLOCKED_FOR_MS);
      expect(edit.state.settled).toBe(false);
      await commit();
      await edit.finished;
      return edit.state;
    });

    expect(cut.error).toBeInstanceOf(ValidationError);
    expect((cut.error as ValidationError).fieldErrors).toEqual({ schedule: [`6 seats are already booked at 09:00 on ${DATE}.`] });
    expect((await as(tenant, (scope) => getTour(scope, tour.id))).schedule).toEqual(slots(8));
  });

  it("makes a cut wait for a booking being added to a time that already has bookings", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "day", schedule: slots(8) });
    await request(tenant, { tourId: tour.id, slotTime: "09:00", adults: 3 });

    // Five seats would cover the three that are committed, but not the four being written.
    const cut = await whileOpen(tenant, placing({ tourId: tour.id, slotTime: "09:00", adults: 4 }), async (commit) => {
      const edit = watch(() => as(tenant, (scope) => updateTour(scope, tour.id, { schedule: slots(5) })));
      await sleep(BLOCKED_FOR_MS);
      expect(edit.state.settled).toBe(false);
      await commit();
      await edit.finished;
      return edit.state;
    });

    expect((cut.error as ValidationError).fieldErrors).toEqual({ schedule: [`7 seats are already booked at 09:00 on ${DATE}.`] });
  });

  it("waits for a request that holds a start time's lock but has not written its booking yet", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "day", schedule: slots(8) });
    await request(tenant, { tourId: tour.id, slotTime: "09:00", adults: 3 });
    const unit = bookableUnit(tour, { startDate: DATE, slotTime: "09:00", departureId: null });

    // The moment in a booking request between taking the lock and inserting: nothing of it is visible
    // anywhere yet, so only the lock itself can make the edit wait.
    let write!: () => void;
    const mayWrite = new Promise<void>((resolve) => (write = resolve));
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));
    const visitor = as(tenant, async (scope) => {
      await lockUnit(scope, unit);
      locked();
      await mayWrite;
      await seedBookingIn(scope, { tourId: tour.id, startDate: DATE, slotTime: "09:00", status: "pending", adults: 4 });
    });

    let cut: { settled: boolean; error?: unknown };
    try {
      await Promise.race([hasLock, visitor]);
      const edit = watch(() => as(tenant, (scope) => updateTour(scope, tour.id, { schedule: slots(5) })));
      await sleep(BLOCKED_FOR_MS);
      expect(edit.state.settled).toBe(false);
      write();
      await visitor;
      await edit.finished;
      cut = edit.state;
    } finally {
      // Whatever happened above, let the held transaction end.
      write();
      await visitor.catch(() => undefined);
    }

    expect((cut.error as ValidationError).fieldErrors).toEqual({ schedule: [`7 seats are already booked at 09:00 on ${DATE}.`] });
    expect(await seatsHeld(tenant, tour.id)).toBe(7);
  });

  it("makes a change of kind, length or party size wait for a booking that is being placed", async () => {
    const edits: [string, Parameters<typeof updateTour>[2], string][] = [
      ["kind", { kind: "departure" }, "conflict"],
      ["durationDays", { durationDays: 5 }, "validation"],
      ["maxGroupSize", { maxGroupSize: 2 }, "validation"],
    ];
    for (const [name, patch, code] of edits) {
      const tenant = await createTenant();
      const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "private", durationDays: 3 });

      const edit = await whileOpen(tenant, placing({ tourId: tour.id, adults: 4 }), async (commit) => {
        const attempt = watch(() => as(tenant, (scope) => updateTour(scope, tour.id, patch)));
        await sleep(BLOCKED_FOR_MS);
        expect(attempt.state.settled, name).toBe(false);
        await commit();
        await attempt.finished;
        return attempt.state;
      });

      expect(edit.error, name).toBeInstanceOf(AppError);
      expect((edit.error as AppError).code, name).toBe(code);
      expect(await as(tenant, (scope) => getTour(scope, tour.id)), name).toMatchObject({ kind: "private", durationDays: 3, maxGroupSize: 8 });
    }
  });

  it("lets an edit that leaves capacity alone finish once an in-flight booking commits", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "day", schedule: slots(8) });

    // A booking holds the tour row (FOR SHARE) for the length of its own
    // transaction, so the edit waits for it rather than racing it. It must
    // neither fail nor deadlock, and both changes must land.
    const updated = await whileOpen(tenant, placing({ tourId: tour.id, slotTime: "09:00", adults: 2 }), async (commit) => {
      const edit = watch(() => as(tenant, (scope) => updateTour(scope, tour.id, { summary: "Now with tea.", priceAdult: 70_000 })));
      await sleep(150);
      expect(edit.state.settled).toBe(false);
      await commit();
      await edit.finished;
      if (edit.state.error) throw edit.state.error;
      return edit.state.value;
    });
    expect(updated).toMatchObject({ summary: "Now with tea.", priceAdult: 70_000 });
    expect(await seatsHeld(tenant, tour.id)).toBe(2);
  });

  it("serialises two capacity edits of the same tour", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "day", schedule: slots(8) });
    await request(tenant, { tourId: tour.id, slotTime: "09:00", adults: 5 });

    const results = await Promise.allSettled([
      as(tenant, (scope) => updateTour(scope, tour.id, { schedule: slots(6) })),
      as(tenant, (scope) => updateTour(scope, tour.id, { schedule: slots(4) })),
      as(tenant, (scope) => updateTour(scope, tour.id, { maxGroupSize: 6 })),
    ]);
    // No deadlock, no database error: the cut below five seats is the only refusal.
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(ValidationError);
    expect(await as(tenant, (scope) => getTour(scope, tour.id))).toMatchObject({ schedule: slots(6), maxGroupSize: 6 });
  });
});
