import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { storefrontOrigin } from "@/components/workspace/content/storefront-origin";
import { JournalCard } from "@/components/workspace/content/journal/journal-card";
import { JOURNAL_PAGE_SIZE, journalHref, journalListInput, parseJournalParams } from "@/components/workspace/content/journal/journal-model";
import { JournalToolbar } from "@/components/workspace/content/journal/journal-toolbar";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { pageCount, pageSummary, type SearchParams } from "@/lib/booking-display";
import { requireWorkspace } from "@/server/auth/guards";
import { inWorkspace } from "@/server/auth/workspace";
import { listJourneyEntries } from "@/server/content/journey";

export const metadata = { title: "Journal" };

export default function JournalPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={6} />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const workspace = await requireWorkspace("content.manage");
  const view = parseJournalParams(await searchParams);
  const { items, total } = await inWorkspace(workspace, (scope) => listJourneyEntries(scope, journalListInput(view)));

  const pages = pageCount(total, JOURNAL_PAGE_SIZE);
  // A stale link past the end lands on the last page instead of an empty one.
  if (total > 0 && view.page > pages) redirect(journalHref({ ...view, page: pages }));

  const origin = storefrontOrigin(workspace);
  const filtered = view.status !== "all" || view.q !== "";

  const header = (
    <PageHeader
      title="Journal"
      description="Entries appear in the My Journey gallery, timeline and map."
      actions={
        <Link href="/workspace/journal/new" className="btn btn-default">
          <Plus aria-hidden="true" />
          Add journal entry
        </Link>
      }
    />
  );

  if (total === 0 && !filtered) {
    return (
      <>
        {header}
        <EmptyState
          title="No journal entries yet"
          description="Share the places you have guided: a cover photo, a few highlights and a photo set. Entries stay drafts until you publish them."
          action={
            <Link href="/workspace/journal/new" className="btn btn-default">
              Write your first entry
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <JournalToolbar status={view.status} q={view.q} />

      {items.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((entry) => (
            <li key={entry.id} className="flex">
              <JournalCard
                origin={origin}
                entry={{
                  id: entry.id,
                  title: entry.title,
                  slug: entry.slug,
                  location: entry.location,
                  visitedOn: entry.visitedOn,
                  photoCount: entry.photos.length,
                  coverUrl: entry.coverUrl,
                  isPublished: entry.isPublished,
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="card p-14 text-center">
          <p className="font-bold">No entries match</p>
          <p className="text-sm text-muted-foreground">Try another search, or show all entries.</p>
          <Link href={journalHref()} className="btn btn-outline btn-sm mt-4">
            Show all entries
          </Link>
        </div>
      )}

      {total > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
          <span>{pageSummary(view.page, JOURNAL_PAGE_SIZE, total)} entries</span>
          {pages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center gap-2">
              {view.page > 1 ? (
                <Link href={journalHref({ ...view, page: view.page - 1 })} className="btn btn-outline btn-sm">
                  Previous
                </Link>
              ) : (
                <span className="btn btn-outline btn-sm" aria-disabled="true">
                  Previous
                </span>
              )}
              <span aria-current="page">
                Page {view.page} of {pages}
              </span>
              {view.page < pages ? (
                <Link href={journalHref({ ...view, page: view.page + 1 })} className="btn btn-outline btn-sm">
                  Next
                </Link>
              ) : (
                <span className="btn btn-outline btn-sm" aria-disabled="true">
                  Next
                </span>
              )}
            </nav>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
