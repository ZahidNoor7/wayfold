import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActivityList, DailyBars, HealthMark, KpiCard, PlatformHeader, Section, statusLabel } from "@/components/platform/ui";
import { PageSkeleton } from "@/components/workspace/page-header";
import { formatMoney, todayIn } from "@/lib/dates";
import {
  formatBytes,
  formatCount,
  formatLongDate,
  formatMonth,
  groupIntegrationUsage,
  healthRows,
  revenueTotals,
  worstHealth,
} from "@/lib/platform-display";
import { cn } from "@/lib/utils";
import { getPlatformStats } from "@/server/platform/analytics";
import { listPlatformAudit } from "@/server/platform/audit";
import { platformGuard } from "../_lib/guard";

export const metadata: Metadata = { title: "Overview" };

const BOOKING_STATUSES = ["pending", "confirmed", "completed", "cancelled"] as const;
const SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "cancelled"] as const;

export default function PlatformOverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const { actor, isOwner } = await platformGuard();
  const today = todayIn("UTC");
  // The operational log: what platform admins have done, newest first, with names.
  const [stats, log] = await Promise.all([getPlatformStats(actor, { today }), listPlatformAudit(actor, { actorType: "platform_admin", limit: 10 })]);

  const health = healthRows(stats.health);
  const worst = worstHealth(health);
  const troubled = health.filter((row) => row.state !== "ok");

  const [mrr, ...otherMrr] = stats.mrr;
  const largest = stats.storage.topTenants[0];
  const usage = groupIntegrationUsage(stats.integrations);
  const months = [...stats.revenueByMonth].reverse();
  const paidThisYear = revenueTotals(stats.revenueByMonth);
  const subscriptionTotal = stats.subscriptions.byPlan.reduce((sum, plan) => sum + plan.count, 0);

  return (
    <>
      <PlatformHeader
        kicker={`${formatLongDate(today)}, UTC`}
        title="Platform overview"
        actions={
          isOwner ? (
            <Link href="/platform/tenants?new=1" className="btn btn-default">
              Create tenant
            </Link>
          ) : null
        }
      />

      {worst !== "ok" ? (
        <div role="alert" className={cn("alert mb-5 flex flex-wrap items-center justify-between gap-3", worst === "fail" ? "alert-destructive" : "alert-warning")}>
          <div>
            <p className="font-semibold">{worst === "fail" ? "A system check is failing" : "A system check needs attention"}</p>
            <p className="mt-0.5">{troubled.map((row) => `${row.label}: ${row.status.toLowerCase()}`).join(". ")}.</p>
          </div>
          <Link href="/platform/system" className="btn btn-outline btn-sm bg-background text-foreground">
            Open system status
          </Link>
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard href="/platform/tenants" label="Tenants" value={formatCount(stats.tenants.total)} sub={`${formatCount(stats.tenants.active)} active`} />
        <KpiCard
          href="/platform/tenants"
          label="New this week"
          value={formatCount(stats.registrations.last7Days)}
          sub={`${formatCount(stats.registrations.last30Days)} in the last 30 days`}
          tone={stats.registrations.last7Days > 0 ? "up" : "neutral"}
          dot="bg-highlight"
        />
        <KpiCard
          href="/platform/tenants?status=active"
          label="Active"
          value={formatCount(stats.tenants.active)}
          sub={stats.tenants.total > 0 ? `${Math.round((stats.tenants.active / stats.tenants.total) * 100)}% of all workspaces` : "No workspaces yet"}
          dot="bg-emerald-600"
        />
        <KpiCard
          href="/platform/tenants?status=suspended"
          label="Suspended"
          value={formatCount(stats.tenants.suspended)}
          sub={stats.tenants.suspended > 0 ? "Locked out, storefront offline" : "None suspended"}
          tone={stats.tenants.suspended > 0 ? "warn" : "neutral"}
          dot="bg-amber-500"
        />
        <KpiCard
          href="/platform/billing"
          label="Monthly recurring revenue"
          value={mrr ? formatMoney(mrr.amount, mrr.currency) : "0"}
          sub={
            !mrr
              ? "No paid subscriptions yet"
              : otherMrr.length > 0
                ? `Plus ${otherMrr.map((entry) => formatMoney(entry.amount, entry.currency)).join(", ")}`
                : "Estimate from active subscriptions"
          }
          dot="bg-highlight"
        />
        <KpiCard
          href="/platform/billing"
          label="Active subscriptions"
          value={formatCount(stats.subscriptions.byStatus.active)}
          sub={
            stats.subscriptions.byStatus.past_due > 0
              ? `${formatCount(stats.subscriptions.byStatus.past_due)} past due`
              : `${formatCount(stats.subscriptions.byStatus.trialing)} on trial`
          }
          tone={stats.subscriptions.byStatus.past_due > 0 ? "warn" : "neutral"}
          dot="bg-emerald-600"
        />
        <KpiCard
          href="/platform#bookings"
          label="Bookings, all workspaces"
          value={formatCount(stats.bookings.total)}
          sub={`${formatCount(stats.bookings.byStatus.pending)} waiting for a decision`}
          dot="bg-sky-600"
        />
        <KpiCard
          href="/platform#storage"
          label="Media stored"
          value={formatBytes(stats.storage.totalBytes)}
          sub={largest ? `Largest: ${largest.name}` : "Nothing uploaded yet"}
        />
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[3fr_2fr]">
        <DailyBars
          id="registrations"
          title="New registrations"
          description="Workspaces created per day, last 30 days"
          series={stats.registrations.daily}
          singular="workspace"
          plural="workspaces"
        />

        <Section id="subscriptions" title="Subscriptions" description={`${formatCount(subscriptionTotal)} in total`}>
          <div className="card-content flex flex-col gap-5">
            {stats.subscriptions.byPlan.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No plans exist yet.{" "}
                <Link href="/platform/plans" className="text-primary underline-offset-4 hover:underline">
                  Create the first plan
                </Link>
                .
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {stats.subscriptions.byPlan.map((plan) => (
                  <li key={plan.planId} className="flex flex-col gap-1.5">
                    <span className="flex items-baseline justify-between gap-3 text-sm">
                      <Link href={`/platform/tenants?plan=${plan.planId}`} className="font-semibold underline-offset-4 hover:underline">
                        {plan.planName}
                      </Link>
                      <span className="tabular-nums text-muted-foreground">{formatCount(plan.count)}</span>
                    </span>
                    <span className="progress block" aria-hidden="true">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${subscriptionTotal > 0 ? Math.round((plan.count / subscriptionTotal) * 100) : 0}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="separator" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              {SUBSCRIPTION_STATUSES.map((status) => (
                <div key={status} className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{statusLabel("subscription", status)}</dt>
                  <dd className="font-semibold tabular-nums">{formatCount(stats.subscriptions.byStatus[status])}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Section>
      </div>

      <div className="mb-5 grid scroll-mt-20 gap-5 xl:grid-cols-[3fr_2fr]" id="bookings">
        <DailyBars
          id="bookings-chart"
          title="Bookings across the platform"
          description="Booking requests received per day, last 30 days"
          series={stats.bookings.daily}
          singular="booking"
          plural="bookings"
          aside={
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {BOOKING_STATUSES.map((status) => (
                <div key={status} className="flex gap-1.5">
                  <dt>{statusLabel("booking", status)}</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{formatCount(stats.bookings.byStatus[status])}</dd>
                </div>
              ))}
            </dl>
          }
        />

        <Section
          id="revenue"
          title="Revenue by month"
          description="Paid invoices, last 12 months"
          actions={
            <Link href="/platform/billing" className="btn btn-ghost btn-sm">
              View invoices
            </Link>
          }
        >
          {months.length === 0 ? (
            <p className="card-content text-sm text-muted-foreground">No invoice has been paid in the last 12 months.</p>
          ) : (
            <>
              <div className="max-h-72 overflow-y-auto border-t">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col" className="pl-6">
                        Month
                      </th>
                      <th scope="col" className="text-right">
                        Invoices
                      </th>
                      <th scope="col" className="pr-6 text-right">
                        Paid
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((row) => (
                      <tr key={`${row.month}-${row.currency}`}>
                        <td className="pl-6">{formatMonth(row.month)}</td>
                        <td className="text-right tabular-nums text-muted-foreground">{formatCount(row.invoices)}</td>
                        <td className="pr-6 text-right font-semibold tabular-nums">{formatMoney(row.amount, row.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t px-6 py-3 text-[13px] text-muted-foreground">
                Total: {paidThisYear.map((entry) => formatMoney(entry.amount, entry.currency)).join(", ")}
              </p>
            </>
          )}
        </Section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
        <Section
          id="log"
          title="Recent operational log"
          description="The latest actions by platform admins"
          className="overflow-hidden"
          actions={
            <Link href="/platform/system?actor=platform_admin" className="btn btn-ghost btn-sm">
              Full audit log
            </Link>
          }
        >
          {log.items.length === 0 ? (
            <p className="card-content text-sm text-muted-foreground">No platform admin has acted yet. Changes to tenants, plans, billing and support access appear here.</p>
          ) : (
            <ActivityList rows={log.items} />
          )}
        </Section>

        <div className="flex min-w-0 flex-col gap-5">
          <Section id="storage" title="Storage by workspace" description={`${formatBytes(stats.storage.totalBytes)} stored in total`} className="scroll-mt-20">
            <div className="card-content">
              {stats.storage.topTenants.length === 0 ? (
                <p className="text-sm text-muted-foreground">No workspace has uploaded media yet.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {stats.storage.topTenants.map((tenant) => (
                    <li key={tenant.tenantId} className="flex flex-col gap-1.5">
                      <span className="flex items-baseline justify-between gap-3 text-sm">
                        <Link href={`/platform/tenants/${tenant.tenantId}`} className="min-w-0 truncate font-semibold underline-offset-4 hover:underline">
                          {tenant.name}
                        </Link>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(tenant.bytes)}</span>
                      </span>
                      <span className="progress block" aria-hidden="true">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${stats.storage.totalBytes > 0 ? Math.max(2, Math.round((tenant.bytes / stats.storage.totalBytes) * 100)) : 0}%` }}
                        />
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Section>

          <Section id="integrations" title="Integration usage" description="Connections workspaces have set up, by provider">
            {usage.length === 0 ? (
              <p className="card-content text-sm text-muted-foreground">No workspace has connected a provider yet.</p>
            ) : (
              <ul className="divide-y border-t">
                {usage.map((row) => (
                  <li key={row.provider} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-3 text-sm">
                    <span className="font-semibold capitalize">{row.provider.replace(/_/g, " ")}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <HealthMark state="ok">{formatCount(row.connected)} connected</HealthMark>
                      {row.error > 0 ? <HealthMark state="fail">{formatCount(row.error)} failing</HealthMark> : null}
                      {row.untested > 0 ? <HealthMark state="unknown">{formatCount(row.untested)} not tested</HealthMark> : null}
                      {row.disabled > 0 ? <span className="text-muted-foreground">{formatCount(row.disabled)} disabled</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
