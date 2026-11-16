"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import {
  createJourneyEntry,
  deleteJourneyEntry,
  setJourneyEntryPublished,
  updateJourneyEntry,
  type CreateJourneyEntryInput,
  type UpdateJourneyEntryInput,
} from "@/server/content/journey";

/*
 * The schemas here only check the envelope. The journey service validates
 * every field itself and answers with one message per field (`title`,
 * `highlights.3`, `mediaIds`), which is what the editor shows beside each
 * control; a strict schema at this layer would flatten those.
 */
const id = z.string().min(1).max(64);
const fields = z.record(z.string(), z.unknown());

const LIST = "/workspace/journal";

function refresh(entryId?: string): void {
  revalidatePath(LIST);
  if (entryId) revalidatePath(`${LIST}/${entryId}`);
}

interface SavedEntry {
  id: string;
  slug: string;
  isPublished: boolean;
}

export const createJourneyEntryAction = workspaceAction("content.manage", z.object({ fields }), async ({ scope, input }): Promise<SavedEntry> => {
  const entry = await createJourneyEntry(scope, input.fields as CreateJourneyEntryInput);
  refresh(entry.id);
  return { id: entry.id, slug: entry.slug, isPublished: entry.isPublished };
});

export const updateJourneyEntryAction = workspaceAction("content.manage", z.object({ id, fields }), async ({ scope, input }): Promise<SavedEntry> => {
  const entry = await updateJourneyEntry(scope, input.id, input.fields as UpdateJourneyEntryInput);
  refresh(entry.id);
  return { id: entry.id, slug: entry.slug, isPublished: entry.isPublished };
});

export const setJourneyEntryPublishedAction = workspaceAction(
  "content.manage",
  z.object({ id, published: z.boolean() }),
  async ({ scope, input }): Promise<SavedEntry> => {
    const entry = await setJourneyEntryPublished(scope, input.id, input.published);
    refresh(entry.id);
    return { id: entry.id, slug: entry.slug, isPublished: entry.isPublished };
  },
);

export const deleteJourneyEntryAction = workspaceAction("content.manage", z.object({ id }), async ({ scope, input }) => {
  await deleteJourneyEntry(scope, input.id);
  refresh(input.id);
  return { id: input.id };
});
