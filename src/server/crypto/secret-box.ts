import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Keyring } from "./keyring";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = "wf1";

/**
 * Identifies exactly which record a ciphertext belongs to. It is fed to GCM as
 * additional authenticated data, so a ciphertext copied onto another tenant's
 * row, another integration, or another provider fails authentication instead
 * of decrypting.
 */
export interface SecretBinding {
  tenantId: string;
  recordId: string;
  purpose: string;
}

export interface SealedSecret {
  /** `wf1.<iv>.<tag>.<ciphertext>`, each part base64url. */
  ciphertext: string;
  keyVersion: string;
}

export class SecretDecryptionError extends Error {
  constructor() {
    // Deliberately uninformative: never echo key, binding, or ciphertext detail.
    super("Stored credential could not be decrypted");
    this.name = "SecretDecryptionError";
  }
}

function aad(binding: SecretBinding, keyVersion: string): Buffer {
  return Buffer.from(
    JSON.stringify([FORMAT, keyVersion, binding.tenantId, binding.recordId, binding.purpose]),
    "utf8",
  );
}

export function sealSecret(keyring: Keyring, binding: SecretBinding, plaintext: string): SealedSecret {
  const keyVersion = keyring.activeVersion;
  const key = keyring.tenantKey(keyVersion, binding.tenantId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(binding, keyVersion));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);

  return {
    keyVersion,
    ciphertext: [FORMAT, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join("."),
  };
}

export function openSecret(keyring: Keyring, binding: SecretBinding, sealed: SealedSecret): string {
  const parts = sealed.ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== FORMAT || !keyring.hasVersion(sealed.keyVersion)) {
    throw new SecretDecryptionError();
  }
  const iv = Buffer.from(parts[1]!, "base64url");
  const tag = Buffer.from(parts[2]!, "base64url");
  const body = Buffer.from(parts[3]!, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretDecryptionError();
  }

  const key = keyring.tenantKey(sealed.keyVersion, binding.tenantId);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(binding, sealed.keyVersion));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretDecryptionError();
  } finally {
    key.fill(0);
  }
}

/** True when a ciphertext was written with a key older than the active one. */
export function needsRotation(keyring: Keyring, sealed: Pick<SealedSecret, "keyVersion">): boolean {
  return sealed.keyVersion !== keyring.activeVersion;
}

/** Re-encrypts under the active key. Returns the input untouched if current. */
export function rotateSecret(keyring: Keyring, binding: SecretBinding, sealed: SealedSecret): SealedSecret {
  if (!needsRotation(keyring, sealed)) return sealed;
  return sealSecret(keyring, binding, openSecret(keyring, binding, sealed));
}

/** UI-safe rendering of a secret: at most the last four characters. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `••••••••${value.slice(-4)}`;
}
