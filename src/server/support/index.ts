import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { TenantScope } from "../db/context";
import { sessions, supportAccessGrants } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import type { Permission } from "../rbac/permissions";

/**
 * The workspace's side of support access. A platform admin can only ask;
 * everything that actually opens, limits or closes the door happens here,
 * inside the tenant's own transaction, by a member holding `support.manage`.
 */

export const MAX_SUPPORT_ACCESS_HOURS = 72;

export type SupportGrantStatus = "requested" | "approved" | "denied" | "revoked" | "expired";

/**
 * Who is deciding. Built from the resolved `Workspace`
 * (`{ userId: workspace.user.id, permissions, isOwner }`), never from input.
 */
export interface SupportActor {
  userId: string;
  permissions: readonly Permission[];
  isOwner?: boolean;
}

export interface SupportGrantView {
  id: string;
  /** The platform admin who asked. Their profile is not visible to the workspace. */
  requestedBy: string;
  reason: string;
  /** `expired` once an approved window has run out, whatever the stored status says. */
  status: SupportGrantStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

type Row = typeof supportAccessGrants.$inferSelect;

const idSchema = z.uuid();

function toView(row: Row, now = new Date()): SupportGrantView {
  const lapsed = row.status === "approved" && (!row.expiresAt || row.expiresAt.getTime() <= now.getTime());
  return {
    id: row.id,
    requestedBy: row.requestedBy,
    reason: row.reason,
    status: lapsed ? "expired" : row.status,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

function assertCanDecide(scope: TenantScope, actor: SupportActor): void {
  // A support session only ever holds `.view` permissions, so the people being
  // let in can never approve or extend their own access.
  if (!actor.isOwner && !actor.permissions.includes("support.manage")) throw new ForbiddenError();
  // The decision is attributed to the signed-in member of this transaction, nobody else.
  if (scope.userId !== actor.userId) throw new ForbiddenError();
}

async function findGrant(scope: TenantScope, id: string): Promise<Row> {
  if (!idSchema.safeParse(id).success) throw new NotFoundError("Support request");
  const [row] = await scope.tx
    .select()
    .from(supportAccessGrants)
    .where(and(eq(supportAccessGrants.tenantId, scope.tenantId), eq(supportAccessGrants.id, id)))
    .limit(1);
  // Same answer whether the id is unknown or belongs to another workspace.
  if (!row) throw new NotFoundError("Support request");
  return row;
}

/**
 * Moves a grant from one status to another in a single statement, so two
 * people deciding at the same moment cannot both succeed.
 */
async function transition(
  scope: TenantScope,
  actor: SupportActor,
  id: string,
  from: "requested" | "approved",
  to: "approved" | "denied" | "revoked",
  expiresAt?: Date,
): Promise<Row> {
  const existing = await findGrant(scope, id);
  const [updated] = (await scope.tx
    .update(supportAccessGrants)
    .set({ status: to, decidedBy: actor.userId, decidedAt: new Date(), ...(expiresAt ? { expiresAt } : {}) })
    .where(and(eq(supportAccessGrants.tenantId, scope.tenantId), eq(supportAccessGrants.id, id), eq(supportAccessGrants.status, from)))
    .returning()) as Row[];
  if (!updated) {
    const state = toView(existing).status;
    throw new ConflictError(
      from === "requested" ? `This request has already been ${state}.` : `Only approved access can be revoked; this request is ${state}.`,
      "support_grant_state",
    );
  }
  return updated;
}

/** Every support request this workspace has received, newest first. */
export async function listSupportGrants(scope: TenantScope): Promise<SupportGrantView[]> {
  const rows = await scope.tx
    .select()
    .from(supportAccessGrants)
    .where(eq(supportAccessGrants.tenantId, scope.tenantId))
    .orderBy(desc(supportAccessGrants.createdAt), desc(supportAccessGrants.id));
  const now = new Date();
  return rows.map((row) => toView(row, now));
}

export const approveSupportGrantSchema = z.object({
  hours: z
    .number()
    .int("Use a whole number of hours.")
    .min(1, "Access must last at least an hour.")
    .max(MAX_SUPPORT_ACCESS_HOURS, `Access can last at most ${MAX_SUPPORT_ACCESS_HOURS} hours.`),
});

/** Opens a view-only window for the platform admin who asked, for at most 72 hours. */
export async function approveSupportGrant(
  scope: TenantScope,
  actor: SupportActor,
  id: string,
  input: z.input<typeof approveSupportGrantSchema>,
): Promise<SupportGrantView> {
  assertCanDecide(scope, actor);
  const parsed = approveSupportGrantSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(undefined, z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);

  const expiresAt = new Date(Date.now() + parsed.data.hours * 3_600_000);
  const row = await transition(scope, actor, id, "requested", "approved", expiresAt);
  await recordAudit(scope, {
    action: "support.access_approved",
    targetType: "support_grant",
    targetId: id,
    metadata: { hours: parsed.data.hours, expiresAt, requestedBy: row.requestedBy },
  });
  return toView(row);
}

export async function denySupportGrant(scope: TenantScope, actor: SupportActor, id: string): Promise<SupportGrantView> {
  assertCanDecide(scope, actor);
  const row = await transition(scope, actor, id, "requested", "denied");
  await recordAudit(scope, {
    action: "support.access_denied",
    targetType: "support_grant",
    targetId: id,
    metadata: { requestedBy: row.requestedBy },
  });
  return toView(row);
}

/**
 * Ends approved access immediately. The grant stops resolving on the very
 * next request, and any session opened under it is deleted as well.
 */
export async function revokeSupportGrant(scope: TenantScope, actor: SupportActor, id: string): Promise<SupportGrantView> {
  assertCanDecide(scope, actor);
  const row = await transition(scope, actor, id, "approved", "revoked");
  // `sessions` is a global table the runtime role may write; the filter keeps
  // this to sessions inside this workspace that carry exactly this grant.
  const ended = await scope.tx
    .delete(sessions)
    .where(and(eq(sessions.supportGrantId, id), eq(sessions.activeTenantId, scope.tenantId)))
    .returning({ id: sessions.id });
  await recordAudit(scope, {
    action: "support.access_revoked",
    targetType: "support_grant",
    targetId: id,
    metadata: { requestedBy: row.requestedBy, sessionsEnded: ended.length },
  });
  return toView(row);
}
