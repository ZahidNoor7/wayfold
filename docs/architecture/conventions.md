# Engineering conventions

Read this before adding or changing server code. It is short on purpose; the
rules exist because each one closes a way tenant data could leak.

## Layout

```
src/server/            server-only code (every file starts with `import "server-only"`)
  db/schema/           Drizzle tables. Frozen contract: change only with a migration
  db/context.ts        withTenant / withUser / withAuthEmail / withoutTenant
  auth/                password, sessions, guards, workspace resolution
  actions.ts           workspaceAction / siteAction / userAction / anonymousAction / platformAction
  rbac/permissions.ts  permission catalogue and built-in roles
  billing/limits.ts    plan entitlements and limit checks
  integrations/        encrypted credential service, adapter registry, adapters
  audit/               append-only audit log with redaction
  platform/            the ONLY code allowed to cross tenants (withPlatform)
  <domain>/            one folder per business domain (catalog, bookings, ...)
src/app/               routes: workspace/ (dashboard), s/[site]/ (storefront), platform/, (auth)/
drizzle/               SQL migrations (generated tables + hand-written RLS)
tests/                 integration and isolation tests against a real PostgreSQL
```

## The five rules of tenant data

1. **Every tenant-owned query runs inside `withTenant`** and receives a
   `TenantScope` (`{ tenantId, userId, tx }`). Service functions take `scope`
   as their first parameter. Never import `appDatabase()` in a service.
2. **Always filter by `scope.tenantId` explicitly**, even though row-level
   security would filter anyway. Two independent fences: the query and the
   policy.
3. **Never accept a tenant id from input.** In the dashboard it comes from the
   session (`workspaceAction`); on a storefront from the verified host
   (`siteAction`). An id in a payload is data and is ignored.
4. **A record of another tenant is "not found".** Look up by
   `(tenant_id, id)` and throw `NotFoundError` when there is no row. Never
   reveal that an id exists elsewhere.
5. **Cross-tenant code lives only in `src/server/platform`** and uses
   `withPlatform`. ESLint blocks that import anywhere else.

## Writing a service

```ts
import "server-only";
import { and, eq } from "drizzle-orm";
import type { TenantScope } from "../db/context";
import { tours } from "../db/schema";
import { NotFoundError } from "../errors";

export async function getTour(scope: TenantScope, id: string) {
  const [row] = await scope.tx
    .select()
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("Tour");
  return row;
}
```

- Validate input with Zod at the service boundary; export the schema so forms
  reuse it. Throw `ValidationError` with `fieldErrors` for bad input.
- Throw `AppError` subclasses (`src/server/errors.ts`) for anything the user
  should read. Any other thrown value is treated as internal and replaced with
  a generic message.
- Money is integer minor units. Dates without a time are `YYYY-MM-DD` strings.
- Enforce plan limits on the server with `assertWithinLimit` /
  `assertFeature`, inside the same transaction as the write.
- Record sensitive changes with `recordAudit(scope, …)`. Metadata is redacted
  automatically; still, pass field names rather than values.
- Never log request bodies, credentials, or driver error objects.

## Writing a Server Action

```ts
"use server";
import { workspaceAction } from "@/server/actions";
import { createTour, createTourSchema } from "@/server/catalog/tours";

export const createTourAction = workspaceAction("tours.manage", createTourSchema, ({ scope, input, audit }) =>
  createTour(scope, input),
);
```

The wrapper checks, in order: session, live workspace membership, permission,
input schema; then runs the handler in the tenant transaction and converts
errors to an `ActionResult`. Do not re-implement any of those steps, and do
not write a Server Action without one of the wrappers.

Pages and layouts call `requireWorkspace("permission")` and then read through
the same tenant-scoped services via `inWorkspace(workspace, scope => …)`.

## Tests

- Runner: Vitest. `pnpm db:start` once, then `pnpm test` (or
  `pnpm exec vitest run <path> --maxWorkers=2` while iterating).
- Tests run against a real PostgreSQL database migrated exactly like
  production, connected as the real runtime role. Do not mock the database.
- Use `tests/helpers/fixtures.ts` (`createTenant`, `createUser`, `createPlan`).
  Every test creates its own tenants, so files run in parallel safely.
- Call services inside `withTenant(fixture.tenantId, scope => …, { userId })`.
- Every domain needs **isolation tests** in `tests/isolation/`: create tenants
  A and B, then prove that A cannot read, list, search, update, delete, or
  attach to B's records, both by id and by payload manipulation. Expect
  `NotFoundError` (or an empty result), never B's data.
- Mock only the network edge (`fetch`, SMTP transport) for provider calls.
- Target: 90% statement coverage of the files you add or change. Check with
  `pnpm exec vitest run <your tests> --coverage --coverage.include='src/server/<domain>/**'`.

## Database changes

Schema files and `drizzle/` are owned by one person at a time. If a service
needs a column or table that does not exist, stop and ask rather than editing
the schema. New tenant-owned tables must:

- have `tenantId: tenantId()` and a `unique(tenant_id, id)` key,
- reference parents with composite foreign keys `(tenant_id, parent_id)`,
- be registered in a migration with `SELECT app_enable_tenant_rls('table')`.

`tests/isolation/core-rls.test.ts` fails if any table with a `tenant_id`
column lacks forced row-level security.

## One transaction, one connection

A `TenantScope` wraps a single database connection. Run its queries one after
another (`await` each). Do not put several `scope.tx` queries in
`Promise.all`: the driver does not support concurrent queries on one
connection. To do independent work in parallel, start separate `withTenant`
calls.
