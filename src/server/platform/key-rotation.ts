import "server-only";
import { asc, inArray } from "drizzle-orm";
import { withTenant } from "../db/context";
import { tenants } from "../db/schema";
import { rotateTenantIntegrationKeys } from "../integrations";
import { withPlatform } from "./db";
import { rotatePlatformIntegrationKeys } from "./integrations";

export interface KeyRotationReport {
  /** Workspaces visited. */
  tenants: number;
  /** Tenant connections re-encrypted under the active key. */
  tenantIntegrationsRotated: number;
  /** Workspaces whose connections could not be re-encrypted (left untouched). */
  tenantsFailed: number;
  platformIntegrationsRotated: number;
}

/**
 * System-only (rotation script): re-encrypts every stored credential under
 * the active key version. The platform connection is used only to list
 * workspaces; each one is then rotated inside its own tenant transaction, so
 * a failure in one workspace rolls back that workspace alone. Counts only:
 * nothing about any credential is returned or logged.
 *
 * `tenantIds` narrows the run to those workspaces, for example to retry the
 * ones a previous run reported as failed.
 */
export async function rotateAllCredentialKeys(options: { tenantIds?: string[] } = {}): Promise<KeyRotationReport> {
  const only = options.tenantIds;
  const ids = await withPlatform((tx) =>
    tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(only ? inArray(tenants.id, only) : undefined)
      .orderBy(asc(tenants.createdAt), asc(tenants.id)),
  );

  const report: KeyRotationReport = { tenants: ids.length, tenantIntegrationsRotated: 0, tenantsFailed: 0, platformIntegrationsRotated: 0 };
  for (const { id } of ids) {
    try {
      report.tenantIntegrationsRotated += await withTenant(id, (scope) => rotateTenantIntegrationKeys(scope));
    } catch {
      // Typically a ciphertext written under a key that is no longer in the
      // keyring. Keep going; the operator sees the count and can investigate.
      report.tenantsFailed += 1;
    }
  }
  report.platformIntegrationsRotated = await rotatePlatformIntegrationKeys();
  return report;
}
