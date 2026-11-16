"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import { updateSiteContent, type SiteSection } from "@/server/settings/site-content";

/*
 * The schema only checks the envelope. `updateSiteContent` validates the
 * section's fields itself and answers with one message per field, keyed by
 * dotted path (`0.label`, `home.title`), which is what the forms show; a
 * strict schema here would collapse those into a single error. An unknown
 * section name is refused by the service.
 */
const envelope = z.object({
  section: z.string().min(1).max(40),
  input: z.unknown(),
});

/** Saves one section of the website content and returns it as stored. */
export const updateSiteSectionAction = workspaceAction("content.manage", envelope, async ({ scope, input }) => {
  const section = input.section as SiteSection;
  const value: unknown = await updateSiteContent(scope, section, input.input);
  revalidatePath("/workspace/site");
  return { section, value };
});
