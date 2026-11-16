CREATE TYPE "public"."auth_token_kind" AS ENUM('email_verification', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('owner', 'support');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'verified');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('open', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."support_grant_status" AS ENUM('requested', 'approved', 'denied', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'platform_admin', 'support_session', 'system');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('untested', 'connected', 'error', 'disabled');--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "auth_token_kind" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" "platform_role" DEFAULT 'support' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"active_tenant_id" uuid,
	"support_grant_id" uuid,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"number" text NOT NULL,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"provider" text DEFAULT 'manual' NOT NULL,
	"provider_ref" text
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_monthly" integer DEFAULT 0 NOT NULL,
	"price_yearly" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"max_team_members" integer,
	"max_published_tours" integer,
	"max_storage_mb" integer,
	"max_bookings_per_month" integer,
	"features" jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"system_key" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"cycle" "billing_cycle" DEFAULT 'monthly' NOT NULL,
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"requested_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "support_grant_status" DEFAULT 'requested' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"domain" text NOT NULL,
	"status" "domain_status" DEFAULT 'pending' NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"plan_id" uuid NOT NULL,
	"limit_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suspended_reason" text,
	"tagline" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"social" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"regions" text[] DEFAULT '{}' NOT NULL,
	"languages" text[] DEFAULT '{"en"}' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"branding" jsonb DEFAULT '{"theme":"emerald","mode":"light","radius":"md","font":"classic"}'::jsonb NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"label" text DEFAULT 'Default' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" "integration_status" DEFAULT 'untested' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"key_version" text NOT NULL,
	"secret_hints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_error" text,
	"rotated_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"status" "integration_status" DEFAULT 'untested' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"key_version" text NOT NULL,
	"secret_hints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_key" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_tenant_idx" ON "invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "invoices_tenant_idx" ON "invoices" USING btree ("tenant_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_key" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_key" ON "plans" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_name_key" ON "roles" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_system_key" ON "roles" USING btree ("tenant_id","system_key");--> statement-breakpoint
CREATE INDEX "support_grants_tenant_idx" ON "support_access_grants" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_domains_verified_domain_key" ON "tenant_domains" USING btree ("domain") WHERE "tenant_domains"."status" = 'verified';--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_domains_tenant_domain_key" ON "tenant_domains" USING btree ("tenant_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_tenant_provider_label_key" ON "integrations" USING btree ("tenant_id","provider","label");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_tenant_category_default_key" ON "integrations" USING btree ("tenant_id","category") WHERE "integrations"."is_default";--> statement-breakpoint
CREATE INDEX "integrations_tenant_category_idx" ON "integrations" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_integrations_category_key" ON "platform_integrations" USING btree ("category");