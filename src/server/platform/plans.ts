import "server-only";
import { asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { plans, subscriptions, tenants, type PlanFeatures } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { INTEGRATION_CATEGORIES, type IntegrationCategory } from "../integrations/types";
import { asPlatform, parse, requireId, type PlatformActor, type PlatformTx } from "./access";
import { recordPlatformAudit } from "./audit";
import { withPlatform } from "./db";

type PlanRow = typeof plans.$inferSelect;

export interface PlanView {
  id: string;
  code: string;
  name: string;
  description: string;
  /** Minor units. */
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  /** `null` means unlimited. */
  maxTeamMembers: number | null;
  maxPublishedTours: number | null;
  maxStorageMb: number | null;
  maxBookingsPerMonth: number | null;
  features: PlanFeatures;
  isPublic: boolean;
  isDefault: boolean;
  sortOrder: number;
  /** Workspaces currently on this plan. */
  tenantCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const CATEGORY_IDS = Object.keys(INTEGRATION_CATEGORIES) as [IntegrationCategory, ...IntegrationCategory[]];
// Fits a PostgreSQL integer with room to spare.
const MAX_INT = 2_000_000_000;

const price = z.number().int("Use whole minor units.").min(0, "A price cannot be negative.").max(MAX_INT);
const limit = z.number().int("Use a whole number.").min(0, "A limit cannot be negative.").max(MAX_INT).nullable();

export const planFeaturesSchema: z.ZodType<PlanFeatures> = z.strictObject({
  customDomain: z.boolean(),
  integrations: z.array(z.enum(CATEGORY_IDS)).transform((list) => [...new Set(list)]),
  platformStorage: z.boolean(),
  promotions: z.boolean(),
  removeBranding: z.boolean(),
});

const editable = {
  name: z.string().trim().min(2, "Enter a plan name.").max(60),
  description: z.string().trim().max(500),
  priceMonthly: price,
  priceYearly: price,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
  maxTeamMembers: limit,
  maxPublishedTours: limit,
  maxStorageMb: limit,
  maxBookingsPerMonth: limit,
  features: planFeaturesSchema,
  isPublic: z.boolean(),
  isDefault: z.boolean(),
  sortOrder: z.number().int().min(-1000).max(1000),
};

export const createPlanSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_-]{1,30}$/, "Use 2 to 31 lower-case letters, digits, hyphens or underscores."),
  ...editable,
  description: editable.description.default(""),
  currency: editable.currency.default("USD"),
  isPublic: editable.isPublic.default(true),
  isDefault: editable.isDefault.default(false),
  sortOrder: editable.sortOrder.default(0),
});
export type CreatePlanInput = z.input<typeof createPlanSchema>;

/** The plan code is its stable identity (sign-up links, seeds), so it cannot be edited. */
export const updatePlanSchema = z.strictObject(editable).partial();
export type UpdatePlanInput = z.input<typeof updatePlanSchema>;

function toView(row: PlanRow, tenantCount: number): PlanView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    priceMonthly: row.priceMonthly,
    priceYearly: row.priceYearly,
    currency: row.currency,
    maxTeamMembers: row.maxTeamMembers,
    maxPublishedTours: row.maxPublishedTours,
    maxStorageMb: row.maxStorageMb,
    maxBookingsPerMonth: row.maxBookingsPerMonth,
    features: row.features,
    isPublic: row.isPublic,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    tenantCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Written as plain SQL with an alias: the correlated reference to the outer
// `plans` row must stay table-qualified.
const tenantCount = sql<number>`(select count(*)::int from tenants t where t.plan_id = plans.id)`;

/**
 * Serialises changes to which plan is the default. "Exactly one default" is a
 * rule across rows, so two concurrent edits must not both read the old state.
 */
async function lockPlans(tx: PlatformTx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('wayfold:plans'))`);
}

async function findPlan(tx: PlatformTx, id: string): Promise<PlanRow> {
  requireId(id, "Plan");
  const [row] = await tx.select().from(plans).where(eq(plans.id, id)).limit(1);
  if (!row) throw new NotFoundError("Plan");
  return row;
}

async function countTenants(tx: PlatformTx, planId: string): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(tenants).where(eq(tenants.planId, planId));
  return row?.n ?? 0;
}

export async function listPlans(admin: PlatformActor): Promise<PlanView[]> {
  return asPlatform(admin, "support", async (tx) => {
    const rows = await tx.select({ plan: plans, tenantCount }).from(plans).orderBy(asc(plans.sortOrder), asc(plans.priceMonthly), asc(plans.name));
    return rows.map((row) => toView(row.plan, row.tenantCount));
  });
}

export async function getPlan(admin: PlatformActor, id: string): Promise<PlanView> {
  return asPlatform(admin, "support", async (tx) => {
    const row = await findPlan(tx, id);
    return toView(row, await countTenants(tx, row.id));
  });
}

export async function createPlan(admin: PlatformActor, input: unknown): Promise<PlanView> {
  return asPlatform(admin, "owner", async (tx) => {
    const data = parse(createPlanSchema, input);
    await lockPlans(tx);

    const taken = await tx.select({ id: plans.id }).from(plans).where(eq(plans.code, data.code)).limit(1);
    if (taken.length > 0) throw new ConflictError("A plan with that code already exists.");

    const currentDefault = await tx.select({ id: plans.id }).from(plans).where(eq(plans.isDefault, true)).limit(1);
    // The very first plan has to be the default: sign-up needs one to exist.
    const isDefault = data.isDefault || currentDefault.length === 0;
    if (isDefault) await tx.update(plans).set({ isDefault: false }).where(eq(plans.isDefault, true));

    const [row] = (await tx
      .insert(plans)
      .values({ ...data, isDefault })
      .returning()) as [PlanRow];

    await recordPlatformAudit(tx, {
      admin,
      action: "plan.created",
      targetType: "plan",
      targetId: row.id,
      metadata: { code: row.code, isDefault },
    });
    return toView(row, 0);
  });
}

export async function updatePlan(admin: PlatformActor, id: string, input: unknown): Promise<PlanView> {
  return asPlatform(admin, "owner", async (tx) => {
    const data = parse(updatePlanSchema, input);
    await lockPlans(tx);
    const existing = await findPlan(tx, id);

    if (data.isDefault === false && existing.isDefault) {
      throw new ConflictError("New workspaces need a default plan. Make another plan the default instead.");
    }
    if (data.isDefault === true && !existing.isDefault) {
      await tx.update(plans).set({ isDefault: false }).where(ne(plans.id, id));
    }

    const changes = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
    const changed = Object.keys(changes);
    const row =
      changed.length === 0
        ? existing
        : ((await tx.update(plans).set(changes).where(eq(plans.id, id)).returning()) as [PlanRow])[0];

    await recordPlatformAudit(tx, {
      admin,
      action: "plan.updated",
      targetType: "plan",
      targetId: id,
      metadata: { code: row.code, fields: changed },
    });
    return toView(row, await countTenants(tx, id));
  });
}

export async function deletePlan(admin: PlatformActor, id: string): Promise<void> {
  await asPlatform(admin, "owner", async (tx) => {
    await lockPlans(tx);
    const existing = await findPlan(tx, id);
    if (existing.isDefault) throw new ConflictError("The default plan cannot be deleted. Make another plan the default first.");

    const inUse =
      (await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.planId, id)).limit(1)).length > 0 ||
      (await tx.select({ id: subscriptions.tenantId }).from(subscriptions).where(eq(subscriptions.planId, id)).limit(1)).length > 0;
    if (inUse) throw new ConflictError("This plan still has workspaces on it. Move them to another plan first.", "plan_in_use");

    await tx.delete(plans).where(eq(plans.id, id));
    await recordPlatformAudit(tx, {
      admin,
      action: "plan.deleted",
      targetType: "plan",
      targetId: id,
      metadata: { code: existing.code },
    });
  });
}

const ALL_CATEGORIES: IntegrationCategory[] = [...CATEGORY_IDS];

type PlanSeed = Omit<typeof plans.$inferInsert, "id" | "createdAt" | "updatedAt" | "isDefault">;

/** The catalogue a fresh installation starts with. Prices are US cents. */
export const DEFAULT_PLANS: readonly PlanSeed[] = [
  {
    code: "free",
    name: "Free",
    description: "Everything a new operator needs to publish a first few tours.",
    priceMonthly: 0,
    priceYearly: 0,
    maxTeamMembers: 2,
    maxPublishedTours: 3,
    maxStorageMb: 200,
    maxBookingsPerMonth: 30,
    features: { customDomain: false, integrations: ["media", "email"], platformStorage: true, promotions: false, removeBranding: false },
    sortOrder: 0,
  },
  {
    code: "starter",
    name: "Starter",
    description: "For a small team taking bookings every week.",
    priceMonthly: 2_900,
    priceYearly: 29_000,
    maxTeamMembers: 5,
    maxPublishedTours: 15,
    maxStorageMb: 2_000,
    maxBookingsPerMonth: 200,
    features: { customDomain: true, integrations: ["media", "email", "maps"], platformStorage: true, promotions: true, removeBranding: false },
    sortOrder: 10,
  },
  {
    code: "professional",
    name: "Professional",
    description: "For established operators with a full catalogue and online payments.",
    priceMonthly: 7_900,
    priceYearly: 79_000,
    maxTeamMembers: 15,
    maxPublishedTours: 60,
    maxStorageMb: 10_000,
    maxBookingsPerMonth: 1_000,
    features: {
      customDomain: true,
      integrations: ["media", "email", "maps", "payments"],
      platformStorage: true,
      promotions: true,
      removeBranding: true,
    },
    sortOrder: 20,
  },
  {
    code: "business",
    name: "Business",
    description: "For larger teams running many departures across destinations.",
    priceMonthly: 19_900,
    priceYearly: 199_000,
    maxTeamMembers: 50,
    maxPublishedTours: 250,
    maxStorageMb: 50_000,
    maxBookingsPerMonth: 5_000,
    features: { customDomain: true, integrations: ALL_CATEGORIES, platformStorage: true, promotions: true, removeBranding: true },
    sortOrder: 30,
  },
  {
    code: "enterprise",
    name: "Enterprise",
    description: "No limits, for operators with bespoke requirements.",
    priceMonthly: 49_900,
    priceYearly: 499_000,
    maxTeamMembers: null,
    maxPublishedTours: null,
    maxStorageMb: null,
    maxBookingsPerMonth: null,
    features: { customDomain: true, integrations: ALL_CATEGORIES, platformStorage: true, promotions: true, removeBranding: true },
    sortOrder: 40,
  },
];

/**
 * System-only (seed script): makes sure the standard plans exist. Safe to run
 * any number of times. A plan that already exists is left exactly as the
 * platform owner last edited it, and an existing default is respected.
 */
export async function ensureDefaultPlans(): Promise<{ created: string[]; defaultCode: string }> {
  return withPlatform(async (tx) => {
    await lockPlans(tx);

    const inserted = await tx
      .insert(plans)
      .values(DEFAULT_PLANS.map((plan) => ({ ...plan, isDefault: false })))
      .onConflictDoNothing({ target: plans.code })
      .returning({ code: plans.code });
    const created = inserted.map((row) => row.code);

    let [current] = await tx.select({ code: plans.code }).from(plans).where(eq(plans.isDefault, true)).limit(1);
    if (!current) {
      [current] = await tx.update(plans).set({ isDefault: true }).where(eq(plans.code, "free")).returning({ code: plans.code });
    }

    if (created.length > 0) {
      await recordPlatformAudit(tx, { admin: null, action: "plan.defaults_seeded", targetType: "plan", metadata: { created } });
    }
    return { created, defaultCode: current!.code };
  });
}
