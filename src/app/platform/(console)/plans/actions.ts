"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { platformAction } from "@/server/actions";
import { createPlan, createPlanSchema, deletePlan, updatePlan, updatePlanSchema } from "@/server/platform/plans";
import { toActor } from "../../_lib/guard";

function refresh(): void {
  revalidatePath("/platform", "layout");
}

export const createPlanAction = platformAction("owner", createPlanSchema, async ({ admin, input }) => {
  const plan = await createPlan(toActor(admin), input);
  refresh();
  return { id: plan.id, name: plan.name };
});

export const updatePlanAction = platformAction("owner", z.object({ planId: z.uuid(), changes: updatePlanSchema }), async ({ admin, input }) => {
  const plan = await updatePlan(toActor(admin), input.planId, input.changes);
  refresh();
  return { id: plan.id, name: plan.name };
});

export const deletePlanAction = platformAction("owner", z.object({ planId: z.uuid() }), async ({ admin, input }) => {
  await deletePlan(toActor(admin), input.planId);
  refresh();
});
