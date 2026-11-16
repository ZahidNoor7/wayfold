import { CircleAlert, CircleCheck, CircleHelp, CircleX, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  actorLabel,
  barHeights,
  buildHref,
  describeAction,
  formatCount,
  formatDateTime,
  formatDay,
  summariseSeries,
  tickIndexes,
  usage,
  type ActorType,
  type DailyPoint,
  type HealthState,
  type PageWindow,
} from "@/lib/platform-display";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- header */

interface PlatformHeaderProps {
  /** The line above the title, as in the design's admin pages. */
  kicker?: ReactNode;
  title: string;
  /** Sits beside the title, e.g. a status badge. */
  badge?: ReactNode;
  actions?: ReactNode;
}

export function PlatformHeader({ kicker, title, badge, actions }: PlatformHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {kicker ? <p className="text-[13px] text-muted-foreground">{kicker}</p> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-display text-3xl font-semibold text-primary sm:text-4xl">{title}</h1>
          {badge}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* ------------------------------------------------------------------- KPI */

type KpiTone = "up" | "warn" | "neutral";

const KPI_TONES: Record<KpiTone, string> = {
  up: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  neutral: "text-muted-foreground",
};

interface KpiCardProps {
  href: string;
  label: string;
  value: string;
  sub: string;
  tone?: KpiTone;
  /** Tailwind background class for the dot, e.g. `bg-highlight`. */
  dot?: string;
}

export function KpiCard({ href, label, value, sub, tone = "neutral", dot = "bg-primary" }: KpiCardProps) {
  return (
    <Link href={href} className="card flex min-w-0 flex-col gap-2 p-5 transition-shadow hover:shadow-md">
      <span className="flex items-center justify-between gap-2 text-[13px] font-medium text-muted-foreground">
        {label}
        <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
      </span>
      <span className="truncate font-display text-[38px] font-semibold leading-none text-primary">{value}</span>
      <span className={cn("text-xs font-semibold", KPI_TONES[tone])}>{sub}</span>
    </Link>
  );
}

/* ---------------------------------------------------------------- badges */

type BadgeTone = "pending" | "confirmed" | "completed" | "cancelled";

const STATUS: Record<string, Record<string, { label: string; tone: BadgeTone }>> = {
  tenant: {
    active: { label: "Active", tone: "confirmed" },
    suspended: { label: "Suspended", tone: "cancelled" },
  },
  subscription: {
    trialing: { label: "Trial", tone: "pending" },
    active: { label: "Active", tone: "confirmed" },
    past_due: { label: "Past due", tone: "cancelled" },
    cancelled: { label: "Cancelled", tone: "completed" },
  },
  invoice: {
    open: { label: "Open", tone: "pending" },
    paid: { label: "Paid", tone: "confirmed" },
    void: { label: "Void", tone: "completed" },
  },
  connection: {
    untested: { label: "Not tested", tone: "pending" },
    connected: { label: "Connected", tone: "confirmed" },
    error: { label: "Error", tone: "cancelled" },
    disabled: { label: "Disabled", tone: "completed" },
  },
  grant: {
    requested: { label: "Waiting for approval", tone: "pending" },
    approved: { label: "Approved", tone: "confirmed" },
    denied: { label: "Denied", tone: "cancelled" },
    revoked: { label: "Revoked", tone: "cancelled" },
    expired: { label: "Expired", tone: "completed" },
  },
  domain: {
    pending: { label: "Not verified", tone: "pending" },
    verified: { label: "Verified", tone: "confirmed" },
  },
  booking: {
    pending: { label: "Pending", tone: "pending" },
    confirmed: { label: "Confirmed", tone: "confirmed" },
    completed: { label: "Completed", tone: "completed" },
    cancelled: { label: "Cancelled", tone: "cancelled" },
  },
  member: {
    active: { label: "Active", tone: "confirmed" },
    deactivated: { label: "Deactivated", tone: "completed" },
  },
};

export type StatusKind = "tenant" | "subscription" | "invoice" | "connection" | "grant" | "domain" | "booking" | "member";

/** A status as a word in a tinted badge. The word carries the meaning. */
export function StatusBadge({ kind, status, className }: { kind: StatusKind; status: string; className?: string }) {
  const entry = STATUS[kind]?.[status] ?? { label: describeAction(status), tone: "completed" as const };
  return <span className={cn("badge", `badge-${entry.tone}`, className)}>{entry.label}</span>;
}

export function statusLabel(kind: StatusKind, status: string): string {
  return STATUS[kind]?.[status]?.label ?? describeAction(status);
}

/* ---------------------------------------------------------------- health */

const HEALTH: Record<HealthState, { icon: LucideIcon; className: string }> = {
  ok: { icon: CircleCheck, className: "text-emerald-700 dark:text-emerald-400" },
  warn: { icon: CircleAlert, className: "text-amber-700 dark:text-amber-400" },
  fail: { icon: CircleX, className: "text-destructive" },
  unknown: { icon: CircleHelp, className: "text-muted-foreground" },
};

/** Icon plus a status word: the state is never carried by colour alone. */
export function HealthMark({ state, children }: { state: HealthState; children: ReactNode }) {
  const { icon: Icon, className } = HEALTH[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", className)}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ pagination */

interface PaginationProps {
  path: string;
  /** Current filters, carried over to the previous and next links. */
  params: Record<string, string | number | null | undefined>;
  pager: PageWindow;
  total: number;
  /** Plural noun for the rows, e.g. "tenants". */
  noun: string;
}

export function Pagination({ path, params, pager, total, noun }: PaginationProps) {
  const summary = pager.from === 0 ? `0 of ${formatCount(total)} ${noun}` : `${formatCount(pager.from)}–${formatCount(pager.to)} of ${formatCount(total)} ${noun}`;
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-[13px] text-muted-foreground sm:px-6">
      <p aria-live="polite">{summary}</p>
      {pager.pages > 1 ? (
        <div className="flex items-center gap-2">
          <span>
            Page {formatCount(pager.page)} of {formatCount(pager.pages)}
          </span>
          {pager.hasPrevious ? (
            <Link href={buildHref(path, { ...params, page: Math.min(pager.page - 1, pager.pages) })} className="btn btn-outline btn-sm" rel="prev">
              Previous
            </Link>
          ) : (
            <span className="btn btn-outline btn-sm pointer-events-none opacity-50" aria-disabled="true">
              Previous
            </span>
          )}
          {pager.hasNext ? (
            <Link href={buildHref(path, { ...params, page: pager.page + 1 })} className="btn btn-outline btn-sm" rel="next">
              Next
            </Link>
          ) : (
            <span className="btn btn-outline btn-sm pointer-events-none opacity-50" aria-disabled="true">
              Next
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}

/* ----------------------------------------------------------------- chart */

interface DailyBarsProps {
  /** Unique within the page: ties the heading to the card. */
  id: string;
  title: string;
  description: string;
  series: DailyPoint[];
  singular: string;
  plural: string;
  /** Right side of the header, e.g. a total. */
  aside?: ReactNode;
}

/**
 * The design's bar chart, one bar per day: plain CSS, bars grow from the
 * baseline. Values are available three ways: a spoken summary, a tooltip per
 * bar, and the full table underneath.
 */
export function DailyBars({ id, title, description, series, singular, plural, aside }: DailyBarsProps) {
  const heights = barHeights(series.map((point) => point.count));
  const ticks = tickIndexes(series.length);
  const empty = series.every((point) => point.count === 0);

  return (
    <section aria-labelledby={id} className="card min-w-0">
      <div className="card-header flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <h2 id={id} className="card-title">
            {title}
          </h2>
          <p className="card-description mt-1.5">{description}</p>
        </div>
        {aside}
      </div>
      <div className="card-content">
        <div role="img" aria-label={summariseSeries(series, singular, plural)} className="relative flex h-56 items-end gap-0.5 border-b pb-7 sm:gap-1">
          {series.map((point, index) => (
            <div key={point.date} className="relative flex h-full min-w-0 flex-1 items-end justify-center">
              <div
                className="w-full max-w-6 origin-bottom animate-grow rounded-t-[4px] bg-primary"
                style={{ height: `${heights[index]}%`, animationDelay: `${index * 0.015}s` }}
                title={`${formatDay(point.date)}: ${formatCount(point.count)} ${point.count === 1 ? singular : plural}`}
              />
              {ticks.has(index) ? (
                <span className="absolute -bottom-6 whitespace-nowrap text-xs text-muted-foreground">{formatDay(point.date)}</span>
              ) : null}
            </div>
          ))}
          {empty ? (
            <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">No {plural} in this period yet.</p>
          ) : null}
        </div>
        <details className="mt-3 text-[13px]">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted-foreground underline-offset-4 hover:underline sm:min-h-0">
            Show the daily figures as a table
          </summary>
          <div className="mt-2 max-h-64 overflow-y-auto rounded-md border">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Day (UTC)</th>
                  <th scope="col" className="text-right">
                    {plural.charAt(0).toUpperCase() + plural.slice(1)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {series.map((point) => (
                  <tr key={point.date}>
                    <td>{formatDay(point.date)}</td>
                    <td className="text-right tabular-nums">{formatCount(point.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- meter */

interface MeterProps {
  label: string;
  used: number;
  limit: number | null;
  /** How the numbers read, e.g. "3 of 5 members". */
  reading: string;
  /** Extra context under the bar, e.g. "Plan allows 5; overridden for this workspace". */
  note?: ReactNode;
}

const METER_FILL = { ok: "bg-primary", warn: "bg-amber-500", over: "bg-destructive" } as const;

export function Meter({ label, used, limit, reading, note }: MeterProps) {
  const state = usage(used, limit);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-muted-foreground">{reading}</span>
      </div>
      {state.percent === null ? (
        <div className="progress" aria-hidden="true" />
      ) : (
        <div
          className="progress"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={state.percent}
          aria-valuetext={`${reading}. ${state.label}.`}
        >
          <div className={cn("h-full rounded-full", METER_FILL[state.tone])} style={{ width: `${state.percent}%` }} />
        </div>
      )}
      <p className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
        <span className={cn(state.tone === "over" && "font-semibold text-destructive", state.tone === "warn" && "font-semibold text-amber-700 dark:text-amber-400")}>
          {state.label}
        </span>
        {note ? <span>{note}</span> : null}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- activity */

/** The fields of an audit event the list shows; `listPlatformAudit` items fit as they are. */
export interface ActivityRow {
  id: string;
  at: Date;
  actorType: ActorType;
  /** Null for system events and for accounts that no longer exist. */
  actorName: string | null;
  action: string;
  tenantId: string | null;
  tenantName: string | null;
}

interface ActivityListProps {
  rows: ActivityRow[];
  /** Show which workspace each event concerns. Off on a workspace's own page. */
  showTenant?: boolean;
  /** Always stack the rows, for narrow columns where a table would scroll sideways. */
  stacked?: boolean;
  className?: string;
}

/** Audit events: a table from `md`, stacked rows below it. */
export function ActivityList({ rows, showTenant = true, stacked = false, className }: ActivityListProps) {
  const who = (row: ActivityRow) => (row.actorName ? `${row.actorName} (${actorLabel(row.actorType).toLowerCase()})` : actorLabel(row.actorType));
  const tenantCell = (row: ActivityRow) =>
    row.tenantId ? (
      <Link href={`/platform/tenants/${row.tenantId}`} className="text-primary underline-offset-4 hover:underline">
        {row.tenantName ?? "Removed workspace"}
      </Link>
    ) : (
      <span className="text-muted-foreground">Platform</span>
    );

  return (
    <div className={className}>
      <ul className={cn("divide-y", !stacked && "md:hidden")}>
        {rows.map((row) => (
          <li key={row.id} className={cn("flex flex-col gap-1 px-5 py-3.5", stacked && "sm:px-6")}>
            <span className="font-bold">{describeAction(row.action)}</span>
            <span className="text-[13px] text-muted-foreground">
              {who(row)}
              {showTenant ? <> in {tenantCell(row)}</> : null}
            </span>
            <span className="text-xs text-muted-foreground">{formatDateTime(row.at)}</span>
          </li>
        ))}
      </ul>
      <div className={cn("hidden overflow-x-auto", !stacked && "md:block")}>
        <table className={cn("table", showTenant ? "min-w-[640px]" : "min-w-[480px]")}>
          <thead>
            <tr>
              <th scope="col" className="pl-6">
                Event
              </th>
              <th scope="col">By</th>
              {showTenant ? <th scope="col">Workspace</th> : null}
              <th scope="col" className="pr-6">
                When
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="pl-6 font-semibold">
                  {describeAction(row.action)}
                  <span className="block text-xs font-normal text-muted-foreground">{row.action}</span>
                </td>
                <td className="text-muted-foreground">{who(row)}</td>
                {showTenant ? <td>{tenantCell(row)}</td> : null}
                <td className="whitespace-nowrap pr-6 text-muted-foreground">{formatDateTime(row.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- details */

/** Label and value pairs in the design's two-column definition grid. */
export function Details({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2.5 text-sm">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words font-semibold">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function NotSet() {
  return <span className="font-normal text-muted-foreground">Not set</span>;
}

/** Card with a titled header: the section block every platform page is built from. */
export function Section({ id, title, description, actions, children, className }: { id: string; title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("card min-w-0", className)}>
      <div className="card-header flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <h2 id={id} className="card-title">
            {title}
          </h2>
          {description ? <p className="card-description mt-1.5">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
