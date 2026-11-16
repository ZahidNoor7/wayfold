import { and, eq } from "drizzle-orm";
import { withTenant, type TenantScope } from "@/server/db/context";
import { auditLogs, bookings, customers, tenants, tours } from "@/server/db/schema";
import type { CampaignInput } from "@/server/promotions/campaigns";
import { unique, type TenantFixture } from "./fixtures";

/** The tenant-local "today" every promotions test passes in. */
export const TODAY = "2026-11-15";

export interface TourFixture {
  id: string;
  title: string;
  priceAdult: number;
  childPricePercent: number;
}

/** Runs as the workspace owner, the way a dashboard action does. */
export function asOwner<T>(tenant: TenantFixture, fn: (scope: TenantScope) => Promise<T>): Promise<T> {
  return withTenant(tenant.tenantId, fn, { userId: tenant.ownerId });
}

/** Runs with a tenant but no user, the way a storefront action does. */
export function asVisitor<T>(tenant: TenantFixture, fn: (scope: TenantScope) => Promise<T>): Promise<T> {
  return withTenant(tenant.tenantId, fn);
}

export async function createTour(
  tenant: TenantFixture,
  overrides: Partial<typeof tours.$inferInsert> = {},
): Promise<TourFixture> {
  const slug = unique("tour");
  return asOwner(tenant, async ({ tx, tenantId }) => {
    const [row] = await tx
      .insert(tours)
      .values({ tenantId, slug, title: `Tour ${slug}`, priceAdult: 69_000, childPricePercent: 50, status: "published", ...overrides })
      .returning({ id: tours.id, title: tours.title, priceAdult: tours.priceAdult, childPricePercent: tours.childPricePercent });
    return row!;
  });
}

/** A customer and a pending booking, inside the caller's transaction. Returns the booking id. */
export async function insertBooking(scope: TenantScope, tour: TourFixture, email = `${unique("guest")}@example.test`): Promise<string> {
  const [customer] = await scope.tx
    .insert(customers)
    .values({ tenantId: scope.tenantId, name: "Guest", email })
    .onConflictDoUpdate({ target: [customers.tenantId, customers.email], set: { name: "Guest" } })
    .returning({ id: customers.id });
  const [booking] = await scope.tx
    .insert(bookings)
    .values({
      tenantId: scope.tenantId,
      reference: unique("WF").toUpperCase(),
      tourId: tour.id,
      customerId: customer!.id,
      startDate: "2027-04-17",
      endDate: "2027-04-17",
      adults: 2,
      currency: "USD",
      unitPriceAdult: tour.priceAdult,
      unitPriceChild: Math.round((tour.priceAdult * tour.childPricePercent) / 100),
      baseAmount: tour.priceAdult * 2,
      totalAmount: tour.priceAdult * 2,
      contactName: "Guest",
      contactEmail: email,
      tourTitle: tour.title,
    })
    .returning({ id: bookings.id });
  return booking!.id;
}

export async function setTenantEmail(tenant: TenantFixture, email: string): Promise<void> {
  await asOwner(tenant, ({ tx, tenantId }) => tx.update(tenants).set({ email }).where(eq(tenants.id, tenantId)));
}

/** Audit actions recorded for the tenant, oldest first, optionally for one target. */
export async function auditActions(tenant: TenantFixture, targetId?: string): Promise<string[]> {
  const rows = await asOwner(tenant, ({ tx, tenantId }) =>
    tx
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), targetId ? eq(auditLogs.targetId, targetId) : undefined))
      .orderBy(auditLogs.createdAt, auditLogs.id),
  );
  return rows.map((row) => row.action);
}

/** Resolves to whatever `run` rejects with, so a test can assert on the error's class and fields. */
export async function errorOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to fail, but it succeeded.");
}

/** A valid public, unconditional campaign that is live on `TODAY`. */
export function campaignInput(overrides: Partial<CampaignInput> = {}): CampaignInput {
  return { name: "Autumn harvest", type: "percent", value: 15, startsOn: "2026-11-01", endsOn: "2026-12-15", ...overrides };
}
