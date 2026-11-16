import "server-only";
import { and, count, eq, sql } from "drizzle-orm";
import { isIsoDate } from "@/lib/dates";
import type { TenantScope } from "../db/context";
import { bookings, mediaAssets, tenants, tours } from "../db/schema";
import { ForbiddenError, ValidationError } from "../errors";
import { countSeats } from "../team/access";

export interface Usage {
  /** Active memberships. */
  teamMembers: number;
  /** Invitations still waiting for an answer. Each one holds a seat. */
  pendingInvitations: number;
  publishedTours: number;
  /** Total size of the media library. */
  storageBytes: number;
  /** Bookings received in the calendar month of `today`, whatever became of them. */
  bookingsThisMonth: number;
}

export interface UsageOptions {
  /** The workspace's current calendar date, `YYYY-MM-DD`. */
  today: string;
  /** The instant used to decide which invitations have expired. */
  now?: Date;
}

/** First day of the month containing `date`, and of the month after it. */
export function monthBounds(date: string): { start: string; end: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const pad = (value: number) => String(value).padStart(2, "0");
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
  return { start: `${date.slice(0, 7)}-01`, end: next };
}

/**
 * What the workspace currently uses of each plan allowance. Every figure is
 * an aggregate filtered by the scope's tenant; nothing is cached, so it is
 * the same number the limit checks see.
 */
export async function getUsage(scope: TenantScope, options: UsageOptions): Promise<Usage> {
  if (!isIsoDate(options.today)) throw new ValidationError("That is not a valid date.");
  const now = options.now ?? new Date();

  const [tenant] = await scope.tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, scope.tenantId)).limit(1);
  if (!tenant) throw new ForbiddenError("This workspace is not available.");

  const seats = await countSeats(scope, now);

  const [published] = await scope.tx
    .select({ n: count() })
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.status, "published")));

  const [storage] = await scope.tx
    .select({ bytes: sql<number>`coalesce(sum(${mediaAssets.bytes}), 0)`.mapWith(Number) })
    .from(mediaAssets)
    .where(eq(mediaAssets.tenantId, scope.tenantId));

  // The month is the workspace's own: a booking made at 23:30 local time on
  // the 31st belongs to that month even if it is already the 1st in UTC.
  const { start, end } = monthBounds(options.today);
  const [booked] = await scope.tx
    .select({ n: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, scope.tenantId),
        sql`${bookings.createdAt} >= (${start}::timestamp at time zone ${tenant.timezone})`,
        sql`${bookings.createdAt} < (${end}::timestamp at time zone ${tenant.timezone})`,
      ),
    );

  return {
    teamMembers: seats.activeMembers,
    pendingInvitations: seats.pendingInvitations,
    publishedTours: published?.n ?? 0,
    storageBytes: storage?.bytes ?? 0,
    bookingsThisMonth: booked?.n ?? 0,
  };
}
