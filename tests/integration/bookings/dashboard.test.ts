import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addBookingNote,
  BookingClashError,
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
  type BookingStatus,
} from "@/server/bookings/service";
import { withTenant, type TenantScope } from "@/server/db/context";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { enqueueNotification } from "@/server/notifications/index";
import {
  allBookings,
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
  seatsSold,
  TODAY,
} from "../../helpers/bookings";
import { createTenant, randomId, unique, type TenantFixture } from "../../helpers/fixtures";

vi.mock("@/server/promotions/engine", () => ({ findBestDiscount: vi.fn(async () => null), consumeDiscount: vi.fn(async () => undefined) }));
vi.mock("@/server/notifications/index", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

const notify = vi.mocked(enqueueNotification);
const notificationsFor = (tenantId: string) => notify.mock.calls.filter(([scope]) => scope.tenantId === tenantId).map(([, message]) => message);

beforeEach(() => {
  notify.mockReset().mockResolvedValue(undefined);
});

const ACTIONS = {
  confirm: (scope: TenantScope, id: string) => confirmBooking(scope, id, { now: NOW }),
  decline: (scope: TenantScope, id: string) => declineBooking(scope, id, { now: NOW }),
  cancel: (scope: TenantScope, id: string) => cancelBooking(scope, id, { kind: "by_business", reason: "Road closed" }, { now: NOW }),
  complete: (scope: TenantScope, id: string) => completeBooking(scope, id, { now: NOW }),
  reopen: (scope: TenantScope, id: string) => reopenBooking(scope, id, { now: NOW }),
} as const;
type Action = keyof typeof ACTIONS;

const RESULT: Record<Action, BookingStatus> = { confirm: "confirmed", decline: "cancelled", cancel: "cancelled", complete: "completed", reopen: "pending" };
const ALLOWED: Record<BookingStatus, Action[]> = { pending: ["confirm", "decline"], confirmed: ["cancel", "complete"], cancelled: ["reopen"], completed: [] };

/** A booking of a fresh day tour, walked to `status` through the real services. */
async function bookingIn(t: TenantFixture, status: BookingStatus, overrides: Record<string, unknown> = {}): Promise<string> {
  const tourId = (overrides.tourId as string | undefined) ?? (await createDayTour(t.tenantId)).id;
  const { bookingId } = await requestBooking(t.tenantId, { tourId, slotTime: "09:00", ...overrides });
  if (status === "cancelled") await asOwner(t, (scope) => ACTIONS.decline(scope, bookingId));
  if (status === "confirmed" || status === "completed") await asOwner(t, (scope) => ACTIONS.confirm(scope, bookingId));
  if (status === "completed") await asOwner(t, (scope) => ACTIONS.complete(scope, bookingId));
  return bookingId;
}

describe("booking status machine", () => {
  const statuses: BookingStatus[] = ["pending", "confirmed", "completed", "cancelled"];
  const cases = statuses.flatMap((from) => (Object.keys(ACTIONS) as Action[]).map((action) => [from, action, ALLOWED[from].includes(action)] as const));

  it.each(cases)("%s booking, %s → allowed: %s", async (from, action, allowed) => {
    const t = await createTenant();
    const id = await bookingIn(t, from);
    const before = await eventsOf(t.tenantId, id);

    if (allowed) {
      const updated = await asOwner(t, (scope) => ACTIONS[action](scope, id));
      expect(updated.status).toBe(RESULT[action]);
      expect((await bookingRow(t.tenantId, id)).status).toBe(RESULT[action]);
      // One new status entry, written by the acting user. Completing also
      // records that the customer was e-mailed a review link.
      const after = await eventsOf(t.tenantId, id);
      expect(after).toHaveLength(before.length + (action === "complete" ? 2 : 1));
      expect(after[before.length]).toMatchObject({ kind: "status", actorId: t.ownerId });
      if (action === "complete") expect(after.at(-1)).toMatchObject({ kind: "notification", message: "Review link e-mailed to the customer." });
    } else {
      const error = await errorOf(asOwner(t, (scope) => ACTIONS[action](scope, id)));
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.code).toBe("invalid_transition");
      expect(error.message).toContain(`A ${from} booking cannot be`);
      expect((await bookingRow(t.tenantId, id)).status).toBe(from);
      expect(await eventsOf(t.tenantId, id)).toHaveLength(before.length);
    }
  });

  it("confirms: clears the hold, stamps the time, logs, audits and tells the customer", async () => {
    const t = await createTenant({ name: "Aurelia Journeys" });
    const id = await bookingIn(t, "pending");
    notify.mockClear();

    const confirmed = await asOwner(t, (scope) => confirmBooking(scope, id, { now: hoursAfter(2) }));
    expect(confirmed).toMatchObject({ status: "confirmed", holdExpiresAt: null, confirmedAt: hoursAfter(2), slotTime: "09:00" });
    expect((await eventsOf(t.tenantId, id)).at(-1)).toEqual({ kind: "status", message: "Booking confirmed.", actorId: t.ownerId });
    expect((await auditActions(t.tenantId, id)).at(-1)).toMatchObject({
      action: "booking.confirmed",
      actorType: "user",
      metadata: { reference: confirmed.reference, forced: false, clashes: [] },
    });
    const [message] = notificationsFor(t.tenantId);
    expect(notificationsFor(t.tenantId)).toHaveLength(1);
    expect(message).toMatchObject({ kind: "booking.confirmed", toEmail: confirmed.contactEmail, relatedId: id });
    expect(message!.subject).toContain(confirmed.reference);
    expect(message!.bodyText).toContain("Aurelia Journeys");
    expect(message!.bodyText).toContain(confirmed.tourTitle);
  });

  it("declines with an optional reason and releases the seats at once", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const full = { tourId: tour.id, slotTime: "09:00", adults: 8 };
    const first = await bookingIn(t, "pending", full);
    const second = await bookingIn(t, "pending", { ...full, slotTime: "14:00" });
    notify.mockClear();

    const declined = await asOwner(t, (scope) => declineBooking(scope, first, { reason: "  Guide unavailable ", now: hoursAfter(1) }));
    expect(declined).toMatchObject({ status: "cancelled", cancelKind: "declined", cancelReason: "Guide unavailable", cancelledAt: hoursAfter(1), holdExpiresAt: null });
    expect((await eventsOf(t.tenantId, first)).at(-1)!.message).toBe("Request declined. Reason: Guide unavailable");
    expect((await auditActions(t.tenantId, first)).at(-1)).toMatchObject({ action: "booking.cancelled", metadata: { kind: "declined", from: "pending" } });
    expect(notificationsFor(t.tenantId)[0]).toMatchObject({ kind: "booking.cancelled", toEmail: declined.contactEmail, relatedId: first, subject: expect.stringContaining(declined.reference) });
    expect(notificationsFor(t.tenantId)[0]!.bodyText).toContain("Reason: Guide unavailable");

    const plain = await asOwner(t, (scope) => declineBooking(scope, second));
    expect(plain).toMatchObject({ cancelKind: "declined", cancelReason: null });
    expect((await eventsOf(t.tenantId, second)).at(-1)!.message).toBe("Request declined.");

    // The slot the declined request held can be sold again straight away.
    await requestBooking(t.tenantId, full);
    expect(await errorOf(asOwner(t, (scope) => declineBooking(scope, first, { reason: "x".repeat(501) })))).toBeInstanceOf(ValidationError);
  });

  it("cancels a confirmed booking only with a kind and a reason", async () => {
    const t = await createTenant();
    const byBusiness = await bookingIn(t, "confirmed");
    const byCustomer = await bookingIn(t, "confirmed");
    notify.mockClear();

    for (const bad of [{ kind: "by_business", reason: " " }, { kind: "expired", reason: "x" }, { kind: "declined", reason: "x" }, { reason: "x" }]) {
      const error = await errorOf(asOwner(t, (scope) => cancelBooking(scope, byBusiness, bad as never)));
      expect(error, JSON.stringify(bad)).toBeInstanceOf(ValidationError);
    }
    expect((await bookingRow(t.tenantId, byBusiness)).status).toBe("confirmed");

    const a = await asOwner(t, (scope) => cancelBooking(scope, byBusiness, { kind: "by_business", reason: "Road closed" }, { now: hoursAfter(3) }));
    expect(a).toMatchObject({ status: "cancelled", cancelKind: "by_business", cancelReason: "Road closed", cancelledAt: hoursAfter(3) });
    expect((await eventsOf(t.tenantId, byBusiness)).at(-1)!.message).toBe("Booking cancelled by the business. Reason: Road closed");

    const b = await asOwner(t, (scope) => cancelBooking(scope, byCustomer, { kind: "by_customer", reason: "Flight cancelled" }));
    expect(b).toMatchObject({ cancelKind: "by_customer", cancelReason: "Flight cancelled" });
    expect((await eventsOf(t.tenantId, byCustomer)).at(-1)!.message).toContain("at the customer's request");

    const messages = notificationsFor(t.tenantId);
    expect(messages.map((message) => message.kind)).toEqual(["booking.cancelled", "booking.cancelled"]);
    expect(messages[0]).toMatchObject({ toEmail: a.contactEmail, relatedId: byBusiness });
    expect(messages[0]!.bodyText).toContain("Reason: Road closed");
    expect(messages[1]).toMatchObject({ toEmail: b.contactEmail, relatedId: byCustomer });
    expect(messages[1]!.bodyText).toContain("Reason: Flight cancelled");
    // The two kinds of cancellation are worded differently.
    expect(messages[0]!.bodyText.split("\n")[2]).not.toBe(messages[1]!.bodyText.split("\n")[2]);
  });

  it("completes a confirmed booking and then refuses everything else", async () => {
    const t = await createTenant();
    const id = await bookingIn(t, "confirmed");
    notify.mockClear();
    const completed = await asOwner(t, (scope) => completeBooking(scope, id, { now: hoursAfter(5) }));
    expect(completed).toMatchObject({ status: "completed", completedAt: hoursAfter(5) });
    const actions = (await auditActions(t.tenantId, id)).map((entry) => entry.action);
    expect(actions.slice(-3)).toEqual(["booking.completed", "review_request.issued", "booking.review_requested"]);
    // The only message is the review request to the customer.
    expect(notificationsFor(t.tenantId).map((message) => message.kind)).toEqual(["review.requested"]);
    const error = await errorOf(asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-03-12" })));
    expect(error.code).toBe("invalid_transition");
  });

  it("reopens a cancelled booking with a fresh hold, only while it still fits", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    const slot = { tourId: tour.id, date: "2027-03-10", slotTime: "09:00", adults: 6 };
    const fits = await bookingIn(t, "cancelled", slot);
    notify.mockClear();

    const reopened = await asOwner(t, (scope) => reopenBooking(scope, fits, { now: hoursAfter(10) }));
    expect(reopened).toMatchObject({ status: "pending", cancelKind: null, cancelReason: null, cancelledAt: null, confirmedAt: null, holdExpiresAt: hoursAfter(34) });
    expect((await eventsOf(t.tenantId, fits)).at(-1)!.message).toContain("Reopened as pending.");
    expect((await auditActions(t.tenantId, fits)).at(-1)).toMatchObject({ action: "booking.reopened" });
    expect(notificationsFor(t.tenantId)).toEqual([]);
    // Reopened, it holds its seats again.
    expect((await errorOf(requestBooking(t.tenantId, { ...slot, adults: 3 }, { today: TODAY, now: hoursAfter(11) }))).code).toBe("slot_taken");

    // A second cancelled request whose seats were sold meanwhile cannot come back.
    const gone = await bookingIn(t, "cancelled", { ...slot, slotTime: "14:00" });
    await requestBooking(t.tenantId, { ...slot, slotTime: "14:00", adults: 4 });
    const error = await errorOf(asOwner(t, (scope) => reopenBooking(scope, gone, { now: NOW })));
    expect(error).toBeInstanceOf(BookingClashError);
    expect(error.code).toBe("booking_clash");
    expect(error.message).toContain("Over capacity: 10 of 8 seats");
    expect((await bookingRow(t.tenantId, gone)).status).toBe("cancelled");
  });

  it("answers not found for unknown and malformed booking ids on every action", async () => {
    const t = await createTenant();
    for (const id of [randomId(), "42", ""]) {
      for (const action of Object.keys(ACTIONS) as Action[]) {
        expect(await errorOf(asOwner(t, (scope) => ACTIONS[action](scope, id))), `${action} ${id}`).toBeInstanceOf(NotFoundError);
      }
      expect(await errorOf(asOwner(t, (scope) => getBooking(scope, id)))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-03-12" })))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(asOwner(t, (scope) => updatePaymentStatus(scope, id, { paymentStatus: "paid" })))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(asOwner(t, (scope) => addBookingNote(scope, id, "hello")))).toBeInstanceOf(NotFoundError);
    }
  });
});

describe("clashes: confirm, force and the conflict banner", () => {
  /** Two requests for 5 seats on one 8-seat slot; the second only fit because the first hold lapsed. */
  async function overbookedSlot(t: TenantFixture) {
    const tour = await createDayTour(t.tenantId);
    const slot = { tourId: tour.id, date: "2027-03-20", slotTime: "14:00", adults: 5 };
    const marco = await requestBooking(t.tenantId, { ...slot, name: "Marco Rossi" });
    const claire = await requestBooking(t.tenantId, { ...slot, name: "Claire Dubois" }, { today: "2027-03-02", now: hoursAfter(30) });
    return { tour, marco: marco.bookingId, claire: claire.bookingId, later: hoursAfter(31) };
  }

  it("refuses to confirm into a clash, and confirms with force while logging it", async () => {
    const t = await createTenant();
    const { marco, claire, later } = await overbookedSlot(t);
    await asOwner(t, (scope) => confirmBooking(scope, claire, { now: later }));
    notify.mockClear();

    const error = (await errorOf(asOwner(t, (scope) => confirmBooking(scope, marco, { now: later })))) as BookingClashError;
    expect(error).toBeInstanceOf(BookingClashError);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe("booking_clash");
    expect(error.clashes).toEqual(["Over capacity: 10 of 8 seats on 2027-03-20 at 14:00 with Claire Dubois (confirmed, 5)"]);
    expect((await bookingRow(t.tenantId, marco)).status).toBe("pending");
    expect(notificationsFor(t.tenantId)).toEqual([]);

    const forced = await asOwner(t, (scope) => confirmBooking(scope, marco, { now: later, force: true }));
    expect(forced.status).toBe("confirmed");
    expect((await eventsOf(t.tenantId, marco)).at(-1)!.message).toBe("Booking confirmed despite a scheduling clash.");
    expect((await auditActions(t.tenantId, marco)).at(-1)).toMatchObject({
      action: "booking.confirmed",
      metadata: { forced: true, clashes: [expect.stringContaining("Over capacity: 10 of 8")] },
    });
    expect(notificationsFor(t.tenantId).map((message) => message.kind)).toEqual(["booking.confirmed"]);
    expect(await seatsSold(t.tenantId, later)).toBe(10);
  });

  it("lists both sides of a clash for the banner, on the list rows and on the detail panel", async () => {
    const t = await createTenant();
    const { marco, claire, later } = await overbookedSlot(t);
    const calm = await bookingIn(t, "pending", { date: "2027-03-25" });
    await asOwner(t, (scope) => confirmBooking(scope, claire, { now: later }));
    await asOwner(t, (scope) => confirmBooking(scope, marco, { now: later, force: true }));

    const clashes = await asOwner(t, (scope) => findClashes(scope, { now: later }));
    expect(clashes.map((entry) => entry.bookingId).sort()).toEqual([marco, claire].sort());
    expect(clashes.find((entry) => entry.bookingId === claire)!.clashes[0]).toMatchObject({
      type: "over_capacity",
      seats: 10,
      capacity: 8,
      with: [expect.objectContaining({ id: marco, name: "Marco Rossi", seats: 5 })],
    });

    const list = await asOwner(t, (scope) => listBookings(scope, {}, { now: later }));
    expect(list.total).toBe(3);
    const flagged = Object.fromEntries(list.rows.map((row) => [row.id, row.clashes.length]));
    expect(flagged).toEqual({ [marco]: 1, [claire]: 1, [calm]: 0 });

    const only = await asOwner(t, (scope) => listBookings(scope, { clashOnly: true }, { now: later }));
    expect(only.rows.map((row) => row.id).sort()).toEqual([marco, claire].sort());
    expect(only.total).toBe(2);
    // Tab counts ignore the conflicts-only toggle.
    expect(only.counts).toEqual({ all: 3, pending: 1, confirmed: 2, completed: 0, cancelled: 0 });

    const detail = await asOwner(t, (scope) => getBooking(scope, marco, { now: later }));
    expect(detail.clashes).toHaveLength(1);
    expect((await asOwner(t, (scope) => getBooking(scope, calm, { now: later }))).clashes).toEqual([]);

    // Cancelling one side resolves the conflict everywhere.
    await asOwner(t, (scope) => cancelBooking(scope, marco, { kind: "by_business", reason: "Double booked" }));
    expect(await asOwner(t, (scope) => findClashes(scope, { now: later }))).toEqual([]);
    const none = await asOwner(t, (scope) => listBookings(scope, { clashOnly: true }, { now: later }));
    expect(none).toMatchObject({ rows: [], total: 0 });
    // An export of "conflicts only" is then just the header row.
    expect((await asOwner(t, (scope) => exportBookingsCsv(scope, { clashOnly: true }, { now: later }))).trimEnd().split("\r\n")).toHaveLength(1);
  });

  it("flags over-full departures and overlapping private tours of different tours", async () => {
    const t = await createTenant();
    const dep = await createDepartureTour(t.tenantId);
    const departure = await createDeparture(t.tenantId, dep.id, "2027-03-20", 8);
    const grand = await createPrivateTour(t.tenantId, { durationDays: 8 });
    const wine = await createPrivateTour(t.tenantId, { durationDays: 2, title: "Private Wine Route" });

    // Each second request only fits because the first one's hold has lapsed.
    const late = { today: "2027-03-02", now: hoursAfter(30) };
    const d1 = await requestBooking(t.tenantId, { tourId: dep.id, date: "2027-03-20", adults: 6 });
    const d2 = await requestBooking(t.tenantId, { tourId: dep.id, date: "2027-03-20", adults: 6 }, late);
    const p1 = await requestBooking(t.tenantId, { tourId: grand.id, date: "2027-06-14", name: "Thomas Becker" });
    const p2 = await requestBooking(t.tenantId, { tourId: wine.id, date: "2027-06-16", name: "Rachel Green" }, late);
    const later = hoursAfter(31);
    for (const booking of [d1, p1]) await asOwner(t, (scope) => confirmBooking(scope, booking.bookingId, { now: later, force: true }));

    const clashes = await asOwner(t, (scope) => findClashes(scope, { now: later }));
    expect(clashes.map((entry) => entry.bookingId).sort()).toEqual([d1, d2, p1, p2].map((b) => b.bookingId).sort());
    const messageOf = (id: string) => clashes.find((entry) => entry.bookingId === id)!.clashes.map((clash) => clash.message);
    expect(messageOf(d2.bookingId)[0]).toContain("Over capacity: 12 of 8 seats on 2027-03-20 with");
    expect(messageOf(p2.bookingId)).toEqual(["Overlaps Thomas Becker’s private tour (2027-06-14 – 2027-06-21, confirmed)"]);
    expect(messageOf(p1.bookingId)).toEqual(["Overlaps Rachel Green’s private tour (2027-06-16 – 2027-06-17, pending)"]);

    // Confirming the second private request needs force too.
    expect(await errorOf(asOwner(t, (scope) => confirmBooking(scope, p2.bookingId, { now: later })))).toBeInstanceOf(BookingClashError);
    expect((await bookingRow(t.tenantId, d2.bookingId)).departureId).toBe(departure.id);
  });
});

describe("rescheduleBooking", () => {
  it("moves a day booking to another date and start time, and tells the customer", async () => {
    const t = await createTenant();
    const id = await bookingIn(t, "confirmed", { date: "2027-03-10", slotTime: "09:00" });
    notify.mockClear();

    const moved = await asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-03-12", slotTime: "14:00" }, { now: NOW }));
    expect(moved).toMatchObject({ startDate: "2027-03-12", endDate: "2027-03-12", slotTime: "14:00", status: "confirmed" });
    expect((await eventsOf(t.tenantId, id)).at(-1)).toEqual({
      kind: "reschedule",
      message: "Date changed from 2027-03-10 at 09:00 to 2027-03-12 at 14:00.",
      actorId: t.ownerId,
    });
    expect((await auditActions(t.tenantId, id)).at(-1)).toMatchObject({ action: "booking.rescheduled", metadata: { from: "2027-03-10", to: "2027-03-12", forced: false } });
    const [message] = notificationsFor(t.tenantId);
    expect(message).toMatchObject({ kind: "booking.rescheduled", relatedId: id });
    expect(message!.bodyText).toContain("10 Mar 2027 at 09:00");
    expect(message!.bodyText).toContain("12 Mar 2027 at 14:00");

    // Omitting the time keeps it; staff may even pick a past date for their records.
    const again = await asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-02-20" }));
    expect(again).toMatchObject({ startDate: "2027-02-20", slotTime: "14:00" });
  });

  it("validates the target: real start times, real departures, an actual change", async () => {
    const t = await createTenant();
    const dayId = await bookingIn(t, "pending", { date: "2027-03-10", slotTime: "09:00" });
    const dep = await createDepartureTour(t.tenantId);
    await createDeparture(t.tenantId, dep.id, "2027-03-10", 8);
    const depId = await bookingIn(t, "pending", { tourId: dep.id, date: "2027-03-10", slotTime: undefined });

    const reschedule = (id: string, input: Record<string, unknown>) => errorOf(asOwner(t, (scope) => rescheduleBooking(scope, id, input as never)));
    expect((await reschedule(dayId, { date: "2027-03-12", slotTime: "18:00" })).fieldErrors).toHaveProperty("slotTime");
    expect((await reschedule(dayId, { date: "2027-03-10" })).fieldErrors).toEqual({ date: ["The booking is already on that date."] });
    expect((await reschedule(dayId, { date: "2027-03-10", slotTime: "09:00" })).fieldErrors).toHaveProperty("date");
    expect((await reschedule(dayId, { date: "12 March" })).fieldErrors).toHaveProperty("date");
    expect((await reschedule(depId, { date: "2027-03-11" })).fieldErrors).toEqual({ date: ["This tour has no departure on that date."] });
    expect((await bookingRow(t.tenantId, dayId)).startDate).toBe("2027-03-10");
  });

  it("needs force to overbook a slot, and records that the clash was acknowledged", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-12", slotTime: "09:00", adults: 6, name: "Claire Dubois" });
    const id = await bookingIn(t, "confirmed", { tourId: tour.id, date: "2027-03-10", slotTime: "09:00", adults: 4 });
    notify.mockClear();

    const error = (await errorOf(asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-03-12" }, { now: NOW })))) as BookingClashError;
    expect(error).toBeInstanceOf(BookingClashError);
    expect(error.clashes).toEqual(["Over capacity: 10 of 8 seats on 2027-03-12 at 09:00 with Claire Dubois (pending, 6)"]);
    expect((await bookingRow(t.tenantId, id)).startDate).toBe("2027-03-10");
    expect(notificationsFor(t.tenantId)).toEqual([]);

    // The other start time has room, so no force is needed there.
    await asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-03-12", slotTime: "14:00" }, { now: NOW }));
    const forced = await asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-03-12", slotTime: "09:00", force: true }, { now: NOW }));
    expect(forced).toMatchObject({ startDate: "2027-03-12", slotTime: "09:00" });
    expect((await eventsOf(t.tenantId, id)).at(-1)!.message).toBe("Date changed from 2027-03-12 at 14:00 to 2027-03-12 at 09:00 (clash acknowledged).");
    expect((await auditActions(t.tenantId, id)).at(-1)).toMatchObject({ metadata: { forced: true } });
  });

  it("moves a departure booking onto another departure, warning about closed ones and closures", async () => {
    const t = await createTenant();
    const tour = await createDepartureTour(t.tenantId, { durationDays: 3 });
    await createDeparture(t.tenantId, tour.id, "2027-03-10", 8);
    const open = await createDeparture(t.tenantId, tour.id, "2027-03-17", 8);
    const closed = await createDeparture(t.tenantId, tour.id, "2027-03-24", 8, false);
    const blocked = await createDeparture(t.tenantId, tour.id, "2027-04-07", 8);
    await createBlock(t.tenantId, { startDate: "2027-04-09", endDate: "2027-04-10", reason: "Novruz" });
    const id = await bookingIn(t, "pending", { tourId: tour.id, date: "2027-03-10", slotTime: undefined, adults: 2 });

    const moved = await asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-03-17" }, { now: NOW }));
    expect(moved).toMatchObject({ startDate: "2027-03-17", endDate: "2027-03-19", departureId: open.id, slotTime: null });

    const toClosed = (await errorOf(asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-03-24" }, { now: NOW })))) as BookingClashError;
    expect(toClosed.clashes).toEqual(["The departure on 2027-03-24 is closed for booking"]);
    const toBlocked = (await errorOf(asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-04-07" }, { now: NOW })))) as BookingClashError;
    expect(toBlocked.clashes).toEqual(["Closed 2027-04-09 – 2027-04-10 (Novruz)"]);

    const forced = await asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-03-24", force: true }, { now: NOW }));
    expect(forced.departureId).toBe(closed.id);
    expect((await asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-04-07", force: true }, { now: NOW }))).departureId).toBe(blocked.id);
  });

  it("checks a private booking against every private booking of the tenant", async () => {
    const t = await createTenant();
    const grand = await createPrivateTour(t.tenantId, { durationDays: 8 });
    const wine = await createPrivateTour(t.tenantId, { durationDays: 2, title: "Private Wine Route" });
    await requestBooking(t.tenantId, { tourId: grand.id, date: "2027-06-14", name: "Thomas Becker" });
    await createBlock(t.tenantId, { tourId: wine.id, startDate: "2027-07-02", endDate: "2027-07-02" });
    const id = await bookingIn(t, "pending", { tourId: wine.id, date: "2027-06-01", slotTime: undefined });

    const error = (await errorOf(asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-06-20" }, { now: NOW })))) as BookingClashError;
    expect(error.clashes).toEqual(["Overlaps Thomas Becker’s private tour (2027-06-14 – 2027-06-21, pending)"]);
    const closure = (await errorOf(asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-07-01" }, { now: NOW })))) as BookingClashError;
    expect(closure.clashes).toEqual(["Closed 2027-07-02 – 2027-07-02"]);

    const moved = await asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-06-22" }, { now: NOW }));
    expect(moved).toMatchObject({ startDate: "2027-06-22", endDate: "2027-06-23" });
  });

  it("moves a cancelled booking quietly: no seat check and no message until it is reopened", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId);
    await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-12", slotTime: "09:00", adults: 8 });
    const id = await bookingIn(t, "cancelled", { tourId: tour.id, date: "2027-03-10", slotTime: "09:00", adults: 2 });
    notify.mockClear();

    const moved = await asOwner(t, (scope) => rescheduleBooking(scope, id, { date: "2027-03-12" }, { now: NOW }));
    expect(moved).toMatchObject({ status: "cancelled", startDate: "2027-03-12" });
    expect(notificationsFor(t.tenantId)).toEqual([]);
    // Reopening is where the full slot stops it.
    expect(await errorOf(asOwner(t, (scope) => reopenBooking(scope, id, { now: NOW })))).toBeInstanceOf(BookingClashError);
  });
});

describe("payments and notes", () => {
  it("records unpaid, deposit, paid and refunded with consistent amounts", async () => {
    const t = await createTenant();
    const id = await bookingIn(t, "confirmed", { adults: 2 }); // total 24 000
    notify.mockClear();
    const pay = (input: Record<string, unknown>) => asOwner(t, (scope) => updatePaymentStatus(scope, id, input as never));

    expect(await pay({ paymentStatus: "deposit_paid", amountPaid: 5_000 })).toMatchObject({ paymentStatus: "deposit_paid", amountPaid: 5_000 });
    expect((await eventsOf(t.tenantId, id)).at(-1)).toEqual({
      kind: "payment",
      message: "Payment marked deposit paid: 50.00 of 240.00 USD received.",
      actorId: t.ownerId,
    });
    expect((await auditActions(t.tenantId, id)).at(-1)).toMatchObject({
      action: "booking.payment_updated",
      metadata: { paymentStatus: "deposit_paid", amountPaid: 5_000, previousStatus: "unpaid", previousAmountPaid: 0 },
    });

    expect(await pay({ paymentStatus: "paid" })).toMatchObject({ paymentStatus: "paid", amountPaid: 24_000 });
    expect(await pay({ paymentStatus: "refunded" })).toMatchObject({ paymentStatus: "refunded", amountPaid: 24_000 });
    expect(await pay({ paymentStatus: "refunded", amountPaid: 0 })).toMatchObject({ paymentStatus: "refunded", amountPaid: 0 });
    expect(await pay({ paymentStatus: "unpaid" })).toMatchObject({ paymentStatus: "unpaid", amountPaid: 0 });
    expect(await pay({ paymentStatus: "paid", amountPaid: 24_000 })).toMatchObject({ paymentStatus: "paid", amountPaid: 24_000 });
    // Payment changes are internal; the customer gets no automatic message.
    expect(notificationsFor(t.tenantId)).toEqual([]);

    for (const bad of [
      { paymentStatus: "paid", amountPaid: 24_001 },
      { paymentStatus: "deposit_paid", amountPaid: 24_001 },
      { paymentStatus: "paid", amountPaid: 10_000 },
      { paymentStatus: "unpaid", amountPaid: 1 },
      { paymentStatus: "deposit_paid", amountPaid: 0 },
      { paymentStatus: "deposit_paid", amountPaid: -5 },
      { paymentStatus: "deposit_paid", amountPaid: 10.5 },
      { paymentStatus: "comped" },
      {},
    ]) {
      expect(await errorOf(pay(bad)), JSON.stringify(bad)).toBeInstanceOf(ValidationError);
    }
    expect(await bookingRow(t.tenantId, id)).toMatchObject({ paymentStatus: "paid", amountPaid: 24_000 });
  });

  it("keeps internal notes on the timeline with their author", async () => {
    const t = await createTenant();
    const id = await bookingIn(t, "pending");
    notify.mockClear();

    const note = await asOwner(t, (scope) => addBookingNote(scope, id, "  Vegetarian; asked about the halva class  "));
    expect(note).toMatchObject({ kind: "note", message: "Vegetarian; asked about the halva class", actorId: t.ownerId });
    expect(await errorOf(asOwner(t, (scope) => addBookingNote(scope, id, "   ")))).toBeInstanceOf(ValidationError);
    expect(await errorOf(asOwner(t, (scope) => addBookingNote(scope, id, "x".repeat(2001))))).toBeInstanceOf(ValidationError);

    const detail = await asOwner(t, (scope) => getBooking(scope, id, { now: NOW }));
    expect(detail.events.map((event) => event.kind)).toEqual(["note", "created"]);
    expect(detail.events[0]).toMatchObject({ id: note.id, message: "Vegetarian; asked about the halva class", actorId: t.ownerId, actorName: "Test User" });
    expect(detail.events[1]).toMatchObject({ actorId: null, actorName: null });
    // The audit log records that a note was added, not what it says.
    const audit = (await auditActions(t.tenantId, id)).at(-1)!;
    expect(audit).toMatchObject({ action: "booking.note_added", metadata: { eventId: note.id } });
    expect(JSON.stringify(audit.metadata)).not.toContain("Vegetarian");
    expect(notificationsFor(t.tenantId)).toEqual([]);
  });
});

describe("expireStaleHolds", () => {
  it("cancels only pending requests whose hold has run out, once", async () => {
    const t = await createTenant({ name: "Aurelia Journeys" });
    const tour = await createDayTour(t.tenantId);
    const stale = await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10", slotTime: "09:00", adults: 8 });
    const confirmed = await bookingIn(t, "confirmed", { tourId: tour.id, date: "2027-03-11" });
    const declined = await bookingIn(t, "cancelled", { tourId: tour.id, date: "2027-03-12" });
    const fresh = await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-13", slotTime: "09:00" }, { today: "2027-03-02", now: hoursAfter(20) });
    notify.mockClear();

    // Nothing has lapsed after 23 hours.
    expect(await asOwner(t, (scope) => expireStaleHolds(scope, hoursAfter(23)))).toBe(0);
    expect(notificationsFor(t.tenantId)).toEqual([]);

    // A scheduled job has no user: the entries are attributed to the system.
    expect(await withTenant(t.tenantId, (scope) => expireStaleHolds(scope, hoursAfter(24)))).toBe(1);

    expect(await bookingRow(t.tenantId, stale.bookingId)).toMatchObject({
      status: "cancelled",
      cancelKind: "expired",
      cancelReason: "The hold expired before the request was confirmed.",
      cancelledAt: hoursAfter(24),
    });
    expect((await eventsOf(t.tenantId, stale.bookingId)).at(-1)).toEqual({ kind: "status", message: "Hold expired; request cancelled automatically.", actorId: null });
    expect((await auditActions(t.tenantId, stale.bookingId)).at(-1)).toMatchObject({ action: "booking.expired", actorType: "system", metadata: { kind: "expired" } });
    const messages = notificationsFor(t.tenantId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ kind: "booking.cancelled", relatedId: stale.bookingId });
    expect(messages[0]!.subject).toContain(stale.reference);
    expect(messages[0]!.bodyText).toContain("Aurelia Journeys");

    expect((await bookingRow(t.tenantId, confirmed)).status).toBe("confirmed");
    expect(await bookingRow(t.tenantId, declined)).toMatchObject({ status: "cancelled", cancelKind: "declined" });
    expect((await bookingRow(t.tenantId, fresh.bookingId)).status).toBe("pending");

    // Running it again changes nothing; the freed slot can be sold.
    expect(await asOwner(t, (scope) => expireStaleHolds(scope, hoursAfter(24)))).toBe(0);
    await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10", slotTime: "09:00", adults: 8 }, { today: "2027-03-02", now: hoursAfter(24) });
    // An expired request can be reopened like any other cancelled one, if it still fits.
    expect(await errorOf(asOwner(t, (scope) => reopenBooking(scope, stale.bookingId, { now: hoursAfter(25) })))).toBeInstanceOf(BookingClashError);
    expect(await asOwner(t, (scope) => expireStaleHolds(scope))).toBe(0);
  });
});

describe("listBookings and getBooking", () => {
  async function seeded() {
    const t = await createTenant();
    const walk = await createDayTour(t.tenantId, { title: "Old City Walk" });
    const food = await createDayTour(t.tenantId, { title: "Food & Wine Evening", priceAdult: 8_500 });
    const tag = unique("x");
    const at = (minutes: number) => ({ today: TODAY, now: new Date(NOW.getTime() + minutes * 60_000) });
    const eleanor = await requestBooking(t.tenantId, { tourId: walk.id, date: "2027-03-12", slotTime: "09:00", name: "Eleanor Whitfield", email: `eleanor-${tag}@example.test` }, at(0));
    const kenji = await requestBooking(t.tenantId, { tourId: walk.id, date: "2027-03-10", slotTime: "14:00", name: "Kenji Watanabe", email: `kenji-${tag}@example.test` }, at(1));
    const priya = await requestBooking(t.tenantId, { tourId: food.id, date: "2027-03-18", slotTime: "09:00", name: "Priya Raman", email: `priya-${tag}@example.test` }, at(2));
    const omar = await requestBooking(t.tenantId, { tourId: food.id, date: "2027-04-02", slotTime: "09:00", name: "Omar 100%_Haddad", email: `omar-${tag}@example.test` }, at(3));
    await asOwner(t, (scope) => confirmBooking(scope, kenji.bookingId, { now: NOW }));
    await asOwner(t, (scope) => confirmBooking(scope, priya.bookingId, { now: NOW }));
    await asOwner(t, (scope) => completeBooking(scope, priya.bookingId));
    await asOwner(t, (scope) => declineBooking(scope, omar.bookingId));
    await asOwner(t, (scope) => updatePaymentStatus(scope, kenji.bookingId, { paymentStatus: "paid" }));
    return { t, walk, food, tag, eleanor, kenji, priya, omar };
  }
  const list = (t: TenantFixture, input: Record<string, unknown> = {}) => asOwner(t, (scope) => listBookings(scope, input as never, { now: NOW }));
  const names = (result: { rows: { contactName: string }[] }) => result.rows.map((row) => row.contactName.split(" ")[0]);

  it("lists newest first by default, with tab counts", async () => {
    const { t } = await seeded();
    const all = await list(t);
    expect(names(all)).toEqual(["Omar", "Priya", "Kenji", "Eleanor"]);
    expect(all.total).toBe(4);
    expect(all.counts).toEqual({ all: 4, pending: 1, confirmed: 1, completed: 1, cancelled: 1 });
    expect(all.rows.every((row) => row.tenantId === t.tenantId && Array.isArray(row.clashes))).toBe(true);
    expect(all.rows[2]).toMatchObject({ slotTime: "14:00", status: "confirmed", paymentStatus: "paid" });
  });

  it("sorts and pages", async () => {
    const { t } = await seeded();
    expect(names(await list(t, { sort: "oldest" }))).toEqual(["Eleanor", "Kenji", "Priya", "Omar"]);
    expect(names(await list(t, { sort: "date_asc" }))).toEqual(["Kenji", "Eleanor", "Priya", "Omar"]);
    expect(names(await list(t, { sort: "date_desc" }))).toEqual(["Omar", "Priya", "Eleanor", "Kenji"]);

    const page = await list(t, { sort: "date_asc", limit: 2, offset: 1 });
    expect(names(page)).toEqual(["Eleanor", "Priya"]);
    expect(page.total).toBe(4);
    expect(names(await list(t, { sort: "date_asc", limit: 2, offset: 4 }))).toEqual([]);
  });

  it("filters by status, tour, payment and tour date, keeping tab counts independent of the status tab", async () => {
    const { t, food, walk } = await seeded();
    for (const status of ["pending", "confirmed", "completed", "cancelled"] as const) {
      const result = await list(t, { status });
      expect(result.rows.map((row) => row.status)).toEqual([status]);
      expect(result.total).toBe(1);
      expect(result.counts.all).toBe(4);
    }
    const byTour = await list(t, { tourId: food.id });
    expect(names(byTour)).toEqual(["Omar", "Priya"]);
    expect(byTour.counts).toEqual({ all: 2, pending: 0, confirmed: 0, completed: 1, cancelled: 1 });
    expect(names(await list(t, { tourId: walk.id, status: "confirmed" }))).toEqual(["Kenji"]);
    expect(names(await list(t, { payment: "paid" }))).toEqual(["Kenji"]);
    expect(names(await list(t, { payment: "unpaid", sort: "oldest" }))).toEqual(["Eleanor", "Priya", "Omar"]);
    expect(names(await list(t, { from: "2027-03-12", to: "2027-03-18", sort: "date_asc" }))).toEqual(["Eleanor", "Priya"]);
    expect(names(await list(t, { from: "2027-03-19" }))).toEqual(["Omar"]);
    expect(names(await list(t, { to: "2027-03-10" }))).toEqual(["Kenji"]);
    expect(await list(t, { tourId: randomId() })).toMatchObject({ rows: [], total: 0, counts: { all: 0 } });
  });

  it("searches reference, name, e-mail and tour title, treating wildcards as plain text", async () => {
    const { t, tag, kenji } = await seeded();
    expect(names(await list(t, { search: kenji.reference.toLowerCase() }))).toEqual(["Kenji"]);
    expect(names(await list(t, { search: "whitfield" }))).toEqual(["Eleanor"]);
    expect(names(await list(t, { search: `PRIYA-${tag}@example` }))).toEqual(["Priya"]);
    expect(names(await list(t, { search: "food & wine" }))).toEqual(["Omar", "Priya"]);
    expect(names(await list(t, { search: "  " }))).toHaveLength(4);
    // "%" and "_" match themselves only.
    expect(names(await list(t, { search: "%" }))).toEqual(["Omar"]);
    expect(names(await list(t, { search: "100%_H" }))).toEqual(["Omar"]);
    expect(names(await list(t, { search: "K_nji" }))).toEqual([]);
    expect(await list(t, { search: "nobody-here" })).toMatchObject({ rows: [], total: 0 });
  });

  it("rejects malformed filters", async () => {
    const t = await createTenant();
    for (const bad of [{ status: "approved" }, { tourId: "abc" }, { limit: 0 }, { limit: 101 }, { offset: -1 }, { sort: "price" }, { from: "March" }, { payment: "free" }]) {
      expect(await errorOf(list(t, bad)), JSON.stringify(bad)).toBeInstanceOf(ValidationError);
    }
    expect(await asOwner(t, (scope) => listBookings(scope))).toEqual({ rows: [], total: 0, counts: { all: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0 } });
  });

  it("returns a booking with its customer and timeline, by id or by reference", async () => {
    const { t, kenji } = await seeded();
    const detail = await asOwner(t, (scope) => getBooking(scope, kenji.bookingId, { now: NOW }));
    expect(detail.booking).toMatchObject({ id: kenji.bookingId, reference: kenji.reference, slotTime: "14:00", status: "confirmed" });
    expect(detail.customer).toMatchObject({ id: detail.booking.customerId, name: "Kenji Watanabe", tenantId: t.tenantId });
    expect(detail.events.map((event) => event.kind)).toEqual(["payment", "status", "created"]);
    expect(detail.clashes).toEqual([]);

    const byReference = await asOwner(t, (scope) => getBookingByReference(scope, ` ${kenji.reference.toLowerCase()} `));
    expect(byReference.booking.id).toBe(kenji.bookingId);
    expect(await errorOf(asOwner(t, (scope) => getBookingByReference(scope, "WF-NOP-0000")))).toBeInstanceOf(NotFoundError);
  });
});

describe("bookingStats", () => {
  it("counts by status, sums confirmed and completed revenue, and lists what is coming up", async () => {
    const t = await createTenant();
    const walk = await createDayTour(t.tenantId, { title: "Old City Walk", priceAdult: 12_000 });
    const grand = await createPrivateTour(t.tenantId, { title: "Private Grand Tour", durationDays: 8, priceAdult: 100_000 });
    const book = (overrides: Record<string, unknown>) => requestBooking(t.tenantId, { tourId: walk.id, slotTime: "09:00", ...overrides });

    const pending = await book({ date: "2027-03-10", adults: 1 }); // 12 000, not revenue
    const confirmedLate = await book({ date: "2027-03-20", slotTime: "14:00", adults: 2, children: 1, name: "Claire Dubois" }); // 30 000
    const confirmedEarly = await book({ date: "2027-03-20", slotTime: "09:00", adults: 1, name: "Priya Raman" }); // 12 000
    const completed = await book({ date: "2027-03-05", adults: 3 }); // 36 000
    const cancelled = await book({ date: "2027-03-15", adults: 4 }); // not revenue
    const nextMonth = await book({ date: "2027-04-02", adults: 1 }); // outside the range
    const running = await requestBooking(t.tenantId, { tourId: grand.id, date: "2027-03-02", adults: 1, name: "Thomas Becker" }); // 2nd – 9th
    for (const b of [confirmedLate, confirmedEarly, completed, cancelled, nextMonth, running]) {
      await asOwner(t, (scope) => confirmBooking(scope, b.bookingId, { now: NOW }));
    }
    await asOwner(t, (scope) => completeBooking(scope, completed.bookingId));
    await asOwner(t, (scope) => cancelBooking(scope, cancelled.bookingId, { kind: "by_customer", reason: "Change of plans" }));

    const stats = await asOwner(t, (scope) => bookingStats(scope, { from: "2027-03-01", to: "2027-03-31", today: "2027-03-06" }));
    expect(stats).toMatchObject({
      from: "2027-03-01",
      to: "2027-03-31",
      currency: "USD",
      counts: { all: 6, pending: 1, confirmed: 3, completed: 1, cancelled: 1 },
      revenue: 30_000 + 12_000 + 36_000 + 100_000,
    });
    // Confirmed only, soonest first; a tour still running today counts as upcoming.
    expect(stats.upcoming.map((row) => [row.contactName, row.startDate, row.slotTime, row.guests])).toEqual([
      ["Thomas Becker", "2027-03-02", null, 1],
      ["Priya Raman", "2027-03-20", "09:00", 1],
      ["Claire Dubois", "2027-03-20", "14:00", 3],
      [expect.any(String), "2027-04-02", "09:00", 1],
    ]);
    expect(stats.upcoming[0]).toMatchObject({ id: running.bookingId, reference: running.reference, tourTitle: "Private Grand Tour", endDate: "2027-03-09" });
    expect(stats.upcoming.map((row) => row.id)).not.toContain(pending.bookingId);

    const limited = await asOwner(t, (scope) => bookingStats(scope, { from: "2027-04-01", to: "2027-04-30", today: "2027-03-10", upcomingLimit: 2 }));
    expect(limited.counts).toEqual({ all: 1, pending: 0, confirmed: 1, completed: 0, cancelled: 0 });
    expect(limited.revenue).toBe(12_000);
    expect(limited.upcoming).toHaveLength(2);

    // Without `today` the tenant's own clock is used: every confirmed booking of 2027 is still ahead.
    const defaulted = await asOwner(t, (scope) => bookingStats(scope, { from: "2027-01-01", to: "2027-01-31" }));
    expect(defaulted.counts.all).toBe(0);
    expect(defaulted.revenue).toBe(0);
    expect(defaulted.upcoming.length).toBe(new Date() < new Date("2027-03-02T00:00:00Z") ? 4 : defaulted.upcoming.length);

    for (const bad of [{ from: "2027-03-31", to: "2027-03-01" }, { from: "March", to: "2027-03-01" }, { from: "2027-03-01" }, { from: "2027-03-01", to: "2027-03-02", upcomingLimit: 0 }]) {
      expect(await errorOf(asOwner(t, (scope) => bookingStats(scope, bad as never))), JSON.stringify(bad)).toBeInstanceOf(ValidationError);
    }
  });
});

describe("exportBookingsCsv", () => {
  it("exports the filtered bookings and neutralises spreadsheet formulas typed by customers", async () => {
    const t = await createTenant();
    const tour = await createDayTour(t.tenantId, { title: "Old City, Walk", priceAdult: 12_000 });
    const evil = await requestBooking(t.tenantId, {
      tourId: tour.id,
      date: "2027-03-10",
      slotTime: "09:00",
      adults: 2,
      children: 1,
      name: '=HYPERLINK("http://evil.test","Click")',
      phone: "+44 7700 900821",
      country: "@SUM(1+1)",
      pickup: "-2+3 cmd|' /C calc'!A0",
      notes: "+1 guest\nallergic to nuts",
      language: "English",
    });
    const plain = await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-11", slotTime: "14:00", adults: 1, name: "Kenji Watanabe", phone: "0501234567" });
    await asOwner(t, (scope) => confirmBooking(scope, plain.bookingId, { now: NOW }));
    await asOwner(t, (scope) => updatePaymentStatus(scope, plain.bookingId, { paymentStatus: "deposit_paid", amountPaid: 2_550 }));

    const csv = await asOwner(t, (scope) => exportBookingsCsv(scope));
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "Reference,Status,Tour,Start date,End date,Start time,Adults,Children,Guest name,Email,Phone,Country,Language,Pickup,Contact via,Currency,Base,Discount,Total,Discount applied,Payment status,Amount paid,Guest notes,Requested at",
    );
    expect(csv.endsWith("\r\n")).toBe(true);

    const evilRow = await bookingRow(t.tenantId, evil.bookingId);
    expect(csv).toContain(
      [
        evil.reference,
        "pending",
        '"Old City, Walk"',
        "2027-03-10",
        "2027-03-10",
        "09:00",
        "2",
        "1",
        `"'=HYPERLINK(""http://evil.test"",""Click"")"`,
        evilRow.contactEmail,
        "'+44 7700 900821",
        "'@SUM(1+1)",
        "English",
        "'-2+3 cmd|' /C calc'!A0",
        "email",
        "USD",
        "300",
        "0",
        "300",
        "",
        "unpaid",
        "0",
        `"'+1 guest\nallergic to nuts"`,
        "2027-03-01T09:00:00.000Z",
      ].join(","),
    );
    // No cell starts with a formula character.
    expect(csv).not.toMatch(/(^|,|\n)[=+@]/);
    expect(csv).toContain(`${plain.reference},confirmed,"Old City, Walk",2027-03-11,2027-03-11,14:00,1,0,Kenji Watanabe,`);
    expect(csv).toContain(",0501234567,");
    expect(csv).toContain(",deposit_paid,25.5,");

    const confirmedOnly = await asOwner(t, (scope) => exportBookingsCsv(scope, { status: "confirmed" }));
    expect(confirmedOnly.split("\r\n")).toHaveLength(3);
    expect(confirmedOnly).toContain(plain.reference);
    expect(confirmedOnly).not.toContain(evil.reference);
    expect((await asOwner(t, (scope) => exportBookingsCsv(scope, { search: "kenji", from: "2027-03-11", to: "2027-03-11" }))).split("\r\n")).toHaveLength(3);

    const audits = (await auditActions(t.tenantId)).filter((entry) => entry.action === "booking.exported");
    expect(audits.map((entry) => entry.metadata)).toEqual([{ rows: 2 }, { rows: 1 }, { rows: 1 }]);
    expect(await errorOf(asOwner(t, (scope) => exportBookingsCsv(scope, { status: "nope" } as never)))).toBeInstanceOf(ValidationError);
    expect(await allBookings(t.tenantId)).toHaveLength(2);
  });
});
