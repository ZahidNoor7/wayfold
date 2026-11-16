import "server-only";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { isIsoDate, isValidTimezone, todayIn } from "../../lib/dates";
import { deleteExpiredSessions } from "../auth/sessions";
import { expireStaleHolds } from "../bookings/service";
import { withTenant, type TenantScope } from "../db/context";
import { auditLogs, tenants } from "../db/schema";
import { deliverPending } from "../notifications";
import { asPlatform, isUuid, type PlatformActor } from "./access";
import { recordPlatformAudit } from "./audit";
import { withPlatform } from "./db";

const RUN_ACTION = "jobs.scheduled_run";
const DEFAULT_TENANT_BATCH = 100;
const MAX_TENANT_BATCH = 500;
/** Messages attempted per workspace in one run; the rest wait for the next run. */
export const NOTIFICATIONS_PER_TENANT = 50;

export interface ScheduledJobsOptions {
  /** The moment the run is "at". Defaults to now. */
  now?: Date;
  /** Overrides every workspace's local calendar day (`YYYY-MM-DD`). Default: `now` in each workspace's timezone. */
  today?: string;
  /** Workspaces listed per query. Default 100, at most 500. */
  tenantBatch?: number;
  /** Limits the run to these workspaces, for example to retry the ones that failed. */
  tenantIds?: string[];
}

export interface ScheduledJobsReport {
  /** Active workspaces visited. */
  tenants: number;
  holdsExpired: number;
  notifications: { sent: number; failed: number; skipped: number; retrying: number; deferred: number };
  sessionsDeleted: number;
  /** How many times each job failed. Counts only: no message of any failure is kept. */
  errors: { holds: number; notifications: number; sessions: number };
}

/** What a per-workspace job is told about the run. */
interface TenantRun {
  now: Date;
  /** The workspace's own calendar day, for jobs that work in dates rather than instants. */
  today: string;
}

/**
 * The per-workspace jobs, in order. Each runs in a transaction of its own, so
 * what one commits (a cancellation notice, say) is visible to the next.
 */
const expireHolds = (scope: TenantScope, run: TenantRun) => expireStaleHolds(scope, run.now);
const deliverNotifications = (scope: TenantScope) => deliverPending(scope, { limit: NOTIFICATIONS_PER_TENANT });

// Class of failure and where, never the message: a driver or mail-server
// error can quote row values, addresses and credentials.
function logFailure(job: string, error: unknown, tenantId?: string): void {
  const kind = error instanceof Error ? error.name : "unknown error";
  console.error(`[wayfold] scheduled job ${job} failed${tenantId ? ` for workspace ${tenantId}` : ""} (${kind})`);
}

/**
 * System-only: the periodic housekeeping, meant to be called every few
 * minutes by a scheduler. For each active workspace it cancels booking
 * requests whose hold has run out, then sends that workspace's queued
 * notifications; finally it removes expired sessions.
 *
 * The platform connection is used only to list workspaces (id and timezone)
 * and to write the summary. All work on a workspace's data happens inside
 * that workspace's own `withTenant` transaction, under row-level security,
 * one transaction per job: a failure rolls back that one job for that one
 * workspace and the run carries on with the next.
 */
export async function runScheduledJobs(options: ScheduledJobsOptions = {}): Promise<ScheduledJobsReport> {
  const now = options.now ?? new Date();
  const fixedToday = options.today !== undefined && isIsoDate(options.today) ? options.today : null;
  const batch = Math.min(Math.max(Math.trunc(options.tenantBatch ?? DEFAULT_TENANT_BATCH) || DEFAULT_TENANT_BATCH, 1), MAX_TENANT_BATCH);
  const only = options.tenantIds?.filter(isUuid);
  const started = Date.now();

  const report: ScheduledJobsReport = {
    tenants: 0,
    holdsExpired: 0,
    notifications: { sent: 0, failed: 0, skipped: 0, retrying: 0, deferred: 0 },
    sessionsDeleted: 0,
    errors: { holds: 0, notifications: 0, sessions: 0 },
  };

  // Keyset paging: stable while workspaces are created or suspended mid-run.
  let after: string | null = null;
  for (;;) {
    const cursor: string | null = after;
    const page: { id: string; timezone: string }[] = await withPlatform((tx) =>
      tx
        .select({ id: tenants.id, timezone: tenants.timezone })
        .from(tenants)
        .where(and(eq(tenants.status, "active"), cursor ? gt(tenants.id, cursor) : undefined, only ? inArray(tenants.id, only) : undefined))
        .orderBy(asc(tenants.id))
        .limit(batch),
    );
    if (page.length === 0) break;
    after = page[page.length - 1]!.id;

    for (const tenant of page) {
      report.tenants += 1;
      const run: TenantRun = { now, today: fixedToday ?? todayIn(isValidTimezone(tenant.timezone) ? tenant.timezone : "UTC", now) };

      try {
        report.holdsExpired += await withTenant(tenant.id, (scope) => expireHolds(scope, run));
      } catch (error) {
        report.errors.holds += 1;
        logFailure("expire-holds", error, tenant.id);
      }

      // Its own transaction, after the one above has committed: the
      // cancellation notices it queued are then visible and go out now.
      try {
        const delivery = await withTenant(tenant.id, deliverNotifications);
        report.notifications.sent += delivery.sent;
        report.notifications.failed += delivery.failed;
        report.notifications.skipped += delivery.skipped;
        report.notifications.retrying += delivery.retrying;
        report.notifications.deferred += delivery.deferred;
      } catch (error) {
        report.errors.notifications += 1;
        logFailure("deliver-notifications", error, tenant.id);
      }
    }
    if (page.length < batch) break;
  }

  try {
    report.sessionsDeleted = await deleteExpiredSessions();
  } catch (error) {
    report.errors.sessions += 1;
    logFailure("delete-expired-sessions", error);
  }

  await withPlatform((tx) =>
    recordPlatformAudit(tx, {
      admin: null,
      action: RUN_ACTION,
      targetType: "job",
      metadata: {
        tenants: report.tenants,
        holdsExpired: report.holdsExpired,
        notifications: report.notifications,
        sessionsDeleted: report.sessionsDeleted,
        errors: report.errors,
        durationMs: Date.now() - started,
      },
    }),
  );
  return report;
}

/** The summary of the most recent scheduled run, or null if none has run yet. */
export async function getLastScheduledRun(
  admin: PlatformActor,
): Promise<{ at: Date; result: ScheduledJobsReport & { durationMs: number } } | null> {
  return asPlatform(admin, "support", async (tx) => {
    const [row] = await tx
      .select({ at: auditLogs.createdAt, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.action, RUN_ACTION))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(1);
    // Written by runScheduledJobs alone, with exactly this shape.
    return row ? { at: row.at, result: row.metadata as unknown as ScheduledJobsReport & { durationMs: number } } : null;
  });
}
