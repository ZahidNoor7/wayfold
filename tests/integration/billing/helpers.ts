import { eq } from "drizzle-orm";
import { withTenant } from "@/server/db/context";
import { bookings, customers, invoices, mediaAssets, plans, tenants, tours } from "@/server/db/schema";
import { withPlatform } from "@/server/platform/db";
import { unique, type TenantFixture } from "../../helpers/fixtures";

export async function addTour(tenant: TenantFixture, status: "draft" | "published" | "archived"): Promise<string> {
  const [row] = await withTenant(tenant.tenantId, ({ tx }) =>
    tx.insert(tours).values({ slug: unique("tour"), title: "Sheki day trip", status }).returning({ id: tours.id }),
  );
  return row!.id;
}

export async function addMedia(tenant: TenantFixture, bytes: number, storageOwner: "tenant" | "platform" = "tenant"): Promise<void> {
  await withTenant(tenant.tenantId, ({ tx }) =>
    tx.insert(mediaAssets).values({
      storageOwner,
      provider: "cloudinary",
      publicId: unique("asset"),
      resourceType: "image",
      url: "https://media.example.test/asset.jpg",
      bytes,
    }),
  );
}

/** A booking received at `createdAt` (an ISO instant), for the given tour. */
export async function addBooking(
  tenant: TenantFixture,
  tourId: string,
  createdAt: string,
  status: "pending" | "confirmed" | "completed" | "cancelled" = "pending",
): Promise<void> {
  await withTenant(tenant.tenantId, async ({ tx }) => {
    const [customer] = await tx
      .insert(customers)
      .values({ name: "Guest", email: `${unique("guest")}@example.test` })
      .returning({ id: customers.id });
    await tx.insert(bookings).values({
      reference: unique("REF"),
      tourId,
      customerId: customer!.id,
      startDate: "2027-03-10",
      endDate: "2027-03-10",
      adults: 2,
      status,
      currency: "USD",
      unitPriceAdult: 5000,
      unitPriceChild: 2500,
      baseAmount: 10000,
      totalAmount: 10000,
      contactName: "Guest",
      contactEmail: "guest@example.test",
      tourTitle: "Sheki day trip",
      createdAt: new Date(createdAt),
    });
  });
}

export async function setTimezone(tenant: TenantFixture, timezone: string): Promise<void> {
  await withTenant(tenant.tenantId, ({ tx }) => tx.update(tenants).set({ timezone }).where(eq(tenants.id, tenant.tenantId)));
}

/** Invoices are written by the platform only, so the fixture goes through it too. */
export async function addInvoice(
  tenant: TenantFixture,
  overrides: { issuedAt?: Date; amount?: number; status?: "open" | "paid" | "void"; description?: string } = {},
): Promise<{ id: string; number: string }> {
  const issuedAt = overrides.issuedAt ?? new Date();
  const [row] = await withPlatform((tx) =>
    tx
      .insert(invoices)
      .values({
        tenantId: tenant.tenantId,
        number: unique("INV"),
        description: overrides.description ?? "Monthly subscription",
        amount: overrides.amount ?? 4900,
        currency: "USD",
        status: overrides.status ?? "paid",
        periodStart: issuedAt,
        periodEnd: new Date(issuedAt.getTime() + 30 * 86_400_000),
        issuedAt,
        paidAt: overrides.status === "open" ? null : issuedAt,
        providerRef: "ch_internal_reference",
      })
      .returning({ id: invoices.id, number: invoices.number }),
  );
  return row!;
}

export async function addPublicPlan(values: { name: string; sortOrder: number; priceMonthly: number; isPublic?: boolean }): Promise<{ id: string; code: string }> {
  const code = unique("pub");
  const [row] = await withPlatform((tx) =>
    tx
      .insert(plans)
      .values({
        code,
        name: values.name,
        description: `${values.name} plan`,
        priceMonthly: values.priceMonthly,
        priceYearly: values.priceMonthly * 10,
        isPublic: values.isPublic ?? true,
        sortOrder: values.sortOrder,
        maxTeamMembers: 5,
        features: { customDomain: false, integrations: ["email"], platformStorage: false, promotions: false, removeBranding: false },
      })
      .returning({ id: plans.id, code: plans.code }),
  );
  return row!;
}
