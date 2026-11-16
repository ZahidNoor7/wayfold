import "server-only";
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { emailSchema, nameSchema } from "../auth/service";
import { generateToken, hashToken } from "../auth/tokens";
import {
  auditLogs,
  authTokens,
  integrations,
  memberships,
  plans,
  roles,
  subscriptions,
  tenantDomains,
  tenants,
  users,
  type PlanFeatures,
  type TenantLimitOverrides,
} from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { asPlatform, likePattern, parse, requireId, type PlatformActor, type PlatformTx } from "./access";
import { recordPlatformAudit } from "./audit";
import { PLATFORM_LINKS, sendPlatformEmail, workspaceCreatedMessage } from "./mailer";
import { provisionTenant, slugify, SlugUnavailableError, validateSlug } from "./provision-tenant";

const LIMIT_KEYS = ["maxTeamMembers", "maxPublishedTours", "maxStorageMb", "maxBookingsPerMonth"] as const;
type LimitKey = (typeof LIMIT_KEYS)[number];
type Limits = Record<LimitKey, number | null>;

const MB = 1024 * 1024;
const SETUP_TOKEN_TTL_MS = 72 * 3_600_000;
/** Not a valid Argon2 hash, so no password can ever match it. */
const UNUSABLE_PASSWORD_HASH = "!";

const SLUG_MESSAGES: Record<SlugUnavailableError["reason"], string> = {
  invalid: "Use 3 to 40 lower-case letters, digits or single hyphens, starting and ending with a letter or digit.",
  reserved: "That address is reserved. Choose another.",
  taken: "That address is already in use.",
};

function slugError(reason: SlugUnavailableError["reason"]): ValidationError {
  return new ValidationError(undefined, { slug: [SLUG_MESSAGES[reason]] });
}

function checkedSlug(raw: string): string {
  const slug = raw.trim().toLowerCase();
  try {
    validateSlug(slug);
  } catch (error) {
    if (error instanceof SlugUnavailableError) throw slugError(error.reason);
    throw error;
  }
  return slug;
}

const tenantNameSchema = z.string().trim().min(2, "Enter the business name.").max(80, "Keep the name under 80 characters.");

async function requireTenant(tx: PlatformTx, id: string) {
  requireId(id, "Tenant");
  const [row] = await tx.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!row) throw new NotFoundError("Tenant");
  return row;
}

/* ------------------------------------------------------------------- list */

export const listTenantsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  planId: z.uuid().optional(),
  sort: z.enum(["created_desc", "created_asc", "name_asc", "name_desc", "members_desc"]).default("created_desc"),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});
export type ListTenantsInput = z.input<typeof listTenantsSchema>;

export interface TenantListItem {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
  plan: { id: string; code: string; name: string };
  /** E-mail of the longest-standing active owner, if any. */
  ownerEmail: string | null;
  /** Active members. */
  memberCount: number;
  createdAt: Date;
}

// Plain SQL with aliases: these are correlated to the outer `tenants` row.
const ownerEmail = sql<string | null>`(
  select u.email from memberships m
  join roles r on r.tenant_id = m.tenant_id and r.id = m.role_id
  join users u on u.id = m.user_id
  where m.tenant_id = tenants.id and r.system_key = 'owner' and m.status = 'active'
  order by m.created_at asc, m.id asc limit 1
)`;
const memberCount = sql<number>`(
  select count(*)::int from memberships m where m.tenant_id = tenants.id and m.status = 'active'
)`;

export async function listTenants(admin: PlatformActor, input: ListTenantsInput = {}): Promise<{ items: TenantListItem[]; total: number }> {
  return asPlatform(admin, "support", async (tx) => {
    const query = parse(listTenantsSchema, input);

    const filters: SQL[] = [];
    if (query.status) filters.push(eq(tenants.status, query.status));
    if (query.planId) filters.push(eq(tenants.planId, query.planId));
    if (query.search) {
      const pattern = likePattern(query.search);
      filters.push(sql`(tenants.name ilike ${pattern} or tenants.slug ilike ${pattern} or ${ownerEmail} ilike ${pattern})`);
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const order = {
      created_desc: [desc(tenants.createdAt), asc(tenants.id)],
      created_asc: [asc(tenants.createdAt), asc(tenants.id)],
      name_asc: [sql`lower(tenants.name) asc`, asc(tenants.id)],
      name_desc: [sql`lower(tenants.name) desc`, asc(tenants.id)],
      members_desc: [sql`${memberCount} desc`, asc(tenants.id)],
    }[query.sort];

    const rows = await tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        status: tenants.status,
        planId: plans.id,
        planCode: plans.code,
        planName: plans.name,
        ownerEmail,
        memberCount,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId))
      .where(where)
      .orderBy(...order)
      .limit(query.limit)
      .offset(query.offset);

    const [counted] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId))
      .where(where);

    return {
      total: counted?.n ?? 0,
      items: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        status: row.status,
        plan: { id: row.planId, code: row.planCode, name: row.planName },
        ownerEmail: row.ownerEmail,
        memberCount: row.memberCount,
        createdAt: row.createdAt,
      })),
    };
  });
}

/* ----------------------------------------------------------------- detail */

export interface TenantAdminView {
  userId: string;
  name: string;
  email: string;
  roleKey: "owner" | "admin";
  roleName: string;
  status: "active" | "deactivated";
  emailVerified: boolean;
  joinedAt: Date;
}

export interface TenantDetail {
  profile: {
    id: string;
    slug: string;
    name: string;
    status: "active" | "suspended";
    suspendedReason: string | null;
    tagline: string;
    email: string;
    phone: string;
    website: string;
    currency: string;
    timezone: string;
    onboardingCompleted: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  plan: { id: string; code: string; name: string; priceMonthly: number; priceYearly: number; currency: string; features: PlanFeatures };
  subscription: {
    status: "trialing" | "active" | "past_due" | "cancelled";
    cycle: "monthly" | "yearly";
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    provider: string;
  } | null;
  limits: {
    /** What the plan grants. `null` = unlimited. */
    plan: Limits;
    /** Per-tenant overrides set by the platform owner. */
    overrides: TenantLimitOverrides;
    /** What is actually enforced: override where present, otherwise the plan. */
    effective: Limits;
  };
  usage: {
    teamMembers: number;
    publishedTours: number;
    storageBytes: number;
    storageMb: number;
    bookingsThisMonth: number;
  };
  domains: { id: string; domain: string; status: "pending" | "verified"; isPrimary: boolean; verifiedAt: Date | null; createdAt: Date }[];
  administrators: TenantAdminView[];
  /** Connection health only. Credentials, ciphertext and masked hints never leave the tenant. */
  integrations: {
    id: string;
    provider: string;
    category: string;
    label: string;
    status: "untested" | "connected" | "error" | "disabled";
    isDefault: boolean;
    lastTestedAt: Date | null;
    updatedAt: Date;
  }[];
  recentActivity: {
    id: string;
    actorType: "user" | "platform_admin" | "support_session" | "system";
    actorUserId: string | null;
    action: string;
    targetType: string | null;
    targetId: string | null;
    createdAt: Date;
  }[];
}

async function readAdministrators(tx: PlatformTx, tenantId: string): Promise<TenantAdminView[]> {
  const rows = await tx
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      roleKey: roles.systemKey,
      roleName: roles.name,
      status: memberships.status,
      emailVerifiedAt: users.emailVerifiedAt,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(roles, and(eq(roles.tenantId, memberships.tenantId), eq(roles.id, memberships.roleId)))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), inArray(roles.systemKey, ["owner", "admin"])))
    .orderBy(desc(roles.systemKey), asc(memberships.createdAt));
  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    roleKey: row.roleKey as "owner" | "admin",
    roleName: row.roleName,
    status: row.status,
    emailVerified: row.emailVerifiedAt !== null,
    joinedAt: row.joinedAt,
  }));
}

/** Everything the platform back office shows about one workspace. */
export async function getTenantDetail(admin: PlatformActor, id: string): Promise<TenantDetail> {
  return asPlatform(admin, "support", async (tx) => {
    const tenant = await requireTenant(tx, id);
    const [plan] = await tx.select().from(plans).where(eq(plans.id, tenant.planId)).limit(1);
    const [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, id)).limit(1);

    const usage = await tx.execute<{ members: number; tours: number; bytes: string; bookings: number }>(sql`
      select
        (select count(*)::int from memberships where tenant_id = ${id} and status = 'active') as members,
        (select count(*)::int from tours where tenant_id = ${id} and status = 'published') as tours,
        (select coalesce(sum(bytes), 0)::text from media_assets where tenant_id = ${id}) as bytes,
        (select count(*)::int from bookings
          where tenant_id = ${id} and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') as bookings
    `);
    const used = usage.rows[0]!;
    const storageBytes = Number(used.bytes);

    const domains = await tx
      .select({
        id: tenantDomains.id,
        domain: tenantDomains.domain,
        status: tenantDomains.status,
        isPrimary: tenantDomains.isPrimary,
        verifiedAt: tenantDomains.verifiedAt,
        createdAt: tenantDomains.createdAt,
      })
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, id))
      .orderBy(desc(tenantDomains.isPrimary), asc(tenantDomains.domain));

    // An explicit column list: the secret columns are never even read here.
    const connections = await tx
      .select({
        id: integrations.id,
        provider: integrations.provider,
        category: integrations.category,
        label: integrations.label,
        status: integrations.status,
        isDefault: integrations.isDefault,
        lastTestedAt: integrations.lastTestedAt,
        updatedAt: integrations.updatedAt,
      })
      .from(integrations)
      .where(eq(integrations.tenantId, id))
      .orderBy(asc(integrations.category), asc(integrations.createdAt));

    const recentActivity = await tx
      .select({
        id: auditLogs.id,
        actorType: auditLogs.actorType,
        actorUserId: auditLogs.actorUserId,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, id))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(20);

    const planLimits = Object.fromEntries(LIMIT_KEYS.map((key) => [key, plan![key]])) as Limits;
    const effective = Object.fromEntries(
      LIMIT_KEYS.map((key) => [key, tenant.limitOverrides[key] !== undefined ? tenant.limitOverrides[key] : planLimits[key]]),
    ) as Limits;

    return {
      profile: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        suspendedReason: tenant.suspendedReason,
        tagline: tenant.tagline,
        email: tenant.email,
        phone: tenant.phone,
        website: tenant.website,
        currency: tenant.currency,
        timezone: tenant.timezone,
        onboardingCompleted: tenant.onboardingCompletedAt !== null,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      },
      plan: {
        id: plan!.id,
        code: plan!.code,
        name: plan!.name,
        priceMonthly: plan!.priceMonthly,
        priceYearly: plan!.priceYearly,
        currency: plan!.currency,
        features: plan!.features,
      },
      subscription: subscription
        ? {
            status: subscription.status,
            cycle: subscription.cycle,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            provider: subscription.provider,
          }
        : null,
      limits: { plan: planLimits, overrides: tenant.limitOverrides, effective },
      usage: {
        teamMembers: used.members,
        publishedTours: used.tours,
        storageBytes,
        storageMb: Math.ceil(storageBytes / MB),
        bookingsThisMonth: used.bookings,
      },
      domains,
      administrators: await readAdministrators(tx, id),
      integrations: connections,
      recentActivity,
    };
  });
}

/* ----------------------------------------------------------------- create */

export const createTenantSchema = z.object({
  name: tenantNameSchema,
  /** Left out, the address is derived from the name. */
  slug: z.string().trim().max(60).optional(),
  ownerEmail: emailSchema,
  /** Used only when the owner does not have an account yet. */
  ownerName: nameSchema.optional(),
  planCode: z.string().trim().min(1).max(40).optional(),
});
export type CreateTenantInput = z.input<typeof createTenantSchema>;

export interface CreatedTenant {
  tenantId: string;
  slug: string;
  ownerUserId: string;
  /** False when an existing account was made the owner. */
  ownerCreated: boolean;
  /** Whether the "choose a password" e-mail reached the mail server. Null for an existing account. */
  setupEmailDelivered: boolean | null;
  /**
   * Single-use token for `PLATFORM_LINKS.resetPassword`, returned only when a
   * new account's e-mail could not be delivered, so the platform owner can
   * hand the link over another way. Show once; do not log.
   */
  setupToken: string | null;
}

/**
 * Creates a workspace on behalf of a business: finds or creates the owner's
 * account by e-mail, then provisions the tenant with that account as owner.
 */
export async function createTenantManually(admin: PlatformActor, input: CreateTenantInput): Promise<CreatedTenant> {
  const prepared = await asPlatform(admin, "owner", async (tx) => {
    const data = parse(createTenantSchema, input);
    const slug = checkedSlug(data.slug || slugify(data.name));

    // Checked here as well as in provisionTenant, so a doomed request does not create an account first.
    const taken = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (taken.length > 0) throw slugError("taken");
    if (data.planCode) {
      const plan = await tx.select({ id: plans.id }).from(plans).where(eq(plans.code, data.planCode)).limit(1);
      if (plan.length === 0) throw new ValidationError(undefined, { planCode: ["That plan does not exist."] });
    }

    const [existing] = await tx
      .select({ id: users.id, name: users.name, status: users.status })
      .from(users)
      .where(eq(users.email, data.ownerEmail))
      .limit(1);
    if (existing) {
      if (existing.status !== "active") throw new ConflictError("That account is disabled and cannot own a workspace.");
      return { data, slug, owner: { id: existing.id, name: existing.name, created: false, token: null as string | null } };
    }

    const [created] = await tx
      .insert(users)
      .values({
        email: data.ownerEmail,
        name: data.ownerName ?? data.name,
        passwordHash: UNUSABLE_PASSWORD_HASH,
      })
      .returning({ id: users.id, name: users.name });
    // The owner sets a password through the normal reset flow, which also proves the address.
    const token = generateToken();
    await tx.insert(authTokens).values({
      userId: created!.id,
      kind: "password_reset",
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SETUP_TOKEN_TTL_MS),
    });
    return { data, slug, owner: { id: created!.id, name: created!.name, created: true, token } };
  });

  const { data, slug, owner } = prepared;
  let tenantId: string;
  try {
    ({ tenantId } = await provisionTenant({ name: data.name, slug, ownerUserId: owner.id, planCode: data.planCode }));
  } catch (error) {
    // Provisioning runs in its own transaction; do not leave behind an account nobody asked for.
    if (owner.created) await asPlatform(admin, "owner", (tx) => tx.delete(users).where(eq(users.id, owner.id)));
    if (error instanceof SlugUnavailableError) throw slugError(error.reason);
    throw error;
  }

  await asPlatform(admin, "owner", (tx) =>
    recordPlatformAudit(tx, {
      admin,
      action: "tenant.created",
      tenantId,
      targetType: "tenant",
      targetId: tenantId,
      metadata: { slug, planCode: data.planCode ?? null, ownerUserId: owner.id, ownerCreated: owner.created },
    }),
  );

  let setupEmailDelivered: boolean | null = null;
  if (owner.token) {
    const result = await sendPlatformEmail({
      to: data.ownerEmail,
      ...workspaceCreatedMessage({ name: owner.name, tenantName: data.name, url: PLATFORM_LINKS.resetPassword(owner.token) }),
    });
    setupEmailDelivered = result.delivered;
  }

  return {
    tenantId,
    slug,
    ownerUserId: owner.id,
    ownerCreated: owner.created,
    setupEmailDelivered,
    setupToken: owner.token && !setupEmailDelivered ? owner.token : null,
  };
}

/* ----------------------------------------------------------------- update */

export const updateTenantSchema = z.object({
  name: tenantNameSchema.optional(),
  slug: z.string().trim().max(60).optional(),
});
export type UpdateTenantInput = z.input<typeof updateTenantSchema>;

export async function updateTenant(admin: PlatformActor, id: string, input: UpdateTenantInput): Promise<{ id: string; name: string; slug: string }> {
  return asPlatform(admin, "owner", async (tx) => {
    const data = parse(updateTenantSchema, input);
    const tenant = await requireTenant(tx, id);

    const changes: { name?: string; slug?: string } = {};
    if (data.name !== undefined && data.name !== tenant.name) changes.name = data.name;
    if (data.slug !== undefined) {
      const slug = checkedSlug(data.slug);
      if (slug !== tenant.slug) {
        const taken = await tx
          .select({ id: tenants.id })
          .from(tenants)
          .where(and(eq(tenants.slug, slug), ne(tenants.id, id)))
          .limit(1);
        if (taken.length > 0) throw slugError("taken");
        changes.slug = slug;
      }
    }

    const fields = Object.keys(changes);
    if (fields.length === 0) return { id, name: tenant.name, slug: tenant.slug };

    await tx.update(tenants).set(changes).where(eq(tenants.id, id));
    await recordPlatformAudit(tx, {
      admin,
      action: "tenant.updated",
      tenantId: id,
      targetType: "tenant",
      targetId: id,
      metadata: { fields, ...(changes.slug ? { previousSlug: tenant.slug, slug: changes.slug } : {}) },
    });
    return { id, name: changes.name ?? tenant.name, slug: changes.slug ?? tenant.slug };
  });
}

/* ------------------------------------------------------- suspend/activate */

const reasonSchema = z.string().trim().min(3, "Say why the workspace is being suspended.").max(500);

/**
 * Locks members out of the workspace and takes its storefront offline. Both
 * are enforced on every request where the tenant is resolved, so no session
 * needs to be touched and nothing is deleted.
 */
export async function suspendTenant(admin: PlatformActor, id: string, reason: string): Promise<void> {
  await asPlatform(admin, "owner", async (tx) => {
    const text = parse(reasonSchema, reason);
    const tenant = await requireTenant(tx, id);
    if (tenant.status === "suspended") throw new ConflictError("This workspace is already suspended.");
    await tx.update(tenants).set({ status: "suspended", suspendedReason: text }).where(eq(tenants.id, id));
    await recordPlatformAudit(tx, {
      admin,
      action: "tenant.suspended",
      tenantId: id,
      targetType: "tenant",
      targetId: id,
      metadata: { reason: text },
    });
  });
}

export async function activateTenant(admin: PlatformActor, id: string): Promise<void> {
  await asPlatform(admin, "owner", async (tx) => {
    const tenant = await requireTenant(tx, id);
    if (tenant.status === "active") throw new ConflictError("This workspace is already active.");
    await tx.update(tenants).set({ status: "active", suspendedReason: null }).where(eq(tenants.id, id));
    await recordPlatformAudit(tx, { admin, action: "tenant.activated", tenantId: id, targetType: "tenant", targetId: id });
  });
}

/* ------------------------------------------------------------ plan/limits */

export const changeTenantPlanSchema = z
  .object({
    planId: z.uuid().optional(),
    planCode: z.string().trim().min(1).max(40).optional(),
    cycle: z.enum(["monthly", "yearly"]).optional(),
  })
  .refine((value) => Boolean(value.planId) !== Boolean(value.planCode), { path: ["planId"], message: "Name the plan by id or by code." });
export type ChangeTenantPlanInput = z.input<typeof changeTenantPlanSchema>;

/** Moves a workspace to another plan: the tenant row and its subscription change together. */
export async function changeTenantPlan(
  admin: PlatformActor,
  id: string,
  input: ChangeTenantPlanInput,
): Promise<{ planId: string; planCode: string }> {
  return asPlatform(admin, "owner", async (tx) => {
    const data = parse(changeTenantPlanSchema, input);
    const tenant = await requireTenant(tx, id);

    const [plan] = await tx
      .select({ id: plans.id, code: plans.code })
      .from(plans)
      .where(data.planId ? eq(plans.id, data.planId) : eq(plans.code, data.planCode!))
      .limit(1);
    if (!plan) throw new NotFoundError("Plan");

    await tx.update(tenants).set({ planId: plan.id }).where(eq(tenants.id, id));

    const periodEnd = new Date();
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    await tx
      .insert(subscriptions)
      .values({ tenantId: id, planId: plan.id, currentPeriodEnd: periodEnd, ...(data.cycle ? { cycle: data.cycle } : {}) })
      .onConflictDoUpdate({
        target: subscriptions.tenantId,
        set: { planId: plan.id, ...(data.cycle ? { cycle: data.cycle } : {}) },
      });

    await recordPlatformAudit(tx, {
      admin,
      action: "tenant.plan_changed",
      tenantId: id,
      targetType: "tenant",
      targetId: id,
      metadata: { fromPlanId: tenant.planId, toPlanId: plan.id, toPlanCode: plan.code, cycle: data.cycle ?? null },
    });
    return { planId: plan.id, planCode: plan.code };
  });
}

const overrideValue = z.number().int("Use a whole number.").min(0, "A limit cannot be negative.").max(2_000_000_000).nullable().optional();

/** A key left out removes that override; `null` means unlimited for this tenant. */
export const limitOverridesSchema = z.strictObject({
  maxTeamMembers: overrideValue,
  maxPublishedTours: overrideValue,
  maxStorageMb: overrideValue,
  maxBookingsPerMonth: overrideValue,
});

/** Replaces the workspace's limit overrides with exactly the given set. */
export async function setLimitOverrides(admin: PlatformActor, id: string, input: TenantLimitOverrides): Promise<TenantLimitOverrides> {
  return asPlatform(admin, "owner", async (tx) => {
    const data = parse(limitOverridesSchema, input);
    await requireTenant(tx, id);

    const overrides: TenantLimitOverrides = {};
    for (const key of LIMIT_KEYS) {
      if (data[key] !== undefined) overrides[key] = data[key];
    }
    await tx.update(tenants).set({ limitOverrides: overrides }).where(eq(tenants.id, id));
    await recordPlatformAudit(tx, {
      admin,
      action: "tenant.limits_overridden",
      tenantId: id,
      targetType: "tenant",
      targetId: id,
      metadata: { overrides },
    });
    return overrides;
  });
}

/* ----------------------------------------------------------------- owners */

/** Members holding the built-in Owner or Administrator role. */
export async function listTenantAdmins(admin: PlatformActor, id: string): Promise<TenantAdminView[]> {
  return asPlatform(admin, "support", async (tx) => {
    await requireTenant(tx, id);
    return readAdministrators(tx, id);
  });
}

export const setTenantOwnerSchema = z
  .object({ userId: z.uuid().optional(), email: emailSchema.optional() })
  .refine((value) => Boolean(value.userId) !== Boolean(value.email), { path: ["userId"], message: "Name the new owner by id or by e-mail." });
export type SetTenantOwnerInput = z.input<typeof setTenantOwnerSchema>;

/**
 * Hands a workspace to another existing account, for example when the
 * original owner has left the business. The new owner becomes an active
 * member with the Owner role; previous owners step down to Administrator
 * (they stay owners only if the workspace has deleted that role).
 */
export async function setTenantOwner(
  admin: PlatformActor,
  id: string,
  input: SetTenantOwnerInput,
): Promise<{ ownerUserId: string; previousOwnerUserIds: string[] }> {
  return asPlatform(admin, "owner", async (tx) => {
    const data = parse(setTenantOwnerSchema, input);
    await requireTenant(tx, id);

    const [user] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(data.userId ? eq(users.id, data.userId) : eq(users.email, data.email!))
      .limit(1);
    if (!user) throw new NotFoundError("User");
    if (user.status !== "active") throw new ConflictError("That account is disabled and cannot own a workspace.");

    const systemRoles = await tx
      .select({ id: roles.id, systemKey: roles.systemKey })
      .from(roles)
      .where(and(eq(roles.tenantId, id), inArray(roles.systemKey, ["owner", "admin"])));
    const ownerRole = systemRoles.find((role) => role.systemKey === "owner");
    const adminRole = systemRoles.find((role) => role.systemKey === "admin");
    if (!ownerRole) throw new ConflictError("This workspace has no Owner role.");

    const previous = await tx
      .select({ id: memberships.id, userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, id), eq(memberships.roleId, ownerRole.id), ne(memberships.userId, user.id)));
    if (adminRole && previous.length > 0) {
      await tx
        .update(memberships)
        .set({ roleId: adminRole.id })
        .where(
          and(
            eq(memberships.tenantId, id),
            inArray(
              memberships.id,
              previous.map((row) => row.id),
            ),
          ),
        );
    }

    await tx
      .insert(memberships)
      .values({ tenantId: id, userId: user.id, roleId: ownerRole.id })
      .onConflictDoUpdate({ target: [memberships.tenantId, memberships.userId], set: { roleId: ownerRole.id, status: "active" } });

    const previousOwnerUserIds = previous.map((row) => row.userId);
    await recordPlatformAudit(tx, {
      admin,
      action: "tenant.owner_changed",
      tenantId: id,
      targetType: "user",
      targetId: user.id,
      metadata: { ownerUserId: user.id, previousOwnerUserIds, previousOwnersDemoted: Boolean(adminRole) },
    });
    return { ownerUserId: user.id, previousOwnerUserIds };
  });
}
