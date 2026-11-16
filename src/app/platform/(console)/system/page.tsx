import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterBar } from "@/components/platform/filter-bar";
import { ActivityList, Details, HealthMark, Pagination, PlatformHeader, Section } from "@/components/platform/ui";
import { PageSkeleton } from "@/components/workspace/page-header";
import {
  actorLabel,
  buildHref,
  firstParam,
  formatCount,
  formatDateTime,
  healthRows,
  isUuidLike,
  pageParam,
  pageWindow,
  pickParam,
  worstHealth,
  type HealthState,
  type SearchParams,
} from "@/lib/platform-display";
import { getSystemHealth } from "@/server/platform/analytics";
import { AUDIT_ACTOR_TYPES, listPlatformAudit } from "@/server/platform/audit";
import { getLastScheduledRun } from "@/server/platform/jobs";
import { loadTenantDirectory } from "../../_lib/data";
import { platformGuard } from "../../_lib/guard";

export const metadata: Metadata = { title: "System" };

const PATH = "/platform/system";
const PAGE_SIZE = 25;
const PERIODS = { "24h": 1, "7d": 7, "30d": 30 } as const;
type Period = keyof typeof PERIODS;
const PERIOD_KEYS = Object.keys(PERIODS) as Period[];
/** A run older than this suggests the scheduler has stopped calling /api/cron. */
const STALE_RUN_MS = 60 * 60_000;

const OVERALL: Record<HealthState, string> = {
  ok: "All checks pass",
  warn: "Needs attention",
  fail: "A check is failing",
  unknown: "A check could not be completed",
};

export default function SystemPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <System {...props} />
    </Suspense>
  );
}

async function System({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { actor } = await platformGuard();
  const params = await searchParams;
  const action = firstParam(params.action).slice(0, 100);
  const tenantParam = firstParam(params.tenant);
  const tenantId = isUuidLike(tenantParam) ? tenantParam : undefined;
  const actorType = pickParam(params.actor, AUDIT_ACTOR_TYPES);
  const period = pickParam(params.period, PERIOD_KEYS);
  const page = pageParam(params.page);
  const now = new Date();
  const from = period ? new Date(now.getTime() - PERIODS[period] * 86_400_000) : undefined;

  const [health, lastRun, log, directory] = await Promise.all([
    getSystemHealth(actor),
    getLastScheduledRun(actor),
    listPlatformAudit(actor, { action: action || undefined, tenantId, actorType, from, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    loadTenantDirectory(actor),
  ]);

  const checks = healthRows(health, now);
  const runState: HealthState = !lastRun
    ? "unknown"
    : lastRun.result.errors && Object.values(lastRun.result.errors).some((count) => count > 0)
      ? "warn"
      : now.getTime() - new Date(lastRun.at).getTime() > STALE_RUN_MS
        ? "warn"
        : "ok";
  const overall = worstHealth([...checks, { state: runState === "unknown" ? "warn" : runState }]);

  const pager = pageWindow(log.total, page, PAGE_SIZE);
  const query = { action, tenant: tenantId, actor: actorType, period };
  const filtered = Boolean(action || tenantId || actorType || period);
  const run = lastRun?.result;
  const runErrors = run ? (run.errors?.holds ?? 0) + (run.errors?.notifications ?? 0) + (run.errors?.sessions ?? 0) : 0;

  return (
    <>
      <PlatformHeader
        kicker={`Checked ${formatDateTime(now)}. Reload the page to check again.`}
        title="System"
        badge={<HealthMark state={overall}>{OVERALL[overall]}</HealthMark>}
      />

      <div className="mb-5 grid gap-5 xl:grid-cols-[3fr_2fr]">
        <Section id="health" title="Health checks" description="What Wayfold needs in order to serve workspaces and storefronts safely" className="overflow-hidden">
          <ul className="divide-y border-t">
            {checks.map((check) => (
              <li key={check.key} className="grid gap-x-6 gap-y-1 px-5 py-3.5 sm:grid-cols-[minmax(0,220px)_minmax(0,150px)_1fr] sm:items-center sm:px-6">
                <span className="text-sm font-semibold">{check.label}</span>
                <HealthMark state={check.state}>{check.status}</HealthMark>
                <span className="text-[13px] leading-relaxed text-muted-foreground">{check.detail}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="jobs"
          title="Scheduled jobs"
          description="Expire stale booking holds, send queued notifications, remove expired sessions"
          actions={
            !lastRun ? (
              <HealthMark state="unknown">Never run</HealthMark>
            ) : runState === "ok" ? (
              <HealthMark state="ok">Ran</HealthMark>
            ) : (
              <HealthMark state="warn">{runErrors > 0 ? "Ran with failures" : "Not run recently"}</HealthMark>
            )
          }
        >
          <div className="card-content">
            {!lastRun || !run ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                The scheduled jobs have never run. Booking holds will not expire and queued e-mails will not be sent until they do. Check that the scheduler calls
                /api/cron with the CRON_SECRET bearer token.
              </p>
            ) : (
              <Details
                items={[
                  { label: "Last run", value: formatDateTime(lastRun.at) },
                  { label: "Took", value: `${formatCount(Math.round((run.durationMs ?? 0) / 100) / 10)} s` },
                  { label: "Workspaces", value: formatCount(run.tenants ?? 0) },
                  { label: "Holds expired", value: formatCount(run.holdsExpired ?? 0) },
                  {
                    label: "Notifications",
                    value: `${formatCount(run.notifications?.sent ?? 0)} sent, ${formatCount(run.notifications?.failed ?? 0)} failed, ${formatCount(
                      (run.notifications?.retrying ?? 0) + (run.notifications?.deferred ?? 0),
                    )} waiting`,
                  },
                  { label: "Sessions removed", value: formatCount(run.sessionsDeleted ?? 0) },
                  {
                    label: "Failures",
                    value:
                      runErrors > 0
                        ? `${formatCount(run.errors.holds)} hold, ${formatCount(run.errors.notifications)} notification, ${formatCount(run.errors.sessions)} session`
                        : "None",
                  },
                ]}
              />
            )}
            {lastRun && runState === "warn" && runErrors === 0 ? (
              <p className="mt-4 text-[13px] text-amber-700 dark:text-amber-400">The last run was more than an hour ago. Check that the scheduler is still calling /api/cron.</p>
            ) : null}
          </div>
        </Section>
      </div>

      <h2 className="mb-1 font-display text-2xl font-semibold text-primary">Audit log</h2>
      <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Every recorded event across Wayfold, newest first: what platform admins, workspace members, support sessions and system jobs did.
      </p>

      <FilterBar
        path={PATH}
        search={{ name: "action", label: "Event code starts with", placeholder: "Event code, e.g. tenant. or support.", value: action }}
        selects={[
          {
            name: "tenant",
            label: "Workspace",
            value: tenantId ?? "",
            options: [
              { value: "", label: "All workspaces" },
              ...(tenantId && !directory.byId.has(tenantId) ? [{ value: tenantId, label: log.items[0]?.tenantName ?? "Selected workspace" }] : []),
              ...directory.options.map((option) => ({ value: option.id, label: option.name })),
            ],
          },
          {
            name: "actor",
            label: "Done by",
            value: actorType ?? "",
            options: [{ value: "", label: "Anyone" }, ...AUDIT_ACTOR_TYPES.map((value) => ({ value, label: actorLabel(value) }))],
          },
          {
            name: "period",
            label: "When",
            value: period ?? "",
            options: [
              { value: "", label: "Any time" },
              { value: "24h", label: "Last 24 hours" },
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
            ],
          },
        ]}
      />

      <div className="card overflow-hidden">
        {log.items.length === 0 ? (
          <div className="p-14 text-center">
            <p className="font-bold">{filtered ? "No events match" : page > 1 ? "Nothing on this page" : "Nothing recorded yet"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered
                ? "Try another event code, workspace, person or period. Event codes match from the start, e.g. tenant. finds every tenant event."
                : page > 1
                  ? "The log is shorter than this page number."
                  : "Events appear here as they happen."}
            </p>
            {filtered || page > 1 ? (
              <Link href={filtered ? PATH : buildHref(PATH, query)} className="btn btn-outline btn-sm mt-5">
                {filtered ? "Clear filters" : "Back to the first page"}
              </Link>
            ) : null}
          </div>
        ) : (
          <ActivityList rows={log.items} showTenant={!tenantId} />
        )}
        <Pagination path={PATH} params={query} pager={pager} total={log.total} noun={log.total === 1 ? "event" : "events"} />
      </div>
    </>
  );
}
