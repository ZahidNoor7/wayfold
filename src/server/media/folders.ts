import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { TenantScope } from "../db/context";
import { mediaAssets, mediaFolders } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { parseInput } from "./validation";

export type MediaFolder = typeof mediaFolders.$inferSelect;

export const folderSchema = z.object({
  name: z.string().trim().min(1, "Give the folder a name.").max(80, "Keep the folder name under 80 characters."),
});
export type FolderInput = z.input<typeof folderSchema>;

const idSchema = z.uuid();

/** Looks a folder up inside the tenant. A foreign or malformed id is "not found". */
export async function getFolder(scope: TenantScope, id: string): Promise<MediaFolder> {
  if (!idSchema.safeParse(id).success) throw new NotFoundError("Folder");
  const [row] = await scope.tx
    .select()
    .from(mediaFolders)
    .where(and(eq(mediaFolders.tenantId, scope.tenantId), eq(mediaFolders.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("Folder");
  return row;
}

export interface MediaFolderWithCount extends MediaFolder {
  assetCount: number;
}

export async function listFolders(scope: TenantScope): Promise<MediaFolderWithCount[]> {
  const rows = await scope.tx
    .select({
      id: mediaFolders.id,
      tenantId: mediaFolders.tenantId,
      name: mediaFolders.name,
      createdAt: mediaFolders.createdAt,
      assetCount: sql<number>`count(${mediaAssets.id})::int`,
    })
    .from(mediaFolders)
    .leftJoin(mediaAssets, and(eq(mediaAssets.tenantId, mediaFolders.tenantId), eq(mediaAssets.folderId, mediaFolders.id)))
    .where(eq(mediaFolders.tenantId, scope.tenantId))
    .groupBy(mediaFolders.id)
    .orderBy(sql`lower(${mediaFolders.name})`, mediaFolders.id);
  return rows;
}

async function assertNameFree(scope: TenantScope, name: string, exceptId?: string): Promise<void> {
  const conditions = [eq(mediaFolders.tenantId, scope.tenantId), sql`lower(${mediaFolders.name}) = lower(${name})`];
  if (exceptId) conditions.push(ne(mediaFolders.id, exceptId));
  const taken = await scope.tx.select({ id: mediaFolders.id }).from(mediaFolders).where(and(...conditions)).limit(1);
  if (taken.length > 0) throw new ConflictError("A folder with that name already exists.");
}

export async function createFolder(scope: TenantScope, input: FolderInput): Promise<MediaFolder> {
  const { name } = parseInput(folderSchema, input);
  await assertNameFree(scope, name);
  const [row] = (await scope.tx.insert(mediaFolders).values({ tenantId: scope.tenantId, name }).returning()) as [MediaFolder];
  return row;
}

export async function renameFolder(scope: TenantScope, id: string, input: FolderInput): Promise<MediaFolder> {
  const { name } = parseInput(folderSchema, input);
  await getFolder(scope, id);
  await assertNameFree(scope, name, id);
  const [row] = (await scope.tx
    .update(mediaFolders)
    .set({ name })
    .where(and(eq(mediaFolders.tenantId, scope.tenantId), eq(mediaFolders.id, id)))
    .returning()) as [MediaFolder];
  return row;
}

/** Deletes a folder. Its files are kept and moved to "no folder". */
export async function deleteFolder(scope: TenantScope, id: string): Promise<void> {
  await getFolder(scope, id);
  await scope.tx
    .update(mediaAssets)
    .set({ folderId: null })
    .where(and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.folderId, id)));
  await scope.tx.delete(mediaFolders).where(and(eq(mediaFolders.tenantId, scope.tenantId), eq(mediaFolders.id, id)));
}
