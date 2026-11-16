import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTenant } from "@/server/db/context";
import { auditLogs, integrations } from "@/server/db/schema";
import {
  INTEGRATION_CATEGORIES,
  ensureAdaptersRegistered,
  getAdapter,
  listAdapters,
  resolveIntegration,
  saveIntegration,
  testIntegration,
} from "@/server/integrations";
import { clearAdapters } from "@/server/integrations/registry";
import { createTenant } from "../../helpers/fixtures";
import { expectNoSecret, jsonResponse, stubFetch } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const BUILT_IN = ["cloudinary", "google_maps", "smtp", "stripe", "whatsapp"];

describe("adapter registration", () => {
  it("registers all five providers on import, one per category", () => {
    expect(listAdapters().map((adapter) => adapter.id).sort()).toEqual(BUILT_IN);
    expect(listAdapters().map((adapter) => adapter.category).sort()).toEqual(Object.keys(INTEGRATION_CATEGORIES).sort());
    expect(listAdapters("email").map((adapter) => adapter.id)).toEqual(["smtp"]);
  });

  it("is idempotent, and restores the providers after the registry is cleared", () => {
    ensureAdaptersRegistered();
    ensureAdaptersRegistered();
    expect(listAdapters()).toHaveLength(5);

    clearAdapters();
    expect(getAdapter("stripe")).toBeUndefined();
    ensureAdaptersRegistered();
    expect(listAdapters().map((adapter) => adapter.id).sort()).toEqual(BUILT_IN);
  });

  it("gives every provider a complete, consistent settings form", () => {
    for (const adapter of listAdapters()) {
      expect(adapter.name, adapter.id).toBeTruthy();
      expect(adapter.description, adapter.id).toBeTruthy();
      expect(adapter.docsUrl, adapter.id).toMatch(/^https:\/\//);
      expect(new Set(adapter.fields.map((field) => field.key)).size, adapter.id).toBe(adapter.fields.length);
      for (const field of adapter.fields) {
        expect(field.label, `${adapter.id}.${field.key}`).toBeTruthy();
        expect(field.help, `${adapter.id}.${field.key}`).toBeTruthy();
        // A masked input is only ever used for a value that is stored encrypted.
        if (field.type === "password") expect(field.secret, `${adapter.id}.${field.key}`).toBe(true);
        if (field.type === "select") expect(field.options?.length, `${adapter.id}.${field.key}`).toBeGreaterThan(0);
        // A field belongs to exactly one schema: the one its `secret` flag names.
        const probe = { [field.key]: "x" };
        const other = field.secret ? adapter.configSchema : adapter.secretSchema;
        const unknownKey = other.safeParse(probe).error?.issues.some((issue: { code: string }) => issue.code === "unrecognized_keys");
        expect(unknownKey, `${adapter.id}.${field.key}`).toBe(true);
      }
    }
  });
});

describe("adapters behind the integration service", () => {
  const cases = [
    {
      provider: "cloudinary",
      category: "media",
      config: { cloudName: "caspian-trails", uploadFolder: "wayfold" },
      secrets: { apiKey: "731946285012345", apiSecret: "Qx7_secretValue-abc123XYZ" },
      success: () => jsonResponse(200, { plan: "Free" }),
    },
    {
      provider: "stripe",
      category: "payments",
      config: { currency: "usd", mode: "test" },
      secrets: { secretKey: ["sk", "test", "51WayfoldFakeKeyForTests0000"].join("_"), webhookSecret: ["whsec", "WayfoldFakeSigningSecret2222"].join("_") },
      success: () => jsonResponse(200, { object: "balance", livemode: false }),
    },
    {
      provider: "google_maps",
      category: "maps",
      config: {},
      secrets: { apiKey: "AIzaWayfoldFakeKeyForTests_0123456789-ab" },
      success: () => jsonResponse(200, { status: "OK", results: [] }),
    },
  ] as const;

  for (const testCase of cases) {
    it(`saves, tests and resolves a ${testCase.provider} connection without exposing its secrets`, async () => {
      const tenant = await createTenant();
      const secretValues = Object.values(testCase.secrets);

      const saved = await withTenant(
        tenant.tenantId,
        (scope) => saveIntegration(scope, { provider: testCase.provider, config: { ...testCase.config }, secrets: { ...testCase.secrets } }),
        { userId: tenant.ownerId },
      );
      expect(saved).toMatchObject({ provider: testCase.provider, category: testCase.category, status: "untested", isDefault: true });
      expect(Object.keys(saved.secretHints).sort()).toEqual(Object.keys(testCase.secrets).sort());
      expectNoSecret(saved, secretValues);

      stubFetch(testCase.success());
      const connected = await withTenant(tenant.tenantId, (scope) => testIntegration(scope, saved.id), { userId: tenant.ownerId });
      expect(connected).toMatchObject({ status: "connected", lastError: null });

      // A rejection that echoes every secret back must not reach the database.
      stubFetch(jsonResponse(400, { status: "REQUEST_DENIED", error_message: secretValues.join(" "), error: { message: secretValues.join(" ") } }));
      const failed = await withTenant(tenant.tenantId, (scope) => testIntegration(scope, saved.id), { userId: tenant.ownerId });
      expect(failed.status).toBe("error");
      expect(failed.lastError).toBeTruthy();
      expectNoSecret(failed, secretValues);

      const stored = await withTenant(tenant.tenantId, async ({ tx }) => ({
        rows: await tx.select().from(integrations).where(eq(integrations.id, saved.id)),
        audit: await tx.select().from(auditLogs),
      }));
      expectNoSecret(stored, secretValues);

      const resolved = await withTenant(tenant.tenantId, (scope) => resolveIntegration(scope, testCase.category));
      expect(resolved.secrets).toEqual(testCase.secrets);
    });
  }

  it("retries a transient provider failure once and then records it", async () => {
    const tenant = await createTenant();
    const saved = await withTenant(tenant.tenantId, (scope) =>
      saveIntegration(scope, { provider: "stripe", config: {}, secrets: { secretKey: ["sk", "test", "51WayfoldFakeKeyForTests0000"].join("_") } }),
    );

    const fetchMock = stubFetch(jsonResponse(503, {}));
    const failed = await withTenant(tenant.tenantId, (scope) => testIntegration(scope, saved.id));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(failed).toMatchObject({ status: "error", lastError: "Stripe is temporarily unavailable (HTTP 503). Please try again in a moment." });

    // A transient failure followed by an answer counts as connected.
    const recovering = stubFetch(jsonResponse(503, {}), jsonResponse(200, { livemode: false }));
    const recovered = await withTenant(tenant.tenantId, (scope) => testIntegration(scope, saved.id));
    expect(recovering).toHaveBeenCalledTimes(2);
    expect(recovered.status).toBe("connected");
  });

  it("saves and tests a WhatsApp number, which has no secrets", async () => {
    const tenant = await createTenant();
    const saved = await withTenant(tenant.tenantId, (scope) =>
      saveIntegration(scope, { provider: "whatsapp", config: { phoneNumber: "+994 50 123 45 67" }, secrets: {} }),
    );
    expect(saved).toMatchObject({ category: "messaging", config: { phoneNumber: "+994501234567" }, secretHints: {} });

    const tested = await withTenant(tenant.tenantId, (scope) => testIntegration(scope, saved.id));
    expect(tested.status).toBe("connected");
  });

  it("turns provider validation into field errors", async () => {
    const tenant = await createTenant();
    await expect(
      withTenant(tenant.tenantId, (scope) =>
        saveIntegration(scope, { provider: "smtp", config: { host: "localhost", port: 465, secure: false }, secrets: { username: "u" } }),
      ),
    ).rejects.toMatchObject({ code: "validation", fieldErrors: { host: expect.any(Array) } });

    await expect(
      withTenant(tenant.tenantId, (scope) => saveIntegration(scope, { provider: "stripe", config: {}, secrets: { secretKey: "pk_test_abcdefgh1234" } })),
    ).rejects.toMatchObject({ code: "validation", fieldErrors: { secretKey: [expect.stringMatching(/publishable/)] } });
  });
});
