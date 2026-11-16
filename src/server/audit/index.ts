import "server-only";
import type { TenantScope } from "../db/context";
import { auditLogs } from "../db/schema";

const SENSITIVE = /(secret|password|token|api[-_]?key|authorization|credential|private[-_]?key|signature|cookie)/i;
const MAX_STRING = 500;
const MAX_DEPTH = 4;

/**
 * Makes metadata safe to persist: values under credential-like keys are
 * replaced, long strings are truncated, and depth is bounded. Applied to
 * everything written to the audit log, so a careless caller cannot leak.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE.test(key) ? "[redacted]" : redact(inner, depth + 1);
    }
    return out;
  }
  return String(value);
}

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  /** Defaults to a normal user action; support sessions must say so. */
  actorType?: "user" | "support_session" | "system";
}

/** Appends to the tenant's audit log inside the caller's transaction. */
export async function recordAudit(scope: TenantScope, entry: AuditEntry): Promise<void> {
  await scope.tx.insert(auditLogs).values({
    tenantId: scope.tenantId,
    actorType: entry.actorType ?? (scope.userId ? "user" : "system"),
    actorUserId: scope.userId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: redact(entry.metadata ?? {}) as Record<string, unknown>,
    ip: entry.ip ?? null,
  });
}
