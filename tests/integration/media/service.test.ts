import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { destinations, mediaAssets } from "@/server/db/schema";
import { ConflictError, ForbiddenError, IntegrationError, LimitExceededError, NotFoundError, ValidationError } from "@/server/errors";
import { IntegrationNotConfiguredError, deleteIntegration } from "@/server/integrations/service";
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
  tenantFolderPrefix,
  updateMedia,
  type UploadRequest,
} from "@/server/media";
import type { ManagedStorage } from "@/server/platform/managed-storage";
import { createTenant, randomId, unique, type TenantFixture } from "../../helpers/fixtures";
import {
  auditActions,
  connectCloudinary,
  documentedSignature,
  FakeCloudinary,
  inTenant,
  managedStorage,
  MB,
  newAccount,
  signAndUpload,
  uploadFile,
  type Account,
} from "./helpers";

const platform = vi.hoisted(() => ({ storage: null as unknown }));
vi.mock("@/server/platform/managed-storage", () => ({ getManagedStorage: vi.fn(async () => platform.storage) }));

const setPlatform = (storage: ManagedStorage | null) => {
  platform.storage = storage;
};

let cloud: FakeCloudinary;

beforeEach(() => {
  setPlatform(null);
  cloud = new FakeCloudinary().install();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A tenant with its own Cloudinary account known to the fake. */
async function connectedTenant(options: Parameters<typeof createTenant>[0] = {}, account: Account = newAccount()) {
  const tenant = await createTenant(options);
  const own = await connectCloudinary(tenant, account);
  cloud.addAccount(own);
  return { tenant, own, prefix: tenantFolderPrefix({ tenantId: tenant.tenantId }, { uploadFolder: own.uploadFolder }) };
}

const jpeg = (overrides: Partial<UploadRequest> = {}): UploadRequest => ({
  resourceType: "image",
  filename: "beach.jpg",
  bytes: 250_000,
  contentType: "image/jpeg",
  ...overrides,
});

const sign = (tenant: TenantFixture, request: UploadRequest) => inTenant(tenant, (scope) => createUploadSignature(scope, request));
const rowCount = (tenant: TenantFixture) => inTenant(tenant, async ({ tx }) => (await tx.select({ id: mediaAssets.id }).from(mediaAssets)).length);

describe("createUploadSignature", () => {
  it("returns a direct-upload authorisation signed per Cloudinary's documented algorithm", async () => {
    const { tenant, own, prefix } = await connectedTenant({}, newAccount({ uploadFolder: "brand" }));
    const before = Math.floor(Date.now() / 1000);

    const result = await sign(tenant, jpeg());

    expect(result.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${own.cloudName}/image/upload`);
    expect(prefix).toBe(`brand/wayfold/t_${tenant.tenantId}`);
    expect(result.fields).toEqual({
      api_key: own.apiKey,
      timestamp: expect.stringMatching(/^\d+$/),
      signature: expect.stringMatching(/^[0-9a-f]{64}$/),
      folder: prefix,
      public_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      allowed_formats: "jpg",
      overwrite: "false",
    });
    expect(Number(result.fields.timestamp)).toBeGreaterThanOrEqual(before);
    expect(result.publicId).toBe(`${prefix}/${result.fields.public_id}`);
    expect(result.resourceType).toBe("image");
    expect(result.storageOwner).toBe("tenant");
    expect(result.expiresAt.getTime()).toBe((Number(result.fields.timestamp) + 3600) * 1000);

    // Independent computation: sorted name=value pairs joined by &, secret appended, SHA-256.
    const { fields } = result;
    const toSign = `allowed_formats=jpg&folder=${prefix}&overwrite=false&public_id=${fields.public_id}&timestamp=${fields.timestamp}`;
    expect(fields.signature).toBe(
      createHash("sha256")
        .update(toSign + own.apiSecret)
        .digest("hex"),
    );
    expect(fields.signature).toBe(documentedSignature(fields, own.apiSecret));

    // The secret is nowhere in what goes to the browser.
    expect(JSON.stringify(result)).not.toContain(own.apiSecret);
    // And Cloudinary would accept exactly these fields.
    expect(cloud.browserUpload(result, { format: "jpg", bytes: 250_000 }).status).toBe(200);
  });

  it("signs a different name for every upload", async () => {
    const { tenant } = await connectedTenant();
    const [one, two] = [await sign(tenant, jpeg()), await sign(tenant, jpeg())];
    expect(one.fields.public_id).not.toBe(two.fields.public_id);
  });

  it("covers every constraining field with the signature, so the browser cannot change them", async () => {
    const { tenant } = await connectedTenant();
    const other = await createTenant();
    const result = await sign(tenant, jpeg());
    const file = { format: "jpg", bytes: 250_000 };

    const tampered: Record<string, string>[] = [
      { folder: `wayfold/t_${other.tenantId}` },
      { folder: "" },
      { public_id: "chosen-by-attacker" },
      { allowed_formats: "jpg,exe" },
      { overwrite: "true" },
      { timestamp: String(Number(result.fields.timestamp) + 86_400) },
    ];
    for (const change of tampered) {
      const response = cloud.browserUpload(result, file, change);
      expect(response.status, JSON.stringify(change)).toBe(401);
    }
    // Sending a format the signature does not allow is refused upstream too.
    expect(cloud.browserUpload(result, { format: "png", bytes: 1 }).status).toBe(400);
  });

  it.each([
    ["image", "photo.jpeg", "image/jpeg", "jpg"],
    ["image", "logo.PNG", "image/png", "png"],
    ["image", "hero.webp", "image/webp", "webp"],
    ["image", "hero.avif", "image/avif", "avif"],
    ["image", "loop.gif", "IMAGE/GIF", "gif"],
    ["video", "clip.mp4", "video/mp4", "mp4"],
    ["video", "clip.webm", "video/webm", "webm"],
    ["video", "clip.mov", "video/quicktime", "mov"],
  ] as const)("accepts %s %s and pins the format to %s", async (resourceType, filename, contentType, format) => {
    const { tenant, own } = await connectedTenant();
    const result = await sign(tenant, { resourceType, filename, contentType, bytes: 1024 });
    expect(result.fields.allowed_formats).toBe(format);
    expect(result.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${own.cloudName}/${resourceType}/upload`);
  });

  it.each([
    ["an unsupported image type", jpeg({ filename: "vector.svg", contentType: "image/svg+xml" }), "contentType"],
    ["a document", jpeg({ filename: "brochure.pdf", contentType: "application/pdf" }), "contentType"],
    ["a video declared as an image", jpeg({ filename: "clip.mp4", contentType: "video/mp4" }), "contentType"],
    ["an image declared as a video", jpeg({ resourceType: "video" }), "contentType"],
    ["an unsupported video type", jpeg({ resourceType: "video", filename: "clip.avi", contentType: "video/x-msvideo" }), "contentType"],
    ["an extension that disagrees with the type", jpeg({ filename: "payload.exe" }), "filename"],
    ["a name without an extension", jpeg({ filename: "beach" }), "filename"],
    ["an image over 15 MB", jpeg({ bytes: 15 * MB + 1 }), "bytes"],
    ["a video over 200 MB", jpeg({ resourceType: "video", filename: "clip.mp4", contentType: "video/mp4", bytes: 200 * MB + 1 }), "bytes"],
    ["an empty file", jpeg({ bytes: 0 }), "bytes"],
    ["a fractional size", jpeg({ bytes: 10.5 }), "bytes"],
    ["an unknown resource type", jpeg({ resourceType: "raw" as "image" }), "resourceType"],
  ])("rejects %s", async (_label, request, field) => {
    const { tenant } = await connectedTenant();
    const error = await sign(tenant, request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors ?? {})).toEqual([field]);
  });

  it("accepts files exactly at the size limits", async () => {
    const { tenant } = await connectedTenant({ plan: { maxStorageMb: null } });
    await expect(sign(tenant, jpeg({ bytes: 15 * MB }))).resolves.toBeDefined();
    await expect(sign(tenant, jpeg({ resourceType: "video", filename: "clip.mp4", contentType: "video/mp4", bytes: 200 * MB }))).resolves.toBeDefined();
  });

  it("refuses an upload that would exceed the plan's storage quota", async () => {
    const { tenant } = await connectedTenant({ plan: { maxStorageMb: 1 } });
    await uploadFile(tenant, cloud, { bytes: 600_000 });

    // 600 000 + 448 576 = exactly 1 MB: still allowed.
    await expect(sign(tenant, jpeg({ bytes: MB - 600_000 }))).resolves.toBeDefined();

    const error = await sign(tenant, jpeg({ bytes: MB - 600_000 + 1 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LimitExceededError);
    expect((error as LimitExceededError).limit).toBe("maxStorageMb");
    expect((error as Error).message).toContain("1 MB of media storage");
  });

  it("is not configured when the tenant has no integration and the plan has no platform storage", async () => {
    const tenant = await createTenant({ plan: { features: { platformStorage: false } } });
    setPlatform(managedStorage(cloud.addAccount(newAccount())));

    await expect(sign(tenant, jpeg())).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });

  it("signs with the platform's credentials on the platform storage path", async () => {
    const tenant = await createTenant({ plan: { features: { platformStorage: true } } });
    const shared = cloud.addAccount(newAccount({ uploadFolder: "tenants" }));
    setPlatform(managedStorage(shared));

    const result = await sign(tenant, jpeg());

    expect(result.storageOwner).toBe("platform");
    expect(result.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${shared.cloudName}/image/upload`);
    expect(result.fields.api_key).toBe(shared.apiKey);
    expect(result.fields.folder).toBe(`tenants/wayfold/t_${tenant.tenantId}`);
    expect(result.fields.signature).toBe(documentedSignature(result.fields, shared.apiSecret));
    expect(JSON.stringify(result)).not.toContain(shared.apiSecret);
  });

  it("checks the target folder belongs to the tenant", async () => {
    const { tenant } = await connectedTenant();
    const folder = await inTenant(tenant, (scope) => createFolder(scope, { name: "Beaches" }));

    await expect(sign(tenant, jpeg({ folderId: folder.id }))).resolves.toBeDefined();
    await expect(sign(tenant, jpeg({ folderId: randomId() }))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("finalizeUpload", () => {
  it("stores the provider's own metadata for a verified image", async () => {
    const { tenant, own } = await connectedTenant();
    const folder = await inTenant(tenant, (scope) => createFolder(scope, { name: "Beaches" }));
    const signature = await sign(tenant, jpeg({ bytes: 250_000 }));
    cloud.browserUpload(signature, { format: "jpg", bytes: 187_654, width: 1600, height: 900 });

    const asset = await inTenant(tenant, (scope) =>
      finalizeUpload(scope, { publicId: signature.publicId, resourceType: "image", folderId: folder.id, alt: "  Sunset over the bay ", filename: "beach.jpg" }),
    );

    expect(asset).toMatchObject({
      tenantId: tenant.tenantId,
      folderId: folder.id,
      storageOwner: "tenant",
      integrationId: own.integrationId,
      provider: "cloudinary",
      publicId: signature.publicId,
      resourceType: "image",
      format: "jpg",
      // From the provider, not from what the browser declared.
      bytes: 187_654,
      width: 1600,
      height: 900,
      durationSeconds: null,
      url: `https://res.cloudinary.com/${own.cloudName}/image/upload/v1719304854/${signature.publicId}.jpg`,
      originalFilename: "beach.jpg",
      alt: "Sunset over the bay",
      createdBy: tenant.ownerId,
    });
    expect(await auditActions(tenant, asset.id)).toEqual(["media.uploaded"]);

    const [details] = cloud.callsOf("details");
    expect(details?.publicId).toBe(signature.publicId);
    expect(details?.authorization).toBe(`Basic ${Buffer.from(`${own.apiKey}:${own.apiSecret}`).toString("base64")}`);
  });

  it("stores duration for a video", async () => {
    const { tenant } = await connectedTenant();
    const signature = await sign(tenant, { resourceType: "video", filename: "tour.mov", contentType: "video/quicktime", bytes: 5 * MB });
    cloud.browserUpload(signature, { format: "mov", bytes: 5 * MB, width: 1920, height: 1080, duration: 31.4 });

    const asset = await inTenant(tenant, (scope) => finalizeUpload(scope, { publicId: signature.publicId, resourceType: "video" }));

    expect(asset).toMatchObject({ resourceType: "video", format: "mov", bytes: 5 * MB, width: 1920, height: 1080, durationSeconds: 31, alt: "", originalFilename: "" });
  });

  it("is idempotent: finalising the same upload again returns the same entry", async () => {
    const { tenant } = await connectedTenant();
    const signature = await signAndUpload(tenant, cloud);
    const input = { publicId: signature.publicId, resourceType: "image" as const };

    const first = await inTenant(tenant, (scope) => finalizeUpload(scope, input));
    const second = await inTenant(tenant, (scope) => finalizeUpload(scope, { ...input, alt: "ignored on repeat" }));
    const sameTransaction = await inTenant(tenant, async (scope) => [await finalizeUpload(scope, input), await finalizeUpload(scope, input)]);

    expect(second).toEqual(first);
    expect(sameTransaction.map((row) => row.id)).toEqual([first.id, first.id]);
    expect(await rowCount(tenant)).toBe(1);
    expect(await auditActions(tenant, first.id)).toEqual(["media.uploaded"]);
    expect(cloud.callsOf("details")).toHaveLength(1);
  });

  it("creates one entry when the same upload is finalised twice at once", async () => {
    const { tenant } = await connectedTenant();
    const signature = await signAndUpload(tenant, cloud);
    const input = { publicId: signature.publicId, resourceType: "image" as const };

    // Hold both provider lookups until each request has passed its "already
    // in the library?" check, so the second insert really collides.
    const realFetch = globalThis.fetch;
    let waiting = 0;
    let release: () => void = () => undefined;
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        if (++waiting === 2) release();
        await bothArrived;
        return realFetch(request, init);
      }),
    );

    const [one, two] = await Promise.all([
      inTenant(tenant, (scope) => finalizeUpload(scope, input)),
      inTenant(tenant, (scope) => finalizeUpload(scope, input)),
    ]);

    expect(one.id).toBe(two.id);
    expect(await rowCount(tenant)).toBe(1);
    expect(await auditActions(tenant, one.id)).toEqual(["media.uploaded"]);
  });

  it("rejects a public id outside the tenant's folder without contacting the provider", async () => {
    const { tenant, own } = await connectedTenant();
    const other = await createTenant();
    const foreign = [
      `wayfold/t_${other.tenantId}/stolen`,
      "wayfold/shared/stolen",
      "stolen",
      `evil/wayfold/t_${tenant.tenantId}/x`,
      `wayfold/t_${tenant.tenantId}/../t_${other.tenantId}/stolen`,
      `wayfold/t_${tenant.tenantId}`,
    ];
    for (const publicId of foreign) {
      // The file really exists in the account: only the prefix check stands in the way.
      cloud.put(own.cloudName, "image", publicId);
      const error = await inTenant(tenant, (scope) => finalizeUpload(scope, { publicId, resourceType: "image" })).catch((e: unknown) => e);
      expect(error, publicId).toBeInstanceOf(ForbiddenError);
    }
    expect(cloud.calls).toHaveLength(0);
    expect(await rowCount(tenant)).toBe(0);
    // Nothing was destroyed either: those files are not this tenant's to touch.
    expect(cloud.has(own.cloudName, "image", `wayfold/t_${other.tenantId}/stolen`)).toBe(true);
  });

  it("rejects when the provider answers with a different public id than was asked for", async () => {
    const { tenant, own, prefix } = await connectedTenant();
    const other = await createTenant();
    const publicId = `${prefix}/redirected`;
    cloud.put(own.cloudName, "image", publicId, { public_id: `wayfold/t_${other.tenantId}/elsewhere` });

    await expect(inTenant(tenant, (scope) => finalizeUpload(scope, { publicId, resourceType: "image" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await rowCount(tenant)).toBe(0);
    expect(cloud.callsOf("destroy")).toHaveLength(0);
  });

  it("answers not found when the provider has no such file", async () => {
    const { tenant, prefix } = await connectedTenant();
    const error = await inTenant(tenant, (scope) => finalizeUpload(scope, { publicId: `${prefix}/never-uploaded`, resourceType: "image" })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NotFoundError);
    expect(await rowCount(tenant)).toBe(0);
  });

  it("re-checks the stored file's type and removes a file that is not allowed", async () => {
    const { tenant, own, prefix } = await connectedTenant();
    const cases = [
      { publicId: `${prefix}/vector`, resourceType: "image" as const, stored: { format: "svg" } },
      { publicId: `${prefix}/gif-as-video`, resourceType: "video" as const, stored: { format: "gif" } },
      { publicId: `${prefix}/private`, resourceType: "image" as const, stored: { type: "private" } },
      { publicId: `${prefix}/mislabelled`, resourceType: "image" as const, stored: { resource_type: "raw" } },
    ];
    for (const { publicId, resourceType, stored } of cases) {
      cloud.put(own.cloudName, resourceType, publicId, stored);
      const error = await inTenant(tenant, (scope) => finalizeUpload(scope, { publicId, resourceType })).catch((e: unknown) => e);
      expect(error, publicId).toBeInstanceOf(ValidationError);
      expect(cloud.has(own.cloudName, resourceType, publicId), publicId).toBe(false);
    }
    expect(await rowCount(tenant)).toBe(0);
  });

  it("re-checks the stored file's size, whatever the browser declared when signing", async () => {
    const { tenant, own } = await connectedTenant({ plan: { maxStorageMb: null } });
    const signature = await sign(tenant, jpeg({ bytes: 1000 }));
    cloud.browserUpload(signature, { format: "jpg", bytes: 15 * MB + 1 });

    const error = await inTenant(tenant, (scope) => finalizeUpload(scope, { publicId: signature.publicId, resourceType: "image" })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain("15 MB");
    expect(cloud.has(own.cloudName, "image", signature.publicId)).toBe(false);
    expect(await rowCount(tenant)).toBe(0);
  });

  it("re-checks the quota against the stored size and removes the file when it does not fit", async () => {
    const { tenant, own } = await connectedTenant({ plan: { maxStorageMb: 1 } });
    await uploadFile(tenant, cloud, { bytes: 600_000 });
    const signature = await sign(tenant, jpeg({ bytes: 1000 }));
    cloud.browserUpload(signature, { format: "jpg", bytes: 500_000 });

    const error = await inTenant(tenant, (scope) => finalizeUpload(scope, { publicId: signature.publicId, resourceType: "image" })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LimitExceededError);
    expect(cloud.has(own.cloudName, "image", signature.publicId)).toBe(false);
    expect(await rowCount(tenant)).toBe(1);
    expect(await inTenant(tenant, getStorageUsage)).toEqual({ usedBytes: 600_000, limitMb: 1, assetCount: 1 });
  });

  it("still rejects when cleaning up a refused file fails", async () => {
    const { tenant, own, prefix } = await connectedTenant();
    cloud.put(own.cloudName, "image", `${prefix}/vector`, { format: "svg" });
    // Details succeed, then the destroy call hits a provider error.
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith("/destroy") ? new Response(JSON.stringify({ error: { message: "nope" } }), { status: 400 }) : realFetch(input, init),
      ),
    );

    await expect(inTenant(tenant, (scope) => finalizeUpload(scope, { publicId: `${prefix}/vector`, resourceType: "image" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("validates its input and the target folder before asking the provider", async () => {
    const { tenant } = await connectedTenant();
    const signature = await signAndUpload(tenant, cloud);

    await expect(inTenant(tenant, (scope) => finalizeUpload(scope, { publicId: "", resourceType: "image" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(
      inTenant(tenant, (scope) => finalizeUpload(scope, { publicId: signature.publicId, resourceType: "image", folderId: "not-a-uuid" })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      inTenant(tenant, (scope) => finalizeUpload(scope, { publicId: signature.publicId, resourceType: "image", folderId: randomId() })),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(cloud.calls).toHaveLength(0);
  });

  it("surfaces a provider outage as a sanitised integration error and stores nothing", async () => {
    const { tenant, own } = await connectedTenant();
    const signature = await signAndUpload(tenant, cloud);
    cloud.scripted.push(new Response(JSON.stringify({ error: { message: `Account ${own.apiSecret} suspended` } }), { status: 400 }));

    const error = (await inTenant(tenant, (scope) => finalizeUpload(scope, { publicId: signature.publicId, resourceType: "image" })).catch(
      (e: unknown) => e,
    )) as Error;

    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.message).not.toContain(own.apiSecret);
    expect(await rowCount(tenant)).toBe(0);
  });

  it("finalises into platform storage with the platform's credentials", async () => {
    const tenant = await createTenant({ plan: { features: { platformStorage: true } } });
    const shared = cloud.addAccount(newAccount());
    setPlatform(managedStorage(shared));

    const asset = await uploadFile(tenant, cloud);

    expect(asset).toMatchObject({ storageOwner: "platform", integrationId: null, provider: "cloudinary" });
    expect(asset.publicId.startsWith(`wayfold/t_${tenant.tenantId}/`)).toBe(true);
    const [details] = cloud.callsOf("details");
    expect(details?.cloudName).toBe(shared.cloudName);
    expect(details?.authorization).toBe(`Basic ${Buffer.from(`${shared.apiKey}:${shared.apiSecret}`).toString("base64")}`);
  });

  it("cannot finalise once the plan loses platform storage", async () => {
    const tenant = await createTenant({ plan: { features: { platformStorage: false } } });
    setPlatform(managedStorage(cloud.addAccount(newAccount())));

    await expect(
      inTenant(tenant, (scope) => finalizeUpload(scope, { publicId: `wayfold/t_${tenant.tenantId}/x`, resourceType: "image" })),
    ).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });
});

describe("listMedia, getMedia, updateMedia", () => {
  it("filters by folder, kind and search text", async () => {
    const { tenant } = await connectedTenant();
    const folder = await inTenant(tenant, (scope) => createFolder(scope, { name: "Beaches" }));
    const beach = await uploadFile(tenant, cloud, { filename: "sunset_beach.jpg", alt: "Golden hour", folderId: folder.id });
    const city = await uploadFile(tenant, cloud, { filename: "city%walk.png", contentType: "image/png", alt: "Old town" });
    const clip = await uploadFile(tenant, cloud, { resourceType: "video", filename: "drone.mp4", alt: "Beach from above" });
    const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id).sort();
    const list = (input: Parameters<typeof listMedia>[1]) => inTenant(tenant, (scope) => listMedia(scope, input));

    expect(ids(await list(undefined))).toEqual([beach.id, city.id, clip.id].sort());
    expect(ids(await list({ folderId: folder.id }))).toEqual([beach.id]);
    expect(ids(await list({ folderId: null }))).toEqual([city.id, clip.id].sort());
    expect(ids(await list({ folderId: randomId() }))).toEqual([]);
    expect(ids(await list({ resourceType: "video" }))).toEqual([clip.id]);
    expect(ids(await list({ search: "BEACH" }))).toEqual([beach.id, clip.id].sort());
    expect(ids(await list({ search: "old town" }))).toEqual([city.id]);
    expect(ids(await list({ search: "beach", resourceType: "image" }))).toEqual([beach.id]);
    // Wildcards in the search text are literal.
    expect(ids(await list({ search: "%" }))).toEqual([city.id]);
    expect(ids(await list({ search: "sunset_" }))).toEqual([beach.id]);
    expect(ids(await list({ search: "sunset_x" }))).toEqual([]);
    expect(ids(await list({ search: "   " }))).toEqual([beach.id, city.id, clip.id].sort());
  });

  it("pages newest-first with a cursor and no repeats", async () => {
    const { tenant } = await connectedTenant();
    const created: string[] = [];
    for (let i = 0; i < 5; i++) created.push((await uploadFile(tenant, cloud, { filename: `photo-${i}.jpg` })).id);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await inTenant(tenant, (scope) => listMedia(scope, { limit: 2, ...(cursor ? { cursor } : {}) }));
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect([...seen].sort()).toEqual([...created].sort());
    const all = await inTenant(tenant, (scope) => listMedia(scope, {}));
    expect(seen).toEqual(all.items.map((item) => item.id));
    expect(all.nextCursor).toBeNull();
    for (let i = 1; i < all.items.length; i++) {
      expect(all.items[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(all.items[i]!.createdAt.getTime());
    }
  });

  it("rejects a malformed cursor or page size", async () => {
    const { tenant } = await connectedTenant();
    const bad = [
      { cursor: "not-a-cursor" },
      { cursor: Buffer.from("abc:def").toString("base64url") },
      { cursor: Buffer.from(`99999999999999999999:${randomId()}`).toString("base64url") },
      { limit: 0 },
      { limit: 101 },
    ];
    for (const input of bad) {
      await expect(inTenant(tenant, (scope) => listMedia(scope, input)), JSON.stringify(input)).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("gets one file, and answers not found for unknown or malformed ids", async () => {
    const { tenant } = await connectedTenant();
    const asset = await uploadFile(tenant, cloud);

    expect(await inTenant(tenant, (scope) => getMedia(scope, asset.id))).toEqual(asset);
    await expect(inTenant(tenant, (scope) => getMedia(scope, randomId()))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(tenant, (scope) => getMedia(scope, "1; drop table media_assets"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updates the description and moves a file between folders", async () => {
    const { tenant } = await connectedTenant();
    const folder = await inTenant(tenant, (scope) => createFolder(scope, { name: "Beaches" }));
    const asset = await uploadFile(tenant, cloud, { alt: "Before" });

    const described = await inTenant(tenant, (scope) => updateMedia(scope, asset.id, { alt: " After " }));
    expect(described).toMatchObject({ alt: "After", folderId: null });

    const moved = await inTenant(tenant, (scope) => updateMedia(scope, asset.id, { folderId: folder.id }));
    expect(moved).toMatchObject({ alt: "After", folderId: folder.id });

    const unfiled = await inTenant(tenant, (scope) => updateMedia(scope, asset.id, { folderId: null, alt: "" }));
    expect(unfiled).toMatchObject({ alt: "", folderId: null });

    // Nothing to change is not an error.
    expect(await inTenant(tenant, (scope) => updateMedia(scope, asset.id, {}))).toMatchObject({ id: asset.id, alt: "" });
    // Provider identity cannot be edited through this door.
    const sneaky = { alt: "x", publicId: "wayfold/other", url: "https://evil.example/x.jpg", bytes: 1 } as Parameters<typeof updateMedia>[2];
    expect(await inTenant(tenant, (scope) => updateMedia(scope, asset.id, sneaky))).toMatchObject({ publicId: asset.publicId, url: asset.url, bytes: asset.bytes });

    await expect(inTenant(tenant, (scope) => updateMedia(scope, asset.id, { folderId: randomId() }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(tenant, (scope) => updateMedia(scope, randomId(), { alt: "x" }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(tenant, (scope) => updateMedia(scope, asset.id, { alt: "x".repeat(301) }))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("deleteMedia", () => {
  it("destroys the file at the provider, removes the row and records it", async () => {
    const { tenant, own } = await connectedTenant();
    const asset = await uploadFile(tenant, cloud);
    expect(cloud.has(own.cloudName, "image", asset.publicId)).toBe(true);

    await inTenant(tenant, (scope) => deleteMedia(scope, asset.id));

    expect(cloud.has(own.cloudName, "image", asset.publicId)).toBe(false);
    const [destroy] = cloud.callsOf("destroy");
    expect(destroy).toMatchObject({ cloudName: own.cloudName, resourceType: "image", publicId: asset.publicId });
    expect(destroy?.body.signature).toBe(documentedSignature(destroy?.body ?? {}, own.apiSecret));
    await expect(inTenant(tenant, (scope) => getMedia(scope, asset.id))).rejects.toBeInstanceOf(NotFoundError);
    expect(await auditActions(tenant, asset.id)).toEqual(["media.uploaded", "media.deleted"]);
    await expect(inTenant(tenant, (scope) => deleteMedia(scope, asset.id))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to delete a file that is in use, and destroys nothing", async () => {
    const { tenant, own } = await connectedTenant();
    const asset = await uploadFile(tenant, cloud);
    await inTenant(tenant, ({ tx }) => tx.insert(destinations).values({ name: "Hunza", slug: unique("hunza"), coverMediaId: asset.id }));

    const error = await inTenant(tenant, async (scope) => {
      const caught = await deleteMedia(scope, asset.id).catch((e: unknown) => e);
      // The transaction is still usable after the refused delete.
      expect((await getMedia(scope, asset.id)).id).toBe(asset.id);
      return caught;
    });

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe("in_use");
    expect((error as Error).message).toMatch(/in use/);
    expect(cloud.callsOf("destroy")).toHaveLength(0);
    expect(cloud.has(own.cloudName, "image", asset.publicId)).toBe(true);
    expect(await auditActions(tenant, asset.id)).toEqual(["media.uploaded"]);

    // Once nothing references it, the delete goes through.
    await inTenant(tenant, ({ tx }) => tx.update(destinations).set({ coverMediaId: null }).where(eq(destinations.coverMediaId, asset.id)));
    await inTenant(tenant, (scope) => deleteMedia(scope, asset.id));
    expect(cloud.has(own.cloudName, "image", asset.publicId)).toBe(false);
  });

  it("keeps the row when the provider cannot destroy the file", async () => {
    const { tenant } = await connectedTenant();
    const asset = await uploadFile(tenant, cloud);
    cloud.scripted.push(new Response(JSON.stringify({ error: { message: "Destroy disabled" } }), { status: 400 }));

    const kept = await inTenant(tenant, async (scope) => {
      await expect(deleteMedia(scope, asset.id)).rejects.toBeInstanceOf(IntegrationError);
      // Even inside the same transaction the row is back.
      return getMedia(scope, asset.id);
    });

    expect(kept.id).toBe(asset.id);
    expect(await auditActions(tenant, asset.id)).toEqual(["media.uploaded"]);
  });

  it("uses the storage that holds the file, not the tenant's current default", async () => {
    const tenant = await createTenant({ plan: { features: { platformStorage: true } } });
    const shared = cloud.addAccount(newAccount());
    setPlatform(managedStorage(shared));
    const onPlatform = await uploadFile(tenant, cloud);

    // The tenant now connects its own account; new uploads go there.
    const own = cloud.addAccount(await connectCloudinary(tenant));
    const onOwn = await uploadFile(tenant, cloud);
    expect(onOwn).toMatchObject({ storageOwner: "tenant" });

    await inTenant(tenant, (scope) => deleteMedia(scope, onPlatform.id));
    await inTenant(tenant, (scope) => deleteMedia(scope, onOwn.id));

    const [first, second] = cloud.callsOf("destroy");
    expect(first).toMatchObject({ cloudName: shared.cloudName, publicId: onPlatform.publicId });
    expect(first?.body.api_key).toBe(shared.apiKey);
    expect(second).toMatchObject({ cloudName: own.cloudName, publicId: onOwn.publicId });
    expect(second?.body.api_key).toBe(own.apiKey);
    expect(cloud.has(shared.cloudName, "image", onPlatform.publicId)).toBe(false);
  });

  it("removes the row without a provider call when the credentials no longer exist", async () => {
    const { tenant, own } = await connectedTenant();
    const asset = await uploadFile(tenant, cloud);
    await inTenant(tenant, (scope) => deleteIntegration(scope, own.integrationId));
    const calls = cloud.calls.length;

    await inTenant(tenant, (scope) => deleteMedia(scope, asset.id));

    expect(cloud.calls).toHaveLength(calls);
    expect(await rowCount(tenant)).toBe(0);
  });
});

describe("replaceMedia", () => {
  it("swaps the provider file on the same entry and destroys the old one", async () => {
    const { tenant, own } = await connectedTenant();
    const folder = await inTenant(tenant, (scope) => createFolder(scope, { name: "Beaches" }));
    const original = await uploadFile(tenant, cloud, { alt: "Keep me", folderId: folder.id, filename: "old.jpg", bytes: 300_000 });
    const signature = await sign(tenant, jpeg({ filename: "new.png", contentType: "image/png", bytes: 400_000 }));
    cloud.browserUpload(signature, { format: "png", bytes: 400_000, width: 2000, height: 1000 });

    const replaced = await inTenant(tenant, (scope) => replaceMedia(scope, original.id, { publicId: signature.publicId, resourceType: "image", filename: "new.png" }));

    expect(replaced).toMatchObject({
      id: original.id,
      publicId: signature.publicId,
      format: "png",
      bytes: 400_000,
      width: 2000,
      height: 1000,
      originalFilename: "new.png",
      // Everything that is not provider identity stays.
      alt: "Keep me",
      folderId: folder.id,
      storageOwner: "tenant",
      integrationId: own.integrationId,
    });
    expect(replaced.url).toContain(signature.publicId);
    expect(cloud.has(own.cloudName, "image", original.publicId)).toBe(false);
    expect(cloud.has(own.cloudName, "image", signature.publicId)).toBe(true);
    expect(await rowCount(tenant)).toBe(1);
    expect(await auditActions(tenant, original.id)).toEqual(["media.uploaded", "media.replaced"]);

    // Repeating the same replace is a no-op.
    const calls = cloud.calls.length;
    const again = await inTenant(tenant, (scope) => replaceMedia(scope, original.id, { publicId: signature.publicId, resourceType: "image" }));
    expect(again).toEqual(replaced);
    expect(cloud.calls).toHaveLength(calls);
    expect(await auditActions(tenant, original.id)).toEqual(["media.uploaded", "media.replaced"]);
  });

  it("counts the freed space when checking the quota", async () => {
    const { tenant } = await connectedTenant({ plan: { maxStorageMb: 1 } });
    const original = await uploadFile(tenant, cloud, { bytes: 900_000 });
    // 900 000 is already stored: a second 900 000 file only fits as a replacement.
    const signature = await sign(tenant, jpeg({ bytes: 1000 }));
    cloud.browserUpload(signature, { format: "jpg", bytes: 900_000 });

    const replaced = await inTenant(tenant, (scope) => replaceMedia(scope, original.id, { publicId: signature.publicId, resourceType: "image" }));
    expect(replaced.bytes).toBe(900_000);
    expect(await inTenant(tenant, getStorageUsage)).toEqual({ usedBytes: 900_000, limitMb: 1, assetCount: 1 });

    const tooBig = await sign(tenant, jpeg({ bytes: 1000 }));
    cloud.browserUpload(tooBig, { format: "jpg", bytes: MB + 1 });
    await expect(inTenant(tenant, (scope) => replaceMedia(scope, original.id, { publicId: tooBig.publicId, resourceType: "image" }))).rejects.toBeInstanceOf(
      LimitExceededError,
    );
    expect((await inTenant(tenant, (scope) => getMedia(scope, original.id))).publicId).toBe(signature.publicId);
  });

  it("rejects a replacement of another kind, from outside the tenant folder, or already in the library", async () => {
    const { tenant, own } = await connectedTenant();
    const other = await createTenant();
    const original = await uploadFile(tenant, cloud);
    const second = await uploadFile(tenant, cloud);
    const replace = (input: Parameters<typeof replaceMedia>[2]) => inTenant(tenant, (scope) => replaceMedia(scope, original.id, input));

    const video = await signAndUpload(tenant, cloud, { resourceType: "video" });
    await expect(replace({ publicId: video.publicId, resourceType: "video" })).rejects.toBeInstanceOf(ValidationError);

    cloud.put(own.cloudName, "image", `wayfold/t_${other.tenantId}/theirs`);
    await expect(replace({ publicId: `wayfold/t_${other.tenantId}/theirs`, resourceType: "image" })).rejects.toBeInstanceOf(ForbiddenError);

    await expect(replace({ publicId: second.publicId, resourceType: "image" })).rejects.toBeInstanceOf(ConflictError);
    await expect(replace({ publicId: `${second.publicId.slice(0, -4)}none`, resourceType: "image" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(tenant, (scope) => replaceMedia(scope, randomId(), { publicId: second.publicId, resourceType: "image" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const unchanged = await inTenant(tenant, (scope) => getMedia(scope, original.id));
    expect(unchanged).toEqual(original);
    expect(cloud.has(own.cloudName, "image", original.publicId)).toBe(true);
    expect(cloud.has(own.cloudName, "image", second.publicId)).toBe(true);
  });

  it("keeps pointing at the old file when it cannot be destroyed", async () => {
    const { tenant } = await connectedTenant();
    const original = await uploadFile(tenant, cloud);
    const signature = await signAndUpload(tenant, cloud);
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith("/destroy") ? new Response(JSON.stringify({ error: { message: "nope" } }), { status: 400 }) : realFetch(input, init),
      ),
    );

    const after = await inTenant(tenant, async (scope) => {
      await expect(replaceMedia(scope, original.id, { publicId: signature.publicId, resourceType: "image" })).rejects.toBeInstanceOf(IntegrationError);
      return getMedia(scope, original.id);
    });

    expect(after.publicId).toBe(original.publicId);
    expect(await auditActions(tenant, original.id)).toEqual(["media.uploaded"]);
  });

  it("moves an entry from platform storage to the tenant's own account", async () => {
    const tenant = await createTenant({ plan: { features: { platformStorage: true } } });
    const shared = cloud.addAccount(newAccount());
    setPlatform(managedStorage(shared));
    const original = await uploadFile(tenant, cloud);
    const own = cloud.addAccount(await connectCloudinary(tenant));
    const signature = await signAndUpload(tenant, cloud);

    const replaced = await inTenant(tenant, (scope) => replaceMedia(scope, original.id, { publicId: signature.publicId, resourceType: "image" }));

    expect(replaced).toMatchObject({ id: original.id, storageOwner: "tenant", integrationId: own.integrationId, publicId: signature.publicId });
    // The old file was destroyed in the platform account, with the platform's key.
    const [destroy] = cloud.callsOf("destroy");
    expect(destroy).toMatchObject({ cloudName: shared.cloudName, publicId: original.publicId });
    expect(destroy?.body.api_key).toBe(shared.apiKey);
    expect(cloud.has(shared.cloudName, "image", original.publicId)).toBe(false);
  });
});

describe("folders", () => {
  it("creates, lists with counts, renames and deletes folders", async () => {
    const { tenant } = await connectedTenant();
    const beaches = await inTenant(tenant, (scope) => createFolder(scope, { name: "  Beaches " }));
    const alps = await inTenant(tenant, (scope) => createFolder(scope, { name: "alps" }));
    expect(beaches).toMatchObject({ name: "Beaches", tenantId: tenant.tenantId });

    const inBeaches = await uploadFile(tenant, cloud, { folderId: beaches.id });
    await uploadFile(tenant, cloud, { folderId: beaches.id });
    await uploadFile(tenant, cloud);

    expect((await inTenant(tenant, listFolders)).map(({ id, name, assetCount }) => ({ id, name, assetCount }))).toEqual([
      { id: alps.id, name: "alps", assetCount: 0 },
      { id: beaches.id, name: "Beaches", assetCount: 2 },
    ]);
    expect(await inTenant(tenant, (scope) => getFolder(scope, beaches.id))).toEqual(beaches);

    const renamed = await inTenant(tenant, (scope) => renameFolder(scope, beaches.id, { name: "Coast" }));
    expect(renamed).toMatchObject({ id: beaches.id, name: "Coast" });
    // Renaming to its own name (any case) is fine; to another folder's name is not.
    await expect(inTenant(tenant, (scope) => renameFolder(scope, beaches.id, { name: "COAST" }))).resolves.toMatchObject({ name: "COAST" });
    await expect(inTenant(tenant, (scope) => renameFolder(scope, beaches.id, { name: "Alps" }))).rejects.toBeInstanceOf(ConflictError);
    await expect(inTenant(tenant, (scope) => createFolder(scope, { name: "ALPS" }))).rejects.toBeInstanceOf(ConflictError);

    await inTenant(tenant, (scope) => deleteFolder(scope, beaches.id));

    await expect(inTenant(tenant, (scope) => getFolder(scope, beaches.id))).rejects.toBeInstanceOf(NotFoundError);
    // Its files survive, in no folder.
    expect(await inTenant(tenant, (scope) => getMedia(scope, inBeaches.id))).toMatchObject({ folderId: null });
    expect(await rowCount(tenant)).toBe(3);
    expect((await inTenant(tenant, (scope) => listMedia(scope, { folderId: null }))).items).toHaveLength(3);
  });

  it("validates names and ids", async () => {
    const { tenant } = await connectedTenant();
    await expect(inTenant(tenant, (scope) => createFolder(scope, { name: "   " }))).rejects.toBeInstanceOf(ValidationError);
    await expect(inTenant(tenant, (scope) => createFolder(scope, { name: "x".repeat(81) }))).rejects.toBeInstanceOf(ValidationError);
    await expect(inTenant(tenant, (scope) => renameFolder(scope, randomId(), { name: "Ghost" }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(tenant, (scope) => deleteFolder(scope, randomId()))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(tenant, (scope) => getFolder(scope, "nope"))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("getStorageUsage", () => {
  it("reports bytes used, the plan limit and the number of files", async () => {
    const { tenant } = await connectedTenant({ plan: { maxStorageMb: 50 } });
    expect(await inTenant(tenant, getStorageUsage)).toEqual({ usedBytes: 0, limitMb: 50, assetCount: 0 });

    await uploadFile(tenant, cloud, { bytes: 1_000_000 });
    const clip = await uploadFile(tenant, cloud, { resourceType: "video", bytes: 3_000_000 });
    expect(await inTenant(tenant, getStorageUsage)).toEqual({ usedBytes: 4_000_000, limitMb: 50, assetCount: 2 });

    await inTenant(tenant, (scope) => deleteMedia(scope, clip.id));
    expect(await inTenant(tenant, getStorageUsage)).toEqual({ usedBytes: 1_000_000, limitMb: 50, assetCount: 1 });
  });

  it("reports an unlimited plan as null", async () => {
    const { tenant } = await connectedTenant({ plan: { maxStorageMb: null } });
    expect(await inTenant(tenant, getStorageUsage)).toMatchObject({ limitMb: null });
  });
});
