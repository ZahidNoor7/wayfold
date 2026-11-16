import { Eye } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StatusTabs } from "@/components/platform/status-tabs";
import { EnterWorkspaceButton } from "@/components/platform/support-actions";
import { Pagination, PlatformHeader, StatusBadge, statusLabel } from "@/components/platform/ui";
import { PageSkeleton } from "@/components/workspace/page-header";
import {
  canEnterWorkspace,
  firstParam,
  formatDateTime,
  pageParam,
  pageWindow,
  pickParam,
  timeLeft,
  type GrantStatus,
  type SearchParams,
} from "@/lib/platform-display";
import { listSupportRequests, type PlatformSupportGrant } from "@/server/platform/support";
import { platformGuard } from "../../_lib/guard";

export const metadata: Metadata = { title: "Support access" };

const PATH = "/platform/support";
const STATUSES: readonly GrantStatus[] = ["requested", "approved", "denied", "revoked", "expired"];
const PAGE_SIZE = 25;

export default function SupportPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Support {...props} />
    </Suspense>
  );
}

function accessWindow(grant: PlatformSupportGrant, now: Date): { main: string; sub: string | null } {
  switch (grant.status) {
    case "requested":
      return { main: "Not decided yet", sub: "Access starts only when the workspace approves" };
    case "approved":
      return { main: grant.expiresAt ? `Until ${formatDateTime(grant.expiresAt)}` : "Approved", sub: grant.expiresAt ? timeLeft(grant.expiresAt, now) : null };
    case "denied":
      return { main: "No access", sub: grant.decidedAt ? `Denied ${formatDateTime(grant.decidedAt)}` : null };
    case "revoked":
      return { main: "Access withdrawn", sub: grant.decidedAt ? `Decided ${formatDateTime(grant.decidedAt)}` : null };
    case "expired":
      return { main: "Ended", sub: grant.expiresAt ? formatDateTime(grant.expiresAt) : null };
  }
}

async function Support({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { actor, admin } = await platformGuard();
  const params = await searchParams;
  const status = pickParam(params.status, STATUSES);
  const sessionEnded = firstParam(params.expired) === "1";

  const page = pageParam(params.page);

  // The page of rows, plus one count per tab (a one-row query each).
  const [result, all, ...counts] = await Promise.all([
    listSupportRequests(actor, { status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    listSupportRequests(actor, { limit: 1 }),
    ...STATUSES.map((value) => listSupportRequests(actor, { status: value, limit: 1 })),
  ]);
  const now = new Date();
  const me = admin.session.user.id;
  const rows = result.items;
  const pager = pageWindow(result.total, page, PAGE_SIZE);
  const countFor = (value: GrantStatus) => counts[STATUSES.indexOf(value)]?.total ?? 0;
  const requester = (grant: PlatformSupportGrant) => (grant.requestedBy === me ? "you" : grant.requesterName || grant.requesterEmail);

  const action = (grant: PlatformSupportGrant) =>
    canEnterWorkspace(grant, me, now) ? (
      <EnterWorkspaceButton grantId={grant.id} tenantName={grant.tenantName} />
    ) : grant.status === "approved" && grant.requestedBy !== me ? (
      <span className="text-xs text-muted-foreground">Only the requester can enter</span>
    ) : null;

  return (
    <>
      <PlatformHeader
        kicker="Ask a workspace for temporary access, and enter once its owners approve."
        title="Support access"
        actions={
          <Link href="/platform/tenants" className="btn btn-default">
            Find a tenant
          </Link>
        }
      />

      {sessionEnded ? (
        <div role="status" className="alert alert-warning mb-4">
          That support session has ended. To enter the workspace again, ask it for access once more.
        </div>
      ) : null}

      <div className="alert mb-5 flex gap-3 bg-card">
        <Eye aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold">Support access is view-only and visible to the workspace.</p>
          <p className="mt-1 text-muted-foreground">
            A request does nothing until someone in the workspace approves it, for a length of time they choose. Inside, you can look but not change anything, and
            billing stays hidden. A banner shows on every page for the whole session, and the request, the start and the end are written to the workspace&apos;s
            own activity log. A session lasts at most 60 minutes and never outlives the approval. The workspace can withdraw access at any moment.
          </p>
          <p className="mt-1 text-muted-foreground">To ask for access, open the tenant and choose Request support access.</p>
        </div>
      </div>

      <StatusTabs
        path={PATH}
        name="status"
        label="Request status"
        value={status ?? ""}
        tabs={[{ value: "", label: "All", count: all.total }, ...STATUSES.map((value) => ({ value, label: statusLabel("grant", value), count: countFor(value) }))]}
      />

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-14 text-center">
            <p className="font-bold">{page > 1 ? "Nothing on this page" : status ? `No ${statusLabel("grant", status).toLowerCase()} requests` : "No support requests yet"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {status ? "Choose another status to see the rest." : "When a business needs help inside its workspace, open the tenant and request access from there."}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="table min-w-[900px]">
                <thead>
                  <tr>
                    <th scope="col" className="pl-6">
                      Tenant
                    </th>
                    <th scope="col">Reason</th>
                    <th scope="col">Requested</th>
                    <th scope="col">Access window</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="pr-6">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((grant) => {
                    const access = accessWindow(grant, now);
                    return (
                      <tr key={grant.id}>
                        <td className="pl-6">
                          <Link href={`/platform/tenants/${grant.tenantId}`} className="block font-bold text-primary underline-offset-4 hover:underline">
                            {grant.tenantName}
                          </Link>
                          <span className="text-xs text-muted-foreground">{grant.tenantSlug}</span>
                        </td>
                        <td className="max-w-[320px] whitespace-pre-line text-muted-foreground">{grant.reason}</td>
                        <td className="whitespace-nowrap text-muted-foreground">
                          {formatDateTime(grant.createdAt)}
                          <span className="block text-xs">By {requester(grant)}</span>
                        </td>
                        <td className="whitespace-nowrap">
                          {access.main}
                          {access.sub ? <span className="block text-xs text-muted-foreground">{access.sub}</span> : null}
                        </td>
                        <td>
                          <StatusBadge kind="grant" status={grant.status} />
                        </td>
                        <td className="pr-6 text-right">{action(grant)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="divide-y md:hidden">
              {rows.map((grant) => {
                const access = accessWindow(grant, now);
                return (
                  <li key={grant.id} className="flex flex-col gap-1.5 p-4">
                    <span className="flex items-center justify-between gap-2">
                      <Link href={`/platform/tenants/${grant.tenantId}`} className="min-w-0 truncate font-bold text-primary underline-offset-4 hover:underline">
                        {grant.tenantName}
                      </Link>
                      <StatusBadge kind="grant" status={grant.status} className="shrink-0" />
                    </span>
                    <span className="whitespace-pre-line text-sm text-muted-foreground">{grant.reason}</span>
                    <span className="text-[13px]">
                      {access.main}
                      {access.sub ? <span className="text-muted-foreground">, {access.sub.toLowerCase()}</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Requested {formatDateTime(grant.createdAt)} by {requester(grant)}
                    </span>
                    {action(grant) ? <span className="pt-1">{action(grant)}</span> : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <Pagination path={PATH} params={{ status }} pager={pager} total={result.total} noun={result.total === 1 ? "request" : "requests"} />
      </div>
    </>
  );
}
