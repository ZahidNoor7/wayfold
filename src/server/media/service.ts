import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import { assertWithinLimit, getEntitlements } from "../billing/limits";
import type { TenantScope } from "../db/context";
import { mediaAssets } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { destroyResource, fetchResource, signParams, SIGNATURE_TTL_SECONDS, unixNow, uploadUrl, type ProviderResource } from "./cloudinary";
import { getFolder } from "./folders";
import { assertDeclaredUploadAllowed, BYTES_PER_MB, normaliseFormat, storedUploadProblem, type MediaResourceType } from "./rules";
import { isInsideTenantFolder, selectStorage, storageForAsset, tenantFolderPrefix, type MediaStorage } from "./storage";
import { FOREIGN_KEY_VIOLATION, parseInput, pgErrorCode } from "./validation";

export type MediaAsset = typeof mediaAssets.$inferSelect;

const resourceTypeSchema = z.enum(["image", "video"]);
const idSchema = z.uuid();
const publicIdSchema = z.string().min(1).max(512);
const filenameSchema = z.string().trim().min(1, "The file needs a name.").max(255);
const altSchema = z.string().trim().max(300, "Keep the description under 300 characters.");

/* ------------------------------------------------------------------ usage */

export interface StorageUsage {
  usedBytes: number;
  /** `null` = unlimited. */
  limitMb: number | null;
  assetCount: number;
}

async function measureUsage(scope: TenantScope): Promise<{ usedBytes: number; assetCount: number }> {
  const [row] = await scope.tx
    .select({
      usedBytes: sql<string>`coalesce(sum(${mediaAssets.bytes}), 0)`,
      assetCount: sql<number>`count(*)::int`,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.tenantId, scope.tenantId));
  return { usedBytes: Number(row?.usedBytes ?? 0), assetCount: row?.assetCount ?? 0 };
}

export async function getStorageUsage(scope: TenantScope): Promise<StorageUsage> {
  const { usedBytes, assetCount } = await measureUsage(scope);
  const { limits } = await getEntitlements(scope);
  return { usedBytes, limitMb: limits.maxStorageMb, assetCount };
}

/**
 * Throws when the library would exceed the plan after adding `addingBytes`.
 * `releasedBytes` is space a replacement frees in the same step.
 */
async function assertStorageQuota(scope: TenantScope, addingBytes: number, releasedBytes = 0): Promise<void> {
  const { usedBytes } = await measureUsage(scope);
  await assertWithinLimit(scope, "maxStorageMb", Math.max(usedBytes - releasedBytes, 0) / BYTES_PER_MB, addingBytes / BYTES_PER_MB);
}

/* ----------------------------------------------------------------- upload */

export const uploadRequestSchema = z.object({
  resourceType: resourceTypeSchema,
  filename: filenameSchema,
  bytes: z.number().int().positive("The file is empty."),
  contentType: z.string().trim().min(1).max(100),
  folderId: idSchema.nullish(),
});
export type UploadRequest = z.input<typeof uploadRequestSchema>;

export interface UploadSignature {
  /** Where the browser posts the file, together with `fields`. */
  uploadUrl: string;
  /** Form fields to send unchanged; altering any signed one voids the signature. */
  fields: {
    api_key: string;
    timestamp: string;
    signature: string;
    folder: string;
    public_id: string;
    allowed_formats: string;
    overwrite: string;
  };
  /** The id the stored file will have; pass it to `finalizeUpload`. */
  publicId: string;
  resourceType: MediaResourceType;
  storageOwner: MediaStorage["owner"];
  expiresAt: Date;
}

/**
 * Authorises one direct browser upload into this tenant's folder. Everything
 * that constrains the upload (folder, file name, format, no overwrite) is
 * covered by the signature, and the API secret never leaves the server.
 */
export async function createUploadSignature(scope: TenantScope, input: UploadRequest): Promise<UploadSignature> {
  const request = parseInput(uploadRequestSchema, input);
  const format = assertDeclaredUploadAllowed(request);
  if (request.folderId) await getFolder(scope, request.folderId);

  const storage = await selectStorage(scope);
  await assertStorageQuota(scope, request.bytes);

  const timestamp = unixNow();
  const signed = {
    // Only the declared format, so a different kind of file is refused upstream.
    allowed_formats: format,
    folder: tenantFolderPrefix(scope, storage.config),
    // A used signature cannot be replayed to swap the file after finalising.
    overwrite: "false",
    // Server-chosen name: the browser cannot aim at an existing file.
    public_id: randomUUID(),
    timestamp: String(timestamp),
  };
  return {
    uploadUrl: uploadUrl(storage.config.cloudName, request.resourceType),
    fields: { ...signed, api_key: storage.secrets.apiKey, signature: signParams(signed, storage.secrets.apiSecret) },
    publicId: `${signed.folder}/${signed.public_id}`,
    resourceType: request.resourceType,
    storageOwner: storage.owner,
    expiresAt: new Date((timestamp + SIGNATURE_TTL_SECONDS) * 1000),
  };
}

/**
 * Establishes what was really uploaded. The client's word is used only to
 * know which file to ask the provider about: ownership (tenant folder), kind,
 * format, size and quota are all judged from the provider's own answer. A
 * file that fails those checks is deleted from the provider again.
 */
async function verifyUpload(
  scope: TenantScope,
  storage: MediaStorage,
  publicId: string,
  resourceType: MediaResourceType,
  releasedBytes = 0,
): Promise<ProviderResource> {
  const foreign = () => new ForbiddenError("That upload does not belong to this workspace.");
  // Checked before any provider call: we never even look at another tenant's file.
  if (!isInsideTenantFolder(scope, storage.config, publicId)) throw foreign();

  const resource = await fetchResource(storage, resourceType, publicId);
  if (!resource) throw new NotFoundError("Upload");
  if (resource.publicId !== publicId || !isInsideTenantFolder(scope, storage.config, resource.publicId)) throw foreign();

  const discard = async () => {
    // Best effort: the rejection below matters more than the clean-up.
    await destroyResource(storage, resourceType, publicId).catch(() => undefined);
  };

  if (resource.resourceType !== resourceType || resource.deliveryType !== "upload") {
    await discard();
    throw new ValidationError("That upload is not a supported file.");
  }
  const problem = storedUploadProblem(resourceType, resource.format, resource.bytes);
  if (problem) {
    await discard();
    throw new ValidationError(problem);
  }

  // One finalise at a time per tenant, so two uploads cannot both squeeze
  // under the quota. Released when the surrounding transaction ends.
  await scope.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`media-quota:${scope.tenantId}`}, 0))`);
  try {
    await assertStorageQuota(scope, resource.bytes, releasedBytes);
  } catch (error) {
    await discard();
    throw error;
  }
  return resource;
}

function providerColumns(storage: MediaStorage, resource: ProviderResource) {
  return {
    storageOwner: storage.owner,
    integrationId: storage.integrationId,
    provider: storage.provider,
    publicId: resource.publicId,
    format: normaliseFormat(resource.format),
    bytes: resource.bytes,
    width: resource.width,
    height: resource.height,
    durationSeconds: resource.durationSeconds,
    url: resource.secureUrl,
  };
}

async function findByPublicId(scope: TenantScope, provider: string, publicId: string): Promise<MediaAsset | undefined> {
  const [row] = await scope.tx
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.provider, provider), eq(mediaAssets.publicId, publicId)))
    .limit(1);
  return row;
}

export const finalizeUploadSchema = z.object({
  publicId: publicIdSchema,
  resourceType: resourceTypeSchema,
  folderId: idSchema.nullish(),
  alt: altSchema.optional(),
  /** Display name only; never used to decide anything. */
  filename: filenameSchema.optional(),
});
export type FinalizeUploadInput = z.input<typeof finalizeUploadSchema>;

/**
 * Adds a finished browser upload to the library after verifying it with the
 * provider. Calling it again for the same file returns the existing entry.
 */
export async function finalizeUpload(scope: TenantScope, input: FinalizeUploadInput): Promise<MediaAsset> {
  const request = parseInput(finalizeUploadSchema, input);
  const storage = await selectStorage(scope);
  if (!isInsideTenantFolder(scope, storage.config, request.publicId)) {
    throw new ForbiddenError("That upload does not belong to this workspace.");
  }

  const existing = await findByPublicId(scope, storage.provider, request.publicId);
  if (existing) return existing;
  if (request.folderId) await getFolder(scope, request.folderId);

  const resource = await verifyUpload(scope, storage, request.publicId, request.resourceType);

  const [inserted] = await scope.tx
    .insert(mediaAssets)
    .values({
      tenantId: scope.tenantId,
      folderId: request.folderId ?? null,
      resourceType: request.resourceType,
      originalFilename: request.filename ?? "",
      alt: request.alt ?? "",
      createdBy: scope.userId,
      ...providerColumns(storage, resource),
    })
    .onConflictDoNothing({ target: [mediaAssets.tenantId, mediaAssets.provider, mediaAssets.publicId] })
    .returning();
  if (!inserted) {
    // A concurrent finalise of the same file won the race; hand back its row.
    const winner = await findByPublicId(scope, storage.provider, request.publicId);
    if (!winner) throw new ConflictError("That upload is already being added. Try again.");
    return winner;
  }

  await recordAudit(scope, {
    action: "media.uploaded",
    targetType: "media_asset",
    targetId: inserted.id,
    metadata: { resourceType: inserted.resourceType, format: inserted.format, bytes: inserted.bytes, storageOwner: inserted.storageOwner },
  });
  return inserted;
}

/* ------------------------------------------------------------------- read */

export async function getMedia(scope: TenantScope, id: string): Promise<MediaAsset> {
  // A malformed id is answered exactly like an unknown or foreign one.
  if (!idSchema.safeParse(id).success) throw new NotFoundError("Media file");
  const [row] = await scope.tx
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("Media file");
  return row;
}

export const DEFAULT_PAGE_SIZE = 40;
export const MAX_PAGE_SIZE = 100;

export const listMediaSchema = z.object({
  /** A folder id, `null` for files in no folder, or omitted for all files. */
  folderId: idSchema.nullish(),
  resourceType: resourceTypeSchema.optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});
export type ListMediaInput = z.input<typeof listMediaSchema>;

export interface MediaPage {
  items: MediaAsset[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

function encodeCursor(row: MediaAsset): string {
  return Buffer.from(`${row.createdAt.getTime()}:${row.id}`).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [ms, id] = Buffer.from(cursor, "base64url").toString("utf8").split(":");
  const createdAt = new Date(Number(ms));
  if (!ms || !/^\d+$/.test(ms) || Number.isNaN(createdAt.getTime()) || !idSchema.safeParse(id).success) {
    throw new ValidationError(undefined, { cursor: ["That page link is no longer valid."] });
  }
  return { createdAt, id: id as string };
}

/** Newest first, one page at a time. Only ever this tenant's files. */
export async function listMedia(scope: TenantScope, input: ListMediaInput = {}): Promise<MediaPage> {
  const query = parseInput(listMediaSchema, input);
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;

  // Page on millisecond precision: that is all a JavaScript date can carry
  // back in the cursor, and the id breaks ties.
  const createdMs = sql`date_trunc('milliseconds', ${mediaAssets.createdAt})`;
  const conditions: (SQL | undefined)[] = [eq(mediaAssets.tenantId, scope.tenantId)];
  if (query.folderId === null) conditions.push(isNull(mediaAssets.folderId));
  else if (query.folderId) conditions.push(eq(mediaAssets.folderId, query.folderId));
  if (query.resourceType) conditions.push(eq(mediaAssets.resourceType, query.resourceType));
  if (query.search) {
    const pattern = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(ilike(mediaAssets.originalFilename, pattern), ilike(mediaAssets.alt, pattern)));
  }
  if (query.cursor) {
    const after = decodeCursor(query.cursor);
    conditions.push(sql`(${createdMs}, ${mediaAssets.id}) < (${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`);
  }

  const rows = await scope.tx
    .select()
    .from(mediaAssets)
    .where(and(...conditions))
    .orderBy(desc(createdMs), desc(mediaAssets.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}

/* ----------------------------------------------------------------- change */

export const updateMediaSchema = z.object({
  alt: altSchema.optional(),
  /** A folder id to move the file, or `null` to take it out of its folder. */
  folderId: idSchema.nullish(),
});
export type UpdateMediaInput = z.input<typeof updateMediaSchema>;

export async function updateMedia(scope: TenantScope, id: string, input: UpdateMediaInput): Promise<MediaAsset> {
  const changes = parseInput(updateMediaSchema, input);
  const asset = await getMedia(scope, id);
  if (changes.folderId) await getFolder(scope, changes.folderId);

  const set: Partial<Pick<MediaAsset, "alt" | "folderId">> = {};
  if (changes.alt !== undefined) set.alt = changes.alt;
  if (changes.folderId !== undefined) set.folderId = changes.folderId;
  if (Object.keys(set).length === 0) return asset;

  const [row] = (await scope.tx
    .update(mediaAssets)
    .set(set)
    .where(and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.id, id)))
    .returning()) as [MediaAsset];
  return row;
}

/**
 * Removes a file from the library and from the provider account that holds
 * it. Inside a savepoint the row goes first, so a file still used by a tour
 * or page is refused before anything is destroyed; if the provider then
 * fails, the savepoint puts the row back and the two never disagree.
 */
export async function deleteMedia(scope: TenantScope, id: string): Promise<void> {
  const asset = await getMedia(scope, id);
  const storage = await storageForAsset(scope, asset);
  try {
    await scope.tx.transaction(async (savepoint) => {
      await savepoint.delete(mediaAssets).where(and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.id, id)));
      if (storage) await destroyResource(storage, asset.resourceType, asset.publicId);
    });
  } catch (error) {
    if (pgErrorCode(error) === FOREIGN_KEY_VIOLATION) {
      throw new ConflictError("This file is in use. Remove it from where it is used, then delete it.", "in_use");
    }
    throw error;
  }

  await recordAudit(scope, {
    action: "media.deleted",
    targetType: "media_asset",
    targetId: id,
    metadata: { resourceType: asset.resourceType, bytes: asset.bytes, storageOwner: asset.storageOwner, removedFromProvider: storage !== null },
  });
}

export const replaceMediaSchema = z.object({
  publicId: publicIdSchema,
  resourceType: resourceTypeSchema,
  filename: filenameSchema.optional(),
});
export type ReplaceMediaInput = z.input<typeof replaceMediaSchema>;

/**
 * Points an existing library entry at a newly uploaded file, so everything
 * that references the entry shows the new file. The new upload is verified
 * exactly like `finalizeUpload`; the old file is then destroyed in the
 * storage that holds it.
 */
export async function replaceMedia(scope: TenantScope, id: string, input: ReplaceMediaInput): Promise<MediaAsset> {
  const request = parseInput(replaceMediaSchema, input);
  const asset = await getMedia(scope, id);
  if (request.resourceType !== asset.resourceType) {
    throw new ValidationError(undefined, { resourceType: [`Replace this ${asset.resourceType} with another ${asset.resourceType}.`] });
  }

  const storage = await selectStorage(scope);
  if (!isInsideTenantFolder(scope, storage.config, request.publicId)) {
    throw new ForbiddenError("That upload does not belong to this workspace.");
  }
  // Repeating a replace that already happened changes nothing.
  if (asset.provider === storage.provider && asset.publicId === request.publicId) return asset;

  const [taken] = await scope.tx
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.tenantId, scope.tenantId),
        eq(mediaAssets.provider, storage.provider),
        eq(mediaAssets.publicId, request.publicId),
        ne(mediaAssets.id, id),
      ),
    )
    .limit(1);
  if (taken) throw new ConflictError("That upload is already in the library.");

  const resource = await verifyUpload(scope, storage, request.publicId, asset.resourceType, asset.bytes);
  // Resolved before the row changes: it is the old file's storage we need.
  const previousStorage = await storageForAsset(scope, asset);

  // Savepoint: if the old file cannot be destroyed the entry keeps pointing
  // at it, and the replace can simply be tried again.
  const row = await scope.tx.transaction(async (savepoint) => {
    const [updated] = (await savepoint
      .update(mediaAssets)
      .set({ ...providerColumns(storage, resource), ...(request.filename ? { originalFilename: request.filename } : {}) })
      .where(and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.id, id)))
      .returning()) as [MediaAsset];
    if (previousStorage) await destroyResource(previousStorage, asset.resourceType, asset.publicId);
    return updated;
  });

  await recordAudit(scope, {
    action: "media.replaced",
    targetType: "media_asset",
    targetId: id,
    metadata: {
      resourceType: row.resourceType,
      format: row.format,
      bytes: row.bytes,
      previousBytes: asset.bytes,
      storageOwner: row.storageOwner,
      previousRemovedFromProvider: previousStorage !== null,
    },
  });
  return row;
}
