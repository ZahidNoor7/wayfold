import { describe, expect, it } from "vitest";
import type { BookingDetail } from "@/server/bookings/service";
import { humaniseMessage, toDetailView, toRowView, type DetailContext } from "./view-models";

const now = new Date("2026-11-14T12:00:00Z");
const format = { now, timezone: "Asia/Baku" };

const row = {
  id: "b1",
  reference: "AJ-OLD-7731",
  contactName: "Marco Rossi",
  country: "Italy",
  createdAt: new Date("2026-11-14T09:00:00Z"),
  tourTitle: "Old City Walk",
  startDate: "2026-11-21",
  slotTime: "14:00:00",
  adults: 2,
  children: 3,
  totalAmount: 51000,
  baseAmount: 60000,
  discountAmount: 9000,
  currency: "USD",
  status: "pending" as const,
  cancelKind: null,
  paymentStatus: "unpaid" as const,
  clashes: [{ type: "over_capacity" as const, message: "Over capacity: 9 of 8 seats", with: [] }],
  customerNotes: "Family of five.",
};

describe("toRowView", () => {
  it("formats a list row", () => {
    expect(toRowView(row, format)).toEqual({
      id: "b1",
      reference: "AJ-OLD-7731",
      name: "Marco Rossi",
      country: "Italy",
      requested: "3 h ago",
      tourTitle: "Old City Walk",
      date: "21 Nov 2026",
      time: "14:00",
      guests: "2 adults, 3 children",
      total: "$510",
      base: "$600",
      status: "pending",
      statusLabel: "Pending",
      paymentStatus: "unpaid",
      clashes: ["Over capacity: 9 of 8 seats"],
      notes: "Family of five.",
    });
  });

  it("leaves out the struck-through price and time when there is none", () => {
    const view = toRowView({ ...row, slotTime: null, discountAmount: 0, totalAmount: 60000, status: "cancelled", cancelKind: "declined", clashes: [] }, format);
    expect(view.time).toBeNull();
    expect(view.base).toBeNull();
    expect(view.total).toBe("$600");
    expect(view.statusLabel).toBe("Declined");
    expect(view.clashes).toEqual([]);
  });
});

describe("humaniseMessage", () => {
  it("rewrites machine timestamps in the workspace timezone", () => {
    expect(humaniseMessage("Reopened as pending. Seats held until 2026-11-16T08:30:00.000Z.", "Asia/Baku")).toBe(
      "Reopened as pending. Seats held until 16 Nov 2026, 12:30.",
    );
    expect(humaniseMessage("Until 2026-11-16T08:30Z and 2026-11-17T08:30:10Z", "UTC")).toBe("Until 16 Nov 2026, 08:30 and 17 Nov 2026, 08:30");
    expect(humaniseMessage("Booking confirmed.", "UTC")).toBe("Booking confirmed.");
  });
});

function detail(overrides: Record<string, unknown> = {}, extra: Partial<BookingDetail> = {}): BookingDetail {
  return {
    booking: {
      ...row,
      tourId: "t1",
      customerId: "c1",
      endDate: "2026-11-21",
      alternativeDate: "2026-11-28",
      participants: [{ name: "Marco Rossi", age: 41 }, { name: "Lia Rossi", age: null }, { name: "Gio Rossi" }],
      cancelReason: null,
      holdExpiresAt: new Date("2026-11-15T12:00:00Z"),
      unitPriceAdult: 12000,
      unitPriceChild: 12000,
      discountLabel: "Family Adventures · 15% off",
      amountPaid: 10000,
      contactEmail: "marco@example.com",
      contactPhone: "+39 333 123 4567",
      language: "Italian",
      pickup: "Fairmont Baku",
      contactMethod: "whatsapp",
      ...overrides,
    },
    customer: { id: "c1" },
    events: [
      { id: "e2", kind: "note", message: "No pork.", actorId: "u1", actorName: "Leyla", createdAt: new Date("2026-11-14T10:00:00Z") },
      { id: "e1", kind: "status", message: "Reopened as pending. Seats held until 2026-11-15T12:00:00.000Z.", actorId: null, actorName: null, createdAt: new Date("2026-11-14T08:00:00Z") },
    ],
    clashes: [{ type: "over_capacity", message: "Over capacity: 9 of 8 seats", with: [] }],
    ...extra,
  } as unknown as BookingDetail;
}

const context: DetailContext = { ...format, workspaceName: "Aurelia Journeys", whatsapp: "https://wa.me/393331234567", canViewCustomer: true };

describe("toDetailView", () => {
  it("formats a pending booking with a discount, a deposit and a live hold", () => {
    const view = toDetailView(detail(), context);
    expect(view.reference).toBe("AJ-OLD-7731");
    expect(view.statusLabel).toBe("Pending");
    expect(view.cancelReason).toBeNull();
    expect(view.requested).toBe("3 h ago");
    expect(view.requestedAt).toBe("14 Nov 2026, 13:00");
    expect(view.hold).toBe("Seats held until 15 Nov 2026, 16:00.");
    expect(view.clashes).toEqual(["Over capacity: 9 of 8 seats"]);
    expect(view.contact).toEqual({
      name: "Marco Rossi",
      email: "marco@example.com",
      phone: "+39 333 123 4567",
      country: "Italy",
      prefers: "WhatsApp",
      mailto: "mailto:marco@example.com?subject=Your%20Aurelia%20Journeys%20request%20AJ-OLD-7731",
      whatsapp: "https://wa.me/393331234567",
      profileHref: "/workspace/customers/c1",
    });
    expect(view.trip).toEqual({
      tourId: "t1",
      tourTitle: "Old City Walk",
      startDate: "2026-11-21",
      slotTime: "14:00",
      when: "21 Nov 2026 · 14:00",
      alternativeDate: "28 Nov 2026",
      guests: "2 adults, 3 children",
      participants: ["Marco Rossi (41)", "Lia Rossi", "Gio Rossi"],
      language: "Italian",
      pickup: "Fairmont Baku",
      notes: "Family of five.",
    });
    expect(view.price).toEqual({
      currency: "USD",
      lines: [
        { label: "2 × adult at $120", amount: "$240" },
        { label: "3 × child at $120", amount: "$360" },
      ],
      base: "$600",
      discount: "$90",
      discountLabel: "Family Adventures · 15% off",
      total: "$510",
      paid: "$100",
      balance: "$410",
      totalAmount: 51000,
      amountPaid: 10000,
    });
    expect(view.events).toEqual([
      { id: "e2", kind: "note", kindLabel: "Note", message: "No pork.", actor: "Leyla", at: "14 Nov 2026, 14:00" },
      { id: "e1", kind: "status", kindLabel: "Status", message: "Reopened as pending. Seats held until 15 Nov 2026, 16:00.", actor: null, at: "14 Nov 2026, 12:00" },
    ]);
  });

  it("says when a hold has lapsed or was never set", () => {
    expect(toDetailView(detail({ holdExpiresAt: new Date("2026-11-14T11:00:00Z") }), context).hold).toBe("The hold on these seats has lapsed.");
    expect(toDetailView(detail({ holdExpiresAt: null }), context).hold).toBe("The hold on these seats has lapsed.");
    expect(toDetailView(detail({ status: "confirmed" }), context).hold).toBeNull();
  });

  it("handles a multi-day tour without children, discount, phone or alternative date", () => {
    const view = toDetailView(
      detail({
        slotTime: null,
        endDate: "2026-11-28",
        children: 0,
        discountAmount: 0,
        baseAmount: 24000,
        totalAmount: 24000,
        amountPaid: 24000,
        alternativeDate: null,
        contactPhone: "",
        participants: [],
        status: "cancelled",
        cancelKind: "by_customer",
        cancelReason: "Family emergency.",
      }),
      { ...context, canViewCustomer: false },
    );
    expect(view.statusLabel).toBe("Cancelled by guest");
    expect(view.cancelReason).toBe("Family emergency.");
    expect(view.hold).toBeNull();
    expect(view.trip.when).toBe("21 – 28 Nov 2026");
    expect(view.trip.slotTime).toBeNull();
    expect(view.trip.alternativeDate).toBeNull();
    expect(view.trip.participants).toEqual([]);
    expect(view.price.lines).toEqual([{ label: "2 × adult at $120", amount: "$240" }]);
    expect(view.price.discount).toBeNull();
    expect(view.price.discountLabel).toBeNull();
    expect(view.price.balance).toBe("$0");
    // No number to chat with, and no right to open the profile.
    expect(view.contact.whatsapp).toBeNull();
    expect(view.contact.profileHref).toBeNull();
  });

  it("keeps a recorded reason hidden unless the booking is cancelled, and offers no chat link without messaging", () => {
    const view = toDetailView(detail({ status: "pending", cancelReason: "old reason" }), { ...context, whatsapp: null });
    expect(view.cancelReason).toBeNull();
    expect(view.contact.whatsapp).toBeNull();
  });
});
