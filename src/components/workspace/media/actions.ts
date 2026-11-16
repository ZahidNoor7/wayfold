"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import { AppError } from "@/server/errors";
import {
  createFolder,
  createUploadSignature,
  deleteFolder,
  deleteMedia,
  finalizeUpload,
  finalizeUploadSchema,
  folderSchema,
  getMedia,
  listFolders,
  listMedia,
  listMediaSchema,
  renameFolder,
  replaceMedia,
  replaceMediaSchema,
  updateMedia,
  updateMediaSchema,
  uploadRequestSchema,
} from "@/server/media";
import { toMediaItem, type MediaFolderItem, type MediaItem, type MediaPageResult } from "./types";

const LIBRARY = "/workspace/media";
const id = z.string().min(1).max(64);

/** Tours, destinations and journal pages show library files, so they go stale with it. */
function revalidateEverywhere(): void {
  revalidatePath("/workspace", "layout");
}

/* ------------------------------------------------------------------- read */

/**
 * One page of the library, newest first. Backs the media library grid and
 * `MediaPicker`. Input: `{ folderId?: string | null, resourceType?, search?, cursor?, limit? }`.
 */
export const listMediaAction = workspaceAction("media.view", listMediaSchema, async ({ scope, input }): Promise<MediaPageResult> => {
  const page = await listMedia(scope, input);
  return { items: page.items.map(toMediaItem), nextCursor: page.nextCursor };
});

/** Library files by id, in the order asked for. Ids that no longer exist are left out. */
export const getMediaByIdsAction = workspaceAction("media.view", z.object({ ids: z.array(id).max(60) }), async ({ scope, input }): Promise<MediaItem[]> => {
  const items: MediaItem[] = [];
  for (const mediaId of input.ids) {
    try {
      items.push(toMediaItem(await getMedia(scope, mediaId)));
    } catch (error) {
      // A file deleted since it was chosen is simply no longer selectable.
      if (!(error instanceof AppError && error.code === "not_found")) throw error;
    }
  }
  return items;
});

export const listFoldersAction = workspaceAction("media.view", z.object({}), async ({ scope }): Promise<MediaFolderItem[]> => {
  const folders = await listFolders(scope);
  return folders.map((folder) => ({ id: folder.id, name: folder.name, assetCount: folder.assetCount }));
});

/* ----------------------------------------------------------------- upload */

/**
 * Step 1 of an upload. The result carries the signature and the public API
 * key the provider needs; the API secret stays on the server.
 */
export const createUploadSignatureAction = workspaceAction("media.manage", uploadRequestSchema, async ({ scope, input }) => {
  const signed = await createUploadSignature(scope, input);
  return { uploadUrl: signed.uploadUrl, fields: { ...signed.fields }, publicId: signed.publicId, resourceType: signed.resourceType };
});

/** Step 3 of an upload: verify what the provider holds and add it to the library. */
export const finalizeUploadAction = workspaceAction("media.manage", finalizeUploadSchema, async ({ scope, input }): Promise<MediaItem> => {
  const asset = await finalizeUpload(scope, input);
  revalidatePath(LIBRARY);
  return toMediaItem(asset);
});

/** Step 3 when replacing: point an existing entry at the newly uploaded file. */
export const replaceMediaAction = workspaceAction(
  "media.manage",
  replaceMediaSchema.extend({ id }),
  async ({ scope, input }): Promise<MediaItem> => {
    const { id: mediaId, ...replacement } = input;
    const asset = await replaceMedia(scope, mediaId, replacement);
    revalidateEverywhere();
    return toMediaItem(asset);
  },
);

/* ----------------------------------------------------------------- change */

export const updateMediaAction = workspaceAction(
  "media.manage",
  updateMediaSchema.extend({ id }),
  async ({ scope, input }): Promise<MediaItem> => {
    const { id: mediaId, ...changes } = input;
    const asset = await updateMedia(scope, mediaId, changes);
    revalidatePath(LIBRARY);
    return toMediaItem(asset);
  },
);

export const deleteMediaAction = workspaceAction("media.manage", z.object({ id }), async ({ scope, input }) => {
  await deleteMedia(scope, input.id);
  revalidateEverywhere();
  return { id: input.id };
});

/* ---------------------------------------------------------------- folders */

export const createFolderAction = workspaceAction("media.manage", folderSchema, async ({ scope, input }): Promise<MediaFolderItem> => {
  const folder = await createFolder(scope, input);
  revalidatePath(LIBRARY);
  return { id: folder.id, name: folder.name, assetCount: 0 };
});

export const renameFolderAction = workspaceAction("media.manage", folderSchema.extend({ id }), async ({ scope, input }) => {
  const folder = await renameFolder(scope, input.id, { name: input.name });
  revalidatePath(LIBRARY);
  return { id: folder.id, name: folder.name };
});

export const deleteFolderAction = workspaceAction("media.manage", z.object({ id }), async ({ scope, input }) => {
  await deleteFolder(scope, input.id);
  revalidatePath(LIBRARY);
  return { id: input.id };
});
