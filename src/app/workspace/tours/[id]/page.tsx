import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/workspace/page-header";
import { TourEditor } from "@/components/workspace/tours/tour-editor";
import { tourToValues, type DepartureDay } from "@/components/workspace/tours/tour-form-model";
import { addDays, todayIn } from "@/lib/dates";
import { requireWorkspace } from "@/server/auth/guards";
import { inWorkspace } from "@/server/auth/workspace";
import { getTourAvailability, MAX_AVAILABILITY_DAYS } from "@/server/bookings/availability";
import { listAvailabilityBlocks } from "@/server/catalog/availability";
import { getTour } from "@/server/catalog/tours";
import { NotFoundError } from "@/server/errors";
import { editorAccess, loadEditorContext } from "../editor-data";

export const metadata = { title: "Edit tour" };

type Params = Promise<{ id: string }>;

export default function EditTourPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Params }) {
  const { id } = await params;
  const workspace = await requireWorkspace("tours.manage");
  const today = todayIn(workspace.tenant.timezone);

  const data = await inWorkspace(workspace, async (scope) => {
    const tour = await getTour(scope, id);
    const context = await loadEditorContext(scope);
    // Current and upcoming closures only; past ones no longer affect anything.
    const blocks = await listAvailabilityBlocks(scope, { tourId: tour.id, from: today });

    // Live seat counts for departure dates, from the same calendar guests book against.
    const departureDays: Record<string, DepartureDay> = {};
    if (tour.kind === "departure" && tour.departures.some((departure) => departure.startDate >= today)) {
      const calendar = await getTourAvailability(scope, tour.id, {
        from: today,
        to: addDays(today, MAX_AVAILABILITY_DAYS - 1),
        today,
        includeUnpublished: true,
      });
      const dates = new Set(tour.departures.map((departure) => departure.startDate));
      for (const day of calendar.days) {
        if (dates.has(day.date)) departureDays[day.date] = { state: day.state, reason: day.reason, seatsLeft: day.seatsLeft, capacity: day.capacity };
      }
    }
    return { tour, context, blocks, departureDays };
  }).catch((error: unknown) => {
    // Unknown ids and other workspaces' tours are the same "not found".
    if (error instanceof NotFoundError) return null;
    throw error;
  });
  if (!data) notFound();

  const { tour, context, blocks, departureDays } = data;

  return (
    <TourEditor
      key={tour.id}
      tour={{ id: tour.id, status: tour.status, kind: tour.kind, slug: tour.slug, publishedAt: tour.publishedAt ? tour.publishedAt.toISOString() : null }}
      initial={tourToValues(tour, workspace.tenant.currency)}
      {...editorAccess(workspace)}
      {...context}
      departures={tour.departures.map((departure) => ({
        id: departure.id,
        startDate: departure.startDate,
        startTime: departure.startTime,
        capacity: departure.capacity,
        isOpen: departure.isOpen,
        seatsBooked: departure.seatsBooked,
      }))}
      departureDays={departureDays}
      blocks={blocks.map((block) => ({ id: block.id, tourId: block.tourId, startDate: block.startDate, endDate: block.endDate, reason: block.reason }))}
      today={today}
    />
  );
}
