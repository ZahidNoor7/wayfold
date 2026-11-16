import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getTourAvailability } from "@/server/bookings/availability";
import {
  addBookingNote,
  bookingStats,
  cancelBooking,
  completeBooking,
  confirmBooking,
  declineBooking,
  expireStaleHolds,
  exportBookingsCsv,
  findClashes,
  getBooking,
  getBookingByReference,
  listBookings,
  reopenBooking,
  rescheduleBooking,
  updatePaymentStatus,
} from "@/server/bookings/service";
import {
  addCustomerNote,
  deleteCustomerNote,
  exportCustomersCsv,
  getCustomer,
  listCustomers,
  setMarketingOptIn,
  setPreferredContact,
  updateCustomer,
} from "@/server/customers/service";
import { withTenant, type TenantScope } from "@/server/db/context";
import { bookingEvents, bookings, customerNotes, customers } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import { enqueueNotification } from "@/server/notifications/index";
import {
  allBookings,
  allCustomers,
  asOwner,
  auditActions,
  bookingRow,
  createDayTour,
  createDeparture,
  createDepartureTour,
  createPrivateTour,
  errorOf,
  eventsOf,
  hoursAfter,
  NOW,
  requestBooking,
  TODAY,
  type TourRow,
} from "../helpers/bookings";
import { createTenant, unique, type TenantFixture } from "../helpers/fixtures";

vi.mock("@/server/promotions/engine", () => ({ findBestDiscount: vi.fn(async () => null), consumeDiscount: vi.fn(async () => undefined) }));
vi.mock("@/server/notifications/index", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

/** Postgres error code of a rejected statement, wherever the driver put it. */
async function pgCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code ?? "unknown";
  }
}
const INSUFFICIENT_PRIVILEGE = "42501";
const FOREIGN_KEY_VIOLATION = "23503";

const SHARED_EMAIL = `${unique("shared")}@example.test`;

interface World {
  a: TenantFixture;
  b: TenantFixture;
  /** Tenant A's records: the ones B must never reach. */
  tourA: TourRow;
  departureTourA: TourRow;
  departureA: { id: string };
  pendingA: { bookingId: string; reference: string };
  confirmedA: { bookingId: string; reference: string };
  cancelledA: { bookingId: string; reference: string };
  customerA: string;
  noteA: string;
  tourB: TourRow;
}

let world: World;

beforeAll(async () => {
  const a = await createTenant({ name: "Aurelia Journeys" });
  const b = await createTenant({ name: "Baku Rival Tours" });
  const tourA = await createDayTour(a.tenantId, { slug: "old-city", title: "Aurelia Old City" });
  const departureTourA = await createDepartureTour(a.tenantId, { slug: "sheki" });
  const departureA = await createDeparture(a.tenantId, departureTourA.id, "2027-03-17", 8);
  const tourB = await createDayTour(b.tenantId, { slug: "old-city", title: "Rival Old City" });

  const guest = { name: "Secret Guest", email: SHARED_EMAIL, phone: "+44 7700 900111" };
  const fixed = (min: number) => min + 4821;
  const pendingA = await requestBooking(a.tenantId, { ...guest, tourId: tourA.id, date: "2027-03-10", slotTime: "09:00", adults: 6 }, { random: fixed });
  const confirmedA = await requestBooking(a.tenantId, { ...guest, tourId: tourA.id, date: "2027-03-11", slotTime: "09:00", adults: 2 });
  const cancelledA = await requestBooking(a.tenantId, { ...guest, tourId: tourA.id, date: "2027-03-12", slotTime: "09:00", adults: 2 });
  await asOwner(a, (scope) => confirmBooking(scope, confirmedA.bookingId, { now: NOW }));
  await asOwner(a, (scope) => declineBooking(scope, cancelledA.bookingId));
  const customerA = (await bookingRow(a.tenantId, pendingA.bookingId)).customerId;
  const noteA = (await asOwner(a, (scope) => addCustomerNote(scope, customerA, "VIP: owner's cousin"))).id;

  world = { a, b, tourA, departureTourA, departureA, pendingA, confirmedA, cancelledA, customerA, noteA, tourB };
});

const asB = <T>(fn: (scope: TenantScope) => Promise<T>) => asOwner(world.b, fn);

/** A customer that really belongs to B, made through B's own storefront. */
async function customerOfB(): Promise<string> {
  const own = await requestBooking(world.b.tenantId, { tourId: world.tourB.id, date: "2027-05-03", slotTime: "14:00", adults: 1 });
  return (await bookingRow(world.b.tenantId, own.bookingId)).customerId;
}

describe("bookings: tenant B cannot reach tenant A's bookings", () => {
  it("cannot read a booking by id or by reference", async () => {
    const { pendingA, confirmedA } = world;
    for (const booking of [pendingA, confirmedA]) {
      expect(await errorOf(asB((scope) => getBooking(scope, booking.bookingId)))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(asB((scope) => getBookingByReference(scope, booking.reference)))).toBeInstanceOf(NotFoundError);
    }
    // The same reference resolves to A's own booking for A.
    expect((await asOwner(world.a, (scope) => getBookingByReference(scope, pendingA.reference))).booking.id).toBe(pendingA.bookingId);
  });

  it("gets the same reference for its own booking without seeing A's", async () => {
    const { b, tourB, pendingA } = world;
    const own = await requestBooking(b.tenantId, { tourId: tourB.id, date: "2027-03-20", slotTime: "09:00" }, { random: (min) => min + 4821 });
    expect(own.reference).toBe(pendingA.reference);
    const found = await asB((scope) => getBookingByReference(scope, pendingA.reference));
    expect(found.booking.id).toBe(own.bookingId);
    expect(found.booking.tenantId).toBe(b.tenantId);
    expect(found.booking.contactName).not.toBe("Secret Guest");
  });

  it("cannot list, search, filter or export them", async () => {
    const { b, tourA, pendingA } = world;
    const everything = await asB((scope) => listBookings(scope, { limit: 100 }));
    expect(everything.rows.every((row) => row.tenantId === b.tenantId)).toBe(true);
    expect(everything.rows.map((row) => row.contactName)).not.toContain("Secret Guest");

    for (const filters of [{ search: "Secret Guest" }, { search: SHARED_EMAIL }, { search: "Aurelia Old City" }, { tourId: tourA.id }, { search: pendingA.reference, tourId: tourA.id }]) {
      const result = await asB((scope) => listBookings(scope, filters));
      expect(result.rows.filter((row) => row.contactName === "Secret Guest"), JSON.stringify(filters)).toEqual([]);
      expect(result.rows.every((row) => row.tenantId === b.tenantId)).toBe(true);
      const csv = await asB((scope) => exportBookingsCsv(scope, filters));
      expect(csv, JSON.stringify(filters)).not.toContain("Secret Guest");
      expect(csv).not.toContain("Aurelia Old City");
    }
    expect(await asB((scope) => listBookings(scope, { tourId: tourA.id }))).toMatchObject({ rows: [], total: 0, counts: { all: 0 } });

    const csv = await asB((scope) => exportBookingsCsv(scope));
    expect(csv).not.toContain(SHARED_EMAIL);
    expect(csv).not.toContain("+44 7700 900111");
  });

  it("cannot confirm, decline, cancel, complete, reopen, reschedule, annotate or mark them paid", async () => {
    const { a, pendingA, confirmedA, cancelledA } = world;
    const before = await allBookings(a.tenantId);
    const eventsBefore = await eventsOf(a.tenantId, pendingA.bookingId);
    vi.mocked(enqueueNotification).mockClear();

    const attempts: [string, (scope: TenantScope) => Promise<unknown>][] = [
      ["confirm", (scope) => confirmBooking(scope, pendingA.bookingId, { now: NOW })],
      ["force confirm", (scope) => confirmBooking(scope, pendingA.bookingId, { now: NOW, force: true })],
      ["decline", (scope) => declineBooking(scope, pendingA.bookingId, { reason: "hijack" })],
      ["cancel", (scope) => cancelBooking(scope, confirmedA.bookingId, { kind: "by_business", reason: "hijack" })],
      ["complete", (scope) => completeBooking(scope, confirmedA.bookingId)],
      ["reopen", (scope) => reopenBooking(scope, cancelledA.bookingId, { now: NOW })],
      ["reschedule", (scope) => rescheduleBooking(scope, pendingA.bookingId, { date: "2027-03-15" })],
      ["force reschedule", (scope) => rescheduleBooking(scope, confirmedA.bookingId, { date: "2027-03-15", force: true })],
      ["payment", (scope) => updatePaymentStatus(scope, confirmedA.bookingId, { paymentStatus: "paid" })],
      ["note", (scope) => addBookingNote(scope, pendingA.bookingId, "planted")],
    ];
    for (const [label, attempt] of attempts) {
      expect(await errorOf(asB(attempt)), label).toBeInstanceOf(NotFoundError);
    }

    expect(await allBookings(a.tenantId)).toEqual(before);
    expect(await eventsOf(a.tenantId, pendingA.bookingId)).toEqual(eventsBefore);
    expect(vi.mocked(enqueueNotification)).not.toHaveBeenCalled();
    // Nothing was written to either tenant's audit log by the failed attempts.
    expect((await auditActions(world.b.tenantId)).filter((entry) => entry.targetId === pendingA.bookingId)).toEqual([]);
  });

  it("does not expire, count or flag A's bookings when B runs its own jobs and reports", async () => {
    const { a, b, pendingA } = world;
    // Far in the future every hold of A has lapsed; B's job must not touch them.
    expect(await asB((scope) => expireStaleHolds(scope, hoursAfter(24 * 400)))).toBeGreaterThanOrEqual(0);
    expect((await bookingRow(a.tenantId, pendingA.bookingId)).status).toBe("pending");
    expect((await allBookings(b.tenantId)).every((row) => row.tenantId === b.tenantId)).toBe(true);

    const statsB = await asB((scope) => bookingStats(scope, { from: "2027-03-10", to: "2027-03-12", today: TODAY }));
    expect(statsB.counts.all).toBe(0);
    expect(statsB.revenue).toBe(0);
    expect(statsB.upcoming.map((row) => row.contactName)).not.toContain("Secret Guest");
    const statsA = await asOwner(a, (scope) => bookingStats(scope, { from: "2027-03-10", to: "2027-03-12", today: TODAY }));
    expect(statsA.counts.all).toBe(3);

    const clashes = await asB((scope) => findClashes(scope, { now: NOW }));
    expect(clashes.map((entry) => entry.contactName)).not.toContain("Secret Guest");
  });

  it("is refused by the database itself when a query skips the services", async () => {
    const { a, b, pendingA } = world;
    const seen = await withTenant(b.tenantId, async ({ tx }) => ({
      byId: await tx.select().from(bookings).where(eq(bookings.id, pendingA.bookingId)),
      byTenant: await tx.select().from(bookings).where(eq(bookings.tenantId, a.tenantId)),
      events: await tx.select().from(bookingEvents).where(eq(bookingEvents.bookingId, pendingA.bookingId)),
      updated: await tx.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, pendingA.bookingId)).returning({ id: bookings.id }),
      deleted: await tx.delete(bookings).where(eq(bookings.tenantId, a.tenantId)).returning({ id: bookings.id }),
    }));
    expect(seen).toEqual({ byId: [], byTenant: [], events: [], updated: [], deleted: [] });

    // Planting a timeline entry on A's booking: wrong tenant is refused, own tenant has no such booking.
    expect(
      await pgCode(() => withTenant(b.tenantId, ({ tx }) => tx.insert(bookingEvents).values({ tenantId: a.tenantId, bookingId: pendingA.bookingId, kind: "note", message: "planted" }))),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(
      await pgCode(() => withTenant(b.tenantId, ({ tx }) => tx.insert(bookingEvents).values({ bookingId: pendingA.bookingId, kind: "note", message: "planted" }))),
    ).toBe(FOREIGN_KEY_VIOLATION);
    // The timeline is append-only even for its owner.
    expect(await pgCode(() => withTenant(a.tenantId, ({ tx }) => tx.delete(bookingEvents).where(eq(bookingEvents.bookingId, pendingA.bookingId))))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect((await bookingRow(a.tenantId, pendingA.bookingId)).status).toBe("pending");
  });
});

describe("bookings: a booking in B cannot reference A's tour or departure", () => {
  it("answers not found when B's storefront is asked to book A's tour, by id or by a slug only A has", async () => {
    const { b, tourA, departureTourA } = world;
    const customersBefore = (await allCustomers(b.tenantId)).length;
    const bookingsBefore = (await allBookings(b.tenantId)).length;

    expect(await errorOf(requestBooking(b.tenantId, { tourId: tourA.id, slotTime: "09:00" }))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(requestBooking(b.tenantId, { tourId: departureTourA.id, date: "2027-03-17" }))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(requestBooking(b.tenantId, { tourSlug: "sheki", date: "2027-03-17" }))).toBeInstanceOf(NotFoundError);

    expect(await allBookings(b.tenantId)).toHaveLength(bookingsBefore);
    expect(await allCustomers(b.tenantId)).toHaveLength(customersBefore);
  });

  it("books B's own tour when both tenants use the same slug", async () => {
    const { b, tourB } = world;
    const result = await requestBooking(b.tenantId, { tourSlug: "old-city", date: "2027-03-22", slotTime: "09:00" });
    const row = await bookingRow(b.tenantId, result.bookingId);
    expect(row).toMatchObject({ tenantId: b.tenantId, tourId: tourB.id, tourTitle: "Rival Old City" });
  });

  it("ignores a tenant id in the payload", async () => {
    const { a, b, tourB } = world;
    const before = (await allBookings(a.tenantId)).length;
    const result = await requestBooking(b.tenantId, { tourId: tourB.id, date: "2027-03-23", slotTime: "09:00", tenantId: a.tenantId, tenant_id: a.tenantId });
    expect((await bookingRow(b.tenantId, result.bookingId)).tenantId).toBe(b.tenantId);
    expect(await allBookings(a.tenantId)).toHaveLength(before);
  });

  it("cannot be rescheduled onto A's departure, nor point at A's tour, departure or customer in the database", async () => {
    const { a, b, tourA, departureA, customerA, tourB } = world;
    const depTourB = await createDepartureTour(b.tenantId);
    await createDeparture(b.tenantId, depTourB.id, "2027-03-24", 8);
    const own = await requestBooking(b.tenantId, { tourId: depTourB.id, date: "2027-03-24" });
    // A has a departure on the 17th; B's tour does not, so for B that date has none.
    const error = await errorOf(asB((scope) => rescheduleBooking(scope, own.bookingId, { date: "2027-03-17", force: true })));
    expect(error.fieldErrors).toEqual({ date: ["This tour has no departure on that date."] });

    const ownRow = await bookingRow(b.tenantId, own.bookingId);
    const forged = { ...ownRow, id: undefined, reference: unique("FORGED") } as unknown as typeof bookings.$inferInsert;
    const insert = (patch: Partial<typeof bookings.$inferInsert>) => pgCode(() => withTenant(b.tenantId, ({ tx }) => tx.insert(bookings).values({ ...forged, ...patch })));

    // The composite foreign keys tie tour, departure and customer to the booking's own tenant.
    expect(await insert({ tourId: tourA.id, departureId: null })).toBe(FOREIGN_KEY_VIOLATION);
    expect(await insert({ tourId: tourB.id, departureId: departureA.id })).toBe(FOREIGN_KEY_VIOLATION);
    expect(await insert({ customerId: customerA })).toBe(FOREIGN_KEY_VIOLATION);
    expect(await insert({ tenantId: a.tenantId })).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await pgCode(() => withTenant(b.tenantId, ({ tx }) => tx.update(bookings).set({ departureId: departureA.id }).where(eq(bookings.id, own.bookingId))))).toBe(
      FOREIGN_KEY_VIOLATION,
    );
    expect(await pgCode(() => withTenant(b.tenantId, ({ tx }) => tx.update(bookings).set({ tenantId: a.tenantId }).where(eq(bookings.id, own.bookingId))))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });
});

describe("availability: each tenant's calendar depends only on its own bookings", () => {
  it("cannot read the availability of A's tour", async () => {
    const { tourA, departureTourA } = world;
    for (const tour of [tourA, departureTourA]) {
      for (const includeUnpublished of [false, true]) {
        const error = await errorOf(asB((scope) => getTourAvailability(scope, tour.id, { from: "2027-03-10", to: "2027-03-17", today: TODAY, now: NOW, includeUnpublished })));
        expect(error).toBeInstanceOf(NotFoundError);
      }
    }
  });

  it("leaves B's seats untouched by A's bookings on the same date, time and slug", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const sameSchedule = { slug: "old-city", schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [{ time: "09:00", capacity: 8 }] } };
    const tourA = await createDayTour(a.tenantId, sameSchedule);
    const tourB = await createDayTour(b.tenantId, sameSchedule);
    const slot = { date: "2027-03-10", slotTime: "09:00", adults: 8 };

    await requestBooking(a.tenantId, { ...slot, tourId: tourA.id });
    const day = async (tenantId: string, tourId: string) =>
      (await withTenant(tenantId, (scope) => getTourAvailability(scope, tourId, { from: "2027-03-10", to: "2027-03-10", today: TODAY, now: NOW }))).days[0]!;

    expect(await day(a.tenantId, tourA.id)).toMatchObject({ state: "full", seatsLeft: 0 });
    expect(await day(b.tenantId, tourB.id)).toMatchObject({ state: "open", seatsLeft: 8 });
    // B can still sell every seat A has sold.
    await requestBooking(b.tenantId, { ...slot, tourId: tourB.id });
    expect(await day(b.tenantId, tourB.id)).toMatchObject({ state: "full", seatsLeft: 0 });
    expect((await errorOf(requestBooking(a.tenantId, { ...slot, tourId: tourA.id, adults: 1 }))).code).toBe("slot_taken");
  });

  it("leaves B's private calendar and departures untouched by A's", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const privateA = await createPrivateTour(a.tenantId, { durationDays: 8 });
    const privateB = await createPrivateTour(b.tenantId, { durationDays: 8 });
    const depA = await createDepartureTour(a.tenantId);
    const depB = await createDepartureTour(b.tenantId);
    await createDeparture(a.tenantId, depA.id, "2027-03-17", 4);
    await createDeparture(b.tenantId, depB.id, "2027-03-17", 4);

    const heldA = await requestBooking(a.tenantId, { tourId: privateA.id, date: "2027-03-10" });
    await asOwner(a, (scope) => confirmBooking(scope, heldA.bookingId, { now: NOW }));
    await requestBooking(a.tenantId, { tourId: depA.id, date: "2027-03-17", adults: 4 });

    const calendarB = await withTenant(b.tenantId, (scope) => getTourAvailability(scope, privateB.id, { from: "2027-03-08", to: "2027-03-18", today: TODAY, now: NOW }));
    expect(calendarB.days.every((day) => day.state === "open")).toBe(true);
    const departuresB = await withTenant(b.tenantId, (scope) => getTourAvailability(scope, depB.id, { from: "2027-03-17", to: "2027-03-17", today: TODAY, now: NOW }));
    expect(departuresB.days[0]).toMatchObject({ state: "open", seatsLeft: 4 });

    // The guide of B is free on the very dates A's guide is booked.
    await requestBooking(b.tenantId, { tourId: privateB.id, date: "2027-03-10" });
    await requestBooking(b.tenantId, { tourId: depB.id, date: "2027-03-17", adults: 4 });
    expect(await asOwner(b, (scope) => findClashes(scope, { now: NOW }))).toEqual([]);
    expect(await asOwner(a, (scope) => findClashes(scope, { now: NOW }))).toEqual([]);
  });

  it("counts each tenant's monthly plan limit separately", async () => {
    const a = await createTenant({ plan: { maxBookingsPerMonth: 1 } });
    const b = await createTenant({ plan: { maxBookingsPerMonth: 1 } });
    const tourA = await createDayTour(a.tenantId);
    const tourB = await createDayTour(b.tenantId);
    await requestBooking(a.tenantId, { tourId: tourA.id, slotTime: "09:00" });
    // A has used its allowance; B has not.
    await requestBooking(b.tenantId, { tourId: tourB.id, slotTime: "09:00" });
    expect((await errorOf(requestBooking(a.tenantId, { tourId: tourA.id, slotTime: "14:00" }))).code).toBe("plan_limit");
  });
});

describe("customers: tenant B cannot reach tenant A's customers", () => {
  it("keeps the same e-mail address as two separate profiles", async () => {
    const { a, b, tourB, customerA } = world;
    const own = await requestBooking(b.tenantId, {
      tourId: tourB.id,
      date: "2027-03-25",
      slotTime: "09:00",
      name: "Public Guest",
      email: SHARED_EMAIL.toUpperCase(),
      phone: "+1 555 000 2222",
    });
    const customerB = (await bookingRow(b.tenantId, own.bookingId)).customerId;
    expect(customerB).not.toBe(customerA);

    const inA = await asOwner(a, (scope) => getCustomer(scope, customerA));
    const inB = await asB((scope) => getCustomer(scope, customerB));
    expect(inA.customer).toMatchObject({ tenantId: a.tenantId, email: SHARED_EMAIL, name: "Secret Guest", phone: "+44 7700 900111" });
    expect(inB.customer).toMatchObject({ tenantId: b.tenantId, email: SHARED_EMAIL, name: "Public Guest", phone: "+1 555 000 2222" });
    // Each profile carries only its own tenant's history and notes.
    expect(inB.bookings.map((row) => row.id)).toEqual([own.bookingId]);
    expect(inB.notes).toEqual([]);
    expect(inA.bookings).toHaveLength(3);
    expect(inA.notes.map((note) => note.body)).toEqual(["VIP: owner's cousin"]);

    // Editing B's profile leaves A's alone, and A's address is free for another B customer to take or not, independently.
    await asB((scope) => updateCustomer(scope, customerB, { name: "Renamed In B", marketingOptIn: true }));
    expect((await asOwner(a, (scope) => getCustomer(scope, customerA))).customer).toMatchObject({ name: "Secret Guest", marketingOptIn: false });
  });

  it("cannot read, list, search or export A's customers", async () => {
    const { b, customerA } = world;
    expect(await errorOf(asB((scope) => getCustomer(scope, customerA)))).toBeInstanceOf(NotFoundError);

    const everyone = await asB((scope) => listCustomers(scope, { limit: 100 }));
    expect(everyone.rows.every((row) => row.tenantId === b.tenantId)).toBe(true);
    expect(everyone.rows.map((row) => row.id)).not.toContain(customerA);

    for (const search of ["Secret Guest", "900111", SHARED_EMAIL]) {
      const result = await asB((scope) => listCustomers(scope, { search }));
      expect(result.rows.map((row) => row.id), search).not.toContain(customerA);
      expect(result.rows.every((row) => row.tenantId === b.tenantId)).toBe(true);
      expect(result.rows.map((row) => row.name)).not.toContain("Secret Guest");
      const csv = await asB((scope) => exportCustomersCsv(scope, { search }));
      expect(csv, search).not.toContain("Secret Guest");
      expect(csv).not.toContain("900111");
    }
    // A search by the shared address finds B's own profile with B's own figures only.
    const shared = await asB((scope) => listCustomers(scope, { search: SHARED_EMAIL }));
    for (const row of shared.rows) expect(row.bookingCount).toBeLessThanOrEqual(1);
    expect(await asB((scope) => exportCustomersCsv(scope))).not.toContain("+44 7700 900111");
  });

  it("cannot update, opt in, annotate or delete notes of A's customers", async () => {
    const { a, customerA, noteA } = world;
    const before = await asOwner(a, (scope) => getCustomer(scope, customerA));

    const attempts: [string, (scope: TenantScope) => Promise<unknown>][] = [
      ["update", (scope) => updateCustomer(scope, customerA, { name: "Hijacked", email: "hijack@example.test" })],
      ["opt in", (scope) => setMarketingOptIn(scope, customerA, true)],
      ["contact", (scope) => setPreferredContact(scope, customerA, "phone")],
      ["add note", (scope) => addCustomerNote(scope, customerA, "planted")],
      ["delete note", (scope) => deleteCustomerNote(scope, customerA, noteA)],
    ];
    for (const [label, attempt] of attempts) {
      expect(await errorOf(asB(attempt)), label).toBeInstanceOf(NotFoundError);
    }

    // B's own customer cannot be used as a handle on A's note either.
    const ownCustomer = await customerOfB();
    expect(await errorOf(asB((scope) => deleteCustomerNote(scope, ownCustomer, noteA)))).toBeInstanceOf(NotFoundError);

    expect(await asOwner(a, (scope) => getCustomer(scope, customerA))).toEqual(before);
  });

  it("lets B take an e-mail address that only a customer of A uses", async () => {
    const { a, b } = world;
    const onlyInA = `${unique("only-a")}@example.test`;
    const tourA = await createDayTour(a.tenantId);
    await requestBooking(a.tenantId, { tourId: tourA.id, date: "2027-03-26", slotTime: "09:00", email: onlyInA });
    const ownCustomer = await customerOfB();
    // Uniqueness is per tenant: A's use of the address is invisible to B and no conflict.
    const updated = await asB((scope) => updateCustomer(scope, ownCustomer, { email: onlyInA }));
    expect(updated).toMatchObject({ tenantId: b.tenantId, email: onlyInA });
  });

  it("is refused by the database itself when a query skips the services", async () => {
    const { a, b, customerA, noteA } = world;
    const seen = await withTenant(b.tenantId, async ({ tx }) => ({
      customer: await tx.select().from(customers).where(eq(customers.id, customerA)),
      byTenant: await tx.select().from(customers).where(eq(customers.tenantId, a.tenantId)),
      notes: await tx.select().from(customerNotes).where(eq(customerNotes.id, noteA)),
      updated: await tx.update(customers).set({ name: "Hijacked" }).where(eq(customers.id, customerA)).returning({ id: customers.id }),
      deletedNotes: await tx.delete(customerNotes).where(eq(customerNotes.customerId, customerA)).returning({ id: customerNotes.id }),
    }));
    expect(seen).toEqual({ customer: [], byTenant: [], notes: [], updated: [], deletedNotes: [] });

    expect(await pgCode(() => withTenant(b.tenantId, ({ tx }) => tx.insert(customerNotes).values({ customerId: customerA, body: "planted" })))).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await pgCode(() => withTenant(b.tenantId, ({ tx }) => tx.insert(customers).values({ tenantId: a.tenantId, name: "Planted", email: `${unique("p")}@example.test` }))),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect((await asOwner(a, (scope) => getCustomer(scope, customerA))).notes).toHaveLength(1);
  });
});
