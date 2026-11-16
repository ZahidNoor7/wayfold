-- Wayfold bootstrap: database roles and the tenant-context primitives every
-- later migration builds on. Runs as the schema owner.
--
-- Roles are NOLOGIN groups. Operators create the actual login users and make
-- them members (see docs/operations/database.md):
--   wayfold_app       runtime; sees only the current tenant's rows
--   wayfold_platform  platform administration; cross-tenant by explicit policy
-- Neither role has BYPASSRLS. Cross-tenant access is always a named policy.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wayfold_app') THEN
    CREATE ROLE wayfold_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wayfold_platform') THEN
    CREATE ROLE wayfold_platform NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint

-- Tenant of the current transaction, set with set_config(..., is_local => true)
-- by the data-access layer. Unset or empty means "no tenant": policies compare
-- against NULL and match nothing, so a missing context fails closed.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- Applies the standard isolation contract to a tenant-owned table:
--   * RLS enabled AND forced (the table owner is subject to it too)
--   * wayfold_app: rows of the current tenant only, for reads and writes
--   * wayfold_platform: all rows, by explicit policy
-- `app_privileges` narrows what the runtime role may do (for example
-- 'SELECT' for tables only the platform writes).
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(
  target regclass,
  app_privileges text DEFAULT 'SELECT, INSERT, UPDATE, DELETE'
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = target AND attname = 'tenant_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'table % has no tenant_id column', target;
  END IF;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);

  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', target);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS PERMISSIVE FOR ALL TO wayfold_app
       USING (tenant_id = app_current_tenant())
       WITH CHECK (tenant_id = app_current_tenant())',
    target
  );

  EXECUTE format('DROP POLICY IF EXISTS platform_all ON %s', target);
  EXECUTE format(
    'CREATE POLICY platform_all ON %s AS PERMISSIVE FOR ALL TO wayfold_platform
       USING (true) WITH CHECK (true)',
    target
  );

  EXECUTE format('REVOKE ALL ON %s FROM wayfold_app', target);
  EXECUTE format('GRANT %s ON %s TO wayfold_app', app_privileges, target);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO wayfold_platform', target);
END
$$;
