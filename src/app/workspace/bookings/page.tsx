import { Download } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BookingsScreen } from "@/components/workspace/bookings/bookings-screen";
import { BOOKINGS_PAGE_SIZE, bookingsHref, exportHref, isFiltered, parseBookingsView, toListInput } from "@/components/workspace/bookings/filters";
import { toDetailView, toRowView, type BookingDetailView } from "@/components/workspace/bookings/view-models";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { pageCount, type SearchParams } from "@/lib/booking-display";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { findClashes, getBooking, listBookings } from "@/server/bookings/service";
import { listTours } from "@/server/catalog/tours";
import { NotFoundError } from "@/server/errors";
import { listIntegrations } from "@/server/integrations";
import { whatsappChatLink } from "@/server/integrations/adapters/whatsapp";

export const metadata = { title: "Bookings" };

export default function BookingsPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const workspace = await requireWorkspace("bookings.view");
  const view = parseBookingsView(await searchParams);
  const now = new Date();
  const timezone = workspace.tenant.timezone;

  const data = await inWorkspace(workspace, async (scope) => {
    const list = await listBookings(scope, toListInput(view), { now });
    // With the conflicts filter on, the list already is the set of clashing bookings.
    const clashCount = view.clash ? list.total : (await findClashes(scope, { now })).length;
    const tours = await listTours(scope, { limit: 100 });

    let detail: BookingDetailView | null = null;
    if (view.booking) {
      try {
        const found = await getBooking(scope, view.booking, { now });
        let whatsapp: string | null = null;
        if (found.booking.contactPhone) {
          const integrations = await listIntegrations(scope);
          // A chat link is only offered once the workspace has set up messaging.
          if (integrations.some((integration) => integration.category === "messaging" && integration.status !== "disabled")) {
            whatsapp = whatsappChatLink(found.booking.contactPhone);
          }
        }
        detail = toDetailView(found, {
          now,
          timezone,
          workspaceName: workspace.tenant.name,
          whatsapp,
          canViewCustomer: can(workspace, "customers.view"),
        });
      } catch (error) {
        // An unknown id, or one from another workspace: the panel says so.
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
    return { list, clashCount, tours: tours.items.map((tour) => ({ id: tour.id, title: tour.title })), detail };
  });

  const { list } = data;
  const pages = pageCount(list.total, BOOKINGS_PAGE_SIZE);
  if (view.page > pages) redirect(bookingsHref(view, { page: pages }));

  const header = (
    <PageHeader
      title="Bookings"
      description="Requests aren’t confirmed until you confirm them here."
      actions={
        can(workspace, "exports.run") && list.total > 0 ? (
          <a href={exportHref(view)} download className="btn btn-outline">
            <Download aria-hidden="true" />
            Export CSV
          </a>
        ) : null
      }
    />
  );

  if (list.counts.all === 0 && !isFiltered(view) && !view.booking) {
    return (
      <>
        {header}
        <EmptyState
          title="No bookings yet"
          description="When a traveller requests a tour on your website, the request appears here for you to confirm, decline or reschedule."
          action={
            can(workspace, "tours.view") ? (
              <Link href="/workspace/tours" className="btn btn-default">
                Check your tours
              </Link>
            ) : null
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <BookingsScreen
        view={view}
        rows={list.rows.map((row) => toRowView(row, { now, timezone }))}
        total={list.total}
        counts={list.counts}
        tours={data.tours}
        clashCount={data.clashCount}
        detail={data.detail}
        permissions={{ manage: can(workspace, "bookings.manage"), promotions: can(workspace, "promotions.view") }}
      />
    </>
  );
}
