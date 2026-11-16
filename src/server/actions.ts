import "server-only";
import { unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { recordAudit, type AuditEntry } from "./audit";
import { getSession, getPlatformAdmin, requestMeta, type PlatformAdmin } from "./auth/guards";
import type { Session } from "./auth/sessions";
import { assertCan, inWorkspace, resolveWorkspace, type Workspace } from "./auth/workspace";
import { withTenant, type TenantScope } from "./db/context";
import { env } from "./env";
import { ForbiddenError, NotFoundError, toActionError, UnauthenticatedError, ValidationError, type ActionResult } from "./errors";
import { deliverPending } from "./notifications";
import { enforceRateLimit, type RateLimitRule } from "./rate-limit";
import type { Permission } from "./rbac/permissions";
import { classifyHost } from "./tenancy/hosts";
import { resolveSite, type SiteTenant } from "./tenancy/resolve";

/**
 * Sends a tenant's queued e-mails once the current response is out, through
 * that tenant's own e-mail connection. Best effort: anything not sent stays
 * queued for the scheduled job, so a failure here is never the visitor's.
 */
export function deliverNotificationsSoon(tenantId: string): void {
  after(() => deliverNotificationsNow(tenantId));
}

/** The delivery itself, for code already running after the response (afterCommit). */
export async function deliverNotificationsNow(tenantId: string): Promise<void> {
  try {
    await withTenant(tenantId, (scope) => deliverPending(scope, { limit: 10 }));
  } catch {
    // Left for the scheduled delivery job.
  }
}

export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(undefined, z.flattenError(result.error).fieldErrors as Record<string, string[]>);
  }
  return result.data;
}

async function guarded<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    unstable_rethrow(error); // let redirect()/notFound() through
    return toActionError(error);
  }
}

export interface WorkspaceActionContext<I> {
  workspace: Workspace;
  /** Transaction scoped to the workspace's tenant. Commit happens on return. */
  scope: TenantScope;
  input: I;
  ip: string;
  /** Audit helper that stamps the actor (including support sessions) and IP. */
  audit: (entry: Omit<AuditEntry, "ip" | "actorType">) => Promise<void>;
  /**
   * Work to do after the transaction has committed and the response is sent
   * (e-mails, delivery). Skipped entirely if the handler or the commit fails,
   * so nothing announces a change that did not happen.
   */
  afterCommit: (task: () => unknown) => void;
}

/**
 * Builds a Server Action for the dashboard. In order: session, live workspace
 * membership, permission, input validation, then the handler inside the
 * tenant's transaction. The tenant always comes from the session; any tenant
 * id a client sends is just data and is ignored.
 */
export function workspaceAction<S extends z.ZodType, T>(
  permission: Permission,
  schema: S,
  handler: (context: WorkspaceActionContext<z.output<S>>) => Promise<T>,
): (raw: z.input<S>) => Promise<ActionResult<T>> {
  return async (raw) =>
    guarded(async () => {
      const session = await getSession();
      if (!session) throw new UnauthenticatedError();
      const resolution = await resolveWorkspace(session);
      if (!resolution.ok) throw new ForbiddenError("This workspace is not available.");
      const { workspace } = resolution;
      assertCan(workspace, permission);
      const input = parseInput(schema, raw);
      const { ip } = await requestMeta();
      const tasks: (() => unknown)[] = [];
      const result = await inWorkspace(workspace, (scope) =>
        handler({
          workspace,
          scope,
          input,
          ip,
          audit: (entry) => recordAudit(scope, { ...entry, ip, actorType: workspace.support ? "support_session" : "user" }),
          afterCommit: (task) => void tasks.push(task),
        }),
      );
      for (const task of tasks) after(task);
      return result;
    });
}

export interface SiteActionContext<I> {
  tenant: SiteTenant;
  scope: TenantScope;
  input: I;
  ip: string;
}

/** Tenant of the storefront the current request was made to, from its Host. */
export async function currentSiteTenant(): Promise<SiteTenant> {
  const { host } = await requestMeta();
  const target = classifyHost(host, { rootDomain: env().ROOT_DOMAIN, appHost: env().APP_HOST });
  if (target.kind !== "tenant" && target.kind !== "custom") throw new NotFoundError("Site");
  const tenant = await resolveSite(target.site);
  if (!tenant || tenant.status !== "active") throw new NotFoundError("Site");
  return tenant;
}

/**
 * Builds a public Server Action for a storefront (booking request, enquiry,
 * discount request). The tenant is derived from the verified request host,
 * never from the payload, and every call is rate-limited per visitor and site.
 */
export function siteAction<S extends z.ZodType, T>(
  rule: RateLimitRule,
  schema: S,
  handler: (context: SiteActionContext<z.output<S>>) => Promise<T>,
): (raw: z.input<S>) => Promise<ActionResult<T>> {
  return async (raw) =>
    guarded(async () => {
      const tenant = await currentSiteTenant();
      const { ip } = await requestMeta();
      await enforceRateLimit(rule, `${tenant.id}:${ip}`);
      const input = parseInput(schema, raw);
      const result = await withTenant(tenant.id, (scope) => handler({ tenant, scope, input, ip }));
      // Booking requests, enquiries and discount requests queue e-mails to the
      // guest and the business; send them now rather than at the next job run.
      deliverNotificationsSoon(tenant.id);
      return result;
    });
}

export interface UserActionContext<I> {
  session: Session;
  input: I;
  ip: string;
  userAgent: string | null;
}

/** Signed-in action with no workspace (account settings, workspace creation). */
export function userAction<S extends z.ZodType, T>(
  schema: S,
  handler: (context: UserActionContext<z.output<S>>) => Promise<T>,
): (raw: z.input<S>) => Promise<ActionResult<T>> {
  return async (raw) =>
    guarded(async () => {
      const session = await getSession();
      if (!session) throw new UnauthenticatedError();
      const input = parseInput(schema, raw);
      const { ip, userAgent } = await requestMeta();
      return handler({ session, input, ip, userAgent });
    });
}

/** Anonymous action (login, register, password reset). */
export function anonymousAction<S extends z.ZodType, T>(
  schema: S,
  handler: (context: { input: z.output<S>; ip: string; userAgent: string | null }) => Promise<T>,
): (raw: z.input<S>) => Promise<ActionResult<T>> {
  return async (raw) =>
    guarded(async () => {
      const input = parseInput(schema, raw);
      const { ip, userAgent } = await requestMeta();
      return handler({ input, ip, userAgent });
    });
}

/** Platform administration action. `owner` for anything that changes state. */
export function platformAction<S extends z.ZodType, T>(
  minimum: "support" | "owner",
  schema: S,
  handler: (context: { admin: PlatformAdmin; input: z.output<S>; ip: string }) => Promise<T>,
): (raw: z.input<S>) => Promise<ActionResult<T>> {
  return async (raw) =>
    guarded(async () => {
      const admin = await getPlatformAdmin();
      if (!admin) throw new NotFoundError("Page");
      if (minimum === "owner" && admin.role !== "owner") throw new ForbiddenError();
      const input = parseInput(schema, raw);
      const { ip } = await requestMeta();
      return handler({ admin, input, ip });
    });
}
