import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withoutTenant } from "@/server/db/context";
import { destinations, mediaAssets, mediaFolders } from "@/server/db/schema";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import {
  createFolder,
  createUploadSignature,
  deleteFolder,
  deleteMedia,
  finalizeUpload,
  getFolder,
  getMedia,
  getStorageUsage,
  listFolders,
  listMedia,
  renameFolder,
  replaceMedia,
  updateMedia,
  type MediaAsset,
  type MediaFolder,
} from "@/server/media";
import type { ManagedStorage } from "@/server/platform/managed-storage";
import { createTenant, unique, type TenantFixture } from "../helpers/fixtures";
import {
  auditActions,
  connectCloudinary,
  documentedSignature,
  FakeCloudinary,
  inTenant,
  managedStorage,
  newAccount,
  signAndUpload,
  uploadFile,
  type Account,
} from "../integration/media/helpers";

const platform = vi.hoisted(() => ({ storage: null as unknown }));
vi.mock("@/server/platform/managed-storage", () => ({ getManagedStorage: vi.fn(async () => platform.storage) }));

const setPlatform = (storage: ManagedStorage | null) => {
  platform.storage = storage;
};

/** Postgres error code of a rejected statement, wherever the driver put it. */
async function pgCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code ?? "unknown";
  }
}

const FOREIGN_KEY_VIOLATION = "23503";
const RLS_VIOLATION = "42501";

let cloud: FakeCloudinary;

beforeEach(() => {
  setPlatform(null);
  cloud = new FakeCloudinary().install();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

interface Side {
  tenant: TenantFixture;
  account: Account & { integrationId: string };
  folder: MediaFolder;
  asset: MediaAsset;
}

/** A tenant with its own Cloudinary account, one folder and one file in it. */
async function side(): Promise<Side> {
  const tenant = await createTenant();
  const account = await connectCloudinary(tenant);
  cloud.addAccount(account);
  const folder = await inTenant(tenant, (scope) => createFolder(scope, { name: "Shared name" }));
  const asset = await uploadFile(tenant, cloud, { filename: `${unique("secret-photo")}.jpg`, alt: "Private launch photo", folderId: folder.id });
  return { tenant, account, folder, asset };
}

describe("media isolation: records", () => {
  it("never lists, searches, counts or pages another tenant's files", async () => {
    const a = await side();
    const b = await side();

    const all = await inTenant(b.tenant, (scope) => listMedia(scope, {}));
    expect(all.items.map((item) => item.id)).toEqual([b.asset.id]);
    expect(all.items.every((item) => item.tenantId === b.tenant.tenantId)).toBe(true);

    // Filtering by A's folder or searching for A's file name finds nothing.
    expect((await inTenant(b.tenant, (scope) => listMedia(scope, { folderId: a.folder.id }))).items).toEqual([]);
    expect((await inTenant(b.tenant, (scope) => listMedia(scope, { search: a.asset.originalFilename }))).items).toEqual([]);

    // A cursor minted for A only positions within B's own rows.
    await uploadFile(a.tenant, cloud);
    const aPage = await inTenant(a.tenant, (scope) => listMedia(scope, { limit: 1 }));
    expect(aPage.nextCursor).not.toBeNull();
    const withForeignCursor = await inTenant(b.tenant, (scope) => listMedia(scope, { cursor: aPage.nextCursor as string }));
    expect(withForeignCursor.items.every((item) => item.tenantId === b.tenant.tenantId)).toBe(true);

    expect(await inTenant(b.tenant, getStorageUsage)).toMatchObject({ usedBytes: b.asset.bytes, assetCount: 1 });
    expect((await inTenant(b.tenant, listFolders)).map((folder) => folder.id)).toEqual([b.folder.id]);
  });

  it("answers not found when B gets, updates, deletes or replaces A's file by id", async () => {
    const a = await side();
    const b = await side();
    const upload = await signAndUpload(b.tenant, cloud);
    const callsBefore = cloud.calls.length;

    await expect(inTenant(b.tenant, (scope) => getMedia(scope, a.asset.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(b.tenant, (scope) => updateMedia(scope, a.asset.id, { alt: "defaced" }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(b.tenant, (scope) => updateMedia(scope, a.asset.id, { folderId: b.folder.id }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(b.tenant, (scope) => deleteMedia(scope, a.asset.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      inTenant(b.tenant, (scope) => replaceMedia(scope, a.asset.id, { publicId: upload.publicId, resourceType: "image" })),
    ).rejects.toBeInstanceOf(NotFoundError);

    // No provider call was made on A's behalf, and A's file and row are untouched.
    expect(cloud.calls).toHaveLength(callsBefore);
    expect(cloud.has(a.account.cloudName, "image", a.asset.publicId)).toBe(true);
    expect(await inTenant(a.tenant, (scope) => getMedia(scope, a.asset.id))).toEqual(a.asset);
    expect(await auditActions(a.tenant, a.asset.id)).toEqual(["media.uploaded"]);
    expect(await auditActions(b.tenant, a.asset.id)).toEqual([]);
  });

  it("answers not found when B reads, renames, deletes or files into A's folder", async () => {
    const a = await side();
    const b = await side();

    await expect(inTenant(b.tenant, (scope) => getFolder(scope, a.folder.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(b.tenant, (scope) => renameFolder(scope, a.folder.id, { name: "Taken over" }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(b.tenant, (scope) => deleteFolder(scope, a.folder.id))).rejects.toBeInstanceOf(NotFoundError);

    // Attaching B's own file or upload to A's folder.
    await expect(inTenant(b.tenant, (scope) => updateMedia(scope, b.asset.id, { folderId: a.folder.id }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      inTenant(b.tenant, (scope) =>
        createUploadSignature(scope, { resourceType: "image", filename: "x.jpg", bytes: 10, contentType: "image/jpeg", folderId: a.folder.id }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    const upload = await signAndUpload(b.tenant, cloud);
    await expect(
      inTenant(b.tenant, (scope) => finalizeUpload(scope, { publicId: upload.publicId, resourceType: "image", folderId: a.folder.id })),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await inTenant(a.tenant, (scope) => getFolder(scope, a.folder.id))).toEqual(a.folder);
    expect(await inTenant(a.tenant, (scope) => getMedia(scope, a.asset.id))).toMatchObject({ folderId: a.folder.id });
    expect(await inTenant(b.tenant, (scope) => getMedia(scope, b.asset.id))).toMatchObject({ folderId: b.folder.id });
    // Folder names are per tenant: both own a "Shared name" without conflict.
    expect(a.folder.name).toBe(b.folder.name);
  });

  it("is enforced by the database as well as the service", async () => {
    const a = await side();
    const b = await side();

    // Bypassing the service, B's transaction still cannot see A's rows.
    const seen = await inTenant(b.tenant, async ({ tx }) => ({
      assets: await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, a.asset.id)),
      folders: await tx.select({ id: mediaFolders.id }).from(mediaFolders).where(eq(mediaFolders.id, a.folder.id)),
      allAssets: await tx.select({ tenantId: mediaAssets.tenantId }).from(mediaAssets),
    }));
    expect(seen.assets).toEqual([]);
    expect(seen.folders).toEqual([]);
    expect(seen.allAssets).toEqual([{ tenantId: b.tenant.tenantId }]);

    // Nor change or remove them.
    const changed = await inTenant(b.tenant, async ({ tx }) => ({
      updated: await tx.update(mediaAssets).set({ alt: "defaced" }).where(eq(mediaAssets.id, a.asset.id)).returning({ id: mediaAssets.id }),
      deleted: await tx.delete(mediaFolders).where(eq(mediaFolders.id, a.folder.id)).returning({ id: mediaFolders.id }),
    }));
    expect(changed).toEqual({ updated: [], deleted: [] });

    // Composite foreign keys stop cross-tenant references outright.
    const intoForeignFolder = await pgCode(() =>
      inTenant(b.tenant, ({ tx }) => tx.update(mediaAssets).set({ folderId: a.folder.id }).where(eq(mediaAssets.id, b.asset.id))),
    );
    expect(intoForeignFolder).toBe(FOREIGN_KEY_VIOLATION);
    const foreignCover = await pgCode(() =>
      inTenant(b.tenant, ({ tx }) => tx.insert(destinations).values({ name: "Borrowed", slug: unique("borrowed"), coverMediaId: a.asset.id })),
    );
    expect(foreignCover).toBe(FOREIGN_KEY_VIOLATION);
    const foreignIntegration = await pgCode(() =>
      inTenant(b.tenant, ({ tx }) => tx.update(mediaAssets).set({ integrationId: a.account.integrationId }).where(eq(mediaAssets.id, b.asset.id))),
    );
    expect(foreignIntegration).toBe(FOREIGN_KEY_VIOLATION);

    // And a row cannot be planted in another tenant.
    const planted = await pgCode(() =>
      inTenant(b.tenant, ({ tx }) =>
        tx.insert(mediaAssets).values({
          tenantId: a.tenant.tenantId,
          storageOwner: "tenant",
          provider: "cloudinary",
          publicId: `wayfold/t_${a.tenant.tenantId}/planted`,
          resourceType: "image",
          url: "https://res.cloudinary.com/x/planted.jpg",
        }),
      ),
    );
    expect(planted).toBe(RLS_VIOLATION);

    // With no tenant context there is nothing to see at all.
    const none = await withoutTenant(async (tx) => ({
      assets: await tx.select({ id: mediaAssets.id }).from(mediaAssets),
      folders: await tx.select({ id: mediaFolders.id }).from(mediaFolders),
    }));
    expect(none).toEqual({ assets: [], folders: [] });
  });
});

describe("media isolation: storage and credentials", () => {
  it("signs B's uploads with B's own credentials and folder, never A's", async () => {
    const a = await side();
    const b = await side();

    const signature = await inTenant(b.tenant, (scope) =>
      createUploadSignature(scope, { resourceType: "image", filename: "x.jpg", bytes: 10, contentType: "image/jpeg" }),
    );

    expect(signature.uploadUrl).toContain(`/${b.account.cloudName}/`);
    expect(signature.uploadUrl).not.toContain(a.account.cloudName);
    expect(signature.fields.api_key).toBe(b.account.apiKey);
    expect(signature.fields.folder).toBe(`wayfold/t_${b.tenant.tenantId}`);
    expect(signature.fields.signature).toBe(documentedSignature(signature.fields, b.account.apiSecret));
    expect(signature.fields.signature).not.toBe(documentedSignature(signature.fields, a.account.apiSecret));
    const serialised = JSON.stringify(signature);
    for (const leaked of [a.tenant.tenantId, a.account.apiKey, a.account.apiSecret, b.account.apiSecret]) {
      expect(serialised).not.toContain(leaked);
    }
  });

  it("does not fall back to A's integration when B has none", async () => {
    const a = await side();
    const b = await createTenant({ plan: { features: { platformStorage: false } } });

    const error = await inTenant(b, (scope) =>
      createUploadSignature(scope, { resourceType: "image", filename: "x.jpg", bytes: 10, contentType: "image/jpeg" }),
    ).catch((e: unknown) => e);

    expect((error as { code?: string }).code).toBe("integration_not_configured");
    expect(JSON.stringify(error)).not.toContain(a.account.apiKey);
  });

  describe("on shared platform storage", () => {
    let shared: Account;
    let a: TenantFixture;
    let b: TenantFixture;

    beforeEach(async () => {
      shared = cloud.addAccount(newAccount({ uploadFolder: "tenants" }));
      setPlatform(managedStorage(shared));
      a = await createTenant({ plan: { features: { platformStorage: true } } });
      b = await createTenant({ plan: { features: { platformStorage: true } } });
    });

    it("gives each tenant its own folder in the shared account", async () => {
      const [forA, forB] = [await signAndUpload(a, cloud), await signAndUpload(b, cloud)];

      expect(forA.fields.folder).toBe(`tenants/wayfold/t_${a.tenantId}`);
      expect(forB.fields.folder).toBe(`tenants/wayfold/t_${b.tenantId}`);
      expect(forB.publicId.startsWith(`${forB.fields.folder}/`)).toBe(true);

      // B's signature does not authorise an upload into A's folder.
      expect(cloud.browserUpload(forB, { format: "jpg", bytes: 10 }, { folder: forA.fields.folder }).status).toBe(401);
      expect(cloud.browserUpload(forB, { format: "jpg", bytes: 10 }, { folder: forA.fields.folder, public_id: forA.fields.public_id }).status).toBe(401);
    });

    it("refuses to finalise a public id under A's prefix into B", async () => {
      const aAsset = await uploadFile(a, cloud);
      const aPending = await signAndUpload(a, cloud);
      const callsBefore = cloud.calls.length;

      // Both A's catalogued file and A's not-yet-finalised upload exist in the same account B uses.
      for (const publicId of [aAsset.publicId, aPending.publicId]) {
        const error = await inTenant(b, (scope) => finalizeUpload(scope, { publicId, resourceType: "image" })).catch((e: unknown) => e);
        expect(error, publicId).toBeInstanceOf(ForbiddenError);
        expect(cloud.has(shared.cloudName, "image", publicId)).toBe(true);
      }

      expect(cloud.calls).toHaveLength(callsBefore);
      expect((await inTenant(b, (scope) => listMedia(scope, {}))).items).toEqual([]);
      expect(await inTenant(b, getStorageUsage)).toMatchObject({ usedBytes: 0, assetCount: 0 });
      // A can still finalise its own pending upload.
      await expect(inTenant(a, (scope) => finalizeUpload(scope, { publicId: aPending.publicId, resourceType: "image" }))).resolves.toMatchObject({
        tenantId: a.tenantId,
      });
    });

    it("refuses to point B's entry at A's file, and leaves both intact", async () => {
      const aAsset = await uploadFile(a, cloud);
      const bAsset = await uploadFile(b, cloud);

      await expect(inTenant(b, (scope) => replaceMedia(scope, bAsset.id, { publicId: aAsset.publicId, resourceType: "image" }))).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      expect(cloud.callsOf("destroy")).toHaveLength(0);
      expect(cloud.has(shared.cloudName, "image", aAsset.publicId)).toBe(true);
      expect(cloud.has(shared.cloudName, "image", bAsset.publicId)).toBe(true);
      expect(await inTenant(b, (scope) => getMedia(scope, bAsset.id))).toEqual(bAsset);
    });

    it("deletes only the caller's own file from the shared account", async () => {
      const aAsset = await uploadFile(a, cloud);
      const bAsset = await uploadFile(b, cloud);

      await expect(inTenant(b, (scope) => deleteMedia(scope, aAsset.id))).rejects.toBeInstanceOf(NotFoundError);
      await inTenant(b, (scope) => deleteMedia(scope, bAsset.id));

      expect(cloud.callsOf("destroy").map((call) => call.publicId)).toEqual([bAsset.publicId]);
      expect(cloud.has(shared.cloudName, "image", aAsset.publicId)).toBe(true);
      expect(await inTenant(a, (scope) => getMedia(scope, aAsset.id))).toEqual(aAsset);
    });
  });

  it("refuses a public id under A's prefix when B uses its own account", async () => {
    const a = await side();
    const b = await side();
    // Even if such a path existed in B's own account, it is outside B's folder.
    cloud.put(b.account.cloudName, "image", a.asset.publicId);

    await expect(inTenant(b.tenant, (scope) => finalizeUpload(scope, { publicId: a.asset.publicId, resourceType: "image" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await inTenant(b.tenant, (scope) => listMedia(scope, {}))).items.map((item) => item.id)).toEqual([b.asset.id]);
  });
});
