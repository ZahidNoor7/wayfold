import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, timestamptz, updatedAt } from "./columns";
import { users } from "./identity";
import { tenants } from "./tenancy";

/* ----------------------------------------------------------- integrations */

export const integrationStatus = pgEnum("integration_status", ["untested", "connected", "error", "disabled"]);

/**
 * A tenant's connection to a third-party provider. `config` holds non-secret
 * settings; every secret lives in `secret_ciphertext`, sealed with AES-256-GCM
 * under a per-tenant key and bound to this row (see `server/crypto`).
 */
export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    /** Adapter id, e.g. `cloudinary`, `smtp`, `stripe`, `google_maps`. */
    provider: text("provider").notNull(),
    /** Capability the adapter fulfils: `media`, `email`, `payments`, `maps`, ... */
    category: text("category").notNull(),
    label: text("label").notNull().default("Default"),
    /** One default connection per category is used when a caller names none. */
    isDefault: boolean("is_default").notNull().default(false),
    status: integrationStatus("status").notNull().default("untested"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    secretCiphertext: text("secret_ciphertext").notNull(),
    keyVersion: text("key_version").notNull(),
    /** Masked previews for the settings UI, e.g. `{ apiSecret: "••••••••a1b2" }`. */
    secretHints: jsonb("secret_hints").$type<Record<string, string>>().notNull().default({}),
    lastTestedAt: timestamptz("last_tested_at"),
    /** Sanitised failure summary. Never contains credentials. */
    lastError: text("last_error"),
    rotatedAt: timestamptz("rotated_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("integrations_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("integrations_tenant_provider_label_key").on(t.tenantId, t.provider, t.label),
    // At most one default connection per category.
    uniqueIndex("integrations_tenant_category_default_key")
      .on(t.tenantId, t.category)
      .where(sql`${t.isDefault}`),
    index("integrations_tenant_category_idx").on(t.tenantId, t.category),
  ],
);

/**
 * Platform-managed provider connections (for example the shared media store
 * offered on some plans). No tenant_id: the runtime role has no access at all;
 * only the platform role reads it, through one narrow service.
 */
export const platformIntegrations = pgTable(
  "platform_integrations",
  {
    id: id(),
    provider: text("provider").notNull(),
    category: text("category").notNull(),
    status: integrationStatus("status").notNull().default("untested"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    secretCiphertext: text("secret_ciphertext").notNull(),
    keyVersion: text("key_version").notNull(),
    secretHints: jsonb("secret_hints").$type<Record<string, string>>().notNull().default({}),
    lastTestedAt: timestamptz("last_tested_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("platform_integrations_category_key").on(t.category)],
);

/* ------------------------------------------------------------------ audit */

export const auditActorType = pgEnum("audit_actor_type", ["user", "platform_admin", "support_session", "system"]);

/**
 * Append-only. The runtime role may INSERT and SELECT its own tenant's rows
 * and has no UPDATE or DELETE privilege. `tenant_id` is null for platform
 * events, which only the platform role can see.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .default(sql`app_current_tenant()`)
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorType: auditActorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Redacted by `server/audit` before it is written. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_tenant_idx").on(t.tenantId, t.createdAt), index("audit_logs_action_idx").on(t.action)],
);

/* ------------------------------------------------------------ rate limits */

/** Fixed-window counters. Global table: keys are opaque hashes, not tenant data. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamptz("window_start").notNull(),
  hits: integer("hits").notNull().default(0),
});
