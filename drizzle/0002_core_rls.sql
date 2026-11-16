-- Row-level security, policies and grants for the core tables.
-- Principle: the runtime role (wayfold_app) starts with nothing and receives
-- exactly the privileges listed here. Anything not granted is denied.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_enable_tenant_rls(regclass, text) FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO wayfold_app, wayfold_platform;
--> statement-breakpoint

-- E-mail being authenticated in this transaction (login, registration,
-- password reset). Lets the auth module read exactly one user row by e-mail
-- without opening the whole table to the runtime role.
CREATE OR REPLACE FUNCTION app_auth_email() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.auth_email', true), '') $$;
--> statement-breakpoint

-- ---------------------------------------------------------------- tenant tables
SELECT app_enable_tenant_rls('roles');
--> statement-breakpoint
SELECT app_enable_tenant_rls('memberships');
--> statement-breakpoint
SELECT app_enable_tenant_rls('invitations');
--> statement-breakpoint
SELECT app_enable_tenant_rls('integrations');
--> statement-breakpoint
-- Billing records: tenants read, only the platform writes.
SELECT app_enable_tenant_rls('subscriptions', 'SELECT');
--> statement-breakpoint
SELECT app_enable_tenant_rls('invoices', 'SELECT');
--> statement-breakpoint
-- Support access: the platform files a request; the tenant can only decide it.
SELECT app_enable_tenant_rls('support_access_grants', 'SELECT');
--> statement-breakpoint
GRANT UPDATE (status, decided_by, decided_at, expires_at) ON support_access_grants TO wayfold_app;
--> statement-breakpoint

-- A user may see their own memberships in every workspace (workspace switcher)
-- without a tenant context. Read-only.
CREATE POLICY own_memberships ON memberships AS PERMISSIVE FOR SELECT TO wayfold_app
  USING (user_id = app_current_user());
--> statement-breakpoint

-- ---------------------------------------------------------------- tenant_domains
SELECT app_enable_tenant_rls('tenant_domains');
--> statement-breakpoint
-- Host resolution needs verified domains of any tenant; pending claims and
-- their verification tokens stay private to the claiming tenant.
CREATE POLICY verified_domains_public ON tenant_domains AS PERMISSIVE FOR SELECT TO wayfold_app
  USING (status = 'verified');
--> statement-breakpoint

-- ---------------------------------------------------------------- tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The tenant directory (slug, name, branding, status) is public by nature:
-- it is what a storefront renders. It holds no secrets.
CREATE POLICY tenants_read ON tenants AS PERMISSIVE FOR SELECT TO wayfold_app USING (true);
--> statement-breakpoint
CREATE POLICY tenants_update_own ON tenants AS PERMISSIVE FOR UPDATE TO wayfold_app
  USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY platform_all ON tenants AS PERMISSIVE FOR ALL TO wayfold_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON tenants TO wayfold_app;
--> statement-breakpoint
-- Profile columns only. slug, status, plan_id, limit_overrides and
-- suspended_reason are platform-controlled: a tenant cannot unsuspend itself,
-- change plan, or raise its own limits, whatever the application code does.
GRANT UPDATE (
  name, tagline, description, email, phone, address, website, social, regions,
  languages, currency, timezone, branding, onboarding_completed_at, updated_at
) ON tenants TO wayfold_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO wayfold_platform;
--> statement-breakpoint

-- ---------------------------------------------------------------- users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_read ON users AS PERMISSIVE FOR SELECT TO wayfold_app
  USING (
    id = app_current_user()
    OR email = app_auth_email()
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id AND m.tenant_id = app_current_tenant()
    )
  );
--> statement-breakpoint
CREATE POLICY users_register ON users AS PERMISSIVE FOR INSERT TO wayfold_app
  WITH CHECK (email = app_auth_email());
--> statement-breakpoint
CREATE POLICY users_update_self ON users AS PERMISSIVE FOR UPDATE TO wayfold_app
  USING (id = app_current_user()) WITH CHECK (id = app_current_user());
--> statement-breakpoint
CREATE POLICY platform_all ON users AS PERMISSIVE FOR ALL TO wayfold_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON users TO wayfold_app;
--> statement-breakpoint
-- Not `email` (needs a verified change flow) and not `status` (platform only).
GRANT UPDATE (name, password_hash, email_verified_at, updated_at) ON users TO wayfold_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO wayfold_platform;
--> statement-breakpoint

-- ---------------------------------------------------------------- audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_read_own ON audit_logs AS PERMISSIVE FOR SELECT TO wayfold_app
  USING (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY audit_append_own ON audit_logs AS PERMISSIVE FOR INSERT TO wayfold_app
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY platform_read ON audit_logs AS PERMISSIVE FOR SELECT TO wayfold_platform USING (true);
--> statement-breakpoint
CREATE POLICY platform_append ON audit_logs AS PERMISSIVE FOR INSERT TO wayfold_platform WITH CHECK (true);
--> statement-breakpoint
-- Append-only for everyone: no UPDATE or DELETE is granted to any runtime role.
GRANT SELECT, INSERT ON audit_logs TO wayfold_app, wayfold_platform;
--> statement-breakpoint

-- ---------------------------------------------------------------- platform-only
ALTER TABLE platform_integrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_integrations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_all ON platform_integrations AS PERMISSIVE FOR ALL TO wayfold_platform
  USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_integrations TO wayfold_platform;
--> statement-breakpoint

-- ---------------------------------------------------------------- global tables
-- Session and token rows are addressed by an unguessable hash; the raw value
-- never reaches the database.
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, auth_tokens, rate_limits TO wayfold_app, wayfold_platform;
--> statement-breakpoint
-- Read-only for the runtime role: no tenant code path can create a platform
-- admin or edit a plan.
GRANT SELECT ON platform_admins, plans TO wayfold_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_admins, plans TO wayfold_platform;
