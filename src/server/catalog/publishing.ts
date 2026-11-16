import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { recordAudit } from "../audit";
import { assertWithinLimit } from "../billing/limits";
import type { TenantScope } from "../db/context";
import { tours } from "../db/schema";
import { ConflictError, ValidationError } from "../errors";
import { countUpcomingDepartures, type TodayOption } from "./departures";
import { completenessErrors, hasErrors } from "./rules";
import { findTourRow, lockCatalog, requireToday, type TourRow } from "./shared";

/**
 * Makes a draft visible on the storefront.
 *
 * Checks that the tour is complete (field-level errors when it is not) and
 * that the plan still has room. The catalogue lock is taken before counting,
 * so two publishes racing for the last free place cannot both succeed.
 */
export async function publishTour(scope: TenantScope, tourId: string, options: TodayOption): Promise<TourRow> {
  const today = requireToday(options.today);
  await lockCatalog(scope);
  const tour = await findTourRow(scope, tourId);
  if (tour.status === "published") return tour;
  if (tour.status === "archived") throw new ConflictError("This tour is archived. Restore it before publishing.");

  const futureDepartures = tour.kind === "departure" ? await countUpcomingDepartures(scope, tour.id, today) : undefined;
  const errors = completenessErrors(tour, { futureDepartures });
  if (hasErrors(errors)) throw new ValidationError("This tour is not ready to publish yet.", errors);

  const [published] = await scope.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.status, "published")));
  await assertWithinLimit(scope, "maxPublishedTours", published?.n ?? 0);

  const [row] = (await scope.tx
    .update(tours)
    .set({ status: "published", publishedAt: new Date() })
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.id, tour.id)))
    .returning()) as [TourRow];
  await recordAudit(scope, { action: "tour.published", targetType: "tour", targetId: tour.id, metadata: { title: tour.title } });
  return row;
}

/** Takes a published tour off the storefront and back to draft. Existing bookings are untouched. */
export async function unpublishTour(scope: TenantScope, tourId: string): Promise<TourRow> {
  const tour = await findTourRow(scope, tourId);
  if (tour.status !== "published") return tour;
  const [row] = (await scope.tx
    .update(tours)
    .set({ status: "draft", publishedAt: null })
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.id, tour.id)))
    .returning()) as [TourRow];
  await recordAudit(scope, { action: "tour.unpublished", targetType: "tour", targetId: tour.id, metadata: { title: tour.title } });
  return row;
}
