import "server-only";
import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { createSession, SUPPORT_SESSION_LIFETIME_MS, type SessionMeta } from "../auth/sessions";
import { hashToken } from "../auth/tokens";
import { withoutTenant } from "../db/context";
import { memberships, roles, sessions, supportAccessGrants, tenants, users } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { asPlatform, parse, requireId, type PlatformActor, type PlatformRole } from "./access";
import { recordPlatformAudit } from "./audit";
import { PLATFORM_LINKS, sendPlatformEmail, supportAccessRequestedMessage } from "./mailer";

/**
 * Support access is the one platform workflow open to the `support` role as
 * well as owners: asking is harmless on its own, because nothing happens until
 * someone inside the workspace approves the request, and what they approve is
 * a view-only, time-boxed session.
 */
const SUPPORT_ACCESS_ROLE: PlatformRole = "support";

export type SupportGrantStatus = "requested" | "approved" | "denied" | "revoked" | "expired";

export interface PlatformSupportGrant {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  requestedBy: string;
  requesterName: string;
  requesterEmail: string;
  reason: string;
  /** `expired` once an approved grant has run out, whatever the stored status says. */
  status: SupportGrantStatus;
  decidedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

/** An approved grant past its window is expired, even if nobody has updated the row. */
export function effectiveGrantStatus(status: SupportGrantStatus, expiresAt: Date | null, now = new Date()): SupportGrantStatus {
  if (status === "approved" && (!expiresAt || expiresAt.getTime() <= now.getTime())) return "expired";
  return status;
}

const reasonSchema = z.string().trim().min(10, "Explain why access is needed (at least 10 characters).").max(500);

/**
 * Asks a workspace for temporary access and e-mails the people who can decide.
 * Creates nothing but the request: no session, no access.
 */
export async function requestSupportAccess(
  admin: PlatformActor,
  tenantId: string,
  reason: string,
  meta: { ip?: string | null } = {},
): Promise<{ grantId: string; notified: number }> {
  const request = await asPlatform(admin, SUPPORT_ACCESS_ROLE, async (tx) => {
    const text = parse(reasonSchema, reason);
    requireId(tenantId, "Tenant");
    const [tenant] = await tx.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new NotFoundError("Tenant");

    const open = await tx
      .select({ id: supportAccessGrants.id })
      .from(supportAccessGrants)
      .where(
        and(
          eq(supportAccessGrants.tenantId, tenantId),
          eq(supportAccessGrants.requestedBy, admin.userId),
          eq(supportAccessGrants.status, "requested"),
        ),
      )
      .limit(1);
    if (open.length > 0) throw new ConflictError("You already have a request waiting for this workspace.");

    const [grant] = await tx
      .insert(supportAccessGrants)
      .values({ tenantId, requestedBy: admin.userId, reason: text })
      .returning({ id: supportAccessGrants.id });

    // Written to the tenant's own audit log: the workspace sees every request.
    await recordPlatformAudit(tx, {
      admin,
      action: "support.access_requested",
      tenantId,
      targetType: "support_grant",
      targetId: grant!.id,
      metadata: { reason: text },
      ip: meta.ip,
    });

    const [requester] = await tx.select({ name: users.name }).from(users).where(eq(users.id, admin.userId)).limit(1);
    // Everyone who is able to decide: owners, and any role granted `support.manage`.
    const deciders = await tx
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(roles, and(eq(roles.tenantId, memberships.tenantId), eq(roles.id, memberships.roleId)))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.status, "active"),
          eq(users.status, "active"),
          sql`(${roles.systemKey} = 'owner' or 'support.manage' = any(${roles.permissions}))`,
        ),
      );

    return { grantId: grant!.id, tenantName: tenant.name, adminName: requester?.name ?? "A Wayfold support engineer", reason: text, deciders };
  });

  // After commit: a mail server problem must not undo (or block) the request.
  let notified = 0;
  const message = supportAccessRequestedMessage({
    tenantName: request.tenantName,
    adminName: request.adminName,
    reason: request.reason,
    url: PLATFORM_LINKS.supportAccess(),
  });
  for (const decider of request.deciders) {
    const result = await sendPlatformEmail({ to: decider.email, ...message });
    if (result.delivered) notified += 1;
  }
  return { grantId: request.grantId, notified };
}

export const SUPPORT_GRANT_STATUSES = ["requested", "approved", "denied", "revoked", "expired"] as const;

export const listSupportGrantsSchema = z.object({
  /** Effective status: `approved` means still open, `expired` includes approvals that have run out. */
  status: z.enum(SUPPORT_GRANT_STATUSES).optional(),
  tenantId: z.uuid().optional(),
  /** Only the caller's own requests. */
  mine: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});
export type ListSupportRequestsInput = z.input<typeof listSupportGrantsSchema>;

/**
 * The SQL form of `effectiveGrantStatus`, so filtering and counting agree
 * with what each row reports.
 */
function statusFilter(status: SupportGrantStatus, now: Date): SQL {
  const lapsed = sql`(${supportAccessGrants.expiresAt} is null or ${supportAccessGrants.expiresAt} <= ${now})`;
  if (status === "approved") return sql`(${supportAccessGrants.status} = 'approved' and not ${lapsed})`;
  if (status === "expired") return sql`(${supportAccessGrants.status} = 'expired' or (${supportAccessGrants.status} = 'approved' and ${lapsed}))`;
  return eq(supportAccessGrants.status, status);
}

/** Support requests across workspaces, newest first, for the platform back office. */
export async function listSupportRequests(
  admin: PlatformActor,
  input: ListSupportRequestsInput = {},
): Promise<{ items: PlatformSupportGrant[]; total: number }> {
  return asPlatform(admin, "support", async (tx) => {
    const query = parse(listSupportGrantsSchema, input);
    const now = new Date();
    const filters: SQL[] = [];
    if (query.status) filters.push(statusFilter(query.status, now));
    if (query.tenantId) filters.push(eq(supportAccessGrants.tenantId, query.tenantId));
    if (query.mine) filters.push(eq(supportAccessGrants.requestedBy, admin.userId));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await tx
      .select({
        id: supportAccessGrants.id,
        tenantId: supportAccessGrants.tenantId,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        requestedBy: supportAccessGrants.requestedBy,
        requesterName: users.name,
        requesterEmail: users.email,
        reason: supportAccessGrants.reason,
        status: supportAccessGrants.status,
        decidedAt: supportAccessGrants.decidedAt,
        expiresAt: supportAccessGrants.expiresAt,
        createdAt: supportAccessGrants.createdAt,
      })
      .from(supportAccessGrants)
      .innerJoin(tenants, eq(tenants.id, supportAccessGrants.tenantId))
      .innerJoin(users, eq(users.id, supportAccessGrants.requestedBy))
      .where(where)
      .orderBy(desc(supportAccessGrants.createdAt), desc(supportAccessGrants.id))
      .limit(query.limit)
      .offset(query.offset);
    const [counted] = await tx.select({ n: sql<number>`count(*)::int` }).from(supportAccessGrants).where(where);
    return {
      items: rows.map((row) => ({ ...row, status: effectiveGrantStatus(row.status, row.expiresAt, now) })),
      total: counted?.n ?? 0,
    };
  });
}

export interface SupportSession {
  /** Session cookie value. Shown to the caller once. */
  token: string;
  expiresAt: Date;
  tenantId: string;
}

/**
 * Opens a support session inside a workspace. This is the only way a platform
 * admin gets a workspace session without being a member, and it works only
 * for a grant that this same admin requested, that the workspace approved,
 * and that has not run out. The session is view-only (see `resolveWorkspace`)
 * and can never outlive the grant.
 */
export async function startSupportSession(admin: PlatformActor, grantId: string, meta: SessionMeta = {}): Promise<SupportSession> {
  let issuedToken: string | undefined;
  try {
    return await asPlatform(admin, SUPPORT_ACCESS_ROLE, async (tx) => {
      requireId(grantId, "Support grant");
      const [grant] = await tx
        .select()
        .from(supportAccessGrants)
        // Someone else's grant is indistinguishable from one that does not exist.
        .where(and(eq(supportAccessGrants.id, grantId), eq(supportAccessGrants.requestedBy, admin.userId)))
        .limit(1)
        .for("share");
      if (!grant) throw new NotFoundError("Support grant");

      const grantEnds = grant.expiresAt;
      const remainingMs = (grantEnds?.getTime() ?? 0) - Date.now();
      if (grant.status !== "approved" || !grantEnds || remainingMs <= 0) {
        throw new ForbiddenError("This workspace has not approved support access, or the approval has ended.");
      }

      await recordPlatformAudit(tx, {
        admin,
        action: "support.session_started",
        tenantId: grant.tenantId,
        targetType: "support_grant",
        targetId: grant.id,
        metadata: { grantExpiresAt: grant.expiresAt },
        ip: meta.ip,
      });

      // Last step, so a session only ever exists alongside its audit record.
      const session = await createSession(admin.userId, meta, {
        activeTenantId: grant.tenantId,
        supportGrantId: grant.id,
        lifetimeMs: Math.min(SUPPORT_SESSION_LIFETIME_MS, remainingMs),
      });
      issuedToken = session.token;

      // The lifetime was measured a moment before the session row was written,
      // so the row can end a few milliseconds after the grant. Pin it back.
      let expiresAt = session.expiresAt;
      if (expiresAt.getTime() > grantEnds.getTime()) {
        expiresAt = grantEnds;
        await tx.update(sessions).set({ expiresAt }).where(eq(sessions.tokenHash, hashToken(session.token)));
      }
      return { token: session.token, expiresAt, tenantId: grant.tenantId };
    });
  } catch (error) {
    // The session is written on the runtime connection. If the audit record
    // then fails to commit, the session must not survive it.
    if (issuedToken) {
      const tokenHash = hashToken(issuedToken);
      await withoutTenant((tx) => tx.delete(sessions).where(eq(sessions.tokenHash, tokenHash)));
    }
    throw error;
  }
}

/** Leaves a workspace: deletes the support session and records that it ended. */
export async function endSupportSession(admin: PlatformActor, sessionId: string, meta: { ip?: string | null } = {}): Promise<void> {
  await asPlatform(admin, SUPPORT_ACCESS_ROLE, async (tx) => {
    requireId(sessionId, "Support session");
    const [ended] = await tx
      .delete(sessions)
      // Only the admin's own support sessions: never an ordinary login, never a colleague's.
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, admin.userId), isNotNull(sessions.supportGrantId)))
      .returning({ tenantId: sessions.activeTenantId, grantId: sessions.supportGrantId });
    if (!ended) throw new NotFoundError("Support session");

    if (ended.tenantId) {
      await recordPlatformAudit(tx, {
        admin,
        action: "support.session_ended",
        tenantId: ended.tenantId,
        targetType: "support_grant",
        targetId: ended.grantId ?? undefined,
        ip: meta.ip,
      });
    }
  });
}
