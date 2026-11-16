"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import { updateBookingSettings } from "@/server/settings/tenant-settings";
import { updateBranding, updateWorkspaceProfile } from "@/server/settings/workspace";

/*
 * The schemas here only fix the shape of what may be sent. The services own
 * every rule, and report problems per field ("social.instagram",
 * "languages.2"), which the forms show beside the field.
 */

const text = z.string().max(5000);

/** The workspace shell, the sidebar name, and the public site all read these values. */
function refreshEverywhere(): void {
  revalidatePath("/workspace", "layout");
  revalidatePath("/s/[site]", "layout");
}

export const updateBrandingAction = workspaceAction(
  "branding.manage",
  z.object({
    theme: z.string().max(40).optional(),
    mode: z.string().max(40).optional(),
    radius: z.string().max(40).optional(),
    font: z.string().max(40).optional(),
    logoMediaId: z.string().max(64).nullable().optional(),
  }),
  async ({ scope, input }) => {
    // The service rejects anything outside the listed themes, modes, corners and fonts.
    const branding = await updateBranding(scope, input as Parameters<typeof updateBranding>[1]);
    refreshEverywhere();
    return { theme: branding.theme, mode: branding.mode, radius: branding.radius, font: branding.font, logoMediaId: branding.logoMediaId ?? null };
  },
);

export const updateProfileAction = workspaceAction(
  "workspace.manage",
  z.object({
    name: text.optional(),
    tagline: text.optional(),
    description: text.optional(),
    languages: z.array(z.string().max(40)).max(50).optional(),
    regions: z.array(z.string().max(200)).max(50).optional(),
    currency: z.string().max(10).optional(),
    timezone: z.string().max(80).optional(),
  }),
  async ({ scope, input }) => {
    const profile = await updateWorkspaceProfile(scope, input as Parameters<typeof updateWorkspaceProfile>[1]);
    refreshEverywhere();
    return {
      name: profile.name,
      tagline: profile.tagline,
      description: profile.description,
      languages: profile.languages,
      regions: profile.regions,
      currency: profile.currency,
      timezone: profile.timezone,
    };
  },
);

const socialKeys = ["instagram", "youtube", "facebook", "tiktok", "whatsapp"] as const;

export const updateContactAction = workspaceAction(
  "workspace.manage",
  z.object({
    email: text.optional(),
    phone: text.optional(),
    address: text.optional(),
    website: text.optional(),
    social: z
      .object({
        instagram: text.optional(),
        youtube: text.optional(),
        facebook: text.optional(),
        tiktok: text.optional(),
        whatsapp: text.optional(),
      })
      .optional(),
  }),
  async ({ scope, input }) => {
    const profile = await updateWorkspaceProfile(scope, input);
    refreshEverywhere();
    return {
      email: profile.email,
      phone: profile.phone,
      address: profile.address,
      website: profile.website,
      social: Object.fromEntries(socialKeys.map((key) => [key, profile.social[key] ?? ""])) as Record<(typeof socialKeys)[number], string>,
    };
  },
);

export const updateBookingRulesAction = workspaceAction(
  "workspace.manage",
  z.object({
    holdHours: z.number().optional(),
    horizonDays: z.number().optional(),
    minNoticeDays: z.number().optional(),
    weeklyDaysOff: z.array(z.number()).max(7).optional(),
    referencePrefix: z.string().max(10).optional(),
  }),
  async ({ scope, input }) => {
    const settings = await updateBookingSettings(scope, input);
    revalidatePath("/workspace/settings");
    // Availability on the public site follows these rules straight away.
    revalidatePath("/s/[site]", "layout");
    return settings;
  },
);
