"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import {
  deleteIntegration,
  saveIntegration,
  setDefaultIntegration,
  setIntegrationEnabled,
  testIntegration,
  type IntegrationView,
} from "@/server/integrations";

/*
 * Every result leaving this file is an IntegrationView rebuilt field by field
 * below: masked hints only, never a secret, ciphertext or key version. Secret
 * values travel one way, browser to server, and are sealed by the service.
 */

const idSchema = z.uuid("That connection could not be found.");

function clientView(view: IntegrationView): IntegrationView {
  return {
    id: view.id,
    provider: view.provider,
    providerName: view.providerName,
    category: view.category,
    label: view.label,
    isDefault: view.isDefault,
    status: view.status,
    config: view.config,
    secretHints: view.secretHints,
    lastTestedAt: view.lastTestedAt,
    lastError: view.lastError,
    rotatedAt: view.rotatedAt,
    updatedAt: view.updatedAt,
  };
}

function refresh(): void {
  revalidatePath("/workspace/settings/integrations");
}

export const saveIntegrationAction = workspaceAction(
  "integrations.manage",
  z.object({
    id: idSchema.optional(),
    provider: z.string().min(1).max(40),
    label: z.string().max(100).optional(),
    config: z.record(z.string(), z.unknown()),
    secrets: z.record(z.string(), z.string().max(8000)),
  }),
  async ({ scope, input }) => {
    const view = await saveIntegration(scope, input);
    refresh();
    return clientView(view);
  },
);

export const testIntegrationAction = workspaceAction("integrations.manage", z.object({ id: idSchema }), async ({ scope, input }) => {
  const view = await testIntegration(scope, input.id);
  refresh();
  return clientView(view);
});

export const setDefaultIntegrationAction = workspaceAction("integrations.manage", z.object({ id: idSchema }), async ({ scope, input }) => {
  await setDefaultIntegration(scope, input.id);
  refresh();
  return { id: input.id };
});

export const setIntegrationEnabledAction = workspaceAction(
  "integrations.manage",
  z.object({ id: idSchema, enabled: z.boolean() }),
  async ({ scope, input }) => {
    const view = await setIntegrationEnabled(scope, input.id, input.enabled);
    refresh();
    return clientView(view);
  },
);

export const deleteIntegrationAction = workspaceAction("integrations.manage", z.object({ id: idSchema }), async ({ scope, input }) => {
  await deleteIntegration(scope, input.id);
  refresh();
  return { id: input.id };
});
