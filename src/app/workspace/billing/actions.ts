"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import { requestPlanChange } from "@/server/billing/overview";

/**
 * Asks Wayfold to move the workspace to another plan. Nothing changes here:
 * plans are changed by the platform, which follows up with the owner.
 */
export const requestPlanChangeAction = workspaceAction(
  "billing.manage",
  z.object({ planCode: z.string().trim().min(1, "Choose a plan.").max(64) }),
  async ({ workspace, scope, input }) => {
    const plan = await requestPlanChange(
      scope,
      { userId: workspace.user.id, permissions: workspace.permissions, isOwner: workspace.isOwner },
      input.planCode,
    );
    // The request is recorded in the activity log.
    revalidatePath("/workspace/activity");
    return { name: plan.name };
  },
);
