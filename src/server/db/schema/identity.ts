import { index, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, timestamptz, updatedAt } from "./columns";

export const userStatus = pgEnum("user_status", ["active", "disabled"]);

/** Global identity. A user can belong to several tenants through memberships. */
export const users = pgTable(
  "users",
  {
    id: id(),
    /** Always stored lower-cased. */
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: timestamptz("email_verified_at"),
    status: userStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    /** SHA-256 of the cookie value. The raw token is never stored. */
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Workspace the session is currently working in. Re-validated per request. */
    activeTenantId: uuid("active_tenant_id"),
    /**
     * Set only on support-access sessions: the grant that authorises a platform
     * admin to act inside `activeTenantId`.
     */
    supportGrantId: uuid("support_grant_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (t) => [uniqueIndex("sessions_token_hash_key").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const authTokenKind = pgEnum("auth_token_kind", ["email_verification", "password_reset"]);

/** Single-use, hashed, expiring tokens for e-mail verification and resets. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: authTokenKind("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    consumedAt: timestamptz("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("auth_tokens_hash_key").on(t.tokenHash), index("auth_tokens_user_idx").on(t.userId, t.kind)],
);

export const platformRole = pgEnum("platform_role", ["owner", "support"]);

/**
 * Platform staff. The runtime database role can only SELECT this table, so no
 * tenant-side code path can add a row to it.
 */
export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  role: platformRole("role").notNull().default("support"),
  createdAt: createdAt(),
});
