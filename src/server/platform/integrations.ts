import "server-only";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { maskSecret, needsRotation, openSecret, sealSecret, type SecretBinding } from "../crypto/secret-box";
import { platformIntegrations } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { retry, sanitiseProviderMessage, withTimeout } from "../integrations/http";
// The index registers the built-in providers as a side effect of being imported.
import { getAdapter, keyring, TEST_TIMEOUT_MS } from "../integrations";
import type { Credentials, ProviderAdapter, TestResult } from "../integrations/types";
import { asPlatform, type PlatformActor, type PlatformTx } from "./access";
import { recordPlatformAudit } from "./audit";
import { withPlatform } from "./db";

/** What the platform itself may connect: shared media storage and its own mailer. */
export const PLATFORM_INTEGRATION_CATEGORIES = ["media", "email"] as const;
export type PlatformIntegrationCategory = (typeof PLATFORM_INTEGRATION_CATEGORIES)[number];

/**
 * Key-derivation scope for platform credentials. It can never collide with a
 * tenant's scope, which is always a UUID, so a platform ciphertext cannot be
 * opened with any tenant's key or the other way round.
 */
const PLATFORM_KEY_SCOPE = "platform";

type Row = typeof platformIntegrations.$inferSelect;

/** What the platform settings screen receives. No ciphertext, no secret. */
export interface PlatformIntegrationView {
  id: string;
  provider: string;
  providerName: string;
  category: PlatformIntegrationCategory;
  status: "untested" | "connected" | "error" | "disabled";
  config: Record<string, unknown>;
  /** Masked previews keyed by secret field, e.g. `••••••••a1b2`. */
  secretHints: Record<string, string>;
  lastTestedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

export interface SavePlatformIntegrationInput {
  provider: string;
  config: Record<string, unknown>;
  /**
   * Secret field values. When the category already uses this provider, a
   * missing or empty value keeps the stored secret.
   */
  secrets: Record<string, string>;
}

export interface ResolvedPlatformIntegration {
  id: string;
  provider: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

function isPlatformCategory(value: unknown): value is PlatformIntegrationCategory {
  return (PLATFORM_INTEGRATION_CATEGORIES as readonly unknown[]).includes(value);
}

function requireCategory(value: unknown): asserts value is PlatformIntegrationCategory {
  if (!isPlatformCategory(value)) throw new NotFoundError("Integration");
}

function binding(row: Pick<Row, "id" | "provider">): SecretBinding {
  return { tenantId: PLATFORM_KEY_SCOPE, recordId: row.id, purpose: `integration:${row.provider}` };
}

function decryptSecrets(row: Row): Record<string, string> {
  const plaintext = openSecret(keyring(), binding(row), { ciphertext: row.secretCiphertext, keyVersion: row.keyVersion });
  return JSON.parse(plaintext) as Record<string, string>;
}

function requireAdapter(provider: string): ProviderAdapter<Record<string, unknown>, Record<string, string>> {
  const adapter = getAdapter(provider);
  if (!adapter) throw new ValidationError("That integration provider is not supported.");
  if (!isPlatformCategory(adapter.category)) {
    throw new ValidationError("The platform can only connect media storage and e-mail delivery.");
  }
  return adapter;
}

function fieldErrors(error: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function toView(row: Row): PlatformIntegrationView {
  return {
    id: row.id,
    provider: row.provider,
    providerName: getAdapter(row.provider)?.name ?? row.provider,
    category: row.category as PlatformIntegrationCategory,
    status: row.status,
    config: row.config,
    secretHints: row.secretHints,
    lastTestedAt: row.lastTestedAt,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

async function findRow(tx: PlatformTx, category: PlatformIntegrationCategory): Promise<Row | null> {
  const [row] = await tx.select().from(platformIntegrations).where(eq(platformIntegrations.category, category)).limit(1);
  return row ?? null;
}

async function requireRow(tx: PlatformTx, category: unknown): Promise<Row> {
  requireCategory(category);
  const row = await findRow(tx, category);
  if (!row) throw new NotFoundError("Integration");
  return row;
}

export async function listPlatformIntegrations(admin: PlatformActor): Promise<PlatformIntegrationView[]> {
  return asPlatform(admin, "support", async (tx) => {
    const rows = await tx.select().from(platformIntegrations).orderBy(asc(platformIntegrations.category));
    return rows.map(toView);
  });
}

/**
 * Connects (or re-configures) the provider for one platform category. There
 * is one connection per category; choosing a different provider replaces it
 * and needs the complete set of secrets.
 */
export async function savePlatformIntegration(admin: PlatformActor, input: SavePlatformIntegrationInput): Promise<PlatformIntegrationView> {
  return asPlatform(admin, "owner", async (tx) => {
    const adapter = requireAdapter(input.provider);
    const category = adapter.category as PlatformIntegrationCategory;

    const current = await findRow(tx, category);
    const existing = current?.provider === adapter.id ? current : null;

    const config = adapter.configSchema.safeParse(input.config);
    if (!config.success) throw new ValidationError(undefined, fieldErrors(config.error));

    const supplied = Object.fromEntries(
      Object.entries(input.secrets ?? {}).filter(([, value]) => typeof value === "string" && value !== ""),
    );
    const merged = existing ? { ...decryptSecrets(existing), ...supplied } : supplied;
    const secrets = adapter.secretSchema.safeParse(merged);
    if (!secrets.success) throw new ValidationError(undefined, fieldErrors(secrets.error));

    const id = existing?.id ?? randomUUID();
    const sealed = sealSecret(keyring(), binding({ id, provider: adapter.id }), JSON.stringify(secrets.data));
    const secretHints = Object.fromEntries(Object.entries(secrets.data).map(([key, value]) => [key, maskSecret(String(value))]));
    const values = {
      config: config.data,
      secretCiphertext: sealed.ciphertext,
      keyVersion: sealed.keyVersion,
      secretHints,
      // Editing a disabled connection must not quietly switch it back on.
      status: existing?.status === "disabled" ? ("disabled" as const) : ("untested" as const),
      lastError: null,
      lastTestedAt: null,
    };

    let row: Row;
    if (existing) {
      [row] = (await tx.update(platformIntegrations).set(values).where(eq(platformIntegrations.id, id)).returning()) as [Row];
    } else {
      // A different provider cannot reuse the old row: the ciphertext is bound to the row id and provider.
      if (current) await tx.delete(platformIntegrations).where(eq(platformIntegrations.id, current.id));
      [row] = (await tx
        .insert(platformIntegrations)
        .values({ id, provider: adapter.id, category, ...values })
        .returning()) as [Row];
    }

    await recordPlatformAudit(tx, {
      admin,
      action: existing ? "platform_integration.updated" : current ? "platform_integration.replaced" : "platform_integration.created",
      targetType: "platform_integration",
      targetId: id,
      // Field names only, never values. The key avoids the word "secret",
      // which the audit redactor would blank out wholesale.
      metadata: { provider: adapter.id, category, changedFields: Object.keys(supplied) },
    });
    return toView(row);
  });
}

/** Proves the stored credentials work with one provider call and records the outcome. */
export async function testPlatformIntegration(admin: PlatformActor, category: string): Promise<PlatformIntegrationView> {
  return asPlatform(admin, "owner", async (tx) => {
    const row = await requireRow(tx, category);
    const adapter = requireAdapter(row.provider);
    const secrets = decryptSecrets(row);
    const credentials: Credentials<Record<string, unknown>, Record<string, string>> = { config: row.config, secrets };

    let result: TestResult;
    try {
      result = await retry(() => withTimeout(TEST_TIMEOUT_MS, (signal) => adapter.test(credentials, signal)), { attempts: 2 });
    } catch (error) {
      result = { ok: false, message: sanitiseProviderMessage(error, Object.values(secrets)) };
    }
    const lastError = result.ok ? null : sanitiseProviderMessage(result.message, Object.values(secrets));

    const [updated] = (await tx
      .update(platformIntegrations)
      // A disabled connection can be tested, but only "Enable" turns it back on.
      .set({ status: row.status === "disabled" ? "disabled" : result.ok ? "connected" : "error", lastTestedAt: new Date(), lastError })
      .where(eq(platformIntegrations.id, row.id))
      .returning()) as [Row];

    await recordPlatformAudit(tx, {
      admin,
      action: "platform_integration.tested",
      targetType: "platform_integration",
      targetId: row.id,
      metadata: { provider: row.provider, category: row.category, ok: result.ok },
    });
    return toView(updated);
  });
}

/** Disabling keeps the credentials but stops every use of them until re-enabled. */
export async function setPlatformIntegrationEnabled(admin: PlatformActor, category: string, enabled: boolean): Promise<PlatformIntegrationView> {
  return asPlatform(admin, "owner", async (tx) => {
    const row = await requireRow(tx, category);
    const [updated] = (await tx
      .update(platformIntegrations)
      .set({ status: enabled ? "untested" : "disabled" })
      .where(eq(platformIntegrations.id, row.id))
      .returning()) as [Row];
    await recordPlatformAudit(tx, {
      admin,
      action: enabled ? "platform_integration.enabled" : "platform_integration.disabled",
      targetType: "platform_integration",
      targetId: row.id,
      metadata: { provider: row.provider, category: row.category },
    });
    return toView(updated);
  });
}

export async function deletePlatformIntegration(admin: PlatformActor, category: string): Promise<void> {
  await asPlatform(admin, "owner", async (tx) => {
    const row = await requireRow(tx, category);
    await tx.delete(platformIntegrations).where(eq(platformIntegrations.id, row.id));
    await recordPlatformAudit(tx, {
      admin,
      action: "platform_integration.deleted",
      targetType: "platform_integration",
      targetId: row.id,
      metadata: { provider: row.provider, category: row.category },
    });
  });
}

/**
 * System-only: decrypted credentials of the platform's connection for
 * `category`, or null when there is none or it is disabled. Never reaches a
 * client; callers are the managed-storage and mailer modules.
 */
export async function resolvePlatformIntegration(category: PlatformIntegrationCategory): Promise<ResolvedPlatformIntegration | null> {
  return withPlatform(async (tx) => {
    const row = await findRow(tx, category);
    if (!row || row.status === "disabled") return null;
    return { id: row.id, provider: row.provider, config: row.config, secrets: decryptSecrets(row) };
  });
}

/** System-only (key rotation script): re-encrypts platform credentials under the active key. */
export async function rotatePlatformIntegrationKeys(): Promise<number> {
  return withPlatform(async (tx) => {
    const rows = await tx.select().from(platformIntegrations);
    let rotated = 0;
    for (const row of rows) {
      if (!needsRotation(keyring(), row)) continue;
      const sealed = sealSecret(keyring(), binding(row), JSON.stringify(decryptSecrets(row)));
      await tx
        .update(platformIntegrations)
        .set({ secretCiphertext: sealed.ciphertext, keyVersion: sealed.keyVersion })
        .where(eq(platformIntegrations.id, row.id));
      rotated += 1;
    }
    return rotated;
  });
}
