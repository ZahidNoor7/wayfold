import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { IntegrationError, ValidationError } from "@/server/errors";
import { getAdapter, registerAdapter } from "@/server/integrations/registry";
import { IntegrationNotConfiguredError, deleteIntegration, saveIntegration, setIntegrationEnabled } from "@/server/integrations/service";
import { isInsideTenantFolder, selectStorage, storageForAsset, tenantFolderPrefix } from "@/server/media/storage";
import { getManagedStorage, type ManagedStorage } from "@/server/platform/managed-storage";
import { createTenant } from "../../helpers/fixtures";
import { connectCloudinary, inTenant, managedStorage, newAccount } from "./helpers";

const platform = vi.hoisted(() => ({ storage: null as unknown }));
vi.mock("@/server/platform/managed-storage", () => ({ getManagedStorage: vi.fn(async () => platform.storage) }));

const setPlatform = (storage: ManagedStorage | null) => {
  platform.storage = storage;
};

beforeEach(() => {
  setPlatform(null);
  vi.mocked(getManagedStorage).mockClear();
});

describe("selectStorage", () => {
  it("uses the tenant's own default media integration, even when platform storage is available", async () => {
    const tenant = await createTenant();
    const own = await connectCloudinary(tenant, newAccount({ uploadFolder: "brand" }));
    setPlatform(managedStorage(newAccount()));

    const storage = await inTenant(tenant, selectStorage);

    expect(storage).toEqual({
      owner: "tenant",
      integrationId: own.integrationId,
      provider: "cloudinary",
      config: { cloudName: own.cloudName, uploadFolder: "brand" },
      secrets: { apiKey: own.apiKey, apiSecret: own.apiSecret },
    });
    expect(getManagedStorage).not.toHaveBeenCalled();
  });

  it("uses platform storage when the plan includes it and the platform has configured it", async () => {
    const tenant = await createTenant({ plan: { features: { platformStorage: true } } });
    const shared = newAccount({ uploadFolder: "tenants" });
    setPlatform(managedStorage(shared));

    const storage = await inTenant(tenant, selectStorage);

    expect(storage).toEqual({
      owner: "platform",
      integrationId: null,
      provider: "cloudinary",
      config: { cloudName: shared.cloudName, uploadFolder: "tenants" },
      secrets: { apiKey: shared.apiKey, apiSecret: shared.apiSecret },
    });
  });

  it("is not configured when the plan lacks platform storage, without even asking for it", async () => {
    const tenant = await createTenant({ plan: { features: { platformStorage: false } } });
    setPlatform(managedStorage(newAccount()));

    const error = await inTenant(tenant, selectStorage).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IntegrationNotConfiguredError);
    expect((error as IntegrationNotConfiguredError).category).toBe("media");
    expect(getManagedStorage).not.toHaveBeenCalled();
  });

  it("is not configured when the plan allows platform storage but none is set up", async () => {
    const tenant = await createTenant({ plan: { features: { platformStorage: true } } });
    await expect(inTenant(tenant, selectStorage)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    expect(getManagedStorage).toHaveBeenCalledTimes(1);
  });

  it("ignores a disabled integration", async () => {
    const tenant = await createTenant({ plan: { features: { platformStorage: false } } });
    const own = await connectCloudinary(tenant);
    await inTenant(tenant, (scope) => setIntegrationEnabled(scope, own.integrationId, false));

    await expect(inTenant(tenant, selectStorage)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });

  it("never falls back to another tenant's integration", async () => {
    const connected = await createTenant({ plan: { features: { platformStorage: false } } });
    await connectCloudinary(connected);
    const bare = await createTenant({ plan: { features: { platformStorage: false } } });

    await expect(inTenant(bare, selectStorage)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });

  it("refuses a media provider the library cannot drive", async () => {
    if (!getAdapter("otherstore")) {
      registerAdapter({
        id: "otherstore",
        category: "media",
        name: "Other store",
        description: "Not Cloudinary",
        fields: [],
        configSchema: z.object({ bucket: z.string() }),
        secretSchema: z.object({ token: z.string() }),
        test: async () => ({ ok: true }),
      });
    }
    const tenant = await createTenant();
    await inTenant(tenant, (scope) => saveIntegration(scope, { provider: "otherstore", config: { bucket: "b" }, secrets: { token: "tok-12345" } }));

    const error = await inTenant(tenant, selectStorage).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    expect((error as IntegrationError).code).toBe("media_provider_unsupported");
  });
});

describe("storageForAsset", () => {
  it("finds the tenant integration that holds a file, even when it is no longer the default", async () => {
    const tenant = await createTenant();
    const first = await connectCloudinary(tenant);
    const asset = { storageOwner: "tenant" as const, integrationId: first.integrationId, provider: "cloudinary" };

    const storage = await inTenant(tenant, (scope) => storageForAsset(scope, asset));
    expect(storage).toMatchObject({ owner: "tenant", integrationId: first.integrationId, secrets: { apiSecret: first.apiSecret } });
  });

  it("returns null once the credentials are gone", async () => {
    const tenant = await createTenant();
    const own = await connectCloudinary(tenant);
    await inTenant(tenant, (scope) => deleteIntegration(scope, own.integrationId));

    const results = await inTenant(tenant, async (scope) => [
      await storageForAsset(scope, { storageOwner: "tenant", integrationId: null, provider: "cloudinary" }),
      await storageForAsset(scope, { storageOwner: "platform", integrationId: null, provider: "cloudinary" }),
      await storageForAsset(scope, { storageOwner: "tenant", integrationId: null, provider: "s3" }),
    ]);
    expect(results).toEqual([null, null, null]);
  });

  it("returns platform storage for a platform-held file regardless of the tenant's own integration", async () => {
    const tenant = await createTenant();
    await connectCloudinary(tenant);
    const shared = newAccount();
    setPlatform(managedStorage(shared));

    const storage = await inTenant(tenant, (scope) => storageForAsset(scope, { storageOwner: "platform", integrationId: null, provider: "cloudinary" }));
    expect(storage).toMatchObject({ owner: "platform", integrationId: null, config: { cloudName: shared.cloudName } });
  });

  it("does not resolve another tenant's integration id", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const aOwn = await connectCloudinary(a);

    await expect(
      inTenant(b, (scope) => storageForAsset(scope, { storageOwner: "tenant", integrationId: aOwn.integrationId, provider: "cloudinary" })),
    ).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });
});

describe("tenantFolderPrefix", () => {
  const tenantId = "0b0f3a52-6d0e-4b7a-9a43-2f1f0c1d2e3f";

  it("places every tenant under wayfold/t_{tenantId}", () => {
    expect(tenantFolderPrefix({ tenantId }, {})).toBe(`wayfold/t_${tenantId}`);
  });

  it("nests under the configured upload folder, ignoring stray slashes and spaces", () => {
    expect(tenantFolderPrefix({ tenantId }, { uploadFolder: "/sites/ My Brand /" })).toBe(`sites/My Brand/wayfold/t_${tenantId}`);
    expect(tenantFolderPrefix({ tenantId }, { uploadFolder: "  " })).toBe(`wayfold/t_${tenantId}`);
  });

  it.each(["a&b=c", "../up", "v123/x", "semi;colon", "per%cent", "trailing."])("rejects the upload folder %j", (uploadFolder) => {
    expect(() => tenantFolderPrefix({ tenantId }, { uploadFolder })).toThrow(ValidationError);
  });

  it("recognises only ids strictly inside the tenant folder", () => {
    const other = "9c1d4e77-1111-4222-8333-444455556666";
    const inside = (publicId: string) => isInsideTenantFolder({ tenantId }, { uploadFolder: "root" }, publicId);

    expect(inside(`root/wayfold/t_${tenantId}/abc`)).toBe(true);
    expect(inside(`root/wayfold/t_${tenantId}/sub/abc`)).toBe(true);
    expect(inside(`root/wayfold/t_${other}/abc`)).toBe(false);
    expect(inside(`wayfold/t_${tenantId}/abc`)).toBe(false);
    expect(inside(`root/wayfold/t_${tenantId}`)).toBe(false);
    expect(inside(`root/wayfold/t_${tenantId}/`)).toBe(false);
    expect(inside(`root/wayfold/t_${tenantId}extra/abc`)).toBe(false);
    expect(inside(`root/wayfold/t_${tenantId}/../t_${other}/abc`)).toBe(false);
    expect(inside(`x/root/wayfold/t_${tenantId}/abc`)).toBe(false);
  });
});
