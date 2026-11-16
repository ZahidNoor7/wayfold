import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActivityFilters, type PersonOption } from "@/components/workspace/activity/activity-filters";
import { activeFilterCount, activityHref, activityQuery, ACTOR_KINDS, parseActivityParams } from "@/components/workspace/activity/params";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { auditActionLabel, auditTargetLabel, isSupportActivity, metadataRows } from "@/lib/audit-labels";
import { formatDateTime, type SearchParams } from "@/lib/booking-display";
import { todayIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { decodeAuditCursor, listAuditEntries, type AuditEntryView } from "@/server/audit/read";
import { requireWorkspace } from "@/server/auth/guards";
import { inWorkspace } from "@/server/auth/workspace";
import { listMembers } from "@/server/team/members";

export const metadata = { title: "Activity log" };

export default function ActivityPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Content {...props} />
    </Suspense>
  );
}

function SupportBadge() {
  return (
    <span className="badge badge-pending">
      <ShieldAlert aria-hidden="true" className="size-3" />
      Support
    </span>
  );
}

function Details({ entry }: { entry: AuditEntryView }) {
  const rows = metadataRows(entry.metadata);
  if (rows.length === 0) return null;
  return (
    <details className="group mt-1.5 text-[13px]">
      <summary className="inline-flex min-h-6 cursor-pointer items-center text-primary underline-offset-4 hover:underline">
        <span className="group-open:hidden">Show details</span>
        <span className="hidden group-open:inline">Hide details</span>
      </summary>
      <dl className="mt-2 grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg bg-muted/60 p-3">
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="break-words font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const workspace = await requireWorkspace("audit.view");
  const view = parseActivityParams(await searchParams);
  // A cursor this page did not issue (an edited or truncated link) starts again from the newest entries.
  if (view.cursor && !decodeAuditCursor(view.cursor)) redirect(activityHref({ ...view, cursor: undefined }));

  const { timezone } = workspace.tenant;
  const { page, members } = await inWorkspace(workspace, async (scope) => {
    const page = await listAuditEntries(scope, activityQuery(view, timezone));
    const members = await listMembers(scope);
    return { page, members };
  });

  const people: PersonOption[] = [
    ...members.map((member) => ({ value: member.userId, label: member.status === "active" ? member.name : `${member.name} (deactivated)` })),
    ...Object.entries(ACTOR_KINDS).map(([value, kind]) => ({ value, label: kind.label })),
  ];
  const filtered = activeFilterCount(view) > 0;

  const header = (
    <PageHeader
      title="Activity log"
      description="A permanent record of changes made in this workspace: who did what, and when. Entries cannot be edited or deleted."
    />
  );

  if (!filtered && !view.cursor && page.items.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          title="No activity yet"
          description="Changes to bookings, tours, the team, settings and integrations are recorded here as they happen, together with any visit from Wayfold support."
        />
      </>
    );
  }

  const when = (entry: AuditEntryView) => (
    <time dateTime={entry.createdAt.toISOString()} className="whitespace-nowrap">
      {formatDateTime(entry.createdAt, timezone)}
    </time>
  );

  return (
    <>
      {header}
      <ActivityFilters view={view} people={people} today={todayIn(timezone)} />

      <div className="card overflow-hidden">
        {page.items.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="table min-w-[820px]">
                <thead>
                  <tr>
                    <th scope="col" className="pl-6">
                      When
                    </th>
                    <th scope="col">Who</th>
                    <th scope="col">What</th>
                    <th scope="col" className="pr-6">
                      Affected
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((entry) => {
                    const support = isSupportActivity(entry);
                    return (
                      <tr key={entry.id} className={cn("align-top", support && "bg-[var(--status-pending-bg)]")}>
                        <td className="pl-6 text-muted-foreground">{when(entry)}</td>
                        <td>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold">{entry.actorName}</span>
                            {support ? <SupportBadge /> : null}
                          </span>
                        </td>
                        <td className="max-w-[28rem]">
                          <span className="block">{auditActionLabel(entry.action)}</span>
                          <Details entry={entry} />
                        </td>
                        <td className="pr-6 text-muted-foreground">{auditTargetLabel(entry) ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y md:hidden">
              {page.items.map((entry) => {
                const support = isSupportActivity(entry);
                const target = auditTargetLabel(entry);
                return (
                  <li key={entry.id} className={cn("flex flex-col gap-1 p-4", support && "bg-[var(--status-pending-bg)]")}>
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-bold">{entry.actorName}</span>
                      {support ? <SupportBadge /> : null}
                    </span>
                    <span className="text-sm">{auditActionLabel(entry.action)}</span>
                    <span className="flex w-full flex-wrap justify-between gap-x-3 text-[13px] text-muted-foreground">
                      <span className="min-w-0 truncate">{target ?? ""}</span>
                      {when(entry)}
                    </span>
                    <Details entry={entry} />
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="p-14 text-center">
            <p className="font-bold">No activity matches</p>
            <p className="text-sm text-muted-foreground">
              {view.cursor && !filtered ? "There are no older entries." : "Try another area, person or date range."}
            </p>
            <Link href={activityHref({})} className="btn btn-outline btn-sm mt-4">
              {filtered ? "Clear filters" : "Back to newest"}
            </Link>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-[13px] text-muted-foreground sm:px-6">
          <span>
            {page.items.length} {page.items.length === 1 ? "entry" : "entries"} shown{view.cursor ? ", older than the previous page" : ""}
          </span>
          {view.cursor || page.nextCursor ? (
            <nav aria-label="Pagination" className="flex items-center gap-2">
              {view.cursor ? (
                <Link href={activityHref({ ...view, cursor: undefined })} className="btn btn-outline btn-sm">
                  Newest entries
                </Link>
              ) : null}
              {page.nextCursor ? (
                <Link href={activityHref({ ...view, cursor: page.nextCursor })} className="btn btn-outline btn-sm">
                  Older entries
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </>
  );
}
