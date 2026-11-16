import { describe, expect, it, vi } from "vitest";
import { cancelBooking, completeBooking, confirmBooking, declineBooking } from "@/server/bookings/service";
import {
  addCustomerNote,
  deleteCustomerNote,
  exportCustomersCsv,
  getCustomer,
  listCustomers,
  setMarketingOptIn,
  setPreferredContact,
  updateCustomer,
  upsertCustomerForBooking,
} from "@/server/customers/service";
import { withTenant } from "@/server/db/context";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { allCustomers, asOwner, auditActions, bookingRow, createDayTour, errorOf, NOW, requestBooking, TODAY } from "../../helpers/bookings";
import { createTenant, randomId, unique, type TenantFixture } from "../../helpers/fixtures";

vi.mock("@/server/promotions/engine", () => ({ findBestDiscount: vi.fn(async () => null), consumeDiscount: vi.fn(async () => undefined) }));
vi.mock("@/server/notifications/index", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

/**
 * Three customers with a known history:
 *  - Eleanor: one completed (240) and one confirmed (120) booking → spent 360, 2 bookings
 *  - Kenji: one pending (120) and one declined booking → spent 0, 2 bookings
 *  - Omar: one confirmed-then-cancelled booking → spent 0, 1 booking
 */
async function seeded() {
  const t = await createTenant();
  const tour = await createDayTour(t.tenantId, { priceAdult: 12_000 });
  const tag = unique("c");
  const emails = { eleanor: `eleanor-${tag}@example.test`, kenji: `kenji-${tag}@example.test`, omar: `omar-${tag}@example.test` };
  const at = (minutes: number) => ({ today: TODAY, now: new Date(NOW.getTime() + minutes * 60_000) });
  const book = (overrides: Record<string, unknown>, minutes: number) => requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00", adults: 1, ...overrides }, at(minutes));

  const e1 = await book({ name: "Eleanor Whitfield", email: emails.eleanor, phone: "+44 7700 900821", country: "United Kingdom", date: "2027-03-10", adults: 2 }, 0);
  const e2 = await book({ name: "Eleanor Whitfield", email: emails.eleanor, date: "2027-03-11" }, 5);
  const k1 = await book({ name: "Kenji Watanabe", email: emails.kenji, phone: "+81 90 1234 5678", country: "Japan", date: "2027-03-12" }, 10);
  const k2 = await book({ name: "Kenji Watanabe", email: emails.kenji, date: "2027-03-13" }, 15);
  const o1 = await book({ name: "Omar Haddad", email: emails.omar, phone: "+971 50 123 4567", date: "2027-03-14" }, 20);

  await asOwner(t, async (scope) => {
    await confirmBooking(scope, e1.bookingId, { now: NOW });
    await completeBooking(scope, e1.bookingId);
    await confirmBooking(scope, e2.bookingId, { now: NOW });
    await declineBooking(scope, k2.bookingId);
    await confirmBooking(scope, o1.bookingId, { now: NOW });
    await cancelBooking(scope, o1.bookingId, { kind: "by_customer", reason: "Plans changed" });
  });

  const ids = {
    eleanor: (await bookingRow(t.tenantId, e1.bookingId)).customerId,
    kenji: (await bookingRow(t.tenantId, k1.bookingId)).customerId,
    omar: (await bookingRow(t.tenantId, o1.bookingId)).customerId,
  };
  return { t, tour, emails, ids, bookings: { e1, e2, k1, k2, o1 } };
}

const list = (t: TenantFixture, input: Record<string, unknown> = {}) => asOwner(t, (scope) => listCustomers(scope, input as never));

describe("listCustomers", () => {
  it("derives booking count, total spent and last booking by SQL", async () => {
    const { t, ids } = await seeded();
    const result = await list(t);
    expect(result.total).toBe(3);
    expect(result.rows.map((row) => [row.name, row.bookingCount, row.totalSpent])).toEqual([
      ["Eleanor Whitfield", 2, 36_000],
      ["Kenji Watanabe", 2, 0],
      ["Omar Haddad", 1, 0],
    ]);
    expect(result.rows.map((row) => row.lastBookingAt)).toEqual([new Date(NOW.getTime() + 5 * 60_000), new Date(NOW.getTime() + 15 * 60_000), new Date(NOW.getTime() + 20 * 60_000)]);
    expect(result.rows[0]).toMatchObject({ id: ids.eleanor, tenantId: t.tenantId, phone: "+44 7700 900821", country: "United Kingdom", marketingOptIn: false });
  });

  it("shows a customer without bookings with zero figures", async () => {
    const t = await createTenant();
    await withTenant(t.tenantId, (scope) =>
      upsertCustomerForBooking(scope, { name: "Walk In", email: "Walk.In@Example.Test", phone: "", country: "", language: "", preferredContact: "phone" }),
    );
    const result = await list(t);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ name: "Walk In", email: "walk.in@example.test", bookingCount: 0, totalSpent: 0, lastBookingAt: null, preferredContact: "phone" });
  });

  it("sorts by name, newest, spend and latest booking, and pages", async () => {
    const { t } = await seeded();
    const names = async (input: Record<string, unknown>) => (await list(t, input)).rows.map((row) => row.name.split(" ")[0]);
    expect(await names({ sort: "name" })).toEqual(["Eleanor", "Kenji", "Omar"]);
    expect(await names({ sort: "newest" })).toEqual(["Omar", "Kenji", "Eleanor"]);
    expect(await names({ sort: "top_spenders" })).toEqual(["Eleanor", "Kenji", "Omar"]);
    expect(await names({ sort: "recent_booking" })).toEqual(["Omar", "Kenji", "Eleanor"]);

    const page = await list(t, { limit: 1, offset: 1 });
    expect(page.rows.map((row) => row.name)).toEqual(["Kenji Watanabe"]);
    expect(page.total).toBe(3);
    expect((await list(t, { limit: 2, offset: 3 })).rows).toEqual([]);
  });

  it("searches name, e-mail and phone, treating wildcards as text", async () => {
    const { t, emails } = await seeded();
    const found = async (search: string) => (await list(t, { search })).rows.map((row) => row.name.split(" ")[0]);
    expect(await found("WATANABE")).toEqual(["Kenji"]);
    expect(await found(emails.omar.toUpperCase())).toEqual(["Omar"]);
    expect(await found("7700 900")).toEqual(["Eleanor"]);
    expect(await found("@example.test")).toEqual(["Eleanor", "Kenji", "Omar"]);
    expect(await found("%")).toEqual([]);
    expect(await found("_")).toEqual([]);
    expect(await list(t, { search: "nobody" })).toEqual({ rows: [], total: 0 });
  });

  it("rejects malformed paging", async () => {
    const t = await createTenant();
    for (const bad of [{ limit: 0 }, { limit: 500 }, { offset: -1 }, { sort: "random" }]) {
      expect(await errorOf(list(t, bad)), JSON.stringify(bad)).toBeInstanceOf(ValidationError);
    }
    expect(await asOwner(t, (scope) => listCustomers(scope))).toEqual({ rows: [], total: 0 });
  });
});

describe("getCustomer", () => {
  it("returns the profile, figures, booking history and notes", async () => {
    const { t, ids, bookings } = await seeded();
    await asOwner(t, (scope) => addCustomerNote(scope, ids.eleanor, "Prefers morning tours"));

    const profile = await asOwner(t, (scope) => getCustomer(scope, ids.eleanor));
    expect(profile.customer).toMatchObject({ id: ids.eleanor, name: "Eleanor Whitfield" });
    expect(profile.stats).toEqual({ bookingCount: 2, totalSpent: 36_000, lastBookingAt: new Date(NOW.getTime() + 5 * 60_000) });
    // Newest first.
    expect(profile.bookings.map((row) => [row.id, row.status, row.totalAmount, row.slotTime])).toEqual([
      [bookings.e2.bookingId, "confirmed", 12_000, "09:00"],
      [bookings.e1.bookingId, "completed", 24_000, "09:00"],
    ]);
    expect(profile.bookings[0]).toMatchObject({ reference: bookings.e2.reference, startDate: "2027-03-11", currency: "USD", paymentStatus: "unpaid", adults: 1, children: 0 });
    expect(profile.notes).toEqual([expect.objectContaining({ body: "Prefers morning tours", authorId: t.ownerId, authorName: "Test User" })]);

    expect(profile.bookings.map((row) => row.cancelKind)).toEqual([null, null]);
    const kenji = await asOwner(t, (scope) => getCustomer(scope, ids.kenji));
    expect(kenji.bookings.map((row) => [row.id, row.status, row.cancelKind])).toEqual([
      [bookings.k2.bookingId, "cancelled", "declined"],
      [bookings.k1.bookingId, "pending", null],
    ]);

    const quiet = await asOwner(t, (scope) => getCustomer(scope, ids.omar));
    expect(quiet.bookings.map((row) => [row.status, row.cancelKind])).toEqual([["cancelled", "by_customer"]]);
    expect(quiet.stats).toMatchObject({ bookingCount: 1, totalSpent: 0 });
    expect(quiet.notes).toEqual([]);
  });

  it("answers not found for unknown and malformed ids", async () => {
    const t = await createTenant();
    for (const id of [randomId(), "abc", ""]) {
      expect(await errorOf(asOwner(t, (scope) => getCustomer(scope, id)))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(asOwner(t, (scope) => updateCustomer(scope, id, { name: "New Name" })))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(asOwner(t, (scope) => addCustomerNote(scope, id, "note")))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(asOwner(t, (scope) => deleteCustomerNote(scope, id, randomId())))).toBeInstanceOf(NotFoundError);
    }
  });
});

describe("updateCustomer", () => {
  it("edits the profile, lower-cases the e-mail and audits field names only", async () => {
    const { t, ids, bookings } = await seeded();
    const newEmail = `${unique("New.Address")}@Example.Test`;

    const updated = await asOwner(t, (scope) =>
      updateCustomer(scope, ids.kenji, { name: "  Kenji W. ", email: ` ${newEmail} `, phone: "+81 3 0000 0000", country: "Japan", language: "Japanese", preferredContact: "whatsapp", marketingOptIn: true }),
    );
    expect(updated).toMatchObject({
      id: ids.kenji,
      name: "Kenji W.",
      email: newEmail.toLowerCase(),
      phone: "+81 3 0000 0000",
      language: "Japanese",
      preferredContact: "whatsapp",
      marketingOptIn: true,
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(updated.createdAt.getTime());

    const audit = (await auditActions(t.tenantId, ids.kenji)).at(-1)!;
    expect(audit).toMatchObject({ action: "customer.updated", actorType: "user" });
    // Country did not change, so it is not listed; values never are.
    expect((audit.metadata as { fields: string[] }).fields.sort()).toEqual(["email", "language", "marketingOptIn", "name", "phone", "preferredContact"]);
    expect(JSON.stringify(audit.metadata)).not.toContain("example.test");

    // Bookings keep the contact details entered at the time.
    expect((await bookingRow(t.tenantId, bookings.k1.bookingId)).contactName).toBe("Kenji Watanabe");
    // A later request with the new address joins the same profile.
    const again = await requestBooking(t.tenantId, { tourId: (await bookingRow(t.tenantId, bookings.k1.bookingId)).tourId, slotTime: "14:00", date: "2027-03-20", email: newEmail });
    expect((await bookingRow(t.tenantId, again.bookingId)).customerId).toBe(ids.kenji);
  });

  it("refuses an e-mail another customer of the tenant has, in any letter case", async () => {
    const { t, ids, emails } = await seeded();
    const error = await errorOf(asOwner(t, (scope) => updateCustomer(scope, ids.kenji, { email: emails.eleanor.toUpperCase() })));
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ code: "email_taken", status: 409 });
    expect((await asOwner(t, (scope) => getCustomer(scope, ids.kenji))).customer.email).toBe(emails.kenji);
    // Re-saving its own address is not a conflict.
    expect((await asOwner(t, (scope) => updateCustomer(scope, ids.kenji, { email: emails.kenji.toUpperCase(), name: "Kenji Watanabe" }))).email).toBe(emails.kenji);
  });

  it("does nothing, and audits nothing, when no field changes", async () => {
    const { t, ids } = await seeded();
    const before = (await auditActions(t.tenantId, ids.omar)).length;
    const same = await asOwner(t, (scope) => updateCustomer(scope, ids.omar, { name: "Omar Haddad" }));
    expect(same.name).toBe("Omar Haddad");
    await asOwner(t, (scope) => updateCustomer(scope, ids.omar, {}));
    expect(await auditActions(t.tenantId, ids.omar)).toHaveLength(before);
  });

  it("validates fields", async () => {
    const { t, ids } = await seeded();
    for (const [bad, field] of [
      [{ name: "K" }, "name"],
      [{ email: "not-an-email" }, "email"],
      [{ preferredContact: "fax" }, "preferredContact"],
      [{ marketingOptIn: "yes" }, "marketingOptIn"],
      [{ phone: "x".repeat(41) }, "phone"],
    ] as const) {
      const error = await errorOf(asOwner(t, (scope) => updateCustomer(scope, ids.kenji, bad as never)));
      expect(error, field).toBeInstanceOf(ValidationError);
      expect(error.fieldErrors).toHaveProperty(field);
    }
  });

  it("sets marketing opt-in and preferred contact on their own", async () => {
    const { t, ids } = await seeded();
    expect((await asOwner(t, (scope) => setMarketingOptIn(scope, ids.omar, true))).marketingOptIn).toBe(true);
    expect((await asOwner(t, (scope) => setMarketingOptIn(scope, ids.omar, false))).marketingOptIn).toBe(false);
    expect((await asOwner(t, (scope) => setPreferredContact(scope, ids.omar, "phone"))).preferredContact).toBe("phone");
    expect(await errorOf(asOwner(t, (scope) => setPreferredContact(scope, ids.omar, "carrier-pigeon" as never)))).toBeInstanceOf(ValidationError);
  });
});

describe("customer notes", () => {
  it("adds and deletes notes, newest first, with author and audit", async () => {
    const { t, ids } = await seeded();
    const first = await asOwner(t, (scope) => addCustomerNote(scope, ids.kenji, "  Photographer; travels with tripod "));
    const second = await asOwner(t, (scope) => addCustomerNote(scope, ids.kenji, "Asked about Khinalug in March"));
    expect(first).toMatchObject({ body: "Photographer; travels with tripod", authorId: t.ownerId, authorName: "Test User" });

    let notes = (await asOwner(t, (scope) => getCustomer(scope, ids.kenji))).notes;
    expect(notes.map((note) => note.id)).toEqual([second.id, first.id]);

    await asOwner(t, (scope) => deleteCustomerNote(scope, ids.kenji, first.id));
    notes = (await asOwner(t, (scope) => getCustomer(scope, ids.kenji))).notes;
    expect(notes.map((note) => note.id)).toEqual([second.id]);

    const actions = (await auditActions(t.tenantId, ids.kenji)).map((entry) => entry.action);
    expect(actions.filter((action) => action.startsWith("customer.note"))).toEqual(["customer.note_added", "customer.note_added", "customer.note_deleted"]);
    expect(JSON.stringify(await auditActions(t.tenantId, ids.kenji))).not.toContain("tripod");
  });

  it("rejects blank notes, and deleting a note twice or through the wrong customer", async () => {
    const { t, ids } = await seeded();
    expect(await errorOf(asOwner(t, (scope) => addCustomerNote(scope, ids.kenji, "   ")))).toBeInstanceOf(ValidationError);
    expect(await errorOf(asOwner(t, (scope) => addCustomerNote(scope, ids.kenji, "x".repeat(4001))))).toBeInstanceOf(ValidationError);

    const note = await asOwner(t, (scope) => addCustomerNote(scope, ids.kenji, "Keep me"));
    expect(await errorOf(asOwner(t, (scope) => deleteCustomerNote(scope, ids.eleanor, note.id)))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(asOwner(t, (scope) => deleteCustomerNote(scope, ids.kenji, "nope")))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(asOwner(t, (scope) => deleteCustomerNote(scope, ids.kenji, randomId())))).toBeInstanceOf(NotFoundError);
    expect((await asOwner(t, (scope) => getCustomer(scope, ids.kenji))).notes).toHaveLength(1);

    await asOwner(t, (scope) => deleteCustomerNote(scope, ids.kenji, note.id));
    expect(await errorOf(asOwner(t, (scope) => deleteCustomerNote(scope, ids.kenji, note.id)))).toBeInstanceOf(NotFoundError);
  });

  it("records a note written without a signed-in user as authorless", async () => {
    const { t, ids } = await seeded();
    const note = await withTenant(t.tenantId, (scope) => addCustomerNote(scope, ids.omar, "Imported from the old system"));
    expect(note).toMatchObject({ authorId: null, authorName: null });
  });
});

describe("exportCustomersCsv", () => {
  it("exports every customer with derived figures and neutralises formulas", async () => {
    const { t, ids, emails } = await seeded();
    await asOwner(t, (scope) => updateCustomer(scope, ids.omar, { name: "=cmd|' /C calc'!A0", country: "@UAE", marketingOptIn: true }));

    const csv = await asOwner(t, (scope) => exportCustomersCsv(scope));
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Name,Email,Phone,Country,Language,Preferred contact,Marketing opt-in,Bookings,Total spent (minor units),Last booking,Customer since");
    expect(lines).toHaveLength(4);
    // Sorted by name: "=cmd…" sorts before the letters.
    expect(lines[1]).toContain(`'=cmd|' /C calc'!A0,${emails.omar},'+971 50 123 4567,'@UAE,,email,yes,1,0,`);
    expect(lines[2]).toContain(`Eleanor Whitfield,${emails.eleanor},'+44 7700 900821,United Kingdom,,email,no,2,36000,${new Date(NOW.getTime() + 5 * 60_000).toISOString()},`);
    expect(csv).not.toMatch(/(^|,|\n)[=+@]/);

    const filtered = await asOwner(t, (scope) => exportCustomersCsv(scope, { search: "kenji" }));
    expect(filtered.trimEnd().split("\r\n")).toHaveLength(2);
    expect(filtered).toContain(emails.kenji);

    const exports = (await auditActions(t.tenantId)).filter((entry) => entry.action === "customer.exported");
    expect(exports.map((entry) => entry.metadata)).toEqual([{ rows: 3 }, { rows: 1 }]);
    expect(await allCustomers(t.tenantId)).toHaveLength(3);
  });
});
