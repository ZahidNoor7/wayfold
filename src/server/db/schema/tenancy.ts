import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, timestamptz, updatedAt } from "./columns";
import { users } from "./identity";

/* ------------------------------------------------------------------ plans */

export interface PlanFeatures {
  customDomain: boolean;
  /** Integration categories the plan may connect, e.g. `["media","email"]`. */
  integrations: string[];
  /** May fall back to platform-managed media storage. */
  platformStorage: boolean;
  promotions: boolean;
  removeBranding: boolean;
}

/** Subscription plans. Written only by the platform role. */
export const plans = pgTable(
  "plans",
  {
    id: id(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Minor units (cents). */
    priceMonthly: integer("price_monthly").notNull().default(0),
    priceYearly: integer("price_yearly").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    /** `null` means unlimited. */
    maxTeamMembers: integer("max_team_members"),
    maxPublishedTours: integer("max_published_tours"),
    maxStorageMb: integer("max_storage_mb"),
    maxBookingsPerMonth: integer("max_bookings_per_month"),
    features: jsonb("features").$type<PlanFeatures>().notNull(),
    isPublic: boolean("is_public").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("plans_code_key").on(t.code),
    // Exactly one plan can be the default for new workspaces.
    uniqueIndex("plans_single_default_key")
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
  ],
);

/* ---------------------------------------------------------------- tenants */

export const tenantStatus = pgEnum("tenant_status", ["active", "suspended"]);

export interface TenantBranding {
  theme: "emerald" | "caspian" | "pomegranate" | "graphite";
  mode: "light" | "dark" | "system";
  radius: "none" | "sm" | "md" | "lg";
  font: "classic" | "modern" | "sans";
  logoMediaId?: string | null;
  /** Optional accent override as `H S% L%`, validated server-side. */
  accent?: string | null;
}

export interface TenantSocial {
  instagram?: string;
  youtube?: string;
  facebook?: string;
  tiktok?: string;
  whatsapp?: string;
}

/** Per-tenant overrides of plan limits, set by the platform owner. */
export interface TenantLimitOverrides {
  maxTeamMembers?: number | null;
  maxPublishedTours?: number | null;
  maxStorageMb?: number | null;
  maxBookingsPerMonth?: number | null;
}

/**
 * A business workspace. The row itself is readable for host resolution;
 * tenants may only update their own profile columns (column-level grants),
 * while status, plan and limits belong to the platform role.
 */
export const tenants = pgTable(
  "tenants",
  {
    id: id(),
    /** Sub-domain label: `{slug}.wayfold.com`. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: tenantStatus("status").notNull().default("active"),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    limitOverrides: jsonb("limit_overrides").$type<TenantLimitOverrides>().notNull().default({}),
    suspendedReason: text("suspended_reason"),

    tagline: text("tagline").notNull().default(""),
    description: text("description").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    address: text("address").notNull().default(""),
    website: text("website").notNull().default(""),
    social: jsonb("social").$type<TenantSocial>().notNull().default({}),
    regions: text("regions").array().notNull().default([]),
    languages: text("languages").array().notNull().default(["en"]),
    currency: text("currency").notNull().default("USD"),
    timezone: text("timezone").notNull().default("UTC"),
    branding: jsonb("branding")
      .$type<TenantBranding>()
      .notNull()
      .default({ theme: "emerald", mode: "light", radius: "md", font: "classic" }),
    onboardingCompletedAt: timestamptz("onboarding_completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("tenants_slug_key").on(t.slug), index("tenants_status_idx").on(t.status)],
);

export const domainStatus = pgEnum("domain_status", ["pending", "verified"]);

/** Custom domains. Only verified domains resolve to a tenant. */
export const tenantDomains = pgTable(
  "tenant_domains",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    /** Lower-cased host name without port. */
    domain: text("domain").notNull(),
    status: domainStatus("status").notNull().default("pending"),
    /** Value the owner must publish in a `_wayfold` TXT record. */
    verificationToken: text("verification_token").notNull(),
    verifiedAt: timestamptz("verified_at"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    // A host name maps to one tenant only once ownership is proven; unverified
    // claims cannot squat on a domain.
    uniqueIndex("tenant_domains_verified_domain_key")
      .on(t.domain)
      .where(sql`${t.status} = 'verified'`),
    uniqueIndex("tenant_domains_tenant_domain_key").on(t.tenantId, t.domain),
  ],
);

/* ------------------------------------------------------- roles & members */

export const roles = pgTable(
  "roles",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    /** Stable key for built-in roles (`owner`, `admin`, ...); null for custom. */
    systemKey: text("system_key"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    permissions: text("permissions").array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("roles_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("roles_tenant_name_key").on(t.tenantId, t.name),
    uniqueIndex("roles_tenant_system_key").on(t.tenantId, t.systemKey),
  ],
);

export const membershipStatus = pgEnum("membership_status", ["active", "deactivated"]);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull(),
    status: membershipStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_key").on(t.tenantId, t.userId),
    index("memberships_user_idx").on(t.userId),
    // Composite key: a membership can only point at a role of its own tenant.
    foreignKey({
      name: "memberships_role_fk",
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    roleId: uuid("role_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamptz("expires_at").notNull(),
    acceptedAt: timestamptz("accepted_at"),
    revokedAt: timestamptz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_key").on(t.tokenHash),
    index("invitations_tenant_idx").on(t.tenantId),
    foreignKey({
      name: "invitations_role_fk",
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }),
  ],
);

/* ---------------------------------------------------------------- billing */

export const subscriptionStatus = pgEnum("subscription_status", ["trialing", "active", "past_due", "cancelled"]);
export const billingCycle = pgEnum("billing_cycle", ["monthly", "yearly"]);

/** One row per tenant. Tenants can read it; only the platform role writes it. */
export const subscriptions = pgTable("subscriptions", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id),
  status: subscriptionStatus("status").notNull().default("active"),
  cycle: billingCycle("cycle").notNull().default("monthly"),
  currentPeriodStart: timestamptz("current_period_start").notNull().defaultNow(),
  currentPeriodEnd: timestamptz("current_period_end").notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  /** Which billing provider owns this subscription (`manual`, `stripe`, ...). */
  provider: text("provider").notNull().default("manual"),
  providerRef: text("provider_ref"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const invoiceStatus = pgEnum("invoice_status", ["open", "paid", "void"]);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    description: text("description").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    status: invoiceStatus("status").notNull().default("open"),
    periodStart: timestamptz("period_start").notNull(),
    periodEnd: timestamptz("period_end").notNull(),
    issuedAt: timestamptz("issued_at").notNull().defaultNow(),
    paidAt: timestamptz("paid_at"),
    provider: text("provider").notNull().default("manual"),
    providerRef: text("provider_ref"),
  },
  (t) => [uniqueIndex("invoices_number_key").on(t.number), index("invoices_tenant_idx").on(t.tenantId, t.issuedAt)],
);

/* --------------------------------------------------------- support access */

export const supportGrantStatus = pgEnum("support_grant_status", [
  "requested",
  "approved",
  "denied",
  "revoked",
  "expired",
]);

/**
 * Explicit, time-boxed permission for a platform admin to enter a workspace.
 * A platform admin files the request; only a tenant member holding
 * `support.manage` can approve it. Nothing here is ever implicit.
 */
export const supportAccessGrants = pgTable(
  "support_access_grants",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    status: supportGrantStatus("status").notNull().default("requested"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamptz("decided_at"),
    /** Access window end. Set on approval. */
    expiresAt: timestamptz("expires_at"),
    createdAt: createdAt(),
  },
  (t) => [index("support_grants_tenant_idx").on(t.tenantId, t.status)],
);
