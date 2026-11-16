import "server-only";
import { sql } from "drizzle-orm";
import { appDatabase, type Transaction } from "./client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidContextError extends Error {
  constructor(what: string) {
    super(`Invalid database context: ${what}`);
    this.name = "InvalidContextError";
  }
}

export class UnsafeDatabaseRoleError extends Error {
  constructor(reason: string) {
    super(`Refusing to serve tenant data: ${reason}`);
    this.name = "UnsafeDatabaseRoleError";
  }
}

export function assertUuid(value: unknown, what: string): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new InvalidContextError(`${what} is not a UUID`);
  }
}

/**
 * A transaction bound to exactly one tenant. Repositories take this type, so
 * a tenant-owned table cannot be queried without first naming the tenant, and
 * PostgreSQL enforces the same boundary again through row-level security.
 */
export interface TenantScope {
  readonly tenantId: string;
  /** Acting user, when there is one (absent on public storefront reads). */
  readonly userId: string | null;
  readonly tx: Transaction;
}

/** A transaction bound to one user and no tenant. */
export interface UserScope {
  readonly userId: string;
  readonly tx: Transaction;
}

interface Settings {
  tenantId?: string;
  userId?: string | null;
  authEmail?: string;
}

let roleCheck: Promise<void> | undefined;

/**
 * Verifies once per process that the runtime connection really is subject to
 * row-level security. A superuser, a BYPASSRLS role, or a member of the
 * platform role would silently see every tenant, so we fail closed instead.
 */
export function assertRuntimeRoleIsSafe(): Promise<void> {
  roleCheck ??= (async () => {
    const result = await appDatabase().execute<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      is_app: boolean;
      is_platform: boolean;
    }>(sql`
      select r.rolsuper, r.rolbypassrls,
             pg_has_role(current_user, 'wayfold_app', 'member') as is_app,
             pg_has_role(current_user, 'wayfold_platform', 'member') as is_platform
      from pg_roles r where r.rolname = current_user
    `);
    const row = result.rows[0];
    if (!row) throw new UnsafeDatabaseRoleError("the runtime role could not be inspected");
    if (row.rolsuper) throw new UnsafeDatabaseRoleError("DATABASE_URL connects as a superuser");
    if (row.rolbypassrls) throw new UnsafeDatabaseRoleError("DATABASE_URL role has BYPASSRLS");
    if (row.is_platform) throw new UnsafeDatabaseRoleError("DATABASE_URL role is a member of wayfold_platform");
    if (!row.is_app) throw new UnsafeDatabaseRoleError("DATABASE_URL role is not a member of wayfold_app");
  })().catch((error: unknown) => {
    roleCheck = undefined;
    throw error;
  });
  return roleCheck;
}

/** Test hook. */
export function resetRuntimeRoleCheck(): void {
  roleCheck = undefined;
}

async function run<T>(settings: Settings, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  await assertRuntimeRoleIsSafe();
  return appDatabase().transaction(async (tx) => {
    // is_local = true: the settings die with this transaction, so a pooled
    // connection can never carry one request's tenant into the next.
    await tx.execute(sql`
      select set_config('app.tenant_id', ${settings.tenantId ?? ""}, true),
             set_config('app.user_id', ${settings.userId ?? ""}, true),
             set_config('app.auth_email', ${settings.authEmail ?? ""}, true)
    `);
    return fn(tx);
  });
}

/**
 * Runs `fn` inside a transaction scoped to `tenantId`.
 *
 * `tenantId` must come from a trusted resolution step (verified session
 * membership or verified host), never straight from request input.
 */
export function withTenant<T>(
  tenantId: string,
  fn: (scope: TenantScope) => Promise<T>,
  options: { userId?: string | null } = {},
): Promise<T> {
  assertUuid(tenantId, "tenant id");
  const userId = options.userId ?? null;
  if (userId !== null) assertUuid(userId, "user id");
  return run({ tenantId, userId }, (tx) => fn({ tenantId, userId, tx }));
}

/** Runs `fn` as one user with no tenant: own profile, own memberships. */
export function withUser<T>(userId: string, fn: (scope: UserScope) => Promise<T>): Promise<T> {
  assertUuid(userId, "user id");
  return run({ userId }, (tx) => fn({ userId, tx }));
}

/**
 * Runs `fn` with permission to read or create the single user row for
 * `email`. Used by login, registration and password reset only.
 */
export function withAuthEmail<T>(email: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const normalised = normaliseEmail(email);
  if (!normalised) throw new InvalidContextError("email is empty");
  return run({ authEmail: normalised }, fn);
}

/** Runs `fn` with no tenant and no user: sessions, tokens, plans, directory. */
export function withoutTenant<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return run({}, fn);
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
