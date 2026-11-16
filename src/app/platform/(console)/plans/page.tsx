import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanManager } from "@/components/platform/plan-manager";
import { PageSkeleton } from "@/components/workspace/page-header";
import { INTEGRATION_CATEGORIES } from "@/server/integrations/types";
import { listPlans } from "@/server/platform/plans";
import { platformGuard } from "../../_lib/guard";

export const metadata: Metadata = { title: "Plans" };

export default function PlansPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Plans />
    </Suspense>
  );
}

async function Plans() {
  const { actor, isOwner } = await platformGuard();
  const plans = await listPlans(actor);

  return (
    <PlanManager
      canEdit={isOwner}
      categories={Object.entries(INTEGRATION_CATEGORIES).map(([id, label]) => ({ id, label }))}
      plans={plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        currency: plan.currency,
        maxTeamMembers: plan.maxTeamMembers,
        maxPublishedTours: plan.maxPublishedTours,
        maxStorageMb: plan.maxStorageMb,
        maxBookingsPerMonth: plan.maxBookingsPerMonth,
        features: plan.features,
        isPublic: plan.isPublic,
        isDefault: plan.isDefault,
        sortOrder: plan.sortOrder,
        tenantCount: plan.tenantCount,
      }))}
    />
  );
}
