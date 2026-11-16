import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cancelBooking, confirmBooking, rescheduleBooking } from "@/server/bookings/service";
import { withTenant } from "@/server/db/context";
import { campaigns, notificationOutbox } from "@/server/db/schema";
import { allBookings, asOwner, bookingRow, createDayTour, NOW, requestBooking, setTenantEmail } from "../../helpers/bookings";
import { createTenant } from "../../helpers/fixtures";

// Nothing is mocked here: these tests run the booking services against the
// real promotions engine and the real notification outbox, to catch a drift
// between this module and the contracts it calls.

const outbox = (tenantId: string) =>
  withTenant(tenantId, ({ tx }) =>
    tx
      .select({ kind: notificationOutbox.kind, toEmail: notificationOutbox.toEmail, subject: notificationOutbox.subject, status: notificationOutbox.status, relatedId: notificationOutbox.relatedId })
      .from(notificationOutbox)
      .where(eq(notificationOutbox.tenantId, tenantId))
      .orderBy(asc(notificationOutbox.createdAt)),
  );

describe("bookings with the real promotions engine and notification outbox", () => {
  it("applies and consumes a campaign discount and queues every message of a booking's life", async () => {
    const t = await createTenant({ name: "Aurelia Journeys" });
    await setTenantEmail(t.tenantId, "hello@aurelia.test");
    const tour = await createDayTour(t.tenantId, { priceAdult: 12_000 });
    const [campaign] = await withTenant(t.tenantId, ({ tx }) =>
      tx.insert(campaigns).values({ name: "Spring opening", type: "percent", value: 15, startsOn: "2027-01-01", endsOn: "2027-12-31" }).returning(),
    );

    const result = await requestBooking(t.tenantId, { tourId: tour.id, date: "2027-03-10", slotTime: "09:00", adults: 2, email: "Eleanor@Example.Test" });
    expect(result.totals).toMatchObject({ baseAmount: 24_000, discountAmount: 3_600, totalAmount: 20_400 });
    expect(result.totals.discountLabel).toContain("Spring opening");
    expect(await bookingRow(t.tenantId, result.bookingId)).toMatchObject({ discountSource: "campaign", discountRefId: campaign!.id, discountAmount: 3_600 });
    const [used] = await withTenant(t.tenantId, ({ tx }) => tx.select({ uses: campaigns.uses }).from(campaigns).where(eq(campaigns.id, campaign!.id)));
    expect(used).toEqual({ uses: 1 });

    await asOwner(t, (scope) => confirmBooking(scope, result.bookingId, { now: NOW }));
    await asOwner(t, (scope) => rescheduleBooking(scope, result.bookingId, { date: "2027-03-12" }, { now: NOW }));
    await asOwner(t, (scope) => cancelBooking(scope, result.bookingId, { kind: "by_business", reason: "Road closed" }));

    const rows = await outbox(t.tenantId);
    expect(rows.map((row) => [row.kind, row.toEmail])).toEqual([
      ["booking.received", "eleanor@example.test"],
      ["booking.staff_alert", "hello@aurelia.test"],
      ["booking.confirmed", "eleanor@example.test"],
      ["booking.rescheduled", "eleanor@example.test"],
      ["booking.cancelled", "eleanor@example.test"],
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ status: "pending", relatedId: result.bookingId });
      expect(row.subject).toContain(result.reference);
    }
  });

  it("takes the booking and queues only the customer's message when the business address is malformed", async () => {
    const t = await createTenant();
    await setTenantEmail(t.tenantId, "not an address");
    const tour = await createDayTour(t.tenantId);

    const result = await requestBooking(t.tenantId, { tourId: tour.id, slotTime: "09:00" });
    expect(result.totals.discountAmount).toBe(0);
    expect(await allBookings(t.tenantId)).toHaveLength(1);
    expect((await outbox(t.tenantId)).map((row) => row.kind)).toEqual(["booking.received"]);
  });
});
