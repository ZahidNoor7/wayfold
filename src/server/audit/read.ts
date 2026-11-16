import "server-only";
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { TenantScope } from "../db/context";
import { auditLogs, memberships, users } from "../db/schema";
import { ValidationError } from "../errors";

export type AuditActorType = "user" | "platform_admin" | "support_session" | "system";

export const AUDIT_ACTOR_TYPES: readonly AuditActorType[] = ["user", "platform_admin", "support_session", "system"];

export interface AuditEntryView {
  id: string;
  action: string;
  actorType: AuditActorType;
  actorUserId: string | null;
  /**
   * Who did it, ready to show: the member's name, "Wayfold support",
   * "Wayfold" for the platform team, "System", or "Former member" when the
   * person has since left the workspace.
   */
  actorName: string;
  targetType: string | null;
  targetId: string | null;
  /** Already redacted when it was written. */
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditPage {
  items: AuditEntryView[];
  /** Pass back as `cursor` for the next (older) page; null on the last page. */
  nextCursor: string | null;
}

export const AUDIT_PAGE_MAX = 100;

const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export const listAuditEntriesSchema = z.object({
  /** `member.` or `member` both match every `member.*` action. */
  action: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z_]+(\.[a-z_]*)?$/, "Choose an area from the list.")
    .optional(),
  actorUserId: z.uuid().optional(),
  actorType: z.enum(AUDIT_ACTOR_TYPES).optional(),
  targetType: z.string().trim().min(1).max(64).optional(),
  /** Inclusive lower bound. */
  from: z.date().optional(),
  /** Exclusive upper bound. */
  to: z.date().optional(),
  limit: z.int().min(1).max(AUDIT_PAGE_MAX).default(50),
  cursor: z.string().max(200).optional(),
});
export type ListAuditEntriesInput = z.input<typeof listAuditEntriesSchema>;

interface CursorPosition {
  /** Microsecond-precise UTC instant, as PostgreSQL stores it. */
  at: string;
  id: string;
}

/** Opaque page token: where the previous page stopped. */
export function encodeAuditCursor(position: CursorPosition): string {
  return Buffer.from(`${position.at}|${position.id}`, "utf8").toString("base64url");
}

/** The position a cursor names, or null when it is not one this module issued. */
export function decodeAuditCursor(cursor: string): CursorPosition | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(cursor)) return null;
  const [at, id, ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (rest.length > 0 || !at || !id) return null;
  if (!isoInstant.test(at) || Number.isNaN(Date.parse(at)) || !z.uuid().safeParse(id).success) return null;
  return { at, id };
}

function actorName(actorType: AuditActorType, memberName: string | null): string {
  if (actorType === "support_session") return "Wayfold support";
  if (actorType === "platform_admin") return "Wayfold";
  if (actorType === "system") return "System";
  return memberName ?? "Former member";
}

/**
 * Reads the workspace's audit log, newest first, one page at a time.
 *
 * Names are resolved only for people who are (or were deactivated as)
 * members of this workspace: the join goes through this tenant's
 * memberships, and the users table's own policy allows nothing wider. A
 * platform admin or support agent is never named, only described.
 */
export async function listAuditEntries(scope: TenantScope, raw: ListAuditEntriesInput = {}): Promise<AuditPage> {
  const parsed = listAuditEntriesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(undefined, z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  }
  const input = parsed.data;

  const conditions: (SQL | undefined)[] = [eq(auditLogs.tenantId, scope.tenantId)];
  if (input.action) {
    const prefix = input.action.includes(".") ? input.action : `${input.action}.`;
    // starts_with, not LIKE: `_` in action codes must not act as a wildcard.
    conditions.push(sql`starts_with(${auditLogs.action}, ${prefix})`);
  }
  if (input.actorUserId) conditions.push(eq(auditLogs.actorUserId, input.actorUserId));
  if (input.actorType) conditions.push(eq(auditLogs.actorType, input.actorType));
  if (input.targetType) conditions.push(eq(auditLogs.targetType, input.targetType));
  if (input.from) conditions.push(gte(auditLogs.createdAt, input.from));
  if (input.to) conditions.push(lt(auditLogs.createdAt, input.to));
  if (input.cursor !== undefined) {
    const position = decodeAuditCursor(input.cursor);
    if (!position) throw new ValidationError("That page of the activity log is no longer available. Start from the newest entries.");
    conditions.push(sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${position.at}::timestamptz, ${position.id}::uuid)`);
  }

  const rows = await scope.tx
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorType: auditLogs.actorType,
      actorUserId: auditLogs.actorUserId,
      memberName: users.name,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      position: sql<string>`to_char(${auditLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(auditLogs)
    .leftJoin(memberships, and(eq(memberships.tenantId, scope.tenantId), eq(memberships.userId, auditLogs.actorUserId)))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      action: row.action,
      actorType: row.actorType,
      actorUserId: row.actorUserId,
      actorName: actorName(row.actorType, row.memberName),
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: row.metadata ?? {},
      createdAt: row.createdAt,
    })),
    nextCursor: rows.length > input.limit && last ? encodeAuditCursor({ at: last.position, id: last.id }) : null,
  };
}
