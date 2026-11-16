import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSecret, SecretDecryptionError } from "@/server/crypto/secret-box";
import { withTenant, type TenantScope } from "@/server/db/context";
import { integrations, mediaAssets, plans } from "@/server/db/schema";
import { ConflictError, LimitExceededError, NotFoundError, ValidationError } from "@/server/errors";
import { TransientProviderError } from "@/server/integrations/http";
import {
  deleteIntegration,
  getIntegration,
  IntegrationNotConfiguredError,
  keyring,
  listIntegrations,
  resolveIntegration,
  rotateTenantIntegrationKeys,
  saveIntegration,
  setDefaultIntegration,
  setIntegrationEnabled,
  TEST_TIMEOUT_MS,
  testIntegration,
  type SaveIntegrationInput,
} from "@/server/integrations/service";
import { withPlatform } from "@/server/platform/db";
import { createTenant, randomId, unique, type TenantFixture } from "../../helpers/fixtures";
import {
  auditFor,
  CONFIG,
  FAKE_MAIL,
  FAKE_MAPS,
  installFakeProviders,
  keysWithoutV1,
  rejection,
  restoreKeys,
  SECRETS,
  storedIntegration,
  switchKeys,
} from "./support";

const provider = installFakeProviders();

beforeEach(() => {
  provider.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreKeys();
});

const asOwner = <T>(t: TenantFixture, fn: (scope: TenantScope) => Promise<T>) => withTenant(t.tenantId, fn, { userId: t.ownerId });

const connect = (t: TenantFixture, overrides: Partial<SaveIntegrationInput> = {}) =>
  asOwner(t, (scope) => saveIntegration(scope, { provider: FAKE_MAIL, config: { ...CONFIG }, secrets: { ...SECRETS }, ...overrides }));

const resolveMail = (t: TenantFixture, integrationId?: string) =>
  asOwner(t, (scope) => resolveIntegration(scope, "email", integrationId ? { integrationId } : {}));

/** Every way a secret could show up in something that leaves the server. */
function expectNoSecrets(value: unknown, extra: string[] = []): void {
  const rendered = JSON.stringify(value);
  for (const secret of [SECRETS.apiKey, SECRETS.apiSecret, "APIKEY-4f9a1c7e", "APISECRET-88b3e6d1", ...extra]) {
    expect(rendered).not.toContain(secret);
  }
}

describe("saveIntegration: create", () => {
  it("creates the connection and returns a view with masked hints only", async () => {
    const t = await createTenant();
    const view = await connect(t);

    expect(view).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      provider: FAKE_MAIL,
      providerName: "Fake Mail",
      category: "email",
      label: "Default",
      isDefault: true,
      status: "untested",
      config: CONFIG,
      secretHints: { apiKey: "••••••••22d0", apiSecret: "••••••••54aa" },
      lastTestedAt: null,
      lastError: null,
      rotatedAt: null,
      updatedAt: expect.any(Date),
    });
  });

  it("stores ciphertext that is not the plaintext, under the active key", async () => {
    const t = await createTenant();
    const view = await connect(t);
    const row = await storedIntegration(view.id);

    expect(row).toMatchObject({ tenantId: t.tenantId, provider: FAKE_MAIL, category: "email", keyVersion: "v2", createdBy: t.ownerId });
    expect(row!.secretCiphertext).toMatch(/^wf1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(row!.secretCiphertext).not.toBe(JSON.stringify(SECRETS));
    // No column of the stored row carries a secret, in clear or base64.
    expectNoSecrets(row, [Buffer.from(SECRETS.apiKey).toString("base64"), Buffer.from(SECRETS.apiKey).toString("base64url")]);
    expect(row!.config).toEqual(CONFIG);
  });

  it("binds the ciphertext to this tenant, this row and this provider", async () => {
    const t = await createTenant();
    const view = await connect(t);
    const row = await storedIntegration(view.id);
    const sealed = { ciphertext: row!.secretCiphertext, keyVersion: row!.keyVersion };
    const binding = { tenantId: t.tenantId, recordId: view.id, purpose: `integration:${FAKE_MAIL}` };

    expect(JSON.parse(openSecret(keyring(), binding, sealed))).toEqual(SECRETS);
    expect(() => openSecret(keyring(), { ...binding, recordId: randomId() }, sealed)).toThrow(SecretDecryptionError);
    expect(() => openSecret(keyring(), { ...binding, tenantId: randomId() }, sealed)).toThrow(SecretDecryptionError);
    expect(() => openSecret(keyring(), { ...binding, purpose: `integration:${FAKE_MAPS}` }, sealed)).toThrow(SecretDecryptionError);
  });

  it("never puts plaintext or ciphertext into any view", async () => {
    const t = await createTenant();
    const created = await connect(t);
    const row = await storedIntegration(created.id);
    const tested = await asOwner(t, (scope) => testIntegration(scope, created.id));
    const views = {
      created,
      fetched: await asOwner(t, (scope) => getIntegration(scope, created.id)),
      listed: await asOwner(t, listIntegrations),
      tested,
      updated: await connect(t, { id: created.id, secrets: {} }),
      disabled: await asOwner(t, (scope) => setIntegrationEnabled(scope, created.id, false)),
    };
    const latest = await storedIntegration(created.id);

    expectNoSecrets(views, [row!.secretCiphertext, latest!.secretCiphertext, ...row!.secretCiphertext.split(".").slice(1)]);
    const rendered = JSON.stringify(views);
    for (const column of ["secretCiphertext", "secret_ciphertext", "keyVersion", "key_version", "wf1."]) {
      expect(rendered).not.toContain(column);
    }
  });

  it("rejects a provider that is not registered", async () => {
    const t = await createTenant();
    const error = await rejection(connect(t, { provider: "telepathy" }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe("That integration provider is not supported.");
    expect(await asOwner(t, listIntegrations)).toEqual([]);
  });

  it("rejects invalid settings with a field error", async () => {
    const t = await createTenant();
    const error = (await rejection(connect(t, { config: { host: "" } }))) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors).toEqual({ host: ["Enter the host."] });
  });

  it.each([
    ["missing", { apiKey: SECRETS.apiKey }],
    ["blank", { apiKey: SECRETS.apiKey, apiSecret: "" }],
    ["too short", { apiKey: SECRETS.apiKey, apiSecret: "tiny" }],
  ])("rejects a %s secret on create without echoing any value", async (_name, secrets) => {
    const t = await createTenant();
    const error = (await rejection(connect(t, { secrets }))) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(["apiSecret"]);
    expectNoSecrets({ message: error.message, fieldErrors: error.fieldErrors }, ["tiny"]);
    expect(await asOwner(t, listIntegrations)).toEqual([]);
  });

  it("names the connection Default unless told otherwise, trimmed and capped at sixty characters", async () => {
    const t = await createTenant();
    expect((await connect(t, { label: "   " })).label).toBe("Default");
    expect((await connect(t, { label: "  Transactional  " })).label).toBe("Transactional");
    expect((await connect(t, { label: "L".repeat(100) })).label).toBe("L".repeat(60));
  });

  it("refuses a second connection with the same provider and name", async () => {
    const t = await createTenant();
    await connect(t, { label: "Primary" });

    const error = await rejection(connect(t, { label: "Primary" }));
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe("A connection with that name already exists for this provider.");
    expect(await asOwner(t, listIntegrations)).toHaveLength(1);

    // The same name is fine for a different provider.
    await expect(connect(t, { provider: FAKE_MAPS, label: "Primary" })).resolves.toMatchObject({ provider: FAKE_MAPS, label: "Primary" });
  });

  it("makes the first connection in each category the default", async () => {
    const t = await createTenant();
    const first = await connect(t, { label: "First" });
    const second = await connect(t, { label: "Second" });
    const maps = await connect(t, { provider: FAKE_MAPS });

    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);
    expect(maps).toMatchObject({ category: "maps", isDefault: true, providerName: "Fake Maps" });
  });

  it("refuses a category the plan does not include", async () => {
    const t = await createTenant({ plan: { features: { integrations: ["media"] } } });

    const error = (await rejection(connect(t))) as LimitExceededError;
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error.limit).toBe("integration:email");
    expect(error.code).toBe("plan_limit");
    expect(await asOwner(t, listIntegrations)).toEqual([]);
    expect(await auditFor(t.tenantId)).toEqual([]);
  });

  it("refuses edits once the plan no longer includes the category", async () => {
    const t = await createTenant();
    const view = await connect(t);
    await withPlatform((tx) =>
      tx
        .update(plans)
        .set({ features: { customDomain: true, integrations: ["media"], platformStorage: true, promotions: true, removeBranding: true } })
        .where(eq(plans.id, t.planId)),
    );
    await expect(connect(t, { id: view.id, secrets: {} })).rejects.toBeInstanceOf(LimitExceededError);
  });
});

describe("saveIntegration: update", () => {
  it("keeps the stored secrets when the secret fields are left blank", async () => {
    const t = await createTenant();
    const created = await connect(t);
    const before = await storedIntegration(created.id);

    const updated = await connect(t, {
      id: created.id,
      config: { host: "smtp2.fake-provider.test" },
      secrets: { apiKey: "", apiSecret: "" },
    });

    expect(updated).toMatchObject({
      id: created.id,
      config: { host: "smtp2.fake-provider.test" },
      secretHints: created.secretHints,
      rotatedAt: null,
      label: "Default",
      isDefault: true,
    });
    const resolved = await resolveMail(t);
    expect(resolved.secrets).toEqual(SECRETS);
    expect(resolved.config).toEqual({ host: "smtp2.fake-provider.test" });

    // Re-sealed with a fresh nonce, still bound to the same row.
    const after = await storedIntegration(created.id);
    expect(after!.secretCiphertext).not.toBe(before!.secretCiphertext);
    expect(await asOwner(t, listIntegrations)).toHaveLength(1);
  });

  it("keeps the stored secrets when the secret fields are omitted entirely", async () => {
    const t = await createTenant();
    const created = await connect(t);
    await connect(t, { id: created.id, secrets: {} });
    expect((await resolveMail(t)).secrets).toEqual(SECRETS);
  });

  it("replaces only the secret that was supplied", async () => {
    const t = await createTenant();
    const created = await connect(t);

    const updated = await connect(t, { id: created.id, secrets: { apiKey: "", apiSecret: "rotated-SECRET-0099aabbccdd" } });

    expect(updated.secretHints).toEqual({ apiKey: "••••••••22d0", apiSecret: "••••••••ccdd" });
    expect(updated.rotatedAt).toBeInstanceOf(Date);
    expect((await resolveMail(t)).secrets).toEqual({ apiKey: SECRETS.apiKey, apiSecret: "rotated-SECRET-0099aabbccdd" });
    expectNoSecrets(updated, ["rotated-SECRET-0099aabbccdd"]);
  });

  it("keeps the label when none is sent, and renames when one is", async () => {
    const t = await createTenant();
    const created = await connect(t, { label: "Primary" });
    expect((await connect(t, { id: created.id, secrets: {} })).label).toBe("Primary");
    expect((await connect(t, { id: created.id, label: "Main", secrets: {} })).label).toBe("Main");
    // Saving again under its own current name is not a conflict.
    expect((await connect(t, { id: created.id, label: "Main", secrets: {} })).label).toBe("Main");
  });

  it("refuses to rename onto another connection's name", async () => {
    const t = await createTenant();
    await connect(t, { label: "Primary" });
    const backup = await connect(t, { label: "Backup" });
    await expect(connect(t, { id: backup.id, label: "Primary", secrets: {} })).rejects.toBeInstanceOf(ConflictError);
    expect((await asOwner(t, (scope) => getIntegration(scope, backup.id))).label).toBe("Backup");
  });

  it("returns the connection to untested and clears the last error", async () => {
    const t = await createTenant();
    const created = await connect(t);
    provider.test = async () => ({ ok: false, message: "Authentication failed" });
    expect(await asOwner(t, (scope) => testIntegration(scope, created.id))).toMatchObject({ status: "error", lastError: "Authentication failed" });

    const updated = await connect(t, { id: created.id, secrets: { apiKey: "replacement-KEY-55667788" } });
    expect(updated).toMatchObject({ status: "untested", lastError: null });
  });

  it("refuses to turn a connection into another provider", async () => {
    const t = await createTenant();
    const created = await connect(t);
    const error = await rejection(connect(t, { id: created.id, provider: FAKE_MAPS }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe("A connection cannot change provider.");
    expect((await storedIntegration(created.id))!.provider).toBe(FAKE_MAIL);
  });

  it("answers an unknown id with not found and creates nothing", async () => {
    const t = await createTenant();
    await expect(connect(t, { id: randomId() })).rejects.toBeInstanceOf(NotFoundError);
    expect(await asOwner(t, listIntegrations)).toEqual([]);
  });

  it("rejects an invalid replacement secret and keeps the old one", async () => {
    const t = await createTenant();
    const created = await connect(t);
    const error = (await rejection(connect(t, { id: created.id, secrets: { apiSecret: "tiny" } }))) as ValidationError;
    expect(error.fieldErrors).toEqual({ apiSecret: ["Enter the API secret."] });
    expect((await resolveMail(t)).secrets).toEqual(SECRETS);
  });
});

describe("listIntegrations / getIntegration", () => {
  it("lists a tenant's connections by category, then age", async () => {
    const t = await createTenant();
    const maps = await connect(t, { provider: FAKE_MAPS });
    const first = await connect(t, { label: "First" });
    const second = await connect(t, { label: "Second" });

    const list = await asOwner(t, listIntegrations);
    expect(list.map((view) => view.id)).toEqual([first.id, second.id, maps.id]);
    expect(await asOwner(t, (scope) => getIntegration(scope, second.id))).toEqual(second);
  });

  it("answers an unknown id with not found", async () => {
    const t = await createTenant();
    const error = await rejection(asOwner(t, (scope) => getIntegration(scope, randomId())));
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toBe("Integration not found.");
  });

  it("shows the raw provider id for a connection whose adapter is gone, and refuses to test it", async () => {
    const t = await createTenant();
    const [row] = await asOwner(t, ({ tx }) =>
      tx
        .insert(integrations)
        .values({ provider: "retired_provider", category: "email", label: "Legacy", secretCiphertext: "wf1.a.b.c", keyVersion: "v2" })
        .returning({ id: integrations.id }),
    );

    const [view] = await asOwner(t, listIntegrations);
    expect(view).toMatchObject({ id: row!.id, provider: "retired_provider", providerName: "retired_provider" });
    await expect(asOwner(t, (scope) => testIntegration(scope, row!.id))).rejects.toBeInstanceOf(ValidationError);
    expect(provider.calls).toEqual([]);
  });
});

describe("testIntegration", () => {
  it("marks the connection connected when the provider accepts the credentials", async () => {
    const t = await createTenant();
    const created = await connect(t);
    provider.test = async () => ({ ok: true, detail: "Authenticated as wayfold" });

    const before = Date.now();
    const view = await asOwner(t, (scope) => testIntegration(scope, created.id));

    expect(view).toMatchObject({ id: created.id, status: "connected", lastError: null });
    expect(view.lastTestedAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    // The adapter received the decrypted credentials and an abort signal.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.credentials).toEqual({ config: CONFIG, secrets: SECRETS });
    expect(provider.calls[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(provider.calls[0]!.signal.aborted).toBe(false);
  });

  it("records the provider's reason when the credentials are refused", async () => {
    const t = await createTenant();
    const created = await connect(t);
    provider.test = async () => ({ ok: false, message: "Authentication failed: unknown account" });

    const view = await asOwner(t, (scope) => testIntegration(scope, created.id));
    expect(view).toMatchObject({ status: "error", lastError: "Authentication failed: unknown account" });
    expect(view.lastTestedAt).toBeInstanceOf(Date);
    expect(provider.calls).toHaveLength(1);
  });

  it("redacts a secret that an adapter put into its failure message", async () => {
    const t = await createTenant();
    const created = await connect(t);
    provider.test = async (credentials) => ({ ok: false, message: `Key ${credentials.secrets.apiKey} was rejected` });

    const view = await asOwner(t, (scope) => testIntegration(scope, created.id));
    expect(view.lastError).toBe("Key [redacted] was rejected");
    expectNoSecrets(view);
    expectNoSecrets(await storedIntegration(created.id));
  });

  it("redacts secrets from a thrown error before storing it", async () => {
    const t = await createTenant();
    const created = await connect(t);
    provider.test = async (credentials) => {
      throw new Error(
        `401 Unauthorized for key ${credentials.secrets.apiKey} at https://user:${credentials.secrets.apiSecret}@api.fake-provider.test/ping?key=${credentials.secrets.apiKey}`,
      );
    };

    const view = await asOwner(t, (scope) => testIntegration(scope, created.id));

    expect(view.status).toBe("error");
    expect(view.lastError).toBe("401 Unauthorized for key [redacted] at https://[redacted]@api.fake-provider.test/ping?[redacted]");
    const row = await storedIntegration(created.id);
    expect(row!.lastError).toBe(view.lastError);
    expectNoSecrets({ view, lastError: row!.lastError, audit: await auditFor(t.tenantId) });
    // A permanent failure is not retried.
    expect(provider.calls).toHaveLength(1);
  });

  it("caps a very long provider error", async () => {
    const t = await createTenant();
    const created = await connect(t);
    provider.test = async () => {
      throw new Error("E".repeat(5_000));
    };
    const view = await asOwner(t, (scope) => testIntegration(scope, created.id));
    expect(view.lastError).toBe(`${"E".repeat(300)}…`);
  });

  it("retries once after a transient failure", async () => {
    const t = await createTenant();
    const created = await connect(t);
    provider.test = async () => {
      if (provider.calls.length === 1) throw new TransientProviderError("Provider responded with HTTP 503");
      return { ok: true };
    };

    const view = await asOwner(t, (scope) => testIntegration(scope, created.id));
    expect(provider.calls).toHaveLength(2);
    expect(view).toMatchObject({ status: "connected", lastError: null });
  });

  it("reports the failure when the provider stays unavailable", async () => {
    const t = await createTenant();
    const created = await connect(t);
    provider.test = async () => {
      throw new TransientProviderError("Provider responded with HTTP 503");
    };

    const view = await asOwner(t, (scope) => testIntegration(scope, created.id));
    expect(provider.calls).toHaveLength(2);
    expect(view).toMatchObject({ status: "error", lastError: "Provider responded with HTTP 503" });
  });

  it("gives up when the provider does not answer in time", async () => {
    const t = await createTenant();
    const created = await connect(t);
    provider.test = () => new Promise(() => {});

    // Shorten only the provider deadline; every other timer (the retry
    // backoff, the connection pool) keeps its real duration.
    const realSetTimeout = globalThis.setTimeout;
    const deadlines: number[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, ms?: number) => {
      if (ms === TEST_TIMEOUT_MS) {
        deadlines.push(ms);
        return realSetTimeout(handler, 25);
      }
      return realSetTimeout(handler, ms);
    }) as typeof setTimeout);

    let view;
    try {
      view = await asOwner(t, (scope) => testIntegration(scope, created.id));
    } finally {
      vi.restoreAllMocks();
    }

    expect(TEST_TIMEOUT_MS).toBe(8_000);
    // One deadline per attempt: the first try and a single retry.
    expect(deadlines).toEqual([TEST_TIMEOUT_MS, TEST_TIMEOUT_MS]);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls.every((call) => call.signal.aborted)).toBe(true);
    expect(view).toMatchObject({ status: "error", lastError: "The provider did not respond in time." });
    expect(view.lastTestedAt).toBeInstanceOf(Date);
  });

  it("clears the previous error after a later success", async () => {
    const t = await createTenant();
    const created = await connect(t);
    provider.test = async () => ({ ok: false, message: "Authentication failed" });
    await asOwner(t, (scope) => testIntegration(scope, created.id));

    provider.test = async () => ({ ok: true });
    expect(await asOwner(t, (scope) => testIntegration(scope, created.id))).toMatchObject({ status: "connected", lastError: null });
  });

  it("answers an unknown id with not found and never calls the provider", async () => {
    const t = await createTenant();
    await expect(asOwner(t, (scope) => testIntegration(scope, randomId()))).rejects.toBeInstanceOf(NotFoundError);
    expect(provider.calls).toEqual([]);
  });
});

describe("default connection", () => {
  it("moves the default within a category and leaves other categories alone", async () => {
    const t = await createTenant();
    const first = await connect(t, { label: "First" });
    const second = await connect(t, { label: "Second" });
    const maps = await connect(t, { provider: FAKE_MAPS });

    await asOwner(t, (scope) => setDefaultIntegration(scope, second.id));

    const list = await asOwner(t, listIntegrations);
    expect(Object.fromEntries(list.map((view) => [view.id, view.isDefault]))).toEqual({
      [first.id]: false,
      [second.id]: true,
      [maps.id]: true,
    });
    expect((await resolveMail(t)).id).toBe(second.id);
  });

  it("is a no-op when the connection is already the default", async () => {
    const t = await createTenant();
    const first = await connect(t);
    await asOwner(t, (scope) => setDefaultIntegration(scope, first.id));
    expect((await asOwner(t, (scope) => getIntegration(scope, first.id))).isDefault).toBe(true);
  });

  it("answers an unknown id with not found and keeps the current default", async () => {
    const t = await createTenant();
    const first = await connect(t);
    await expect(asOwner(t, (scope) => setDefaultIntegration(scope, randomId()))).rejects.toBeInstanceOf(NotFoundError);
    expect((await resolveMail(t)).id).toBe(first.id);
  });

  it("makes the next new connection the default after the default was deleted", async () => {
    const t = await createTenant();
    const first = await connect(t, { label: "First" });
    await asOwner(t, (scope) => deleteIntegration(scope, first.id));
    const replacement = await connect(t, { label: "Replacement" });
    expect(replacement.isDefault).toBe(true);
    expect((await resolveMail(t)).id).toBe(replacement.id);
  });
});

describe("setIntegrationEnabled", () => {
  it("disables a connection so it no longer resolves, and re-enables it as untested", async () => {
    const t = await createTenant();
    const created = await connect(t);
    await asOwner(t, (scope) => testIntegration(scope, created.id));

    const disabled = await asOwner(t, (scope) => setIntegrationEnabled(scope, created.id, false));
    expect(disabled.status).toBe("disabled");
    await expect(resolveMail(t)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    await expect(resolveMail(t, created.id)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);

    const enabled = await asOwner(t, (scope) => setIntegrationEnabled(scope, created.id, true));
    expect(enabled.status).toBe("untested");
    expect((await resolveMail(t)).secrets).toEqual(SECRETS);
  });

  it("answers an unknown id with not found", async () => {
    const t = await createTenant();
    await expect(asOwner(t, (scope) => setIntegrationEnabled(scope, randomId(), false))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteIntegration", () => {
  it("removes the connection and its ciphertext", async () => {
    const t = await createTenant();
    const created = await connect(t);

    await asOwner(t, (scope) => deleteIntegration(scope, created.id));

    expect(await storedIntegration(created.id)).toBeNull();
    expect(await asOwner(t, listIntegrations)).toEqual([]);
    await expect(asOwner(t, (scope) => getIntegration(scope, created.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(resolveMail(t)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    await expect(asOwner(t, (scope) => deleteIntegration(scope, created.id))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps media uploaded through it, without the link to the removed credentials", async () => {
    const t = await createTenant();
    const created = await connect(t);
    const publicId = unique("asset");
    await asOwner(t, ({ tx }) =>
      tx.insert(mediaAssets).values({
        storageOwner: "tenant",
        integrationId: created.id,
        provider: FAKE_MAIL,
        publicId,
        resourceType: "image",
        url: `https://cdn.fake-provider.test/${publicId}.jpg`,
      }),
    );

    await asOwner(t, (scope) => deleteIntegration(scope, created.id));

    const assets = await asOwner(t, ({ tx }) =>
      tx
        .select({ publicId: mediaAssets.publicId, integrationId: mediaAssets.integrationId })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.tenantId, t.tenantId), eq(mediaAssets.publicId, publicId))),
    );
    expect(assets).toEqual([{ publicId, integrationId: null }]);
  });

  it("answers an unknown id with not found", async () => {
    const t = await createTenant();
    await expect(asOwner(t, (scope) => deleteIntegration(scope, randomId()))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("resolveIntegration", () => {
  it("returns the decrypted credentials of the default connection", async () => {
    const t = await createTenant();
    const created = await connect(t);
    expect(await resolveMail(t)).toEqual({ id: created.id, provider: FAKE_MAIL, config: CONFIG, secrets: SECRETS });
  });

  it("works on a storefront scope with no signed-in user", async () => {
    const t = await createTenant();
    const created = await connect(t);
    const resolved = await withTenant(t.tenantId, (scope) => resolveIntegration(scope, "email"));
    expect(resolved).toMatchObject({ id: created.id, secrets: SECRETS });
  });

  it("throws IntegrationNotConfiguredError when nothing is connected", async () => {
    const t = await createTenant();
    const error = (await rejection(resolveMail(t))) as IntegrationNotConfiguredError;
    expect(error).toBeInstanceOf(IntegrationNotConfiguredError);
    expect(error).toMatchObject({ code: "integration_not_configured", status: 409, category: "email" });
    expect(error.message).toBe("Connect a email integration in Settings → Integrations first.");
  });

  it("does not use a connection from another category", async () => {
    const t = await createTenant();
    const maps = await connect(t, { provider: FAKE_MAPS });
    await expect(resolveMail(t)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    await expect(resolveMail(t, maps.id)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    expect((await asOwner(t, (scope) => resolveIntegration(scope, "maps"))).id).toBe(maps.id);
  });

  it("resolves a named connection that is not the default", async () => {
    const t = await createTenant();
    await connect(t, { label: "First" });
    const second = await connect(t, { label: "Second", secrets: { apiKey: "second-KEY-aaaabbbbcccc", apiSecret: "second-SECRET-ddddeeeeffff" } });

    const resolved = await resolveMail(t, second.id);
    expect(resolved.id).toBe(second.id);
    expect(resolved.secrets).toEqual({ apiKey: "second-KEY-aaaabbbbcccc", apiSecret: "second-SECRET-ddddeeeeffff" });
    await expect(resolveMail(t, randomId())).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });

  it("does not fall back to another connection when the default is disabled", async () => {
    const t = await createTenant();
    const first = await connect(t, { label: "First" });
    await connect(t, { label: "Second" });
    await asOwner(t, (scope) => setIntegrationEnabled(scope, first.id, false));
    await expect(resolveMail(t)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });

  it("leaves a ciphertext written under the active key untouched", async () => {
    const t = await createTenant();
    const created = await connect(t);
    const before = await storedIntegration(created.id);
    await resolveMail(t);
    const after = await storedIntegration(created.id);
    expect(after!.secretCiphertext).toBe(before!.secretCiphertext);
    expect(after!.keyVersion).toBe("v2");
  });
});

describe("key rotation", () => {
  it("re-encrypts a row written under an old key the next time it is resolved", async () => {
    const t = await createTenant();
    switchKeys("v1");
    const created = await connect(t);
    const old = await storedIntegration(created.id);
    expect(old!.keyVersion).toBe("v1");

    switchKeys("v2");
    expect((await resolveMail(t)).secrets).toEqual(SECRETS);

    const rotated = await storedIntegration(created.id);
    expect(rotated!.keyVersion).toBe("v2");
    expect(rotated!.secretCiphertext).not.toBe(old!.secretCiphertext);
    expectNoSecrets(rotated);

    // v1 can now be retired: the row no longer depends on it.
    switchKeys("v2", keysWithoutV1());
    expect((await resolveMail(t)).secrets).toEqual(SECRETS);
    expect((await storedIntegration(created.id))!.secretCiphertext).toBe(rotated!.secretCiphertext);
  });

  it("cannot read an unrotated row once its key is gone, and says nothing about why", async () => {
    const t = await createTenant();
    switchKeys("v1");
    await connect(t);

    switchKeys("v2", keysWithoutV1());
    const error = await rejection(resolveMail(t));
    expect(error).toBeInstanceOf(SecretDecryptionError);
    expect(error.message).toBe("Stored credential could not be decrypted");
    expectNoSecrets({ message: error.message, error });
  });

  it("rotates every outdated connection of the tenant, and only those", async () => {
    const t = await createTenant();
    const other = await createTenant();
    switchKeys("v1");
    const first = await connect(t, { label: "First" });
    const maps = await connect(t, { provider: FAKE_MAPS });
    const foreign = await connect(other);
    switchKeys("v2");
    const current = await connect(t, { label: "Current" });
    const currentBefore = await storedIntegration(current.id);

    expect(await asOwner(t, rotateTenantIntegrationKeys)).toBe(2);

    for (const id of [first.id, maps.id, current.id]) expect((await storedIntegration(id))!.keyVersion).toBe("v2");
    expect((await storedIntegration(current.id))!.secretCiphertext).toBe(currentBefore!.secretCiphertext);
    expect((await resolveMail(t, first.id)).secrets).toEqual(SECRETS);
    expect((await asOwner(t, (scope) => resolveIntegration(scope, "maps"))).secrets).toEqual(SECRETS);
    // Another tenant's rows are not this tenant's to rotate.
    expect((await storedIntegration(foreign.id))!.keyVersion).toBe("v1");

    expect(await asOwner(t, rotateTenantIntegrationKeys)).toBe(0);
  });

  it("keeps hints, status and settings when rotating keys", async () => {
    const t = await createTenant();
    switchKeys("v1");
    const created = await connect(t);
    await asOwner(t, (scope) => testIntegration(scope, created.id));
    switchKeys("v2");
    await asOwner(t, rotateTenantIntegrationKeys);

    expect(await asOwner(t, (scope) => getIntegration(scope, created.id))).toMatchObject({
      status: "connected",
      config: CONFIG,
      secretHints: created.secretHints,
      isDefault: true,
    });
  });
});

describe("integration audit trail", () => {
  it("records every change with field names only, never values", async () => {
    const t = await createTenant();
    const created = await connect(t, { label: "Primary" });
    await connect(t, { id: created.id, config: { host: "smtp2.fake-provider.test" }, secrets: {} });
    await connect(t, { id: created.id, secrets: { apiSecret: "rotated-SECRET-0099aabbccdd" } });
    provider.test = async (credentials) => {
      throw new Error(`rejected ${credentials.secrets.apiSecret}`);
    };
    await asOwner(t, (scope) => testIntegration(scope, created.id));
    await asOwner(t, (scope) => setDefaultIntegration(scope, created.id));
    await asOwner(t, (scope) => setIntegrationEnabled(scope, created.id, false));
    await asOwner(t, (scope) => setIntegrationEnabled(scope, created.id, true));
    const lastCiphertext = (await storedIntegration(created.id))!.secretCiphertext;
    await asOwner(t, (scope) => deleteIntegration(scope, created.id));

    const rows = await auditFor(t.tenantId);
    expect(rows.map((row) => row.action)).toEqual([
      "integration.created",
      "integration.updated",
      "integration.credentials_rotated",
      "integration.tested",
      "integration.default_changed",
      "integration.disabled",
      "integration.enabled",
      "integration.deleted",
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ tenantId: t.tenantId, actorType: "user", actorUserId: t.ownerId, targetType: "integration", targetId: created.id });
    }

    expect(rows[0]!.metadata).toEqual({ provider: FAKE_MAIL, label: "Primary", changedFields: ["apiKey", "apiSecret"] });
    expect(rows[1]!.metadata).toEqual({ provider: FAKE_MAIL, label: "Primary", changedFields: [] });
    expect(rows[2]!.metadata).toEqual({ provider: FAKE_MAIL, label: "Primary", changedFields: ["apiSecret"] });
    expect(rows[3]!.metadata).toEqual({ provider: FAKE_MAIL, ok: false });
    expect(rows[7]!.metadata).toEqual({ provider: FAKE_MAIL, label: "Primary" });

    expectNoSecrets(rows, ["rotated-SECRET-0099aabbccdd", lastCiphertext, "wf1."]);
  });

  it("attributes a change made without a signed-in user to the system", async () => {
    const t = await createTenant();
    const created = await withTenant(t.tenantId, (scope) =>
      saveIntegration(scope, { provider: FAKE_MAIL, config: { ...CONFIG }, secrets: { ...SECRETS } }),
    );
    const [row] = await auditFor(t.tenantId);
    expect(row).toMatchObject({ action: "integration.created", actorType: "system", actorUserId: null, targetId: created.id });
    expect((await storedIntegration(created.id))!.createdBy).toBeNull();
  });

  it("writes no audit row when the change is rejected", async () => {
    const t = await createTenant();
    await expect(connect(t, { config: { host: "" } })).rejects.toBeInstanceOf(ValidationError);
    await expect(asOwner(t, (scope) => deleteIntegration(scope, randomId()))).rejects.toBeInstanceOf(NotFoundError);
    expect(await auditFor(t.tenantId)).toEqual([]);
  });
});

describe("a disabled connection stays disabled", () => {
  const disable = (t: TenantFixture, id: string) => asOwner(t, (scope) => setIntegrationEnabled(scope, id, false));

  it("keeps its status when its settings are edited", async () => {
    const t = await createTenant();
    const created = await connect(t);
    await disable(t, created.id);

    const updated = await connect(t, { id: created.id, config: { host: "smtp2.fake-provider.test" }, secrets: {} });

    expect(updated).toMatchObject({ status: "disabled", config: { host: "smtp2.fake-provider.test" }, lastError: null });
    expect((await storedIntegration(created.id))!.status).toBe("disabled");
    await expect(resolveMail(t)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    await expect(resolveMail(t, created.id)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });

  it("keeps its status when its credentials are replaced", async () => {
    const t = await createTenant();
    const created = await connect(t);
    await disable(t, created.id);

    const updated = await connect(t, { id: created.id, secrets: { apiSecret: "rotated-SECRET-0099aabbccdd" } });

    expect(updated.status).toBe("disabled");
    expect(updated.rotatedAt).toBeInstanceOf(Date);
    await expect(resolveMail(t)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);

    // Only an explicit enable switches it back on, with the new credentials.
    expect((await asOwner(t, (scope) => setIntegrationEnabled(scope, created.id, true))).status).toBe("untested");
    expect((await resolveMail(t)).secrets).toEqual({ apiKey: SECRETS.apiKey, apiSecret: "rotated-SECRET-0099aabbccdd" });
  });

  it("still returns an enabled connection to untested on edit", async () => {
    const t = await createTenant();
    const created = await connect(t);
    await asOwner(t, (scope) => testIntegration(scope, created.id));
    expect((await connect(t, { id: created.id, secrets: {} })).status).toBe("untested");
  });

  it("records a successful test without switching the connection on", async () => {
    const t = await createTenant();
    const created = await connect(t);
    await disable(t, created.id);

    const before = Date.now();
    const view = await asOwner(t, (scope) => testIntegration(scope, created.id));

    expect(view).toMatchObject({ status: "disabled", lastError: null });
    expect(view.lastTestedAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    // The provider really was called with the stored credentials.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.credentials.secrets).toEqual(SECRETS);
    await expect(resolveMail(t)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);

    const actions = (await auditFor(t.tenantId)).map((row) => row.action);
    expect(actions).toEqual(["integration.created", "integration.disabled", "integration.tested"]);
  });

  it("records a failed test, redacted, without changing the status", async () => {
    const t = await createTenant();
    const created = await connect(t);
    await disable(t, created.id);
    provider.test = async (credentials) => ({ ok: false, message: `Key ${credentials.secrets.apiKey} was rejected` });

    const view = await asOwner(t, (scope) => testIntegration(scope, created.id));

    expect(view).toMatchObject({ status: "disabled", lastError: "Key [redacted] was rejected" });
    expect(view.lastTestedAt).toBeInstanceOf(Date);
    expect(await storedIntegration(created.id)).toMatchObject({ status: "disabled", lastError: "Key [redacted] was rejected" });
    expectNoSecrets(view);
  });

  it("clears a recorded test error when the disabled connection is edited", async () => {
    const t = await createTenant();
    const created = await connect(t);
    await disable(t, created.id);
    provider.test = async () => ({ ok: false, message: "Authentication failed" });
    await asOwner(t, (scope) => testIntegration(scope, created.id));

    expect(await connect(t, { id: created.id, secrets: {} })).toMatchObject({ status: "disabled", lastError: null });
  });
});

describe("deleting the default connection", () => {
  const defaults = async (t: TenantFixture) =>
    Object.fromEntries((await asOwner(t, listIntegrations)).map((view) => [view.label, view.isDefault]));

  it("promotes the oldest remaining connection in the same category", async () => {
    const t = await createTenant();
    const first = await connect(t, { label: "First" });
    const second = await connect(t, { label: "Second", secrets: { apiKey: "second-KEY-aaaabbbbcccc", apiSecret: "second-SECRET-ddddeeeeffff" } });
    await connect(t, { label: "Third" });

    await asOwner(t, (scope) => deleteIntegration(scope, first.id));

    expect(await defaults(t)).toEqual({ Second: true, Third: false });
    const resolved = await resolveMail(t);
    expect(resolved.id).toBe(second.id);
    expect(resolved.secrets).toEqual({ apiKey: "second-KEY-aaaabbbbcccc", apiSecret: "second-SECRET-ddddeeeeffff" });
  });

  it("skips disabled connections when choosing the new default", async () => {
    const t = await createTenant();
    const first = await connect(t, { label: "First" });
    const second = await connect(t, { label: "Second" });
    const third = await connect(t, { label: "Third" });
    await asOwner(t, (scope) => setIntegrationEnabled(scope, second.id, false));

    await asOwner(t, (scope) => deleteIntegration(scope, first.id));

    expect(await defaults(t)).toEqual({ Second: false, Third: true });
    expect((await resolveMail(t)).id).toBe(third.id);
  });

  it("promotes a connection whatever its test status, as long as it is switched on", async () => {
    const t = await createTenant();
    const first = await connect(t, { label: "First" });
    const failing = await connect(t, { label: "Failing" });
    provider.test = async () => ({ ok: false, message: "Authentication failed" });
    await asOwner(t, (scope) => testIntegration(scope, failing.id));

    await asOwner(t, (scope) => deleteIntegration(scope, first.id));
    expect(await defaults(t)).toEqual({ Failing: true });
  });

  it("leaves no default when only disabled connections remain", async () => {
    const t = await createTenant();
    const first = await connect(t, { label: "First" });
    const second = await connect(t, { label: "Second" });
    const third = await connect(t, { label: "Third" });
    await asOwner(t, (scope) => setIntegrationEnabled(scope, second.id, false));
    await asOwner(t, (scope) => setIntegrationEnabled(scope, third.id, false));

    await asOwner(t, (scope) => deleteIntegration(scope, first.id));

    expect(await defaults(t)).toEqual({ Second: false, Third: false });
    await expect(resolveMail(t)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    // The next connection added fills the vacancy.
    expect((await connect(t, { label: "Fresh" })).isDefault).toBe(true);
  });

  it("leaves nothing behind when the default was the only connection", async () => {
    const t = await createTenant();
    const only = await connect(t);
    await asOwner(t, (scope) => deleteIntegration(scope, only.id));
    expect(await asOwner(t, listIntegrations)).toEqual([]);
  });

  it("changes nothing when the deleted connection was not the default", async () => {
    const t = await createTenant();
    const first = await connect(t, { label: "First" });
    const second = await connect(t, { label: "Second" });
    await connect(t, { label: "Third" });

    await asOwner(t, (scope) => deleteIntegration(scope, second.id));

    expect(await defaults(t)).toEqual({ First: true, Third: false });
    expect((await resolveMail(t)).id).toBe(first.id);
  });

  it("only looks inside the deleted connection's own category", async () => {
    const t = await createTenant();
    const mail = await connect(t, { label: "Mail" });
    const maps = await connect(t, { provider: FAKE_MAPS, label: "Maps one" });
    const mapsBackup = await connect(t, { provider: FAKE_MAPS, label: "Maps two" });

    // Deleting the only e-mail connection must not disturb the maps default.
    await asOwner(t, (scope) => deleteIntegration(scope, mail.id));
    expect(await defaults(t)).toEqual({ "Maps one": true, "Maps two": false });
    await expect(resolveMail(t)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);

    await asOwner(t, (scope) => deleteIntegration(scope, maps.id));
    expect(await defaults(t)).toEqual({ "Maps two": true });
    expect((await asOwner(t, (scope) => resolveIntegration(scope, "maps"))).id).toBe(mapsBackup.id);
  });

  it("follows a default that was moved before the delete", async () => {
    const t = await createTenant();
    const first = await connect(t, { label: "First" });
    const second = await connect(t, { label: "Second" });
    await connect(t, { label: "Third" });
    await asOwner(t, (scope) => setDefaultIntegration(scope, second.id));

    await asOwner(t, (scope) => deleteIntegration(scope, second.id));

    expect(await defaults(t)).toEqual({ First: true, Third: false });
    expect((await resolveMail(t)).id).toBe(first.id);
  });

  it("never promotes another tenant's connection", async () => {
    const t = await createTenant();
    const other = await createTenant();
    const mine = await connect(t, { label: "Mine" });
    const theirs = await connect(other, { label: "Theirs" });
    const theirBackup = await connect(other, { label: "Their backup" });

    await asOwner(t, (scope) => deleteIntegration(scope, mine.id));

    expect(await asOwner(t, listIntegrations)).toEqual([]);
    expect(await storedIntegration(theirs.id)).toMatchObject({ isDefault: true, tenantId: other.tenantId });
    expect(await storedIntegration(theirBackup.id)).toMatchObject({ isDefault: false, tenantId: other.tenantId });
  });
});
