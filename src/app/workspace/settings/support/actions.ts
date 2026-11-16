"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import type { Workspace } from "@/server/auth/workspace";
import { approveSupportGrant, denySupportGrant, revokeSupportGrant, type SupportActor } from "@/server/support";

// Ids are checked by the service: one that cannot name a request is "not found" there.
const idSchema = z.string().min(1).max(64);

/** The member deciding, taken from the verified workspace session, never from input. */
function actorOf(workspace: Workspace): SupportActor {
  return { userId: workspace.user.id, permissions: workspace.permissions, isOwner: workspace.isOwner };
}

function refresh(): void {
  revalidatePath("/workspace/settings/support");
}

export const approveSupportGrantAction = workspaceAction(
  "support.manage",
  z.object({ id: idSchema, hours: z.number() }),
  async ({ scope, workspace, input }) => {
    const grant = await approveSupportGrant(scope, actorOf(workspace), input.id, { hours: input.hours });
    refresh();
    return { id: grant.id, expiresAt: grant.expiresAt };
  },
);

export const denySupportGrantAction = workspaceAction("support.manage", z.object({ id: idSchema }), async ({ scope, workspace, input }) => {
  const grant = await denySupportGrant(scope, actorOf(workspace), input.id);
  refresh();
  return { id: grant.id };
});

export const revokeSupportGrantAction = workspaceAction("support.manage", z.object({ id: idSchema }), async ({ scope, workspace, input }) => {
  const grant = await revokeSupportGrant(scope, actorOf(workspace), input.id);
  refresh();
  return { id: grant.id };
});
