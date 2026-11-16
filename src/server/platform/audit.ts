import "server-only";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { redact } from "../audit";
import { auditLogs, tenants, users } from "../db/schema";
import { asPlatform, parse, type PlatformActor, type PlatformTx } from "./access";

export interface PlatformAuditEntry {
  /** The acting platform admin, or null for system jobs (seeding, webhooks). */
  admin: PlatformActor | null;
  action: string;
  /**
   * Tenant the change affects. When set, the row is also visible in that
   * tenant's own audit log; null keeps it platform-only.
   */
  tenantId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Appends a platform event to the audit log inside the caller's cross-tenant
 * transaction, so the record and the change commit or roll back together.
 */
export async function recordPlatformAudit(tx: PlatformTx, entry: PlatformAuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    // Explicit, because the column default reads a tenant context this connection never sets.
    tenantId: entry.tenantId ?? null,
    actorType: entry.admin ? "platform_admin" : "system",
    actorUserId: entry.admin?.userId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: redact(entry.metadata ?? {}) as Record<string, unknown>,
    ip: entry.ip ?? null,
  });
}

export const AUDIT_ACTOR_TYPES = ["user", "platform_admin", "support_session", "system"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const listPlatformAuditSchema = z
  .object({
    /** Matches actions starting with this text, e.g. `tenant.` or `support.session_`. */
    action: z.string().trim().min(1).max(100).optional(),
    tenantId: z.uuid().optional(),
    actorType: z.enum(AUDIT_ACTOR_TYPES).optional(),
    /** Inclusive bounds on when the event happened. */
    from: z.date().optional(),
    to: z.date().optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, { path: ["to"], message: "The end cannot be before the start." });
export type ListPlatformAuditInput = z.input<typeof listPlatformAuditSchema>;

export interface PlatformAuditItem {
  id: string;
  at: Date;
  /** Null for platform-level events. */
  tenantId: string | null;
  tenantName: string | null;
  actorType: AuditActorType;
  /** Null for system events and for actors whose account no longer exists. */
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
}

/** Escapes `%`, `_` and `\` and anchors the text at the start for LIKE. */
function prefixPattern(text: string): string {
  return `${text.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * The audit log across every workspace and the platform's own events,
 * newest first. Readable by support as well as owners.
 */
export async function listPlatformAudit(admin: PlatformActor, input: ListPlatformAuditInput = {}): Promise<{ items: PlatformAuditItem[]; total: number }> {
  return asPlatform(admin, "support", async (tx) => {
    const query = parse(listPlatformAuditSchema, input);
    const filters: SQL[] = [];
    if (query.action) filters.push(sql`${auditLogs.action} like ${prefixPattern(query.action)}`);
    if (query.tenantId) filters.push(eq(auditLogs.tenantId, query.tenantId));
    if (query.actorType) filters.push(eq(auditLogs.actorType, query.actorType));
    if (query.from) filters.push(gte(auditLogs.createdAt, query.from));
    if (query.to) filters.push(lte(auditLogs.createdAt, query.to));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await tx
      .select({
        id: auditLogs.id,
        at: auditLogs.createdAt,
        tenantId: auditLogs.tenantId,
        tenantName: tenants.name,
        actorType: auditLogs.actorType,
        actorName: users.name,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        metadata: auditLogs.metadata,
        ip: auditLogs.ip,
      })
      .from(auditLogs)
      .leftJoin(tenants, eq(tenants.id, auditLogs.tenantId))
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(query.limit)
      .offset(query.offset);
    const [counted] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(where);

    return {
      // Redacted again on the way out: a row written without recordAudit must not leak either.
      items: rows.map((row) => ({ ...row, metadata: redact(row.metadata ?? {}) as Record<string, unknown> })),
      total: counted?.n ?? 0,
    };
  });
}
