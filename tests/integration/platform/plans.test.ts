import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { plans } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import {
  createPlan,
  DEFAULT_PLANS,
  deletePlan,
  ensureDefaultPlans,
  getPlan,
  listPlans,
  updatePlan,
  type CreatePlanInput,
} from "@/server/platform/plans";
import { createTenant, randomId, unique } from "../../helpers/fixtures";
import { auditBy, caught, createAdmin } from "./helpers";

const features = { customDomain: false, integrations: ["media", "email"], platformStorage: true, promotions: false, removeBranding: false };

function planInput(overrides: Partial<CreatePlanInput> = {}): CreatePlanInput {
  return {
    code: unique("p").replace(/-/g, "_"),
    name: "Trial plan",
    priceMonthly: 1_000,
    priceYearly: 10_000,
    maxTeamMembers: 3,
    maxPublishedTours: 5,
    maxStorageMb: 100,
    maxBookingsPerMonth: null,
    features,
    ...overrides,
  } as CreatePlanInput;
}

async function defaultCount(): Promise<number> {
  const result = await withPlatform((tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from plans where is_default`));
  return result.rows[0]!.n;
}

describe("plans", () => {
  beforeAll(async () => {
    await ensureDefaultPlans();
  });

  it("seeds the standard catalogue once and leaves it alone afterwards", async () => {
    const owner = await createAdmin();
    const again = await ensureDefaultPlans();
    expect(again.created).toEqual([]);
    expect(again.defaultCode).toBe((await listPlans(owner)).find((plan) => plan.isDefault)!.code);
    expect(await defaultCount()).toBe(1);

    const all = await listPlans(owner);
    const byCode = new Map(all.map((plan) => [plan.code, plan]));
    for (const seed of DEFAULT_PLANS) expect(byCode.has(seed.code)).toBe(true);

    const free = byCode.get("free")!;
    expect(free).toMatchObject({
      priceMonthly: 0,
      maxTeamMembers: 2,
      maxPublishedTours: 3,
      maxStorageMb: 200,
      maxBookingsPerMonth: 30,
      features: { customDomain: false, integrations: ["media", "email"], platformStorage: true, promotions: false },
    });
    expect(byCode.get("enterprise")).toMatchObject({
      maxTeamMembers: null,
      maxPublishedTours: null,
      maxStorageMb: null,
      maxBookingsPerMonth: null,
    });

    // Limits and prices only ever go up through the tiers.
    const tiers = ["free", "starter", "professional", "business"].map((code) => byCode.get(code)!);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]!.priceMonthly).toBeGreaterThan(tiers[i - 1]!.priceMonthly);
      expect(tiers[i]!.maxTeamMembers!).toBeGreaterThan(tiers[i - 1]!.maxTeamMembers!);
      expect(tiers[i]!.maxPublishedTours!).toBeGreaterThan(tiers[i - 1]!.maxPublishedTours!);
      expect(tiers[i]!.maxStorageMb!).toBeGreaterThan(tiers[i - 1]!.maxStorageMb!);
      expect(tiers[i]!.maxBookingsPerMonth!).toBeGreaterThan(tiers[i - 1]!.maxBookingsPerMonth!);
    }
  });

  it("does not overwrite a seeded plan the owner has edited", async () => {
    const owner = await createAdmin();
    const starter = (await listPlans(owner)).find((plan) => plan.code === "starter")!;
    await updatePlan(owner, starter.id, { description: "Edited by the owner" });
    await ensureDefaultPlans();
    expect((await getPlan(owner, starter.id)).description).toBe("Edited by the owner");
    await updatePlan(owner, starter.id, { description: starter.description });
  });

  it("creates, reads, updates and deletes a plan, auditing each change", async () => {
    const owner = await createAdmin();
    const created = await createPlan(owner, planInput({ name: "  Growth  ", currency: "eur", description: "For growing teams" }));
    expect(created).toMatchObject({ name: "Growth", currency: "EUR", isDefault: false, isPublic: true, tenantCount: 0, sortOrder: 0 });

    const updated = await updatePlan(owner, created.id, { priceMonthly: 1_500, maxTeamMembers: null, features: { ...features, promotions: true } });
    expect(updated).toMatchObject({ priceMonthly: 1_500, maxTeamMembers: null, features: { promotions: true } });
    expect(await updatePlan(owner, created.id, {})).toMatchObject({ priceMonthly: 1_500 });
    expect(await getPlan(owner, created.id)).toMatchObject({ code: created.code, priceMonthly: 1_500 });

    await deletePlan(owner, created.id);
    expect(await caught(() => getPlan(owner, created.id))).toBeInstanceOf(NotFoundError);

    const actions = (await auditBy(owner.userId)).map((row) => row.action);
    expect(actions.filter((action) => action === "plan.updated")).toHaveLength(2);
    expect(actions).toEqual(expect.arrayContaining(["plan.created", "plan.deleted"]));
    const [createdRow] = (await auditBy(owner.userId)).filter((row) => row.action === "plan.created");
    expect(createdRow).toMatchObject({ actorType: "platform_admin", tenantId: null, targetType: "plan", targetId: created.id });
  });

  it("rejects invalid prices, limits, features and codes", async () => {
    const owner = await createAdmin();
    const bad: Partial<CreatePlanInput>[] = [
      { priceMonthly: -1 },
      { priceYearly: 9.5 },
      { maxTeamMembers: -3 },
      { maxStorageMb: 1.5 },
      { code: "Has Spaces" },
      { currency: "EURO" },
      { features: { ...features, integrations: ["teleport"] } as never },
      { features: { customDomain: true } as never },
      { features: { ...features, extra: true } as never },
      { name: "" },
    ];
    for (const overrides of bad) {
      expect(await caught(() => createPlan(owner, planInput(overrides)))).toBeInstanceOf(ValidationError);
    }
    const error = await caught(() => createPlan(owner, planInput({ priceMonthly: -1 })));
    expect(error.fieldErrors).toHaveProperty("priceMonthly");

    const plan = await createPlan(owner, planInput());
    expect(await caught(() => updatePlan(owner, plan.id, { maxPublishedTours: -1 }))).toBeInstanceOf(ValidationError);
    expect(await caught(() => updatePlan(owner, plan.id, { code: "renamed" } as never))).toBeInstanceOf(ValidationError);
    expect(await caught(() => createPlan(owner, planInput({ code: plan.code })))).toBeInstanceOf(ConflictError);
    await deletePlan(owner, plan.id);
  });

  it("de-duplicates the integration categories of a plan", async () => {
    const owner = await createAdmin();
    const plan = await createPlan(owner, planInput({ features: { ...features, integrations: ["media", "media", "maps"] } }));
    expect(plan.features.integrations).toEqual(["media", "maps"]);
    await deletePlan(owner, plan.id);
  });

  it("keeps exactly one default plan through every change", async () => {
    const owner = await createAdmin();
    const original = (await listPlans(owner)).find((plan) => plan.isDefault)!;
    try {
      const next = await createPlan(owner, planInput({ isDefault: true }));
      expect(next.isDefault).toBe(true);
      expect(await defaultCount()).toBe(1);
      expect((await getPlan(owner, original.id)).isDefault).toBe(false);

      // The default cannot be switched off or deleted, only handed over.
      expect(await caught(() => updatePlan(owner, next.id, { isDefault: false }))).toBeInstanceOf(ConflictError);
      expect(await caught(() => deletePlan(owner, next.id))).toBeInstanceOf(ConflictError);
      expect(await defaultCount()).toBe(1);

      await updatePlan(owner, original.id, { isDefault: true });
      expect((await getPlan(owner, next.id)).isDefault).toBe(false);
      expect(await defaultCount()).toBe(1);
      // Not deleted: a workspace created elsewhere while it was the default may still be on it.
      await updatePlan(owner, next.id, { isPublic: false });
    } finally {
      await withPlatform(async (tx) => {
        await tx.update(plans).set({ isDefault: false });
        await tx.update(plans).set({ isDefault: true }).where(eq(plans.id, original.id));
      });
    }
  });

  it("refuses to delete a plan that workspaces are on", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();
    const error = await caught(() => deletePlan(owner, tenant.planId));
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe("plan_in_use");
    expect((await getPlan(owner, tenant.planId)).tenantCount).toBe(1);
  });

  it("answers not-found for unknown and malformed ids", async () => {
    const owner = await createAdmin();
    expect(await caught(() => getPlan(owner, randomId()))).toBeInstanceOf(NotFoundError);
    expect(await caught(() => updatePlan(owner, "not-a-uuid", { name: "Nope" }))).toBeInstanceOf(NotFoundError);
    expect(await caught(() => deletePlan(owner, randomId()))).toBeInstanceOf(NotFoundError);
  });

  it("lets support read plans but not change them", async () => {
    const support = await createAdmin("support");
    expect((await listPlans(support)).length).toBeGreaterThanOrEqual(DEFAULT_PLANS.length);
    expect(await caught(() => createPlan(support, planInput()))).toBeInstanceOf(ForbiddenError);
    expect(await auditBy(support.userId)).toEqual([]);
  });
});
