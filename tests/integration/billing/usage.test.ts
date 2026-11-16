import { describe, expect, it } from "vitest";
import { getUsage, monthBounds } from "@/server/billing/usage";
import { withTenant } from "@/server/db/context";
import { invitations } from "@/server/db/schema";
import { ValidationError } from "@/server/errors";
import { inviteMember, revokeInvitation } from "@/server/team/invitations";
import { createTenant } from "../../helpers/fixtures";
import { addMember, ownerActor, systemRole } from "../team/helpers";
import { addBooking, addMedia, addTour, setTimezone } from "./helpers";

describe("usage", () => {
  it("is all zeros for a new workspace, apart from its owner", async () => {
    const tenant = await createTenant();

    const usage = await withTenant(tenant.tenantId, (scope) => getUsage(scope, { today: "2027-03-15" }));

    expect(usage).toEqual({ teamMembers: 1, pendingInvitations: 0, publishedTours: 0, storageBytes: 0, bookingsThisMonth: 0 });
  });

  it("counts active members and only the invitations still waiting", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const actor = ownerActor(tenant);
    await addMember(tenant, "staff");
    await addMember(tenant, "admin", { status: "deactivated" });
    const invite = (email: string) => withTenant(tenant.tenantId, (scope) => inviteMember(scope, actor, { email, roleId: staff.id }));
    await invite("waiting-one@example.test");
    await invite("waiting-two@example.test");
    const withdrawn = await invite("withdrawn@example.test");
    await withTenant(tenant.tenantId, (scope) => revokeInvitation(scope, withdrawn.invitationId));

    const usage = await withTenant(tenant.tenantId, (scope) => getUsage(scope, { today: "2027-03-15" }));
    expect(usage).toMatchObject({ teamMembers: 2, pendingInvitations: 2 });

    // Eight days on, the remaining invitations have lapsed and hold no seat.
    const later = new Date(Date.now() + 8 * 86_400_000);
    const afterExpiry = await withTenant(tenant.tenantId, (scope) => getUsage(scope, { today: "2027-03-15", now: later }));
    expect(afterExpiry).toMatchObject({ teamMembers: 2, pendingInvitations: 0 });
    expect(await withTenant(tenant.tenantId, ({ tx }) => tx.select().from(invitations))).toHaveLength(3);
  });

  it("counts published tours only and adds up the media library", async () => {
    const tenant = await createTenant();
    await addTour(tenant, "published");
    await addTour(tenant, "published");
    await addTour(tenant, "draft");
    await addTour(tenant, "archived");
    await addMedia(tenant, 1_500_000);
    await addMedia(tenant, 2_500_000, "platform");
    // Larger than a 32-bit integer, to prove the sum is not truncated.
    await addMedia(tenant, 5_000_000_000);

    const usage = await withTenant(tenant.tenantId, (scope) => getUsage(scope, { today: "2027-03-15" }));

    expect(usage.publishedTours).toBe(2);
    expect(usage.storageBytes).toBe(5_004_000_000);
  });

  it("counts the bookings received in the calendar month of today, whatever their status", async () => {
    const tenant = await createTenant();
    const tour = await addTour(tenant, "published");
    await addBooking(tenant, tour, "2027-02-28T23:59:59Z");
    await addBooking(tenant, tour, "2027-03-01T00:00:00Z");
    await addBooking(tenant, tour, "2027-03-15T12:00:00Z", "cancelled");
    await addBooking(tenant, tour, "2027-03-31T23:59:59Z", "confirmed");
    await addBooking(tenant, tour, "2027-04-01T00:00:00Z");

    const count = (today: string) => withTenant(tenant.tenantId, async (scope) => (await getUsage(scope, { today })).bookingsThisMonth);

    expect(await count("2027-03-15")).toBe(3);
    expect(await count("2027-03-01")).toBe(3);
    expect(await count("2027-02-10")).toBe(1);
    expect(await count("2027-04-30")).toBe(1);
    expect(await count("2027-05-01")).toBe(0);
  });

  it("draws the month boundary in the workspace's own timezone", async () => {
    const tenant = await createTenant();
    await setTimezone(tenant, "Asia/Baku"); // UTC+4, no daylight saving
    const tour = await addTour(tenant, "published");
    // 00:30 on 1 March in Baku is still 28 February in UTC.
    await addBooking(tenant, tour, "2027-02-28T20:30:00Z");
    // 23:30 on 31 March in Baku.
    await addBooking(tenant, tour, "2027-03-31T19:30:00Z");
    // 00:30 on 1 April in Baku, although still 31 March in UTC.
    await addBooking(tenant, tour, "2027-03-31T20:30:00Z");

    const count = (today: string) => withTenant(tenant.tenantId, async (scope) => (await getUsage(scope, { today })).bookingsThisMonth);

    expect(await count("2027-03-20")).toBe(2);
    expect(await count("2027-02-20")).toBe(0);
    expect(await count("2027-04-20")).toBe(1);
  });

  it("rejects a value that is not a calendar date", async () => {
    const tenant = await createTenant();
    for (const today of ["2027-13-01", "15/03/2027", "", "2027-02-30"]) {
      await expect(withTenant(tenant.tenantId, (scope) => getUsage(scope, { today }))).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("works out month boundaries, including across a year end", () => {
    expect(monthBounds("2027-03-15")).toEqual({ start: "2027-03-01", end: "2027-04-01" });
    expect(monthBounds("2027-12-31")).toEqual({ start: "2027-12-01", end: "2028-01-01" });
    expect(monthBounds("2028-02-29")).toEqual({ start: "2028-02-01", end: "2028-03-01" });
    expect(monthBounds("2027-09-30")).toEqual({ start: "2027-09-01", end: "2027-10-01" });
  });
});
