"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import { ensureDefaultCategories } from "@/server/catalog/categories";
import { completeOnboarding, updateBranding, updateBrandingSchema, updateWorkspaceProfile, updateWorkspaceProfileSchema } from "@/server/settings/workspace";

/** The profile fields first-run setup asks for. The service validates each one. */
const profileSchema = updateWorkspaceProfileSchema.pick({
  tagline: true,
  description: true,
  email: true,
  phone: true,
  address: true,
  currency: true,
  timezone: true,
  languages: true,
  regions: true,
});

export const saveOnboardingProfileAction = workspaceAction("workspace.manage", profileSchema, async ({ scope, input }) => {
  await updateWorkspaceProfile(scope, input);
  revalidatePath("/workspace", "layout");
  return null;
});

const lookSchema = updateBrandingSchema.pick({ theme: true, mode: true, radius: true, font: true });

export const saveOnboardingLookAction = workspaceAction("branding.manage", lookSchema, async ({ scope, input }) => {
  await updateBranding(scope, input);
  revalidatePath("/workspace", "layout");
  return null;
});

/**
 * Marks setup as finished and gives the workspace the standard tour
 * categories, in one transaction. Safe to call twice.
 */
export const finishOnboardingAction = workspaceAction("workspace.manage", z.object({}), async ({ scope }) => {
  await completeOnboarding(scope);
  await ensureDefaultCategories(scope);
  revalidatePath("/workspace", "layout");
  return null;
});
