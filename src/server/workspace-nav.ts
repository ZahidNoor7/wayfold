import "server-only";
import { and, count, eq } from "drizzle-orm";
import type { TenantScope } from "./db/context";
import { bookings, discountRequests, inquiries } from "./db/schema";

export interface NavCounts {
  pendingBookings: number;
  pendingDiscountRequests: number;
  newInquiries: number;
}

/** Counters shown beside sidebar links. Tenant-scoped like everything else. */
export async function getNavCounts(scope: TenantScope): Promise<NavCounts> {
  // One transaction is one connection: its queries run one after another.
  const [pending] = await scope.tx
    .select({ n: count() })
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.status, "pending")));
  const [requests] = await scope.tx
    .select({ n: count() })
    .from(discountRequests)
    .where(and(eq(discountRequests.tenantId, scope.tenantId), eq(discountRequests.status, "pending")));
  const [fresh] = await scope.tx
    .select({ n: count() })
    .from(inquiries)
    .where(and(eq(inquiries.tenantId, scope.tenantId), eq(inquiries.status, "new")));
  return { pendingBookings: pending?.n ?? 0, pendingDiscountRequests: requests?.n ?? 0, newInquiries: fresh?.n ?? 0 };
}
