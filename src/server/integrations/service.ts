import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { recordAudit } from "../audit";
import { assertIntegrationCategory } from "../billing/limits";
import { createKeyring, type Keyring } from "../crypto/keyring";
import { maskSecret, needsRotation, openSecret, sealSecret, type SecretBinding } from "../crypto/secret-box";
import type { TenantScope } from "../db/context";
import { integrations, mediaAssets } from "../db/schema";
import { env } from "../env";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../errors";
import { retry, sanitiseProviderMessage, withTimeout } from "./http";
import { getAdapter } from "./registry";
import type { Credentials, IntegrationCategory, IntegrationView, ProviderAdapter, TestResult } from "./types";

export const TEST_TIMEOUT_MS = 8_000;

export class IntegrationNotConfiguredError extends AppError {
  constructor(readonly category: IntegrationCategory) {
    super("integration_not_configured", `Connect a ${category} integration in Settings → Integrations first.`, 409);
  }
}

let keyringCache: Keyring | undefined;

/** The platform keyring. Built from infrastructure secrets; never exported to clients. */
export function keyring(): Keyring {
  keyringCache ??= createKeyring(env().CREDENTIAL_ENCRYPTION_KEYS, env().CREDENTIAL_ENCRYPTION_ACTIVE_KEY);
  return keyringCache;
}

/** Test hook. */
export function resetKeyring(): void {
  keyringCache = undefined;
}

type Row = typeof integrations.$inferSelect;

function binding(row: Pick<Row, "id" | "tenantId" | "provider">): SecretBinding {
  return { tenantId: row.tenantId, recordId: row.id, purpose: `integration:${row.provider}` };
}

function requireAdapter(provider: string): ProviderAdapter<Record<string, unknown>, Record<string, string>> {
  const adapter = getAdapter(provider);
  if (!adapter) throw new ValidationError("That integration provider is not supported.");
  return adapter;
}

function toView(row: Row): IntegrationView {
  return {
    id: row.id,
    provider: row.provider,
    providerName: getAdapter(row.provider)?.name ?? row.provider,
    category: row.category as IntegrationCategory,
    label: row.label,
    isDefault: row.isDefault,
    status: row.status,
    config: row.config,
    secretHints: row.secretHints,
    lastTestedAt: row.lastTestedAt,
    lastError: row.lastError,
    rotatedAt: row.rotatedAt,
    updatedAt: row.updatedAt,
  };
}

function fieldErrors(error: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function decryptSecrets(row: Row): Record<string, string> {
  const plaintext = openSecret(keyring(), binding(row), { ciphertext: row.secretCiphertext, keyVersion: row.keyVersion });
  return JSON.parse(plaintext) as Record<string, string>;
}

async function findRow(scope: TenantScope, id: string): Promise<Row> {
  const [row] = await scope.tx
    .select()
    .from(integrations)
    .where(and(eq(integrations.tenantId, scope.tenantId), eq(integrations.id, id)))
    .limit(1);
  // Same answer whether the id is unknown or belongs to another tenant.
  if (!row) throw new NotFoundError("Integration");
  return row;
}

export async function listIntegrations(scope: TenantScope): Promise<IntegrationView[]> {
  const rows = await scope.tx
    .select()
    .from(integrations)
    .where(eq(integrations.tenantId, scope.tenantId))
    .orderBy(integrations.category, integrations.createdAt);
  return rows.map(toView);
}

export async function getIntegration(scope: TenantScope, id: string): Promise<IntegrationView> {
  return toView(await findRow(scope, id));
}

export interface SaveIntegrationInput {
  /** Present when editing an existing connection. */
  id?: string;
  provider: string;
  label?: string;
  config: Record<string, unknown>;
  /**
   * Secret field values. When editing, a missing or empty value keeps the
   * stored secret, so the form never needs the old value sent to the browser.
   */
  secrets: Record<string, string>;
}

/**
 * Creates or updates a connection. Secrets are validated by the provider's
 * schema, then sealed with the tenant's key and bound to this exact row.
 * Takes effect immediately: nothing is cached across requests.
 */
export async function saveIntegration(scope: TenantScope, input: SaveIntegrationInput): Promise<IntegrationView> {
  const adapter = requireAdapter(input.provider);
  await assertIntegrationCategory(scope, adapter.category);

  const existing = input.id ? await findRow(scope, input.id) : null;
  if (existing && existing.provider !== adapter.id) throw new ValidationError("A connection cannot change provider.");

  const config = adapter.configSchema.safeParse(input.config);
  if (!config.success) throw new ValidationError(undefined, fieldErrors(config.error));

  const supplied = Object.fromEntries(Object.entries(input.secrets).filter(([, value]) => typeof value === "string" && value !== ""));
  const merged = existing ? { ...decryptSecrets(existing), ...supplied } : supplied;
  const secrets = adapter.secretSchema.safeParse(merged);
  if (!secrets.success) throw new ValidationError(undefined, fieldErrors(secrets.error));

  const label = (input.label ?? existing?.label ?? "Default").trim().slice(0, 60) || "Default";
  const id = existing?.id ?? randomUUID();
  const sealed = sealSecret(keyring(), { tenantId: scope.tenantId, recordId: id, purpose: `integration:${adapter.id}` }, JSON.stringify(secrets.data));
  const secretHints = Object.fromEntries(Object.entries(secrets.data).map(([key, value]) => [key, maskSecret(String(value))]));
  const secretsChanged = Object.keys(supplied).length > 0;

  const duplicate = await scope.tx
    .select({ id: integrations.id })
    .from(integrations)
    .where(
      and(
        eq(integrations.tenantId, scope.tenantId),
        eq(integrations.provider, adapter.id),
        eq(integrations.label, label),
        ne(integrations.id, id),
      ),
    )
    .limit(1);
  if (duplicate.length > 0) throw new ConflictError("A connection with that name already exists for this provider.");

  let row: Row;
  if (existing) {
    [row] = (await scope.tx
      .update(integrations)
      .set({
        label,
        config: config.data,
        secretCiphertext: sealed.ciphertext,
        keyVersion: sealed.keyVersion,
        secretHints,
        // Editing never switches a connection back on by itself.
        status: existing.status === "disabled" ? "disabled" : "untested",
        lastError: null,
        ...(secretsChanged ? { rotatedAt: new Date() } : {}),
      })
      .where(and(eq(integrations.tenantId, scope.tenantId), eq(integrations.id, id)))
      .returning()) as [Row];
  } else {
    const others = await scope.tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.tenantId, scope.tenantId), eq(integrations.category, adapter.category), eq(integrations.isDefault, true)))
      .limit(1);
    [row] = (await scope.tx
      .insert(integrations)
      .values({
        id,
        tenantId: scope.tenantId,
        provider: adapter.id,
        category: adapter.category,
        label,
        isDefault: others.length === 0,
        config: config.data,
        secretCiphertext: sealed.ciphertext,
        keyVersion: sealed.keyVersion,
        secretHints,
        createdBy: scope.userId,
      })
      .returning()) as [Row];
  }

  await recordAudit(scope, {
    action: existing ? (secretsChanged ? "integration.credentials_rotated" : "integration.updated") : "integration.created",
    targetType: "integration",
    targetId: id,
    // Field names only. Values never enter the audit log. The key must not
    // contain "secret": the audit redactor would blank the whole list.
    metadata: { provider: adapter.id, label, changedFields: Object.keys(supplied) },
  });
  return toView(row);
}

/**
 * Proves the stored credentials work with one provider call, under a timeout
 * with retries for transient failures, and records the outcome.
 */
export async function testIntegration(scope: TenantScope, id: string): Promise<IntegrationView> {
  const row = await findRow(scope, id);
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

  const [updated] = (await scope.tx
    .update(integrations)
    // A disabled connection can be tested, but only "Enable" turns it back on.
    .set({ status: row.status === "disabled" ? "disabled" : result.ok ? "connected" : "error", lastTestedAt: new Date(), lastError })
    .where(and(eq(integrations.tenantId, scope.tenantId), eq(integrations.id, id)))
    .returning()) as [Row];

  await recordAudit(scope, {
    action: "integration.tested",
    targetType: "integration",
    targetId: id,
    metadata: { provider: row.provider, ok: result.ok },
  });
  return toView(updated);
}

export async function setDefaultIntegration(scope: TenantScope, id: string): Promise<void> {
  const row = await findRow(scope, id);
  await scope.tx
    .update(integrations)
    .set({ isDefault: false })
    .where(and(eq(integrations.tenantId, scope.tenantId), eq(integrations.category, row.category), eq(integrations.isDefault, true)));
  await scope.tx
    .update(integrations)
    .set({ isDefault: true })
    .where(and(eq(integrations.tenantId, scope.tenantId), eq(integrations.id, id)));
  await recordAudit(scope, { action: "integration.default_changed", targetType: "integration", targetId: id });
}

export async function setIntegrationEnabled(scope: TenantScope, id: string, enabled: boolean): Promise<IntegrationView> {
  await findRow(scope, id);
  const [row] = (await scope.tx
    .update(integrations)
    .set({ status: enabled ? "untested" : "disabled" })
    .where(and(eq(integrations.tenantId, scope.tenantId), eq(integrations.id, id)))
    .returning()) as [Row];
  await recordAudit(scope, { action: enabled ? "integration.enabled" : "integration.disabled", targetType: "integration", targetId: id });
  return toView(row);
}

/**
 * Deletes a connection and its ciphertext. Media already uploaded through it
 * keeps its catalogue rows (the files still exist with the provider) but loses
 * the link to the removed credentials.
 */
export async function deleteIntegration(scope: TenantScope, id: string): Promise<void> {
  const row = await findRow(scope, id);
  await scope.tx
    .update(mediaAssets)
    .set({ integrationId: null })
    .where(and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.integrationId, id)));
  await scope.tx.delete(integrations).where(and(eq(integrations.tenantId, scope.tenantId), eq(integrations.id, id)));

  if (row.isDefault) {
    // The category must not be left without a default while another
    // connection exists: promote the oldest one that is still switched on.
    const [next] = await scope.tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.tenantId, scope.tenantId), eq(integrations.category, row.category), ne(integrations.status, "disabled")))
      .orderBy(integrations.createdAt)
      .limit(1);
    if (next) {
      await scope.tx
        .update(integrations)
        .set({ isDefault: true })
        .where(and(eq(integrations.tenantId, scope.tenantId), eq(integrations.id, next.id)));
    }
  }
  await recordAudit(scope, {
    action: "integration.deleted",
    targetType: "integration",
    targetId: id,
    metadata: { provider: row.provider, label: row.label },
  });
}

export interface ResolvedIntegration<C = Record<string, unknown>, S = Record<string, string>> {
  id: string;
  provider: string;
  config: C;
  secrets: S;
}

/**
 * Server-side only: returns decrypted credentials for the current tenant's
 * connection in `category` (a specific one, or the default). There is no
 * fallback of any kind: not to another tenant, not to a global credential.
 * No usable connection means IntegrationNotConfiguredError.
 */
export async function resolveIntegration<C = Record<string, unknown>, S = Record<string, string>>(
  scope: TenantScope,
  category: IntegrationCategory,
  options: { integrationId?: string } = {},
): Promise<ResolvedIntegration<C, S>> {
  const conditions = [eq(integrations.tenantId, scope.tenantId), eq(integrations.category, category), ne(integrations.status, "disabled")];
  conditions.push(options.integrationId ? eq(integrations.id, options.integrationId) : eq(integrations.isDefault, true));

  const [row] = await scope.tx.select().from(integrations).where(and(...conditions)).limit(1);
  if (!row) throw new IntegrationNotConfiguredError(category);

  const secrets = decryptSecrets(row);
  if (needsRotation(keyring(), row)) {
    // Opportunistic re-encryption under the active key after a key rotation.
    const sealed = sealSecret(keyring(), binding(row), JSON.stringify(secrets));
    await scope.tx
      .update(integrations)
      .set({ secretCiphertext: sealed.ciphertext, keyVersion: sealed.keyVersion })
      .where(and(eq(integrations.tenantId, scope.tenantId), eq(integrations.id, row.id)));
  }
  return { id: row.id, provider: row.provider, config: row.config as C, secrets: secrets as S };
}

/** Re-encrypts every connection of the current tenant under the active key. */
export async function rotateTenantIntegrationKeys(scope: TenantScope): Promise<number> {
  const rows = await scope.tx.select().from(integrations).where(eq(integrations.tenantId, scope.tenantId));
  let rotated = 0;
  for (const row of rows) {
    if (!needsRotation(keyring(), row)) continue;
    const sealed = sealSecret(keyring(), binding(row), JSON.stringify(decryptSecrets(row)));
    await scope.tx
      .update(integrations)
      .set({ secretCiphertext: sealed.ciphertext, keyVersion: sealed.keyVersion })
      .where(and(eq(integrations.tenantId, scope.tenantId), eq(integrations.id, row.id)));
    rotated += 1;
  }
  return rotated;
}
