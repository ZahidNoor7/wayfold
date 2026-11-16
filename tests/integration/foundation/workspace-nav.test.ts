import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant, type TenantScope } from "@/server/db/context";
import { bookings, discountRequests, inquiries } from "@/server/db/schema";
import { getNavCounts } from "@/server/workspace-nav";
import { createTenant, unique, type TenantFixture } from "../../helpers/fixtures";
import { asOwner, createTour, insertBooking, type TourFixture } from "../../helpers/promotions";

const ZERO = { pendingBookings: 0, pendingDiscountRequests: 0, newInquiries: 0 };

const countsFor = (t: TenantFixture) => asOwner(t, getNavCounts);

async function addBooking(scope: TenantScope, tour: TourFixture, status: "pending" | "confirmed" | "completed" | "cancelled" = "pending") {
  const id = await insertBooking(scope, tour);
  if (status !== "pending") await scope.tx.update(bookings).set({ status }).where(eq(bookings.id, id));
  return id;
}

function addDiscountRequest(scope: TenantScope, tour: TourFixture, status: "pending" | "approved" | "rejected" = "pending") {
  return scope.tx.insert(discountRequests).values({
    reference: unique("DR").toUpperCase(),
    accessTokenHash: unique("hash"),
    name: "Guest",
    email: `${unique("guest")}@example.test`,
    tourId: tour.id,
    guests: 3,
    adults: 2,
    children: 1,
    type: "percent",
    value: 10,
    reason: "Returning customer",
    status,
  });
}

function addInquiry(scope: TenantScope, status: "new" | "read" | "archived" = "new", tourId: string | null = null) {
  return scope.tx.insert(inquiries).values({
    name: "Guest",
    email: `${unique("guest")}@example.test`,
    message: "Do you run this tour in winter?",
    tourId,
    status,
  });
}

describe("getNavCounts", () => {
  it("is all zeros for a workspace with nothing waiting", async () => {
    const a = await createTenant();
    expect(await countsFor(a)).toEqual(ZERO);
    // Plain numbers, not the strings a bigint count would come back as.
    expect(Object.values(await countsFor(a)).every((value) => typeof value === "number")).toBe(true);
  });

  it("counts pending bookings, pending discount requests and new enquiries", async () => {
    const a = await createTenant();
    const tour = await createTour(a);
    await asOwner(a, async (scope) => {
      await addBooking(scope, tour);
      await addBooking(scope, tour);
      await addBooking(scope, tour);
      await addDiscountRequest(scope, tour);
      await addDiscountRequest(scope, tour);
      await addInquiry(scope);
      await addInquiry(scope, "new", tour.id);
      await addInquiry(scope);
      await addInquiry(scope);
    });

    expect(await countsFor(a)).toEqual({ pendingBookings: 3, pendingDiscountRequests: 2, newInquiries: 4 });
  });

  it("ignores bookings, requests and enquiries that are no longer waiting", async () => {
    const a = await createTenant();
    const tour = await createTour(a);
    await asOwner(a, async (scope) => {
      await addBooking(scope, tour);
      await addBooking(scope, tour, "confirmed");
      await addBooking(scope, tour, "completed");
      await addBooking(scope, tour, "cancelled");
      await addDiscountRequest(scope, tour);
      await addDiscountRequest(scope, tour, "approved");
      await addDiscountRequest(scope, tour, "rejected");
      await addInquiry(scope);
      await addInquiry(scope, "read");
      await addInquiry(scope, "archived");
    });

    expect(await countsFor(a)).toEqual({ pendingBookings: 1, pendingDiscountRequests: 1, newInquiries: 1 });
  });

  it("drops an item from its counter as soon as it is handled", async () => {
    const a = await createTenant();
    const tour = await createTour(a);
    const bookingId = await asOwner(a, async (scope) => {
      await addDiscountRequest(scope, tour);
      await addInquiry(scope);
      return addBooking(scope, tour);
    });
    expect(await countsFor(a)).toEqual({ pendingBookings: 1, pendingDiscountRequests: 1, newInquiries: 1 });

    await asOwner(a, async ({ tx }) => {
      await tx.update(bookings).set({ status: "confirmed" }).where(eq(bookings.id, bookingId));
      await tx.update(discountRequests).set({ status: "rejected" });
      await tx.update(inquiries).set({ status: "read" });
    });
    expect(await countsFor(a)).toEqual(ZERO);
  });

  it("sees rows written earlier in the same transaction", async () => {
    const a = await createTenant();
    const tour = await createTour(a);
    const counts = await asOwner(a, async (scope) => {
      await addBooking(scope, tour);
      await addInquiry(scope);
      return getNavCounts(scope);
    });
    expect(counts).toEqual({ pendingBookings: 1, pendingDiscountRequests: 0, newInquiries: 1 });
  });

  it("works on a scope with no signed-in user", async () => {
    const a = await createTenant();
    await asOwner(a, (scope) => addInquiry(scope));
    expect(await withTenant(a.tenantId, getNavCounts)).toEqual({ ...ZERO, newInquiries: 1 });
  });
});

describe("getNavCounts isolation", () => {
  it("does not count another tenant's rows", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const tourB = await createTour(b);
    await asOwner(b, async (scope) => {
      await addBooking(scope, tourB);
      await addBooking(scope, tourB);
      await addDiscountRequest(scope, tourB);
      await addInquiry(scope);
      await addInquiry(scope);
      await addInquiry(scope);
    });

    expect(await countsFor(a)).toEqual(ZERO);
    expect(await countsFor(b)).toEqual({ pendingBookings: 2, pendingDiscountRequests: 1, newInquiries: 3 });
  });

  it("keeps two busy tenants' counters apart", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const tourA = await createTour(a);
    const tourB = await createTour(b);
    await asOwner(a, async (scope) => {
      await addBooking(scope, tourA);
      await addDiscountRequest(scope, tourA);
      await addDiscountRequest(scope, tourA);
      await addDiscountRequest(scope, tourA);
    });
    await asOwner(b, async (scope) => {
      await addBooking(scope, tourB);
      await addBooking(scope, tourB);
      await addInquiry(scope);
    });

    const [forA, forB] = await Promise.all([countsFor(a), countsFor(b)]);
    expect(forA).toEqual({ pendingBookings: 1, pendingDiscountRequests: 3, newInquiries: 0 });
    expect(forB).toEqual({ pendingBookings: 2, pendingDiscountRequests: 0, newInquiries: 1 });
  });

  it("returns zeros for a scope that lies about its tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const tourB = await createTour(b);
    await asOwner(b, async (scope) => {
      await addBooking(scope, tourB);
      await addDiscountRequest(scope, tourB);
      await addInquiry(scope);
    });

    // A's transaction asking for B's numbers: row-level security answers.
    const forged = await asOwner(a, (scope) => getNavCounts({ ...scope, tenantId: b.tenantId }));
    expect(forged).toEqual(ZERO);
  });
});
