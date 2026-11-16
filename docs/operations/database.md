# Database setup and roles

Wayfold uses one PostgreSQL database (Neon in production) and three kinds of
connection. Getting these roles right is what makes tenant isolation real, so
the application checks them at start-up and refuses to run if they are wrong.

| Connection | Environment variable | Role | Used by |
| --- | --- | --- | --- |
| Schema owner | `DATABASE_MIGRATION_URL` | owner of the tables | `pnpm db:migrate` only |
| Runtime | `DATABASE_URL` | a login that is a member of `wayfold_app` | the web application |
| Platform | `DATABASE_PLATFORM_URL` | a login that is a member of `wayfold_platform` | `src/server/platform` only |

`wayfold_app` and `wayfold_platform` are group roles created by the first
migration. They cannot log in. You create the login users and add them to the
groups.

## First-time setup (production)

1. Create the database and note the owner connection string. Put it in
   `DATABASE_MIGRATION_URL` in the environment that runs migrations (CI or a
   local shell). Do not set it on the web application.
2. Run the migrations: `pnpm db:migrate`.
3. As the owner, create the two login users **with SQL** (not through a
   provider console, which may attach extra privileges):

   ```sql
   CREATE ROLE wf_app LOGIN PASSWORD '<strong password>'
     NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE IN ROLE wayfold_app;
   CREATE ROLE wf_platform LOGIN PASSWORD '<strong password>'
     NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE IN ROLE wayfold_platform;
   REVOKE ALL ON DATABASE <database> FROM PUBLIC;
   GRANT CONNECT ON DATABASE <database> TO wayfold_app, wayfold_platform;
   ```

4. Build `DATABASE_URL` and `DATABASE_PLATFORM_URL` from those users.
5. Seed plans and the first platform owner:
   `pnpm db:seed -- --owner-email you@example.com --owner-name "Your Name" --owner-password '<password>'`

The runtime user must never be the schema owner, a superuser, a role with
`BYPASSRLS`, or a member of `wayfold_platform`. `assertRuntimeRoleIsSafe`
(in `src/server/db/context.ts`) verifies all four on first use and fails
closed.

> Neon: whether console-created roles carry `BYPASSRLS` was not confirmed
> from Neon's documentation when this was written. Creating the users with
> SQL as shown avoids the question, and the start-up check catches a mistake.

## Local development

```bash
pnpm db:start      # project-local PostgreSQL in .local/pg, port 54329
pnpm db:setup      # creates wayfold_dev, migrates, creates wf_app / wf_platform; prints env lines
pnpm db:seed       # plans (+ optional platform owner)
pnpm db:stop
```

The local cluster is separate from any other PostgreSQL on the machine and is
gitignored. `scripts/local-db.sh destroy` removes it.

## Migrations

- Tables are generated from `src/server/db/schema` with `pnpm db:generate`.
- Roles, functions, row-level security, policies and grants are hand-written
  SQL migrations (`drizzle/*_rls.sql`) so every policy is reviewable.
- A new tenant-owned table needs, in a migration:
  `SELECT app_enable_tenant_rls('table_name');`
  The test `tests/isolation/core-rls.test.ts` fails if a table with a
  `tenant_id` column has no forced row-level security, and if the runtime role
  gains read access to a new table without row-level security.
- Forced row-level security also applies to the schema owner. A data backfill
  in a migration must `SET LOCAL ROLE wayfold_platform` first (grant the owner
  membership for that purpose), or it will see no rows.

## Connections and pooling

- Production uses `@neondatabase/serverless` over WebSockets
  (`DATABASE_DRIVER=neon`), because the tenant context needs an interactive
  transaction, which Neon's HTTP driver does not provide. Local and CI use
  node-postgres (`DATABASE_DRIVER=pg`).
- Use Neon's **pooled** connection string. The tenant context is set with
  `set_config(..., true)` (transaction-local), which is safe under
  transaction-mode pooling. Never switch to session-level `SET`.
- `DATABASE_POOL_MAX` is per server instance. Keep it small (default 5).
