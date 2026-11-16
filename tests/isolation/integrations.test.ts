import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecretDecryptionError } from "@/server/crypto/secret-box";
import { withTenant, type TenantScope } from "@/server/db/context";
import { integrations } from "@/server/db/schema";
import { LimitExceededError, NotFoundError } from "@/server/errors";
import {
  deleteIntegration,
  getIntegration,
  IntegrationNotConfiguredError,
  listIntegrations,
  resolveIntegration,
  rotateTenantIntegrationKeys,
  saveIntegration,
  setDefaultIntegration,
  setIntegrationEnabled,
  testIntegration,
  type SaveIntegrationInput,
} from "@/server/integrations/service";
import { withPlatform } from "@/server/platform/db";
import { createTenant, randomId, type TenantFixture } from "../helpers/fixtures";
import {
  auditFor,
  CONFIG,
  FAKE_MAIL,
  installFakeProviders,
  rejection,
  restoreKeys,
  storedIntegration,
  switchKeys,
} from "../integration/foundation/support";

const provider = installFakeProviders();

beforeEach(() => {
  provider.reset();
});

afterEach(() => {
  restoreKeys();
});

const A_SECRETS = { apiKey: "tenantA-APIKEY-1a2b3c4d5e6f", apiSecret: "tenantA-APISECRET-6f5e4d3c2b1a" };
const B_SECRETS = { apiKey: "tenantB-APIKEY-9z8y7x6w5v4u", apiSecret: "tenantB-APISECRET-4u5v6w7x8y9z" };

const as = <T>(t: TenantFixture, fn: (scope: TenantScope) => Promise<T>) => withTenant(t.tenantId, fn, { userId: t.ownerId });

const connect = (t: TenantFixture, secrets: Record<string, string>, overrides: Partial<SaveIntegrationInput> = {}) =>
  as(t, (scope) => saveIntegration(scope, { provider: FAKE_MAIL, config: { ...CONFIG }, secrets: { ...secrets }, ...overrides }));

function expectNothingOfA(value: unknown): void {
  const rendered = JSON.stringify(value) ?? "";
  for (const secret of [A_SECRETS.apiKey, A_SECRETS.apiSecret, "tenantA-"]) expect(rendered).not.toContain(secret);
}

async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(NotFoundError);
  expect(error.message).toBe("Integration not found.");
  expectNothingOfA({ message: error.message, error });
}

describe("integration isolation: tenant B against tenant A's connection", () => {
  it("does not list it", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const mine = await connect(a, A_SECRETS);

    expect(await as(b, listIntegrations)).toEqual([]);

    const own = await connect(b, B_SECRETS);
    const list = await as(b, listIntegrations);
    expect(list.map((view) => view.id)).toEqual([own.id]);
    expect(list.map((view) => view.id)).not.toContain(mine.id);
    expectNothingOfA(list);
  });

  it("cannot get it by id", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const target = await connect(a, A_SECRETS);
    await expectNotFound(as(b, (scope) => getIntegration(scope, target.id)));
  });

  it("gets the same answer for a foreign id as for an id that does not exist", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const target = await connect(a, A_SECRETS);

    const foreign = (await rejection(as(b, (scope) => getIntegration(scope, target.id)))) as NotFoundError;
    const missing = (await rejection(as(b, (scope) => getIntegration(scope, randomId())))) as NotFoundError;
    expect({ name: foreign.name, code: foreign.code, status: foreign.status, message: foreign.message }).toEqual({
      name: missing.name,
      code: missing.code,
      status: missing.status,
      message: missing.message,
    });
  });

  it("cannot update it, and the attempt creates nothing in B", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const target = await connect(a, A_SECRETS);
    const before = await storedIntegration(target.id);

    await expectNotFound(connect(b, B_SECRETS, { id: target.id, config: { host: "attacker.example.test" } }));
    // Blank secrets would mean "keep the stored ones": still not found.
    await expectNotFound(connect(b, {}, { id: target.id }));

    expect(await storedIntegration(target.id)).toEqual(before);
    expect(await as(b, listIntegrations)).toEqual([]);
    expect((await as(a, (scope) => resolveIntegration(scope, "email"))).secrets).toEqual(A_SECRETS);
  });

  it("cannot test it, and the provider is never called with A's credentials", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const target = await connect(a, A_SECRETS);

    await expectNotFound(as(b, (scope) => testIntegration(scope, target.id)));

    expect(provider.calls).toEqual([]);
    expect(await storedIntegration(target.id)).toMatchObject({ status: "untested", lastTestedAt: null });
  });

  it("cannot make it a default, disable it or enable it", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const target = await connect(a, A_SECRETS);

    await expectNotFound(as(b, (scope) => setDefaultIntegration(scope, target.id)));
    await expectNotFound(as(b, (scope) => setIntegrationEnabled(scope, target.id, false)));
    await expectNotFound(as(b, (scope) => setIntegrationEnabled(scope, target.id, true)));

    expect(await storedIntegration(target.id)).toMatchObject({ status: "untested", isDefault: true });
  });

  it("cannot delete it", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const target = await connect(a, A_SECRETS);

    await expectNotFound(as(b, (scope) => deleteIntegration(scope, target.id)));

    expect(await storedIntegration(target.id)).not.toBeNull();
    expect((await as(a, (scope) => resolveIntegration(scope, "email"))).id).toBe(target.id);
  });

  it("cannot resolve it by id", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const target = await connect(a, A_SECRETS);

    const error = await rejection(as(b, (scope) => resolveIntegration(scope, "email", { integrationId: target.id })));
    expect(error).toBeInstanceOf(IntegrationNotConfiguredError);
    expectNothingOfA({ message: error.message, error });
  });

  it("leaves no trace of the attempts in either audit log", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const target = await connect(a, A_SECRETS);

    await rejection(as(b, (scope) => testIntegration(scope, target.id)));
    await rejection(as(b, (scope) => deleteIntegration(scope, target.id)));

    expect(await auditFor(b.tenantId)).toEqual([]);
    expect((await auditFor(a.tenantId)).map((row) => row.action)).toEqual(["integration.created"]);
  });

  it("cannot reach it through a scope that lies about its tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const target = await connect(a, A_SECRETS);

    // The query now asks for A's rows, but the transaction is B's: row-level
    // security is the second fence and still returns nothing.
    const forged = <T>(fn: (scope: TenantScope) => Promise<T>) => as(b, (scope) => fn({ ...scope, tenantId: a.tenantId }));

    expect(await forged(listIntegrations)).toEqual([]);
    await expectNotFound(forged((scope) => getIntegration(scope, target.id)));
    await expectNotFound(forged((scope) => testIntegration(scope, target.id)));
    await expectNotFound(forged((scope) => deleteIntegration(scope, target.id)));
    await expect(forged((scope) => resolveIntegration(scope, "email"))).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    await expect(forged((scope) => resolveIntegration(scope, "email", { integrationId: target.id }))).rejects.toBeInstanceOf(
      IntegrationNotConfiguredError,
    );
    expect(await forged(rotateTenantIntegrationKeys)).toBe(0);
    expect(await storedIntegration(target.id)).not.toBeNull();
    expect(provider.calls).toEqual([]);
  });
});

describe("integration isolation: resolving credentials", () => {
  it("never returns A's credentials to B when B has nothing configured", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const target = await connect(a, A_SECRETS);

    for (const options of [{}, { integrationId: target.id }]) {
      const error = (await rejection(as(b, (scope) => resolveIntegration(scope, "email", options)))) as IntegrationNotConfiguredError;
      expect(error).toBeInstanceOf(IntegrationNotConfiguredError);
      expect(error.category).toBe("email");
      expectNothingOfA({ message: error.message, error });
    }
    // Also on a storefront scope with no user at all.
    await expect(withTenant(b.tenantId, (scope) => resolveIntegration(scope, "email"))).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });

  it("does not fall back to A when B's only connection is disabled", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await connect(a, A_SECRETS);
    const own = await connect(b, B_SECRETS);
    await as(b, (scope) => setIntegrationEnabled(scope, own.id, false));

    await expect(as(b, (scope) => resolveIntegration(scope, "email"))).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });

  it("gives each tenant its own credentials for the same provider and name", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const inA = await connect(a, A_SECRETS, { label: "Primary" });
    const inB = await connect(b, B_SECRETS, { label: "Primary" });

    // Interleave to show nothing is cached across tenants.
    for (let i = 0; i < 3; i++) {
      expect(await as(a, (scope) => resolveIntegration(scope, "email"))).toMatchObject({ id: inA.id, secrets: A_SECRETS });
      expect(await as(b, (scope) => resolveIntegration(scope, "email"))).toMatchObject({ id: inB.id, secrets: B_SECRETS });
    }
    const [fromA, fromB] = await Promise.all([
      as(a, (scope) => resolveIntegration(scope, "email")),
      as(b, (scope) => resolveIntegration(scope, "email")),
    ]);
    expect(fromA.secrets).toEqual(A_SECRETS);
    expect(fromB.secrets).toEqual(B_SECRETS);
  });

  it("hands the provider only the calling tenant's credentials when testing", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await connect(a, A_SECRETS);
    const own = await connect(b, B_SECRETS);

    await as(b, (scope) => testIntegration(scope, own.id));

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.credentials.secrets).toEqual(B_SECRETS);
    expectNothingOfA(provider.calls.map((call) => call.credentials));
  });

  it("encrypts identical secrets differently for each tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const inA = await storedIntegration((await connect(a, A_SECRETS)).id);
    const inB = await storedIntegration((await connect(b, A_SECRETS)).id);
    expect(inA!.secretCiphertext).not.toBe(inB!.secretCiphertext);
    expect(inA!.secretCiphertext.split(".")[3]).not.toBe(inB!.secretCiphertext.split(".")[3]);
  });
});

describe("integration isolation: a database-level mix-up", () => {
  it("fails to decrypt when A's ciphertext is copied onto B's row", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const source = await storedIntegration((await connect(a, A_SECRETS)).id);
    const victim = await connect(b, B_SECRETS);

    await withPlatform((tx) =>
      tx
        .update(integrations)
        .set({ secretCiphertext: source!.secretCiphertext, keyVersion: source!.keyVersion })
        .where(eq(integrations.id, victim.id)),
    );

    const error = await rejection(as(b, (scope) => resolveIntegration(scope, "email")));
    expect(error).toBeInstanceOf(SecretDecryptionError);
    expect(error.message).toBe("Stored credential could not be decrypted");
    expectNothingOfA({ message: error.message, error });

    // Every other path that would decrypt refuses as well.
    await expect(as(b, (scope) => resolveIntegration(scope, "email", { integrationId: victim.id }))).rejects.toBeInstanceOf(SecretDecryptionError);
    await expect(as(b, (scope) => testIntegration(scope, victim.id))).rejects.toBeInstanceOf(SecretDecryptionError);
    await expect(connect(b, {}, { id: victim.id })).rejects.toBeInstanceOf(SecretDecryptionError);
    expect(provider.calls).toEqual([]);

    // The view still shows B's own hints and nothing of A.
    expectNothingOfA(await as(b, listIntegrations));
  });

  it("fails to decrypt when A's whole row is copied into B under a new id", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const source = await storedIntegration((await connect(a, A_SECRETS)).id);

    const [clone] = await withPlatform((tx) =>
      tx
        .insert(integrations)
        .values({
          tenantId: b.tenantId,
          provider: source!.provider,
          category: source!.category,
          label: source!.label,
          isDefault: true,
          config: source!.config,
          secretCiphertext: source!.secretCiphertext,
          keyVersion: source!.keyVersion,
          secretHints: source!.secretHints,
        })
        .returning({ id: integrations.id }),
    );

    await expect(as(b, (scope) => resolveIntegration(scope, "email"))).rejects.toBeInstanceOf(SecretDecryptionError);
    await expect(as(b, (scope) => testIntegration(scope, clone!.id))).rejects.toBeInstanceOf(SecretDecryptionError);
    expect(provider.calls).toEqual([]);
  });

  it("fails to decrypt when A's row is moved to B with its id intact", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const target = await connect(a, A_SECRETS);

    await withPlatform((tx) => tx.update(integrations).set({ tenantId: b.tenantId }).where(eq(integrations.id, target.id)));

    // B can now see the row, but the ciphertext is still bound to tenant A.
    expect((await as(b, listIntegrations)).map((view) => view.id)).toEqual([target.id]);
    const error = await rejection(as(b, (scope) => resolveIntegration(scope, "email")));
    expect(error).toBeInstanceOf(SecretDecryptionError);
    expectNothingOfA({ message: error.message, error });
    await expect(as(b, rotateTenantIntegrationKeys)).resolves.toBe(0);
  });

  it("fails to decrypt a ciphertext swapped between two rows of the same tenant", async () => {
    const a = await createTenant();
    const first = await connect(a, A_SECRETS, { label: "First" });
    const second = await connect(a, B_SECRETS, { label: "Second" });
    const source = await storedIntegration(first.id);

    await withPlatform((tx) => tx.update(integrations).set({ secretCiphertext: source!.secretCiphertext }).where(eq(integrations.id, second.id)));

    await expect(as(a, (scope) => resolveIntegration(scope, "email", { integrationId: second.id }))).rejects.toBeInstanceOf(SecretDecryptionError);
    // The untouched row is unaffected.
    expect((await as(a, (scope) => resolveIntegration(scope, "email", { integrationId: first.id }))).secrets).toEqual(A_SECRETS);
  });

  it("does not rotate a mixed-up ciphertext into a valid one for B", async () => {
    const a = await createTenant();
    const b = await createTenant();
    switchKeys("v1");
    const source = await storedIntegration((await connect(a, A_SECRETS)).id);
    const victim = await connect(b, B_SECRETS);
    await withPlatform((tx) =>
      tx
        .update(integrations)
        .set({ secretCiphertext: source!.secretCiphertext, keyVersion: source!.keyVersion })
        .where(eq(integrations.id, victim.id)),
    );

    switchKeys("v2");
    await expect(as(b, rotateTenantIntegrationKeys)).rejects.toBeInstanceOf(SecretDecryptionError);
    await expect(as(b, (scope) => resolveIntegration(scope, "email"))).rejects.toBeInstanceOf(SecretDecryptionError);
    // The failed rotation changed nothing.
    expect(await storedIntegration(victim.id)).toMatchObject({ keyVersion: "v1", secretCiphertext: source!.secretCiphertext });
  });
});

describe("integration isolation: housekeeping stays inside the tenant", () => {
  it("rotates only the calling tenant's keys", async () => {
    const a = await createTenant();
    const b = await createTenant();
    switchKeys("v1");
    const inA = await connect(a, A_SECRETS);
    const inB = await connect(b, B_SECRETS);
    const before = await storedIntegration(inA.id);

    switchKeys("v2");
    expect(await as(b, rotateTenantIntegrationKeys)).toBe(1);

    expect((await storedIntegration(inB.id))!.keyVersion).toBe("v2");
    expect(await storedIntegration(inA.id)).toEqual(before);
  });

  it("applies each tenant's own plan when connecting", async () => {
    const a = await createTenant();
    const b = await createTenant({ plan: { features: { integrations: [] } } });
    await connect(a, A_SECRETS);

    await expect(connect(b, B_SECRETS)).rejects.toBeInstanceOf(LimitExceededError);
    expect(await as(b, listIntegrations)).toEqual([]);
  });

  it("keeps each tenant's integration audit entries to itself", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const inA = await connect(a, A_SECRETS);
    const inB = await connect(b, B_SECRETS);

    expect((await auditFor(a.tenantId)).map((row) => row.targetId)).toEqual([inA.id]);
    expect((await auditFor(b.tenantId)).map((row) => row.targetId)).toEqual([inB.id]);
  });

  it("lets both tenants manage a default without disturbing the other", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const inA = await connect(a, A_SECRETS);
    const firstB = await connect(b, B_SECRETS, { label: "First" });
    const secondB = await connect(b, B_SECRETS, { label: "Second" });

    await as(b, (scope) => setDefaultIntegration(scope, secondB.id));
    await as(b, (scope) => deleteIntegration(scope, firstB.id));

    expect(await storedIntegration(inA.id)).toMatchObject({ isDefault: true, status: "untested" });
    expect((await as(a, (scope) => resolveIntegration(scope, "email"))).secrets).toEqual(A_SECRETS);
  });
});
