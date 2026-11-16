import { MapPinned, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { CategoryManager } from "@/components/workspace/tours/category-manager";
import { pageCount, parseTourListParams, toListQuery, tourListHref, type StatusTab } from "@/components/workspace/tours/tour-list-params";
import { ToursFilters } from "@/components/workspace/tours/tours-filters";
import { ToursList } from "@/components/workspace/tours/tours-list";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { getEntitlements } from "@/server/billing/limits";
import { ensureDefaultCategories, listCategories } from "@/server/catalog/categories";
import { getTourCounts, listTours } from "@/server/catalog/tours";

export const metadata = { title: "Tours" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function ToursPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const workspace = await requireWorkspace("tours.view");
  const params = parseTourListParams(await searchParams);
  const canManage = can(workspace, "tours.manage");
  const canPublish = can(workspace, "tours.publish");

  const { tours, counts, categories, limit } = await inWorkspace(workspace, async (scope) => {
    const counts = await getTourCounts(scope);
    let categories = await listCategories(scope);
    // A brand-new workspace starts with the standard category list.
    if (categories.length === 0 && counts.draft + counts.published + counts.archived === 0 && canManage) {
      categories = await ensureDefaultCategories(scope);
    }
    const tours = await listTours(scope, toListQuery(params));
    const { limits } = await getEntitlements(scope);
    return { tours, counts, categories, limit: limits.maxPublishedTours };
  });

  const total = counts.draft + counts.published + counts.archived;
  const pages = pageCount(tours.total);
  // A page past the end (a stale link, or the last row of a page was removed) goes to the last page.
  if (tours.items.length === 0 && tours.total > 0) redirect(tourListHref(params, { page: pages }));
  const tabs: { key: StatusTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: total },
    { key: "published", label: "Published", count: counts.published },
    { key: "draft", label: "Drafts", count: counts.draft },
    { key: "archived", label: "Archived", count: counts.archived },
  ];
  const categoryOptions = categories.map((category) => ({ id: category.id, name: category.name, tourCount: category.tourCount }));
  const filtered = params.category !== "" || params.search !== "" || params.featured;
  const atLimit = limit !== null && counts.published >= limit;

  return (
    <>
      <PageHeader
        title="Tours"
        description="Everything you publish here appears on your website."
        actions={
          canManage ? (
            <>
              <Link href="/workspace/destinations" className="btn btn-outline">
                <MapPinned aria-hidden="true" />
                Destinations
              </Link>
              <CategoryManager categories={categoryOptions} />
              <Link href="/workspace/tours/new" className="btn btn-default">
                <Plus aria-hidden="true" />
                Create tour
              </Link>
            </>
          ) : null
        }
      />

      <div role="tablist" aria-label="Tour status" className="tabs-list no-scrollbar mb-6 max-w-full justify-start overflow-x-auto">
        {tabs.map((tab) => (
          <Link key={tab.key} href={tourListHref(params, { status: tab.key })} role="tab" aria-selected={params.status === tab.key} className="tabs-trigger" scroll={false}>
            {tab.label} <span className="rounded-full bg-muted-foreground/15 px-1.5 text-xs">{tab.count}</span>
          </Link>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="text-sm text-muted-foreground">
          {counts.published} published · {counts.draft} draft · {counts.featured} featured on homepage
        </p>
        {limit !== null ? (
          <p className="flex items-center gap-3 text-sm">
            <span
              className="progress h-1.5 w-24"
              role="progressbar"
              aria-label="Published tours used on your plan"
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={Math.min(counts.published, limit)}
            >
              <span className={`block h-full rounded-full ${atLimit ? "bg-highlight" : "bg-primary"}`} style={{ width: `${limit > 0 ? Math.min(100, (counts.published / limit) * 100) : 100}%` }} />
            </span>
            <span className={atLimit ? "font-semibold" : "text-muted-foreground"}>
              {counts.published} of {limit} published
            </span>
            {atLimit ? (
              <Link href="/workspace/billing" className="font-semibold text-primary underline-offset-4 hover:underline">
                Upgrade for more
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>

      {total > 0 ? <ToursFilters key={params.status} params={params} categories={categoryOptions} /> : null}

      <div role="tabpanel" aria-label={`${tabs.find((tab) => tab.key === params.status)?.label ?? "All"} tours`}>
        {tours.items.length === 0 ? (
          total === 0 ? (
            <EmptyState
              title="No tours yet"
              description={
                canManage
                  ? "Create your first tour as a draft, add its details and photos, then publish it when it is ready for guests."
                  : "Tours created by your team will appear here."
              }
              action={
                canManage ? (
                  <Link href="/workspace/tours/new" className="btn btn-default">
                    Create your first tour
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              title={filtered ? "No tours match these filters" : params.status === "archived" ? "Nothing archived" : params.status === "draft" ? "No drafts" : "No published tours"}
              description={
                filtered
                  ? params.search
                    ? `Nothing here matches “${params.search}”. Try a different search or clear the filters.`
                    : "Try a different category, or clear the filters."
                  : params.status === "archived"
                    ? "Tours you archive are kept here, with their bookings and history."
                    : params.status === "draft"
                      ? "Tours you are still working on appear here until you publish them."
                      : "Publish a draft to show it on your website."
              }
              action={
                <Link href={tourListHref({ ...params, category: "", search: "", featured: false }, filtered ? {} : { status: "all" })} className="btn btn-outline">
                  {filtered ? "Clear filters" : "Show all tours"}
                </Link>
              }
            />
          )
        ) : (
          <>
            <ToursList
              items={tours.items.map((tour) => ({
                id: tour.id,
                title: tour.title,
                status: tour.status,
                place: tour.place,
                categoryName: tour.categoryName,
                destinationName: tour.destinationName,
                durationDays: tour.durationDays,
                durationLabel: tour.durationLabel,
                priceAdult: tour.priceAdult,
                isFeatured: tour.isFeatured,
                coverUrl: tour.coverUrl,
                mediaCount: tour.mediaCount,
              }))}
              currency={workspace.tenant.currency} canManage={canManage} canPublish={canPublish} />
            {pages > 1 ? (
              <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Page {Math.min(params.page, pages)} of {pages} · {tours.total} {tours.total === 1 ? "tour" : "tours"}
                </p>
                <div className="flex gap-2">
                  {params.page > 1 ? (
                    <Link href={tourListHref(params, { page: params.page - 1 })} className="btn btn-outline btn-sm" rel="prev">
                      Previous
                    </Link>
                  ) : (
                    <span className="btn btn-outline btn-sm" aria-disabled="true">
                      Previous
                    </span>
                  )}
                  {params.page < pages ? (
                    <Link href={tourListHref(params, { page: params.page + 1 })} className="btn btn-outline btn-sm" rel="next">
                      Next
                    </Link>
                  ) : (
                    <span className="btn btn-outline btn-sm" aria-disabled="true">
                      Next
                    </span>
                  )}
                </div>
              </nav>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
