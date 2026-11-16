import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookingRequest, SlotTakenError } from "@/server/bookings/request";
import { confirmBooking } from "@/server/bookings/service";
import { withTenant } from "@/server/db/context";
import { ConflictError, LimitExceededError, NotFoundError, ValidationError } from "@/server/errors";
import { enqueueNotification } from "@/server/notifications/index";
import { consumeDiscount, findBestDiscount } from "@/server/promotions/engine";
import { updateBookingSettings } from "@/server/settings/tenant-settings";
import {
  allBookings,
  allCustomers,
  asOwner,
  auditActions,
  bookingRow,
  createBlock,
  createDayTour,
  createDeparture,
  createDepartureTour,
  createPrivateTour,
  errorOf,
  eventsOf,
  hoursAfter,
  NOW,
  requestBooking,
  requestInput,
  setTenantEmail,
  TODAY,
} from "../../helpers/bookings";
import { createTenant, randomId, unique } from "../../helpers/fixtures";

vi.mock("@/server/promotions/engine", () => ({ findBestDiscount: vi.fn(async () => null), consumeDiscount: vi.fn(async () => undefined) }));
vi.mock("@/server/notifications/index", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

const findBest = vi.mocked(findBestDiscount);
const consume = vi.mocked(consumeDiscount);
const notify = vi.mocked(enqueueNotification);

const notificationsFor = (tenantId: string) => notify.mock.calls.filter(([scope]) => scope.tenantId === tenantId).map(([, message]) => message);

beforeEach(() => {
  findBest.mockReset().mockResolvedValue(null);
  consume.mockReset().mockResolvedValue(undefined);
  notify.mockReset().mockResolvedValue(undefined);
});

describe("createBookingRequest: the request flow", () => {
  it("creates a pending booking that holds its seats, with server-side snapshots", async () => {
    const t = await createTenant({ name: "Aurelia Journeys" });
    await setTenantEmail(t.tenantId, "hello@aurelia.test");
    const tour = await createDayTour(t.tenantId, { slug: "old-city-walk", title: "Icherisheher & Flame Towers", priceAdult: 12_000, childPricePercent: 50 });
    const email = `${unique("Eleanor")}@Example.Test`;

    const result = await requestBooking(t.tenantId, {
      tourId: tour.id,
      date: "2027-03-10",
      slotTime: "14:00",
      alternativeDate: "2027-03-11",
      adults: 2,
      children: 1,
      participants: [{ name: " Eleanor Whitfield " }, { name: "Tom", age: 9 }],
      name: "  Eleanor Whitfield ",
      email: `  ${email} `,
      phone: "+44 7700 900821",
      country: "United Kingdom",
      language: "English",
      pickup: "Four Seasons, Baku",
      contactMethod: "whatsapp",
      notes: "Vegetarian",
    });

    expect(result.reference).toMatch(/^WF-OLD-\d{4}$/);
    expect(result.status).toBe("pending");
    expect(result.holdExpiresAt).toEqual(hoursAfter(24));
    expect(result.totals).toEqual({
      currency: "USD",
      unitPriceAdult: 12_000,
      unitPriceChild: 6_000,
      baseAmount: 30_000,
      discountAmount: 0,
      totalAmount: 30_000,
      discountLabel: null,
    });

    const row = await bookingRow(t.tenantId, result.bookingId);
    expect(row).toMatchObject({
      tenantId: t.tenantId,
      reference: result.reference,
      tourId: tour.id,
      departureId: null,
      startDate: "2027-03-10",
      endDate: "2027-03-10",
      slotTime: "14:00:00",
      alternativeDate: "2027-03-11",
      adults: 2,
      children: 1,
      participants: [
        { name: "Eleanor Whitfield", age: null },
        { name: "Tom", age: 9 },
      ],
      status: "pending",
      cancelKind: null,
      currency: "USD",
      unitPriceAdult: 12_000,
      unitPriceChild: 6_000,
      baseAmount: 30_000,
      discountAmount: 0,
      totalAmount: 30_000,
      discountSource: null,
      discountRefId: null,
      paymentStatus: "unpaid",
      amountPaid: 0,
      contactName: "Eleanor Whitfield",
      contactEmail: email.toLowerCase(),
      contactPhone: "+44 7700 900821",
      country: "United Kingdom",
      language: "English",
      pickup: "Four Seasons, Baku",
      contactMethod: "whatsapp",
      customerNotes: "Vegetarian",
      tourTitle: "Icherisheher & Flame Towers",
      confirmedAt: null,
    });
    expect(row.holdExpiresAt).toEqual(hoursAfter(24));
    expect(row.createdAt).toEqual(NOW);

    const customers = await allCustomers(t.tenantId);
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({
      id: row.customerId,
      name: "Eleanor Whitfield",
      email: email.toLowerCase(),
      phone: "+44 7700 900821",
      country: "United Kingdom",
      language: "English",
      preferredContact: "whatsapp",
      marketingOptIn: false,
    });

    expect(await eventsOf(t.tenantId, row.id)).toEqual([{ kind: "created", message: expect.stringContaining("3 guests"), actorId: null }]);
    expect(await auditActions(t.tenantId, row.id)).toEqual([
      expect.objectContaining({ action: "booking.created", actorType: "system", metadata: expect.objectContaining({ reference: result.reference, seats: 3 }) }),
    ]);

    const [received, alert] = notificationsFor(t.tenantId);
    expect(notificationsFor(t.tenantId)).toHaveLength(2);
    expect(received).toMatchObject({ kind: "booking.received", toEmail: email.toLowerCase(), relatedType: "booking", relatedId: row.id });
    expect(received!.subject).toContain(result.reference);
    // The wording belongs to the notification templates; the facts come from this booking.
    for (const fact of ["Eleanor", "Aurelia Journeys", "24 hours", "10 Mar 2027 at 14:00", "2 adults, 1 child", "$300", "Four Seasons, Baku", "hello@aurelia.test"]) {
      expect(received!.bodyText, fact).toContain(fact);
    }
    expect(alert).toMatchObject({ kind: "booking.staff_alert", toEmail: "hello@aurelia.test", relatedType: "booking", relatedId: row.id });
    expect(alert!.subject).toContain(result.reference);
    for (const fact of ["Eleanor Whitfield", email.toLowerCase(), "+44 7700 900821", "Vegetarian", "Icherisheher & Flame Towers"]) {
      expect(alert!.bodyText, fact).toContain(fact);
    }
  });

  it("skips the staff alert when the business has no usable e-mail address, and still takes the booking", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", adults: 1, date: "2027-03-10" });
    expect(notificationsFor(t.tenantId).map((message) => message.kind)).toEqual(["booking.received"]);
    expect(notificationsFor(t.tenantId)[0]!.bodyText).toContain("1 adult\n");

    // A typo in settings must not cost the business a booking.
    await setTenantEmail(t.tenantId, "hello at aurelia");
    await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", adults: 1, date: "2027-03-11" });
    expect(notificationsFor(t.tenantId).map((message) => message.kind)).toEqual(["booking.received", "booking.received"]);

    await setTenantEmail(t.tenantId, "  Hello@Aurelia.Test ");
    await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", adults: 1, date: "2027-03-12" });
    expect(notificationsFor(t.tenantId).at(-1)).toMatchObject({ kind: "booking.staff_alert", toEmail: "Hello@Aurelia.Test" });
    expect(await allBookings(t.tenantId)).toHaveLength(3);
  });

  it("finds the tour by slug, and prefers neither drafts nor other tenants' tours", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId, { slug: "fire-and-stone" });
    await createDayTour(t.tenantId, { slug: "hidden-draft", status: "draft" });
    const archived = await createDayTour(t.tenantId, { status: "archived" });

    const result = await requestBooking(t.tenantId, { tourSlug: "fire-and-stone", slotTime: "09:00" });
    expect(result.reference).toMatch(/^WF-FIR-\d{4}$/);
    expect((await bookingRow(t.tenantId, result.bookingId)).tourId).toBe(tour.id);

    for (const selector of [{ tourSlug: "hidden-draft" }, { tourSlug: "no-such-tour" }, { tourId: archived.id }, { tourId: randomId() }, { tourId: "nonsense" }]) {
      const error = await errorOf(requestBooking(t.tenantId, { ...selector, slotTime: "09:00" }));
      expect(error, JSON.stringify(selector)).toBeInstanceOf(NotFoundError);
    }
    expect(await allBookings(t.tenantId)).toHaveLength(1);
  });

  it("uses the tenant's reference prefix, hold length and currency", async () => {
    const t = await createTenant();
    const tour = await createPrivateTour(t.tenantId, { slug: "grand-azerbaijan", durationDays: 8, priceAdult: 245_000 });
    await withTenant(t.tenantId, (scope) => updateBookingSettings(scope, { referencePrefix: "aj", holdHours: 48 }));

    const result = await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-04-05", adults: 2 });
    expect(result.reference).toMatch(/^AJ-GRA-\d{4}$/);
    expect(result.holdExpiresAt).toEqual(hoursAfter(48));
    expect(await bookingRow(t.tenantId, result.bookingId)).toMatchObject({ startDate: "2027-04-05", endDate: "2027-04-12", slotTime: null, totalAmount: 490_000 });
    expect(notificationsFor(t.tenantId)[0]!.bodyText).toMatch(/5 Apr 2027 to .*12 Apr 2027/);
    expect(notificationsFor(t.tenantId)[0]!.bodyText).toContain("48 hours");
  });

  it("ignores prices, totals, status, references and tenant ids sent by the client", async () => {
    const t = await createTenant();
    const other = await createTenant();
    const tour = await createDayTour(t.tenantId, { priceAdult: 12_000 });

    const result = await requestBooking(t.tenantId, {
      tourId: tour.id,
      slotTime: "09:00",
      adults: 2,
      // None of these are part of the contract; all must be dropped.
      tenantId: other.tenantId,
      status: "confirmed",
      reference: "FREE-RIDE-0001",
      priceAdult: 1,
      unitPriceAdult: 1,
      unitPriceChild: 0,
      baseAmount: 2,
      totalAmount: 0,
      discountAmount: 24_000,
      discountLabel: "100% off",
      paymentStatus: "paid",
      amountPaid: 24_000,
      holdExpiresAt: "2099-01-01T00:00:00Z",
      customerId: randomId(),
      currency: "JPY",
      tourTitle: "Free tour",
      confirmedAt: "2027-01-01T00:00:00Z",
    });

    const row = await bookingRow(t.tenantId, result.bookingId);
    expect(row).toMatchObject({
      tenantId: t.tenantId,
      status: "pending",
      unitPriceAdult: 12_000,
      baseAmount: 24_000,
      discountAmount: 0,
      totalAmount: 24_000,
      discountLabel: null,
      paymentStatus: "unpaid",
      amountPaid: 0,
      currency: "USD",
      tourTitle: tour.title,
      confirmedAt: null,
    });
    expect(row.reference).toMatch(/^WF-/);
    expect(row.holdExpiresAt).toEqual(hoursAfter(24));
    expect(await allBookings(other.tenantId)).toEqual([]);
    expect(await allCustomers(other.tenantId)).toEqual([]);
  });

  it("rounds child prices to whole minor units", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId, { priceAdult: 16_501, childPricePercent: 50 });
    const result = await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", adults: 1, children: 3 });
    expect(result.totals).toMatchObject({ unitPriceAdult: 16_501, unitPriceChild: 8_251, baseAmount: 41_254, totalAmount: 41_254 });
  });
});

describe("createBookingRequest: validation", () => {
  it.each([
    ["a one-letter name", { name: "E" }, "name", "Please enter your full name."],
    ["a malformed e-mail", { email: "eleanor@example" }, "email", "Enter a valid email, e.g. name@example.com."],
    ["an e-mail the outbox could not write to", { email: "eleanor..w@example.test" }, "email", "Enter a valid email, e.g. name@example.com."],
    ["an over-long e-mail", { email: `${"e".repeat(250)}@example.test` }, "email", "Enter a valid email, e.g. name@example.com."],
    ["a short phone number", { phone: "12-34" }, "phone", "Enter a phone number with at least 7 digits."],
    ["terms not accepted", { agree: false }, "agree", "Please confirm you understand this is a request."],
    ["terms missing", { agree: undefined }, "agree", "Please confirm you understand this is a request."],
    ["no adults", { adults: 0 }, "adults", "At least one adult is needed."],
    ["negative children", { children: -1 }, "children", undefined],
    ["fractional guests", { adults: 1.5 }, "adults", undefined],
    ["an impossible date", { date: "2027-02-30" }, "date", "Enter a valid date."],
    ["a malformed start time", { slotTime: "9am" }, "slotTime", "Enter a valid start time."],
    ["an unknown contact method", { contactMethod: "pigeon" }, "contactMethod", undefined],
    ["no tour", { tourId: undefined }, "tourId", "Choose a tour."],
    ["a nameless participant", { participants: [{ name: " " }] }, "participants", undefined],
  ])("rejects %s", async (_label, overrides, field, message) => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const error = await errorOf(requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", ...overrides }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors).toHaveProperty(field);
    if (message) expect(error.fieldErrors![field]).toContain(message);
    expect(await allBookings(t.tenantId)).toEqual([]);
    expect(await allCustomers(t.tenantId)).toEqual([]);
  });

  it("requires a start time the tour actually has", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const missing = await errorOf(requestBooking(t.tenantId, { tourId: tour.id }));
    expect(missing.fieldErrors).toEqual({ slotTime: ["Choose a start time."] });
    const unknown = await errorOf(requestBooking(t.tenantId, { tourId: tour.id, slotTime: "18:00" }));
    expect(unknown.fieldErrors).toEqual({ slotTime: ["Choose a start time."] });
  });

  it("limits a day or private party to the tour's group size, but not a shared departure", async () => {
    const t = await createTenant();
    const day = await createDayTour(t.tenantId, { maxGroupSize: 4, schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [{ time: "09:00", capacity: 12 }] } });
    const priv = await createPrivateTour(t.tenantId, { maxGroupSize: 6 });
    const dep = await createDepartureTour(t.tenantId, { maxGroupSize: 2 });
    await createDeparture(t.tenantId, dep.id, "2027-03-10", 12);

    const tooManyDay = await errorOf(requestBooking(t.tenantId, { tourId: day.id, slotTime: "09:00", adults: 3, children: 2 }));
    expect(tooManyDay.fieldErrors).toEqual({ adults: ["This tour takes up to 4 guests per booking."] });
    const tooManyPrivate = await errorOf(requestBooking(t.tenantId, { tourId: priv.id, adults: 7 }));
    expect(tooManyPrivate).toBeInstanceOf(ValidationError);

    await requestBooking(t.tenantId, { tourId: day.id, slotTime: "09:00", adults: 2, children: 2 });
    await requestBooking(t.tenantId, { tourId: priv.id, adults: 4, children: 2 });
    // Shared departure: seats are the limit, not the group size.
    await requestBooking(t.tenantId, { tourId: dep.id, adults: 5 });
    expect(await allBookings(t.tenantId)).toHaveLength(3);
  });

  it("rejects more named travellers than guests and a back-up date equal to the date or in the past", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const base = { tourId: tour.id, slotTime: "09:00", adults: 1 };
    expect((await errorOf(requestBooking(t.tenantId, { ...base, participants: [{ name: "A" }, { name: "B" }] }))).fieldErrors).toHaveProperty("participants");
    expect((await errorOf(requestBooking(t.tenantId, { ...base, alternativeDate: "2027-03-10" }))).fieldErrors).toHaveProperty("alternativeDate");
    expect((await errorOf(requestBooking(t.tenantId, { ...base, alternativeDate: "2027-02-01" }))).fieldErrors).toHaveProperty("alternativeDate");
    expect(await allBookings(t.tenantId)).toEqual([]);
  });

  it("rejects dates that are past, too soon, beyond the horizon, a day off, blocked or not scheduled", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId, { schedule: { weekdays: [1, 2, 3, 4, 5, 6], slots: [{ time: "09:00", capacity: 8 }] } });
    await withTenant(t.tenantId, (scope) => updateBookingSettings(scope, { weeklyDaysOff: [2], horizonDays: 30 }));
    await createBlock(t.tenantId, { startDate: "2027-03-11", endDate: "2027-03-12" });

    for (const date of ["2027-02-20", "2027-03-01", "2027-04-05", "2027-03-09", "2027-03-11", "2027-03-07"]) {
      const error = await errorOf(requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", date }));
      expect(error, date).toBeInstanceOf(ValidationError);
      expect(error.fieldErrors, date).toEqual({ date: ["That date is no longer available — please choose another."] });
    }
    await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", date: "2027-03-10" });
    expect(await allBookings(t.tenantId)).toHaveLength(1);
  });

  it("fails loudly when the caller passes a malformed clock", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const error = await errorOf(
      withTenant(t.tenantId, (scope) => createBookingRequest(scope, requestInput({ tourId: tour.id, slotTime: "09:00" }), { today: "today", now: NOW })),
    );
    expect(error).toBeInstanceOf(RangeError);
  });
});

describe("createBookingRequest: capacity", () => {
  it("sells a day slot down to zero and then answers slot_taken", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const at = { tourId: tour.id, date: "2027-03-10", slotTime: "09:00" };
    await requestBooking(t.tenantId, { ...at, adults: 5 });

    const tooBig = await errorOf(requestBooking(t.tenantId, { ...at, adults: 4 }));
    expect(tooBig).toBeInstanceOf(SlotTakenError);
    expect(tooBig).toMatchObject({ code: "slot_taken", status: 409, seatsLeft: 3 });
    expect(tooBig.message).toContain("Only 3 seats left");

    await requestBooking(t.tenantId, { ...at, adults: 2, children: 1 });
    const full = await errorOf(requestBooking(t.tenantId, { ...at, adults: 1 }));
    expect(full).toBeInstanceOf(ConflictError);
    expect(full).toMatchObject({ code: "slot_taken", seatsLeft: 0 });
    expect(full.message).toContain("just booked by someone else");

    // The other start time and the next day are separate units.
    await requestBooking(t.tenantId, { ...at, slotTime: "14:00", adults: 8 });
    await requestBooking(t.tenantId, { ...at, date: "2027-03-11", adults: 8 });
    expect(await allBookings(t.tenantId)).toHaveLength(4);
    // The losers left nothing behind: no booking, no customer profile.
    expect(await allCustomers(t.tenantId)).toHaveLength(4);
  });

  it("sells a departure by seats and only on open departures", async () => {
    const t = await createTenant();
    const tour = await createDepartureTour(t.tenantId, { durationDays: 3 });
    const departure = await createDeparture(t.tenantId, tour.id, "2027-03-10", 8);
    await createDeparture(t.tenantId, tour.id, "2027-03-17", 8, false);

    const first = await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10", adults: 4, children: 2, slotTime: "09:00" });
    expect(await bookingRow(t.tenantId, first.bookingId)).toMatchObject({ departureId: departure.id, endDate: "2027-03-12", slotTime: null });

    const tooBig = await errorOf(requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10", adults: 3 }));
    expect(tooBig).toMatchObject({ code: "slot_taken", seatsLeft: 2 });
    await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10", adults: 2 });
    expect(await errorOf(requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10", adults: 1 }))).toMatchObject({ code: "slot_taken", seatsLeft: 0 });

    for (const date of ["2027-03-11", "2027-03-17"]) {
      const error = await errorOf(requestBooking(t.tenantId, { tourId: tour.id, date, adults: 1 }));
      expect(error.fieldErrors, date).toHaveProperty("date");
    }
  });

  it("refuses a departure whose span runs into a closure", async () => {
    const t = await createTenant();
    const tour = await createDepartureTour(t.tenantId, { durationDays: 3 });
    await createDeparture(t.tenantId, tour.id, "2027-03-10", 8);
    await createBlock(t.tenantId, { startDate: "2027-03-12", endDate: "2027-03-12", reason: "Guide away" });
    expect((await errorOf(requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10" }))).fieldErrors).toHaveProperty("date");
  });

  it("gives a private span to one party at a time, across two different private tours", async () => {
    const t = await createTenant();
    const grand = await createPrivateTour(t.tenantId, { durationDays: 8 });
    const wine = await createPrivateTour(t.tenantId, { durationDays: 2, title: "Private Wine Route" });

    const first = await requestBooking(t.tenantId, { tourId: grand.id, date: "2027-03-10", adults: 2 }); // 10th – 17th

    // Same tour, overlapping; other tour, overlapping at either edge and inside.
    const overlapping = [
      { tourId: grand.id, date: "2027-03-05" }, // 5th – 12th
      { tourId: grand.id, date: "2027-03-17" }, // 17th – 24th
      { tourId: wine.id, date: "2027-03-09" }, // 9th – 10th
      { tourId: wine.id, date: "2027-03-13" },
      { tourId: wine.id, date: "2027-03-17" }, // 17th – 18th
    ];
    for (const attempt of overlapping) {
      const error = await errorOf(requestBooking(t.tenantId, attempt));
      expect(error, JSON.stringify(attempt)).toBeInstanceOf(SlotTakenError);
      expect(error.code).toBe("slot_taken");
    }

    // Confirmed bookings block just the same.
    await asOwner(t, (scope) => confirmBooking(scope, first.bookingId, { now: NOW }));
    expect((await errorOf(requestBooking(t.tenantId, { tourId: wine.id, date: "2027-03-13" }))).code).toBe("slot_taken");

    // Directly before and after the span is free, on either tour.
    await requestBooking(t.tenantId, { tourId: wine.id, date: "2027-03-08" }); // 8th – 9th
    await requestBooking(t.tenantId, { tourId: grand.id, date: "2027-03-18" }); // 18th – 25th
    expect(await allBookings(t.tenantId)).toHaveLength(3);
  });

  it("frees the seats of a pending request once its hold has expired", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const priv = await createPrivateTour(t.tenantId, { durationDays: 3 });
    const slot = { tourId: tour.id, date: "2027-03-10", slotTime: "09:00", adults: 8 };
    await requestBooking(t.tenantId, slot);
    await requestBooking(t.tenantId, { tourId: priv.id, date: "2027-03-10" });

    // One minute before the 24-hour hold ends, both are still taken.
    const almost = { today: "2027-03-02", now: hoursAfter(24 - 1 / 60) };
    expect((await errorOf(requestBooking(t.tenantId, slot, almost))).code).toBe("slot_taken");
    expect((await errorOf(requestBooking(t.tenantId, { tourId: priv.id, date: "2027-03-11" }, almost))).code).toBe("slot_taken");

    // At the moment the hold ends the seats are free again, with no clean-up job needed.
    const after = { today: "2027-03-02", now: hoursAfter(24) };
    await requestBooking(t.tenantId, slot, after);
    await requestBooking(t.tenantId, { tourId: priv.id, date: "2027-03-11" }, after);
    expect(await allBookings(t.tenantId)).toHaveLength(4);
  });

  it("keeps a confirmed booking's seats however long ago its hold was", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const slot = { tourId: tour.id, date: "2027-03-20", slotTime: "09:00", adults: 8 };
    const first = await requestBooking(t.tenantId, slot);
    await asOwner(t, (scope) => confirmBooking(scope, first.bookingId, { now: NOW }));
    const muchLater = { today: "2027-03-10", now: hoursAfter(24 * 9) };
    expect((await errorOf(requestBooking(t.tenantId, slot, muchLater))).code).toBe("slot_taken");
  });
});

describe("createBookingRequest: plan limit", () => {
  it("stops at the plan's bookings per calendar month and starts again next month", async () => {
    const t = await createTenant({ plan: { maxBookingsPerMonth: 2 } });
    const tour = await createDayTour(t.tenantId);
    const base = { tourId: tour.id, slotTime: "09:00", adults: 1 };

    // One request from the end of February does not count towards March.
    await requestBooking(t.tenantId, { ...base, date: "2027-03-20" }, { today: "2027-02-28", now: new Date("2027-02-28T22:00:00Z") });
    await requestBooking(t.tenantId, { ...base, date: "2027-03-10" });
    await requestBooking(t.tenantId, { ...base, date: "2027-03-11" });

    const error = await errorOf(requestBooking(t.tenantId, { ...base, date: "2027-03-12" }));
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error).toMatchObject({ code: "plan_limit", limit: "maxBookingsPerMonth" });
    expect(await allBookings(t.tenantId)).toHaveLength(3);
    // The refused request left no customer profile either.
    expect(await allCustomers(t.tenantId)).toHaveLength(3);

    await requestBooking(t.tenantId, { ...base, date: "2027-04-12" }, { today: "2027-04-01", now: new Date("2027-04-01T08:00:00Z") });
    expect(await allBookings(t.tenantId)).toHaveLength(4);
  });

  it("counts lapsed requests too, and has no cap when the plan is unlimited", async () => {
    const limited = await createTenant({ plan: { maxBookingsPerMonth: 1 } });
    const tour = await createDayTour(limited.tenantId);
    await requestBooking(limited.tenantId, { tourId: tour.id, slotTime: "09:00" });
    // Even once that hold has lapsed, the month's allowance is used.
    const error = await errorOf(requestBooking(limited.tenantId, { tourId: tour.id, slotTime: "09:00" }, { today: "2027-03-03", now: hoursAfter(48) }));
    expect(error).toBeInstanceOf(LimitExceededError);

    const unlimited = await createTenant({ plan: { maxBookingsPerMonth: null } });
    const free = await createDayTour(unlimited.tenantId);
    for (const date of ["2027-03-10", "2027-03-11", "2027-03-12"]) {
      await requestBooking(unlimited.tenantId, { tourId: free.id, slotTime: "09:00", date });
    }
    expect(await allBookings(unlimited.tenantId)).toHaveLength(3);
  });
});

describe("createBookingRequest: customers", () => {
  it("reuses one profile per e-mail, whatever its letter case, and never lets the form rewrite it", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const email = `${unique("omar")}@example.test`;

    const first = await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", date: "2027-03-10", name: "Omar Haddad", email, phone: "+971 50 123 4567", country: "", language: "" });
    const second = await requestBooking(t.tenantId, {
      tourId: tour.id,
      slotTime: "09:00",
      date: "2027-03-11",
      name: "Somebody Else",
      email: email.toUpperCase(),
      phone: "+1 000 000 0000",
      country: "UAE",
      language: "Arabic",
      contactMethod: "phone",
    });

    const customers = await allCustomers(t.tenantId);
    expect(customers).toHaveLength(1);
    // Blank fields were filled in; the name, phone and contact preference staff may rely on were kept.
    expect(customers[0]).toMatchObject({ name: "Omar Haddad", email, phone: "+971 50 123 4567", country: "UAE", language: "Arabic", preferredContact: "email" });

    const rows = await allBookings(t.tenantId);
    expect(new Set(rows.map((row) => row.customerId))).toEqual(new Set([customers[0]!.id]));
    // Each booking keeps what was typed for it.
    expect(await bookingRow(t.tenantId, first.bookingId)).toMatchObject({ contactName: "Omar Haddad", contactPhone: "+971 50 123 4567" });
    expect(await bookingRow(t.tenantId, second.bookingId)).toMatchObject({ contactName: "Somebody Else", contactPhone: "+1 000 000 0000", contactEmail: email, contactMethod: "phone" });
  });
});

describe("createBookingRequest: discounts", () => {
  const discount = { source: "campaign" as const, refId: randomId(), label: "Autumn harvest — 15% off", amount: 3_600 };

  it("asks the engine with server-side figures, snapshots the result and consumes it", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId, { priceAdult: 12_000 });
    findBest.mockResolvedValue(discount);
    const email = `${unique("guest")}@example.test`;

    const result = await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", adults: 2, email: email.toUpperCase() });

    expect(findBest).toHaveBeenCalledTimes(1);
    const [scope, context] = findBest.mock.calls[0]!;
    expect(scope.tenantId).toBe(t.tenantId);
    expect(context).toEqual({ tourId: tour.id, email, adults: 2, children: 0, baseAmount: 24_000, travelDate: "2027-03-10", today: TODAY });

    expect(result.totals).toMatchObject({ baseAmount: 24_000, discountAmount: 3_600, totalAmount: 20_400, discountLabel: discount.label });
    expect(await bookingRow(t.tenantId, result.bookingId)).toMatchObject({
      discountAmount: 3_600,
      totalAmount: 20_400,
      discountSource: "campaign",
      discountRefId: discount.refId,
      discountLabel: discount.label,
    });
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls[0]![0].tenantId).toBe(t.tenantId);
    expect(consume.mock.calls[0]![1]).toEqual(discount);
    expect(consume.mock.calls[0]![2]).toBe(result.bookingId);
  });

  it("never lets a discount exceed the price or go negative", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId, { priceAdult: 12_000 });

    findBest.mockResolvedValue({ ...discount, amount: 999_999 });
    const capped = await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", adults: 1, date: "2027-03-10" });
    expect(capped.totals).toMatchObject({ discountAmount: 12_000, totalAmount: 0 });
    expect(consume.mock.calls[0]![1]).toMatchObject({ amount: 12_000 });

    findBest.mockResolvedValue({ ...discount, amount: 100.9 });
    const truncated = await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", adults: 1, date: "2027-03-11" });
    expect(truncated.totals).toMatchObject({ discountAmount: 100, totalAmount: 11_900 });

    consume.mockClear();
    for (const amount of [0, -500, Number.NaN, Number.POSITIVE_INFINITY]) {
      findBest.mockResolvedValue({ ...discount, amount });
      const result = await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "14:00", adults: 1, date: "2027-03-12" });
      expect(result.totals, String(amount)).toMatchObject({ discountAmount: 0, totalAmount: 12_000, discountLabel: null });
      expect((await bookingRow(t.tenantId, result.bookingId)).discountSource).toBeNull();
    }
    expect(consume).not.toHaveBeenCalled();
  });

  it("creates nothing when the discount cannot be consumed", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    findBest.mockResolvedValue({ ...discount, source: "personal" });
    consume.mockRejectedValue(new ConflictError("That discount was just used.", "discount_used"));

    const error = await errorOf(requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00" }));
    expect(error).toMatchObject({ code: "discount_used" });
    expect(await allBookings(t.tenantId)).toEqual([]);
    expect(await allCustomers(t.tenantId)).toEqual([]);
    expect(await auditActions(t.tenantId)).toEqual([]);
  });
});

describe("createBookingRequest: references", () => {
  it("draws again when a reference is taken, growing it rather than failing", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId, { slug: "old-city" });
    const stuck = (min: number) => min + 234;
    const base = { tourId: tour.id, slotTime: "09:00", adults: 1 };

    const first = await requestBooking(t.tenantId, base, { random: stuck });
    expect(first.reference).toBe("WF-OLD-1234");
    // Every four-digit draw collides, so the reference grows to six digits.
    const second = await requestBooking(t.tenantId, base, { random: stuck });
    expect(second.reference).toBe("WF-OLD-100234");
    // With both taken there is nothing left to draw.
    const error = await errorOf(requestBooking(t.tenantId, base, { random: stuck }));
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe("reference_unavailable");
    expect(await allBookings(t.tenantId)).toHaveLength(2);

    // A draw that collides once and then moves on.
    let calls = 0;
    const third = await requestBooking(t.tenantId, base, { random: (min) => min + (calls++ === 0 ? 234 : 777) });
    expect(third.reference).toBe("WF-OLD-1777");
  });

  it("lets two tenants hold the same reference", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const fixed = (min: number) => min + 4821;
    const tourA = await createDayTour(a.tenantId, { slug: "sheki" });
    const tourB = await createDayTour(b.tenantId, { slug: "sheki" });
    const inA = await requestBooking(a.tenantId, { tourId: tourA.id, slotTime: "09:00" }, { random: fixed });
    const inB = await requestBooking(b.tenantId, { tourId: tourB.id, slotTime: "09:00" }, { random: fixed });
    expect(inA.reference).toBe("WF-SHE-5821");
    expect(inB.reference).toBe("WF-SHE-5821");
  });
});
