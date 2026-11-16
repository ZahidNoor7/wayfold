import { describe, expect, it, vi } from "vitest";
import { createTenant } from "../../helpers/fixtures";
import { createPrivateTour, errorOf, requestBooking } from "../../helpers/bookings";

vi.mock("@/server/promotions/engine", () => ({ findBestDiscount: vi.fn(async () => null), consumeDiscount: vi.fn(async () => undefined) }));
vi.mock("@/server/notifications/index", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

describe("group size", () => {
  it("refuses a party smaller than the tour's minimum, on the server", async () => {
    const tenant = await createTenant();
    const tour = await createPrivateTour(tenant.tenantId, { minGroupSize: 3, maxGroupSize: 8 });

    const error = await errorOf(requestBooking(tenant.tenantId, { tourId: tour.id, adults: 1, children: 1 }));
    expect(error.fieldErrors?.adults?.[0]).toContain("at least 3");

    const accepted = await requestBooking(tenant.tenantId, { tourId: tour.id, adults: 2, children: 1 });
    expect(accepted.status).toBe("pending");
  });
});
