import "server-only";
import { desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import journal from "../../../drizzle/meta/_journal.json";
import { addDays, eachDate, isIsoDate } from "../../lib/dates";
import { assertRuntimeRoleIsSafe, withoutTenant } from "../db/context";
import { auditLogs } from "../db/schema";
import { asPlatform, parse, type PlatformActor, type PlatformTx } from "./access";
import { withPlatform } from "./db";

export interface DailyCount {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  count: number;
}

export interface SystemHealth {
  database: {
    /** The platform connection answered (it must have, for this to be returned). */
    platformReachable: boolean;
    /** The tenant-restricted runtime connection answered a trivial query. */
    runtimeReachable: boolean;
  };
  migrations: {
    /** Migrations shipped with this build. */
    expected: number;
    /** Migrations recorded in the database's ledger. Null only when the ledger cannot be read. */
    applied: number | null;
    /** `expected - applied`: migrations this build needs that the database has not had yet. */
    pending: number | null;
  };
  /** Whether the runtime connection is really subject to row-level security. */
  runtimeRole: { safe: boolean; problem: string | null };
  outbox: { pending: number; failed: number; oldestPendingAt: Date | null };
}

export interface PlatformStats {
  /** The UTC calendar day every "last N days" figure ends on. */
  today: string;
  tenants: { total: number; active: number; suspended: number };
  registrations: { last7Days: number; last30Days: number; daily: DailyCount[] };
  subscriptions: {
    byPlan: { planId: string; planCode: string; planName: string; count: number }[];
    byStatus: Record<"trialing" | "active" | "past_due" | "cancelled", number>;
  };
  /** Monthly recurring revenue from active subscriptions, minor units, per currency. */
  mrr: { currency: string; amount: number }[];
  /** Paid invoices by month of payment (`YYYY-MM`), last 12 months, minor units. */
  revenueByMonth: { month: string; currency: string; amount: number; invoices: number }[];
  bookings: {
    total: number;
    byStatus: Record<"pending" | "confirmed" | "completed" | "cancelled", number>;
    daily: DailyCount[];
  };
  storage: { totalBytes: number; topTenants: { tenantId: string; name: string; slug: string; bytes: number }[] };
  integrations: { provider: string; status: "untested" | "connected" | "error" | "disabled"; count: number }[];
  health: SystemHealth;
  /** Latest platform-level events: admin actions and system jobs. */
  recentActivity: {
    id: string;
    actorType: "user" | "platform_admin" | "support_session" | "system";
    actorUserId: string | null;
    tenantId: string | null;
    action: string;
    targetType: string | null;
    targetId: string | null;
    createdAt: Date;
  }[];
}

const SERIES_DAYS = 30;

export const platformStatsSchema = z.object({
  /** `YYYY-MM-DD`. Defaults to the current UTC date. */
  today: z.string().refine(isIsoDate, "Use a date like 2026-01-31.").optional(),
});

/** Turns sparse `{ day, n }` rows into one entry per day, zero-filled. */
function fillDaily(rows: { day: string; n: number }[], start: string, end: string): DailyCount[] {
  const counts = new Map(rows.map((row) => [row.day, row.n]));
  return eachDate(start, end).map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

async function readMigrationsApplied(): Promise<number | null> {
  try {
    // Its own transaction: a permission error here must not poison the caller's.
    const result = await withPlatform((tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`));
    return result.rows[0]?.n ?? null;
  } catch {
    // The ledger lives in the migration owner's schema. A database that predates the grant
    // (or was never migrated) reports "unknown" rather than failing the whole status panel.
    return null;
  }
}

type Outbox = SystemHealth["outbox"];

async function readOutbox(tx: PlatformTx): Promise<Outbox> {
  const outbox = await tx.execute<{ pending: number; failed: number; oldest: Date | null }>(sql`
    select count(*) filter (where status = 'pending')::int as pending,
           count(*) filter (where status = 'failed')::int as failed,
           min(created_at) filter (where status = 'pending') as oldest
    from notification_outbox
  `);
  const queue = outbox.rows[0]!;
  return { pending: queue.pending, failed: queue.failed, oldestPendingAt: queue.oldest ? new Date(queue.oldest) : null };
}

/**
 * The probes that need connections of their own. Run only after the caller's
 * platform transaction has ended: asking the pool for a second connection
 * while still holding one would hang on a pool sized to a single connection.
 */
async function completeHealth(outbox: Outbox): Promise<SystemHealth> {
  let runtimeReachable = true;
  try {
    await withoutTenant((runtime) => runtime.execute(sql`select 1`));
  } catch {
    runtimeReachable = false;
  }

  let runtimeRole: SystemHealth["runtimeRole"] = { safe: true, problem: null };
  try {
    await assertRuntimeRoleIsSafe();
  } catch (error) {
    // UnsafeDatabaseRoleError messages name the misconfiguration and nothing else.
    runtimeRole = {
      safe: false,
      problem: error instanceof Error && error.name === "UnsafeDatabaseRoleError" ? error.message : "The runtime role could not be checked.",
    };
  }

  const expected = journal.entries.length;
  const applied = await readMigrationsApplied();
  return {
    database: { platformReachable: true, runtimeReachable },
    migrations: { expected, applied, pending: applied === null ? null : Math.max(0, expected - applied) },
    runtimeRole,
    outbox,
  };
}

/** Database, migration, role-safety and queue checks for the platform status panel. */
export async function getSystemHealth(admin: PlatformActor): Promise<SystemHealth> {
  return completeHealth(await asPlatform(admin, "support", (tx) => readOutbox(tx)));
}

/** The numbers behind the platform owner's dashboard, across every workspace. */
export async function getPlatformStats(admin: PlatformActor, input: z.input<typeof platformStatsSchema> = {}): Promise<PlatformStats> {
  const { outbox, ...stats } = await asPlatform(admin, "support", async (tx) => {
    const today = parse(platformStatsSchema, input).today ?? new Date().toISOString().slice(0, 10);
    const seriesStart = addDays(today, -(SERIES_DAYS - 1));
    const weekStart = addDays(today, -6);
    // Half-open UTC window [seriesStart 00:00, tomorrow 00:00).
    const from = `${seriesStart}T00:00:00Z`;
    const until = `${addDays(today, 1)}T00:00:00Z`;
    const utcDay = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`);

    const tenantCounts = await tx.execute<{ total: number; active: number; suspended: number }>(sql`
      select count(*)::int as total,
             count(*) filter (where status = 'active')::int as active,
             count(*) filter (where status = 'suspended')::int as suspended
      from tenants
    `);

    const registrations = await tx.execute<{ day: string; n: number }>(sql`
      select ${utcDay("created_at")} as day, count(*)::int as n
      from tenants where created_at >= ${from}::timestamptz and created_at < ${until}::timestamptz
      group by 1
    `);
    const registrationSeries = fillDaily(registrations.rows, seriesStart, today);

    const byPlan = await tx.execute<{ plan_id: string; code: string; name: string; n: number }>(sql`
      select p.id as plan_id, p.code, p.name, count(s.tenant_id)::int as n
      from plans p left join subscriptions s on s.plan_id = p.id
      group by p.id, p.code, p.name, p.sort_order
      order by p.sort_order, p.name
    `);
    const byStatus = await tx.execute<{ status: keyof PlatformStats["subscriptions"]["byStatus"]; n: number }>(
      sql`select status, count(*)::int as n from subscriptions group by status`,
    );

    const mrr = await tx.execute<{ currency: string; amount: string }>(sql`
      select currency, amount::text as amount from (
        select p.currency,
               sum(case when s.cycle = 'yearly' then round(p.price_yearly / 12.0) else p.price_monthly end) as amount
        from subscriptions s join plans p on p.id = s.plan_id
        where s.status = 'active'
        group by p.currency
      ) totals
      where amount > 0
      order by totals.amount desc, currency
    `);

    const revenue = await tx.execute<{ month: string; currency: string; amount: string; n: number }>(sql`
      select to_char(paid_at at time zone 'UTC', 'YYYY-MM') as month, currency, sum(amount)::text as amount, count(*)::int as n
      from invoices
      where status = 'paid'
        and paid_at >= (date_trunc('month', ${`${today}T00:00:00Z`}::timestamptz at time zone 'UTC') - interval '11 months') at time zone 'UTC'
        and paid_at < ${until}::timestamptz
      group by 1, 2
      order by 1, 2
    `);

    const bookingStatus = await tx.execute<{ status: keyof PlatformStats["bookings"]["byStatus"]; n: number }>(
      sql`select status, count(*)::int as n from bookings group by status`,
    );
    const bookingDays = await tx.execute<{ day: string; n: number }>(sql`
      select ${utcDay("created_at")} as day, count(*)::int as n
      from bookings where created_at >= ${from}::timestamptz and created_at < ${until}::timestamptz
      group by 1
    `);

    const storageTotal = await tx.execute<{ bytes: string }>(sql`select coalesce(sum(bytes), 0)::text as bytes from media_assets`);
    const storageTop = await tx.execute<{ tenant_id: string; name: string; slug: string; bytes: string }>(sql`
      select t.id as tenant_id, t.name, t.slug, sum(m.bytes)::text as bytes
      from media_assets m join tenants t on t.id = m.tenant_id
      group by t.id, t.name, t.slug
      order by sum(m.bytes) desc, t.id
      limit 5
    `);

    const integrationUsage = await tx.execute<{ provider: string; status: PlatformStats["integrations"][number]["status"]; n: number }>(sql`
      select provider, status, count(*)::int as n from integrations group by provider, status order by provider, status
    `);

    const recentActivity = await tx
      .select({
        id: auditLogs.id,
        actorType: auditLogs.actorType,
        actorUserId: auditLogs.actorUserId,
        tenantId: auditLogs.tenantId,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(or(eq(auditLogs.actorType, "platform_admin"), isNull(auditLogs.tenantId)))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(20);

    const subscriptionStatus = { trialing: 0, active: 0, past_due: 0, cancelled: 0 };
    for (const row of byStatus.rows) subscriptionStatus[row.status] = row.n;
    const bookingsByStatus = { pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
    for (const row of bookingStatus.rows) bookingsByStatus[row.status] = row.n;
    const sumFrom = (series: DailyCount[], start: string) =>
      series.reduce((total, day) => (day.date >= start ? total + day.count : total), 0);

    return {
      today,
      tenants: tenantCounts.rows[0]!,
      registrations: {
        last7Days: sumFrom(registrationSeries, weekStart),
        last30Days: sumFrom(registrationSeries, seriesStart),
        daily: registrationSeries,
      },
      subscriptions: {
        byPlan: byPlan.rows.map((row) => ({ planId: row.plan_id, planCode: row.code, planName: row.name, count: row.n })),
        byStatus: subscriptionStatus,
      },
      mrr: mrr.rows.map((row) => ({ currency: row.currency, amount: Number(row.amount) })),
      revenueByMonth: revenue.rows.map((row) => ({ month: row.month, currency: row.currency, amount: Number(row.amount), invoices: row.n })),
      bookings: {
        total: Object.values(bookingsByStatus).reduce((total, n) => total + n, 0),
        byStatus: bookingsByStatus,
        daily: fillDaily(bookingDays.rows, seriesStart, today),
      },
      storage: {
        totalBytes: Number(storageTotal.rows[0]!.bytes),
        topTenants: storageTop.rows.map((row) => ({ tenantId: row.tenant_id, name: row.name, slug: row.slug, bytes: Number(row.bytes) })),
      },
      integrations: integrationUsage.rows.map((row) => ({ provider: row.provider, status: row.status, count: row.n })),
      recentActivity,
      outbox: await readOutbox(tx),
    };
    // One snapshot for every figure: counts read moments apart would
    // otherwise disagree while sign-ups and changes are happening.
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  return { ...stats, health: await completeHealth(outbox) };
}
