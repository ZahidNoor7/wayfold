import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { openSecret } from "@/server/crypto/secret-box";
import { platformIntegrations } from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { keyring } from "@/server/integrations";
import { getAdapter, registerAdapter } from "@/server/integrations/registry";
import type { ProviderAdapter } from "@/server/integrations/types";
import { withPlatform } from "@/server/platform/db";
import {
  deletePlatformIntegration,
  listPlatformIntegrations,
  resolvePlatformIntegration,
  rotatePlatformIntegrationKeys,
  savePlatformIntegration,
  setPlatformIntegrationEnabled,
  testPlatformIntegration,
} from "@/server/platform/integrations";
import { getManagedStorage } from "@/server/platform/managed-storage";
import { auditBy, caught, createAdmin, holdPlatformIntegrationsLock } from "./helpers";

const API_KEY = "key-1234567890";
const API_SECRET = "s3cr3t-value-abcdef-9876";
const cloudinary = { provider: "cloudinary", config: { cloudName: "wayfold-shared", uploadFolder: "/managed/" }, secrets: { apiKey: API_KEY, apiSecret: API_SECRET } };

/** A second media provider and a non-platform category, to exercise replacement and refusal. */
function ensureTestAdapters(): void {
  const base = {
    description: "Test adapter",
    fields: [],
    configSchema: z.strictObject({ bucket: z.string().min(1) }),
    secretSchema: z.strictObject({ accessKey: z.string().min(8) }),
  };
  const adapters: ProviderAdapter<{ bucket: string }, { accessKey: string }>[] = [
    { ...base, id: "test_bucket", category: "media", name: "Test Bucket", test: async () => ({ ok: true }) },
    { ...base, id: "test_maps", category: "maps", name: "Test Maps", test: async () => ({ ok: true }) },
    {
      ...base,
      id: "test_flaky_mail",
      category: "email",
      name: "Flaky Mail",
      test: async ({ secrets }) => {
        throw new Error(`connection reset while sending ${secrets.accessKey}`);
      },
    },
  ];
  for (const adapter of adapters) if (!getAdapter(adapter.id)) registerAdapter(adapter);
}

async function rawRow(category: string) {
  const [row] = await withPlatform((tx) => tx.select().from(platformIntegrations).where(eq(platformIntegrations.category, category)));
  return row;
}

async function clear(): Promise<void> {
  await withPlatform((tx) => tx.delete(platformIntegrations));
}

describe("platform integrations", () => {
  holdPlatformIntegrationsLock();
  afterEach(async () => {
    vi.unstubAllGlobals();
    await clear();
  });

  it("stores credentials sealed and bound to the platform scope, and never returns them", async () => {
    const owner = await createAdmin();
    const view = await savePlatformIntegration(owner, cloudinary);

    expect(view).toMatchObject({
      provider: "cloudinary",
      providerName: "Cloudinary",
      category: "media",
      status: "untested",
      config: { cloudName: "wayfold-shared", uploadFolder: "managed" },
      lastTestedAt: null,
      lastError: null,
    });
    expect(view.secretHints).toEqual({ apiKey: "••••••••7890", apiSecret: "••••••••9876" });
    const serialised = JSON.stringify(view) + JSON.stringify(await listPlatformIntegrations(owner));
    expect(serialised).not.toContain(API_SECRET);
    expect(serialised).not.toContain(API_KEY);
    expect(serialised).not.toContain("wf1.");

    const row = (await rawRow("media"))!;
    expect(row.secretCiphertext.startsWith("wf1.")).toBe(true);
    expect(row.secretCiphertext).not.toContain(API_SECRET);
    expect(row.keyVersion).toBe("v2");

    // Opens only with the platform scope, this row and this provider.
    const sealed = { ciphertext: row.secretCiphertext, keyVersion: row.keyVersion };
    const binding = { tenantId: "platform", recordId: row.id, purpose: "integration:cloudinary" };
    expect(JSON.parse(openSecret(keyring(), binding, sealed))).toEqual({ apiKey: API_KEY, apiSecret: API_SECRET });
    expect(() => openSecret(keyring(), { ...binding, tenantId: row.id }, sealed)).toThrow();
    expect(() => openSecret(keyring(), { ...binding, purpose: "integration:smtp" }, sealed)).toThrow();

    const audit = (await auditBy(owner.userId)).find((entry) => entry.action === "platform_integration.created")!;
    expect(audit).toMatchObject({ tenantId: null, actorType: "platform_admin", targetId: row.id });
    expect(audit.metadata).toEqual({ provider: "cloudinary", category: "media", changedFields: ["apiKey", "apiSecret"] });
    expect(JSON.stringify(audit.metadata)).not.toContain(API_SECRET);
  });

  it("serves managed storage only while a Cloudinary connection is configured and enabled", async () => {
    const owner = await createAdmin();
    expect(await getManagedStorage()).toBeNull();

    await savePlatformIntegration(owner, cloudinary);
    expect(await getManagedStorage()).toEqual({
      provider: "cloudinary",
      config: { cloudName: "wayfold-shared", uploadFolder: "managed" },
      secrets: { apiKey: API_KEY, apiSecret: API_SECRET },
    });

    await setPlatformIntegrationEnabled(owner, "media", false);
    expect(await getManagedStorage()).toBeNull();
    expect(await resolvePlatformIntegration("media")).toBeNull();

    const enabled = await setPlatformIntegrationEnabled(owner, "media", true);
    expect(enabled.status).toBe("untested");
    expect((await getManagedStorage())?.config.cloudName).toBe("wayfold-shared");

    await deletePlatformIntegration(owner, "media");
    expect(await getManagedStorage()).toBeNull();
    expect(await rawRow("media")).toBeUndefined();

    const actions = (await auditBy(owner.userId)).map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining(["platform_integration.disabled", "platform_integration.enabled", "platform_integration.deleted"]),
    );
  });

  it("keeps a disabled connection disabled through edits and tests", async () => {
    const owner = await createAdmin();
    await savePlatformIntegration(owner, cloudinary);
    await setPlatformIntegrationEnabled(owner, "media", false);

    const edited = await savePlatformIntegration(owner, { provider: "cloudinary", config: { cloudName: "edited" }, secrets: {} });
    expect(edited).toMatchObject({ status: "disabled", config: { cloudName: "edited" } });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ plan: "Free" }), { status: 200 })));
    const tested = await testPlatformIntegration(owner, "media");
    expect(tested.status).toBe("disabled");
    expect(tested.lastTestedAt).toBeInstanceOf(Date);
    expect(tested.lastError).toBeNull();
    expect(await getManagedStorage()).toBeNull();

    // Only "Enable" switches it back on.
    expect((await setPlatformIntegrationEnabled(owner, "media", true)).status).toBe("untested");
    expect((await getManagedStorage())?.config.cloudName).toBe("edited");
  });

  it("omits the optional folder and ignores a media provider that is not Cloudinary or is incomplete", async () => {
    const owner = await createAdmin();
    ensureTestAdapters();

    await savePlatformIntegration(owner, { ...cloudinary, config: { cloudName: "bare" } });
    expect((await getManagedStorage())?.config).toEqual({ cloudName: "bare" });

    // A row that lost its cloud name is not usable storage.
    await withPlatform((tx) => tx.update(platformIntegrations).set({ config: {} }).where(eq(platformIntegrations.category, "media")));
    expect(await getManagedStorage()).toBeNull();

    await savePlatformIntegration(owner, { provider: "test_bucket", config: { bucket: "shared" }, secrets: { accessKey: "access-key-1" } });
    expect(await getManagedStorage()).toBeNull();
  });

  it("keeps stored secrets when an edit leaves them blank, and replaces them when given", async () => {
    const owner = await createAdmin();
    const first = await savePlatformIntegration(owner, cloudinary);

    const edited = await savePlatformIntegration(owner, { provider: "cloudinary", config: { cloudName: "renamed" }, secrets: { apiKey: "", apiSecret: "" } });
    expect(edited.id).toBe(first.id);
    expect(edited.config).toEqual({ cloudName: "renamed" });
    expect((await getManagedStorage())?.secrets).toEqual({ apiKey: API_KEY, apiSecret: API_SECRET });

    await savePlatformIntegration(owner, { provider: "cloudinary", config: { cloudName: "renamed" }, secrets: { apiSecret: "rotated-secret-0001" } });
    expect((await getManagedStorage())?.secrets).toEqual({ apiKey: API_KEY, apiSecret: "rotated-secret-0001" });

    const updates = (await auditBy(owner.userId)).filter((entry) => entry.action === "platform_integration.updated");
    expect(updates.map((entry) => (entry.metadata as { changedFields: string[] }).changedFields).sort()).toEqual([[], ["apiSecret"]]);
  });

  it("replaces the connection when the category moves to another provider", async () => {
    const owner = await createAdmin();
    ensureTestAdapters();
    const first = await savePlatformIntegration(owner, cloudinary);

    // The new provider cannot inherit the old one's secrets.
    const incomplete = await caught(() => savePlatformIntegration(owner, { provider: "test_bucket", config: { bucket: "b" }, secrets: {} }));
    expect(incomplete).toBeInstanceOf(ValidationError);
    expect(incomplete.fieldErrors).toHaveProperty("accessKey");
    expect((await rawRow("media"))!.provider).toBe("cloudinary");

    const replaced = await savePlatformIntegration(owner, { provider: "test_bucket", config: { bucket: "b" }, secrets: { accessKey: "access-key-1" } });
    expect(replaced.id).not.toBe(first.id);
    expect(await listPlatformIntegrations(owner)).toHaveLength(1);
    expect(await resolvePlatformIntegration("media")).toEqual({
      id: replaced.id,
      provider: "test_bucket",
      config: { bucket: "b" },
      secrets: { accessKey: "access-key-1" },
    });
    expect((await auditBy(owner.userId)).map((entry) => entry.action)).toContain("platform_integration.replaced");
  });

  it("validates provider, category, config and secrets", async () => {
    const owner = await createAdmin();
    ensureTestAdapters();
    expect(await caught(() => savePlatformIntegration(owner, { ...cloudinary, provider: "no_such_provider" }))).toBeInstanceOf(ValidationError);
    // Maps is a real category, but not one the platform connects for itself.
    expect(
      await caught(() => savePlatformIntegration(owner, { provider: "test_maps", config: { bucket: "b" }, secrets: { accessKey: "access-key-1" } })),
    ).toBeInstanceOf(ValidationError);

    const badConfig = await caught(() => savePlatformIntegration(owner, { ...cloudinary, config: { cloudName: "has spaces" } }));
    expect(badConfig).toBeInstanceOf(ValidationError);
    expect(badConfig.fieldErrors).toHaveProperty("cloudName");
    const badSecret = await caught(() => savePlatformIntegration(owner, { ...cloudinary, secrets: { apiKey: API_KEY } }));
    expect(badSecret.fieldErrors).toHaveProperty("apiSecret");
    expect(await listPlatformIntegrations(owner)).toEqual([]);

    for (const category of ["payments", "nope", ""]) {
      expect(await caught(() => testPlatformIntegration(owner, category))).toBeInstanceOf(NotFoundError);
    }
    expect(await caught(() => deletePlatformIntegration(owner, "email"))).toBeInstanceOf(NotFoundError);
    expect(await caught(() => setPlatformIntegrationEnabled(owner, "media", false))).toBeInstanceOf(NotFoundError);
  });

  it("records a successful and a failed connection test without leaking the secret", async () => {
    const owner = await createAdmin();
    await savePlatformIntegration(owner, cloudinary);

    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        requested.push(String(url));
        return new Response(JSON.stringify({ plan: "Advanced" }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const ok = await testPlatformIntegration(owner, "media");
    expect(ok).toMatchObject({ status: "connected", lastError: null });
    expect(ok.lastTestedAt).toBeInstanceOf(Date);
    expect(requested).toEqual(["https://api.cloudinary.com/v1_1/wayfold-shared/usage"]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: `Invalid credentials for ${API_SECRET}` } }), { status: 401 })),
    );
    const failed = await testPlatformIntegration(owner, "media");
    expect(failed.status).toBe("error");
    expect(failed.lastError).toContain("did not accept");
    expect(failed.lastError).not.toContain(API_SECRET);

    const tests = (await auditBy(owner.userId)).filter((entry) => entry.action === "platform_integration.tested");
    expect(tests.map((entry) => (entry.metadata as { ok: boolean }).ok).sort()).toEqual([false, true]);
  });

  it("turns an adapter exception into a sanitised error state", async () => {
    const owner = await createAdmin();
    ensureTestAdapters();
    await savePlatformIntegration(owner, { provider: "test_flaky_mail", config: { bucket: "b" }, secrets: { accessKey: "access-key-SECRET" } });
    const view = await testPlatformIntegration(owner, "email");
    expect(view.status).toBe("error");
    expect(view.lastError).toContain("connection reset");
    expect(view.lastError).not.toContain("access-key-SECRET");
  });

  it("re-encrypts platform credentials written under an older key", async () => {
    const owner = await createAdmin();
    await savePlatformIntegration(owner, cloudinary);
    expect(await rotatePlatformIntegrationKeys()).toBe(0);

    // Re-seal under v1, as if the row predated the key rotation.
    const row = (await rawRow("media"))!;
    const { createKeyring } = await import("@/server/crypto/keyring");
    const { sealSecret } = await import("@/server/crypto/secret-box");
    const old = sealSecret(
      createKeyring(process.env.CREDENTIAL_ENCRYPTION_KEYS!, "v1"),
      { tenantId: "platform", recordId: row.id, purpose: "integration:cloudinary" },
      JSON.stringify({ apiKey: API_KEY, apiSecret: API_SECRET }),
    );
    await withPlatform((tx) =>
      tx.update(platformIntegrations).set({ secretCiphertext: old.ciphertext, keyVersion: "v1" }).where(eq(platformIntegrations.id, row.id)),
    );

    expect(await rotatePlatformIntegrationKeys()).toBe(1);
    expect((await rawRow("media"))!.keyVersion).toBe("v2");
    expect((await getManagedStorage())?.secrets).toEqual({ apiKey: API_KEY, apiSecret: API_SECRET });
  });

  it("lets support see connection status but change nothing", async () => {
    const owner = await createAdmin();
    const support = await createAdmin("support");
    await savePlatformIntegration(owner, cloudinary);

    expect((await listPlatformIntegrations(support)).map((view) => view.status)).toEqual(["untested"]);
    expect(await caught(() => savePlatformIntegration(support, cloudinary))).toBeInstanceOf(ForbiddenError);
    expect(await caught(() => testPlatformIntegration(support, "media"))).toBeInstanceOf(ForbiddenError);
    expect(await caught(() => setPlatformIntegrationEnabled(support, "media", false))).toBeInstanceOf(ForbiddenError);
    expect(await caught(() => deletePlatformIntegration(support, "media"))).toBeInstanceOf(ForbiddenError);
    expect((await rawRow("media"))!.status).toBe("untested");
  });
});
