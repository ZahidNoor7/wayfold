import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { joinWaitlist } from "@/server/bookings/waitlist";
import { withTenant } from "@/server/db/context";
import { waitlistEntries } from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/server/errors";
import {
  auditActions,
  createDayTour,
  createDeparture,
  createDepartureTour,
  createPrivateTour,
  errorOf,
  NOW,
  requestBooking,
  TODAY,
  type TourRow,
} from "../../helpers/bookings";
import { createTenant, randomId, unique, type TenantFixture } from "../../helpers/fixtures";

const DATE = "2027-03-10";
const options = { today: TODAY, now: NOW };

function join(tenantId: string, input: Record<string, unknown>) {
  return withTenant(tenantId, (scope) => joinWaitlist(scope, { name: "Aiko Tanaka", email: `${unique("guest")}@example.test`, ...input }, options));
}

function entriesOf(tenantId: string, tourId: string) {
  return withTenant(tenantId, ({ tx }) =>
    tx
      .select()
      .from(waitlistEntries)
      .where(and(eq(waitlistEntries.tenantId, tenantId), eq(waitlistEntries.tourId, tourId))),
  );
}

describe("joinWaitlist", () => {
  let tenant: TenantFixture;
  let departureTour: TourRow;

  beforeAll(async () => {
    tenant = await createTenant();
    departureTour = await createDepartureTour(tenant.tenantId);
    await createDeparture(tenant.tenantId, departureTour.id, DATE, 8);
    // Sold out: one request takes all eight seats.
    await requestBooking(tenant.tenantId, { tourId: departureTour.id, date: DATE, adults: 8 });
  });

  it("adds a visitor to the waitlist of a sold-out departure", async () => {
    const email = `${unique("Mixed.Case")}@Example.Test`;
    const result = await join(tenant.tenantId, { tourId: departureTour.id, date: DATE, email, partySize: 2 });
    expect(result).toEqual({ date: DATE, slotTime: null });

    const rows = await entriesOf(tenant.tenantId, departureTour.id);
    const row = rows.find((entry) => entry.email === email.toLowerCase());
    expect(row).toMatchObject({ date: DATE, slotTime: null, name: "Aiko Tanaka", partySize: 2 });

    const [audit] = await auditActions(tenant.tenantId, row!.id);
    expect(audit).toMatchObject({ action: "booking.waitlist_joined", actorType: "system" });
    // The address itself never reaches the audit log.
    expect(JSON.stringify(audit!.metadata)).not.toContain(email.toLowerCase());
  });

  it("finds the tour by slug and defaults the party to one", async () => {
    const email = `${unique("slug")}@example.test`;
    await join(tenant.tenantId, { tourSlug: departureTour.slug, date: DATE, email });
    const rows = await entriesOf(tenant.tenantId, departureTour.id);
    expect(rows.find((entry) => entry.email === email)).toMatchObject({ partySize: 1 });
  });

  it("updates the entry when the same e-mail joins again, and answers the same", async () => {
    const email = `${unique("twice")}@example.test`;
    const first = await join(tenant.tenantId, { tourId: departureTour.id, date: DATE, email, partySize: 2 });
    const second = await join(tenant.tenantId, { tourId: departureTour.id, date: DATE, email, name: "A. Tanaka", partySize: 4 });
    expect(second).toEqual(first);

    const rows = (await entriesOf(tenant.tenantId, departureTour.id)).filter((entry) => entry.email === email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "A. Tanaka", partySize: 4 });
  });

  it("refuses a date that still has space for the party", async () => {
    const tour = await createDepartureTour(tenant.tenantId);
    await createDeparture(tenant.tenantId, tour.id, DATE, 8);
    const error = await errorOf(join(tenant.tenantId, { tourId: tour.id, date: DATE, partySize: 2 }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors?.date?.[0]).toContain("still has space");
    expect(await entriesOf(tenant.tenantId, tour.id)).toHaveLength(0);
  });

  it("accepts a party larger than the seats that are left", async () => {
    const tour = await createDepartureTour(tenant.tenantId);
    await createDeparture(tenant.tenantId, tour.id, DATE, 8);
    await requestBooking(tenant.tenantId, { tourId: tour.id, date: DATE, adults: 6 });
    await expect(join(tenant.tenantId, { tourId: tour.id, date: DATE, partySize: 4 })).resolves.toEqual({ date: DATE, slotTime: null });
    await expect(errorOf(join(tenant.tenantId, { tourId: tour.id, date: DATE, partySize: 2 }))).resolves.toBeInstanceOf(ValidationError);
  });

  it("refuses dates the tour does not run on, and dates in the past", async () => {
    const noDeparture = await errorOf(join(tenant.tenantId, { tourId: departureTour.id, date: "2027-03-11" }));
    expect(noDeparture).toBeInstanceOf(ValidationError);
    expect(noDeparture.fieldErrors?.date?.[0]).toContain("not running");

    const past = await errorOf(join(tenant.tenantId, { tourId: departureTour.id, date: "2027-02-20" }));
    expect(past.fieldErrors?.date?.[0]).toContain("not running");
  });

  it("waits for one start time of a day tour, or for the whole day", async () => {
    const tour = await createDayTour(tenant.tenantId);
    await requestBooking(tenant.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", adults: 8 });

    await expect(join(tenant.tenantId, { tourId: tour.id, date: DATE, slotTime: "09:00", partySize: 2 })).resolves.toEqual({ date: DATE, slotTime: "09:00" });

    const open = await errorOf(join(tenant.tenantId, { tourId: tour.id, date: DATE, slotTime: "14:00", partySize: 2 }));
    expect(open.fieldErrors?.slotTime?.[0]).toContain("still has space");

    const unknown = await errorOf(join(tenant.tenantId, { tourId: tour.id, date: DATE, slotTime: "11:00" }));
    expect(unknown.fieldErrors?.slotTime?.[0]).toBe("Choose a start time.");

    // No time given while the afternoon is free: the day can still be booked.
    const wholeDay = await errorOf(join(tenant.tenantId, { tourId: tour.id, date: DATE, partySize: 2 }));
    expect(wholeDay.fieldErrors?.date?.[0]).toContain("still has space");

    await requestBooking(tenant.tenantId, { tourId: tour.id, date: DATE, slotTime: "14:00", adults: 8 });
    await expect(join(tenant.tenantId, { tourId: tour.id, date: DATE, partySize: 2 })).resolves.toEqual({ date: DATE, slotTime: null });
  });

  it("takes a waitlist for a private date that is on hold", async () => {
    const tour = await createPrivateTour(tenant.tenantId);
    await requestBooking(tenant.tenantId, { tourId: tour.id, date: DATE, adults: 2 });
    await expect(join(tenant.tenantId, { tourId: tour.id, date: DATE, partySize: 2 })).resolves.toEqual({ date: DATE, slotTime: null });
    // A start date whose eight days overlap the held block is waited for too.
    await expect(join(tenant.tenantId, { tourId: tour.id, date: "2027-03-12" })).resolves.toEqual({ date: "2027-03-12", slotTime: null });
  });

  it("treats drafts and unknown tours as not found", async () => {
    const draft = await createDepartureTour(tenant.tenantId, { status: "draft" });
    await createDeparture(tenant.tenantId, draft.id, DATE, 8);
    await expect(errorOf(join(tenant.tenantId, { tourId: draft.id, date: DATE }))).resolves.toBeInstanceOf(NotFoundError);
    await expect(errorOf(join(tenant.tenantId, { tourSlug: draft.slug, date: DATE }))).resolves.toBeInstanceOf(NotFoundError);
    await expect(errorOf(join(tenant.tenantId, { tourId: randomId(), date: DATE }))).resolves.toBeInstanceOf(NotFoundError);
    await expect(errorOf(join(tenant.tenantId, { tourId: "not-an-id", date: DATE }))).resolves.toBeInstanceOf(NotFoundError);
  });

  it("validates what the visitor typed", async () => {
    const error = await errorOf(join(tenant.tenantId, { tourId: departureTour.id, date: "soon", name: "A", email: "nope", partySize: 0 }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual(["date", "email", "name", "partySize"]);

    const noTour = await errorOf(join(tenant.tenantId, { date: DATE }));
    expect(noTour.fieldErrors?.tourId?.[0]).toBe("Choose a tour.");
  });

  it("needs a real calendar date for today", async () => {
    await expect(
      withTenant(tenant.tenantId, (scope) =>
        joinWaitlist(scope, { tourId: departureTour.id, date: DATE, name: "Aiko Tanaka", email: "aiko@example.test" }, { today: "today", now: NOW }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });

  describe("tenant isolation", () => {
    it("cannot join the waitlist of another tenant's tour, by id or by slug", async () => {
      const other = await createTenant();
      await expect(errorOf(join(other.tenantId, { tourId: departureTour.id, date: DATE }))).resolves.toBeInstanceOf(NotFoundError);
      await expect(errorOf(join(other.tenantId, { tourSlug: departureTour.slug, date: DATE }))).resolves.toBeInstanceOf(NotFoundError);
    });

    it("ignores a tenant id smuggled into the payload", async () => {
      const other = await createTenant();
      const tour = await createDepartureTour(other.tenantId);
      await createDeparture(other.tenantId, tour.id, DATE, 8);
      await requestBooking(other.tenantId, { tourId: tour.id, date: DATE, adults: 8 });

      const email = `${unique("smuggle")}@example.test`;
      await join(other.tenantId, { tourId: tour.id, date: DATE, email, tenantId: tenant.tenantId });
      const mine = await withTenant(tenant.tenantId, ({ tx }) => tx.select().from(waitlistEntries).where(eq(waitlistEntries.email, email)));
      expect(mine).toHaveLength(0);
      const theirs = await entriesOf(other.tenantId, tour.id);
      expect(theirs.map((entry) => entry.email)).toContain(email);
    });

    it("keeps one tenant's entries out of another tenant's reads", async () => {
      const other = await createTenant();
      const rows = await withTenant(other.tenantId, ({ tx }) => tx.select().from(waitlistEntries));
      expect(rows.every((row) => row.tenantId === other.tenantId)).toBe(true);
    });
  });
});
