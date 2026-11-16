import "server-only";
import { hkdfSync } from "node:crypto";

const KEY_BYTES = 32;

export interface Keyring {
  /** Version new ciphertexts are written with. */
  readonly activeVersion: string;
  /** Per-tenant data key for a version. Throws on an unknown version. */
  tenantKey(version: string, tenantId: string): Buffer;
  hasVersion(version: string): boolean;
  readonly versions: readonly string[];
}

/**
 * Parses `v1:<base64>,v2:<base64>` into master keys and derives one data key
 * per tenant with HKDF-SHA256. A tenant never shares key material with another
 * tenant, and the master keys never leave this module.
 */
export function createKeyring(spec: string, activeVersion: string): Keyring {
  const masters = new Map<string, Buffer>();

  for (const entry of spec.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    const version = separator === -1 ? "" : trimmed.slice(0, separator);
    const encoded = separator === -1 ? "" : trimmed.slice(separator + 1);
    if (!/^v\d+$/.test(version)) {
      throw new Error("Credential key entries must look like v<number>:<base64 key>");
    }
    const key = Buffer.from(encoded, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(`Credential key ${version} must decode to ${KEY_BYTES} bytes`);
    }
    if (masters.has(version)) {
      throw new Error(`Credential key ${version} is listed more than once`);
    }
    masters.set(version, key);
  }

  if (!masters.has(activeVersion)) {
    throw new Error(`Active credential key ${activeVersion} is not in the keyring`);
  }

  return {
    activeVersion,
    versions: [...masters.keys()],
    hasVersion: (version) => masters.has(version),
    tenantKey(version, tenantId) {
      const master = masters.get(version);
      if (!master) {
        throw new Error(`Unknown credential key version ${version}`);
      }
      const derived = hkdfSync(
        "sha256",
        master,
        Buffer.from(tenantId, "utf8"),
        Buffer.from("wayfold/tenant-credentials/v1", "utf8"),
        KEY_BYTES,
      );
      return Buffer.from(derived);
    },
  };
}
