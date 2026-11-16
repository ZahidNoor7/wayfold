"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { platformAction } from "@/server/actions";
import {
  deletePlatformIntegration,
  PLATFORM_INTEGRATION_CATEGORIES,
  savePlatformIntegration,
  setPlatformIntegrationEnabled,
  testPlatformIntegration,
} from "@/server/platform/integrations";
import { toActor } from "../../_lib/guard";

const category = z.enum(PLATFORM_INTEGRATION_CATEGORIES);

function refresh(): void {
  revalidatePath("/platform", "layout");
}

const saveSchema = z.object({
  provider: z.string().min(1).max(40),
  config: z.record(z.string(), z.unknown()),
  secrets: z.record(z.string(), z.string().max(2000)),
});

// Results carry status only. Config, hints and errors reach the page through the refreshed list.
export const savePlatformIntegrationAction = platformAction("owner", saveSchema, async ({ admin, input }) => {
  const saved = await savePlatformIntegration(toActor(admin), input);
  refresh();
  return { providerName: saved.providerName, status: saved.status };
});

export const testPlatformIntegrationAction = platformAction("owner", z.object({ category }), async ({ admin, input }) => {
  const tested = await testPlatformIntegration(toActor(admin), input.category);
  refresh();
  return { providerName: tested.providerName, status: tested.status, lastError: tested.lastError };
});

export const setPlatformIntegrationEnabledAction = platformAction("owner", z.object({ category, enabled: z.boolean() }), async ({ admin, input }) => {
  const updated = await setPlatformIntegrationEnabled(toActor(admin), input.category, input.enabled);
  refresh();
  return { providerName: updated.providerName, status: updated.status };
});

export const deletePlatformIntegrationAction = platformAction("owner", z.object({ category }), async ({ admin, input }) => {
  await deletePlatformIntegration(toActor(admin), input.category);
  refresh();
});
