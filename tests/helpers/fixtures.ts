import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { plans, users } from "@/server/db/schema";
import type { PlanFeatures } from "@/server/db/schema";
import { withPlatform } from "@/server/platform/db";
import { provisionTenant } from "@/server/platform/provision-tenant";

export const unique = (prefix = "t") => `${prefix}-${randomBytes(5).toString("hex")}`;

const ALL_FEATURES: PlanFeatures = {
  customDomain: true,
  integrations: ["media", "email", "payments", "maps", "messaging"],
  platformStorage: true,
  promotions: true,
  removeBranding: true,
};

export interface PlanOverrides {
  maxTeamMembers?: number | null;
  maxPublishedTours?: number | null;
  maxStorageMb?: number | null;
  maxBookingsPerMonth?: number | null;
  features?: Partial<PlanFeatures>;
}

/** Creates a plan with its own code so tests never share limits. */
export async function createPlan(overrides: PlanOverrides = {}): Promise<{ id: string; code: string }> {
  const code = unique("plan");
  const { features, ...limits } = overrides;
  return withPlatform(async (tx) => {
    const [row] = await tx
      .insert(plans)
      .values({ code, name: code, isPublic: false, features: { ...ALL_FEATURES, ...features }, ...limits })
      .returning({ id: plans.id, code: plans.code });
    return row!;
  });
}

export async function createUser(overrides: { email?: string; name?: string } = {}): Promise<{ id: string; email: string }> {
  const email = overrides.email ?? `${unique("user")}@example.test`;
  return withPlatform(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({ email, name: overrides.name ?? "Test User", passwordHash: "!", emailVerifiedAt: new Date() })
      .returning({ id: users.id, email: users.email });
    return row!;
  });
}

export interface TenantFixture {
  tenantId: string;
  slug: string;
  ownerId: string;
  ownerEmail: string;
  ownerRoleId: string;
  planId: string;
}

/** A complete workspace: plan, owner user, tenant, built-in roles, subscription. */
export async function createTenant(options: { plan?: PlanOverrides; name?: string } = {}): Promise<TenantFixture> {
  const plan = await createPlan(options.plan);
  const owner = await createUser();
  const slug = unique("biz");
  const provisioned = await provisionTenant({
    name: options.name ?? `Business ${slug}`,
    slug,
    ownerUserId: owner.id,
    planCode: plan.code,
  });
  return {
    tenantId: provisioned.tenantId,
    slug,
    ownerId: owner.id,
    ownerEmail: owner.email,
    ownerRoleId: provisioned.ownerRoleId,
    planId: plan.id,
  };
}

export async function deleteUser(userId: string): Promise<void> {
  await withPlatform((tx) => tx.delete(users).where(eq(users.id, userId)));
}

export const randomId = () => randomUUID();
