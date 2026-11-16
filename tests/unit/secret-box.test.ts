import { describe, expect, it } from "vitest";
import { createKeyring } from "@/server/crypto/keyring";
import {

  maskSecret,
  needsRotation,
  openSecret,
  rotateSecret,
  sealSecret,
  SecretDecryptionError,
  type SealedSecret,
  type SecretBinding,
} from "@/server/crypto/secret-box";

// Shaped like a Stripe live key but not one; assembled at runtime so secret
// scanners do not mistake the source for a leaked credential.
const FAKE_LIVE_KEY = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");

const SPEC = `v1:${Buffer.alloc(32, 1).toString("base64")},v2:${Buffer.alloc(32, 2).toString("base64")}`;
const keyringV1 = createKeyring(SPEC, "v1");
const keyringV2 = createKeyring(SPEC, "v2");

const binding: SecretBinding = {
  tenantId: "0d3c1b52-6f0e-4b63-9a55-0a1f6f6f0001",
  recordId: "5b0f3a0e-33f5-4f5b-8a46-7c1f5d2b0001",
  purpose: "integration:smtp",
};
const PLAINTEXT = JSON.stringify({ apiKey: FAKE_LIVE_KEY, password: "pässwörd ✓" });

/** Flips one bit in one dot-separated part of a sealed value. */
function tamper(sealed: SealedSecret, part: 1 | 2 | 3): SealedSecret {
  const parts = sealed.ciphertext.split(".");
  const bytes = Buffer.from(parts[part]!, "base64url");
  bytes[0] = bytes[0]! ^ 0x01;
  parts[part] = bytes.toString("base64url");
  return { ...sealed, ciphertext: parts.join(".") };
}

function replacePart(sealed: SealedSecret, part: number, value: string): SealedSecret {
  const parts = sealed.ciphertext.split(".");
  parts[part] = value;
  return { ...sealed, ciphertext: parts.join(".") };
}

describe("sealSecret / openSecret", () => {
  it("round-trips a secret, including non-ASCII text", () => {
    const sealed = sealSecret(keyringV2, binding, PLAINTEXT);
    expect(sealed.keyVersion).toBe("v2");
    expect(openSecret(keyringV2, binding, sealed)).toBe(PLAINTEXT);
    // The derived key is wiped after use; a second open must still work.
    expect(openSecret(keyringV2, binding, sealed)).toBe(PLAINTEXT);
  });

  it("round-trips an empty string", () => {
    const sealed = sealSecret(keyringV2, binding, "");
    expect(openSecret(keyringV2, binding, sealed)).toBe("");
  });

  it("produces the documented wf1.<iv>.<tag>.<body> layout", () => {
    const parts = sealSecret(keyringV2, binding, PLAINTEXT).ciphertext.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("wf1");
    expect(Buffer.from(parts[1]!, "base64url")).toHaveLength(12);
    expect(Buffer.from(parts[2]!, "base64url")).toHaveLength(16);
  });

  it("does not contain the plaintext in any encoding a reader could spot", () => {
    const { ciphertext } = sealSecret(keyringV2, binding, PLAINTEXT);
    expect(ciphertext).not.toContain(FAKE_LIVE_KEY);
    expect(ciphertext).not.toContain(Buffer.from(PLAINTEXT).toString("base64url"));
    expect(ciphertext).not.toContain(Buffer.from(PLAINTEXT).toString("base64"));
    expect(Buffer.from(ciphertext.split(".")[3]!, "base64url").toString("utf8")).not.toContain("sk_live");
  });

  it("uses a fresh nonce, so sealing the same value twice differs", () => {
    const first = sealSecret(keyringV2, binding, PLAINTEXT);
    const second = sealSecret(keyringV2, binding, PLAINTEXT);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.ciphertext.split(".")[1]).not.toBe(second.ciphertext.split(".")[1]);
  });

  it.each([
    ["nonce", 1],
    ["authentication tag", 2],
    ["ciphertext body", 3],
  ] as const)("fails when the %s is tampered with", (_name, part) => {
    const sealed = sealSecret(keyringV2, binding, PLAINTEXT);
    expect(() => openSecret(keyringV2, binding, tamper(sealed, part))).toThrow(SecretDecryptionError);
  });

  it("fails when the body is truncated or extended", () => {
    const sealed = sealSecret(keyringV2, binding, PLAINTEXT);
    const body = Buffer.from(sealed.ciphertext.split(".")[3]!, "base64url");
    expect(() => openSecret(keyringV2, binding, replacePart(sealed, 3, body.subarray(1).toString("base64url")))).toThrow(SecretDecryptionError);
    expect(() =>
      openSecret(keyringV2, binding, replacePart(sealed, 3, Buffer.concat([body, Buffer.from([0])]).toString("base64url"))),
    ).toThrow(SecretDecryptionError);
    expect(() => openSecret(keyringV2, binding, replacePart(sealed, 3, ""))).toThrow(SecretDecryptionError);
  });

  it("fails for another tenant, even with the same record id and purpose", () => {
    const sealed = sealSecret(keyringV2, binding, PLAINTEXT);
    const other = { ...binding, tenantId: "0d3c1b52-6f0e-4b63-9a55-0a1f6f6f0002" };
    expect(() => openSecret(keyringV2, other, sealed)).toThrow(SecretDecryptionError);
  });

  it("fails for another record of the same tenant", () => {
    const sealed = sealSecret(keyringV2, binding, PLAINTEXT);
    const other = { ...binding, recordId: "5b0f3a0e-33f5-4f5b-8a46-7c1f5d2b0002" };
    expect(() => openSecret(keyringV2, other, sealed)).toThrow(SecretDecryptionError);
  });

  it("fails for another purpose on the same record", () => {
    const sealed = sealSecret(keyringV2, binding, PLAINTEXT);
    expect(() => openSecret(keyringV2, { ...binding, purpose: "integration:stripe" }, sealed)).toThrow(SecretDecryptionError);
  });

  it("fails for a key version the keyring does not hold", () => {
    const sealed = sealSecret(keyringV2, binding, PLAINTEXT);
    expect(() => openSecret(keyringV2, binding, { ...sealed, keyVersion: "v9" })).toThrow(SecretDecryptionError);
    const onlyV1 = createKeyring(`v1:${Buffer.alloc(32, 1).toString("base64")}`, "v1");
    expect(() => openSecret(onlyV1, binding, sealed)).toThrow(SecretDecryptionError);
  });

  it("fails when the recorded key version is swapped for another valid one", () => {
    const sealed = sealSecret(keyringV1, binding, PLAINTEXT);
    expect(sealed.keyVersion).toBe("v1");
    expect(() => openSecret(keyringV2, binding, { ...sealed, keyVersion: "v2" })).toThrow(SecretDecryptionError);
  });

  it("fails when the same version name holds a different master key", () => {
    const sealed = sealSecret(keyringV2, binding, PLAINTEXT);
    const imposter = createKeyring(`v2:${Buffer.alloc(32, 9).toString("base64")}`, "v2");
    expect(() => openSecret(imposter, binding, sealed)).toThrow(SecretDecryptionError);
  });

  it.each([
    ["empty string", ""],
    ["plain text", "sk_live_plaintext"],
    ["too few parts", "wf1.aaaa.bbbb"],
    ["too many parts", "wf1.aaaa.bbbb.cccc.dddd"],
    ["unknown format marker", "wf2.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA"],
    ["short nonce", "wf1.AAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA"],
    ["short tag", "wf1.AAAAAAAAAAAAAAAA.AAAA.AAAA"],
  ])("fails on a malformed value: %s", (_name, ciphertext) => {
    expect(() => openSecret(keyringV2, binding, { ciphertext, keyVersion: "v2" })).toThrow(SecretDecryptionError);
  });

  it("raises an error that reveals nothing about the key, binding or ciphertext", () => {
    const sealed = sealSecret(keyringV2, binding, PLAINTEXT);
    const failures: unknown[] = [];
    for (const attempt of [
      () => openSecret(keyringV2, { ...binding, tenantId: "0d3c1b52-6f0e-4b63-9a55-0a1f6f6f0002" }, sealed),
      () => openSecret(keyringV2, binding, tamper(sealed, 2)),
      () => openSecret(keyringV2, binding, { ...sealed, keyVersion: "v9" }),
      () => openSecret(keyringV2, binding, { ciphertext: "garbage", keyVersion: "v2" }),
    ]) {
      try {
        attempt();
      } catch (error) {
        failures.push(error);
      }
    }
    expect(failures).toHaveLength(4);

    for (const failure of failures) {
      const error = failure as SecretDecryptionError;
      expect(error).toBeInstanceOf(SecretDecryptionError);
      expect(error.name).toBe("SecretDecryptionError");
      // One fixed sentence for every cause: the reason is not distinguishable.
      expect(error.message).toBe("Stored credential could not be decrypted");
      expect(error.cause).toBeUndefined();
      const rendered = `${error.message} ${JSON.stringify(error)} ${Object.keys(error).join(",")}`;
      for (const detail of [binding.tenantId, binding.recordId, binding.purpose, "v2", "v9", "sk_live", ...sealed.ciphertext.split(".").slice(1)]) {
        expect(rendered).not.toContain(detail);
      }
    }
  });
});

describe("key rotation", () => {
  it("flags only ciphertexts written under an older key", () => {
    const old = sealSecret(keyringV1, binding, PLAINTEXT);
    expect(needsRotation(keyringV1, old)).toBe(false);
    expect(needsRotation(keyringV2, old)).toBe(true);
    expect(needsRotation(keyringV2, sealSecret(keyringV2, binding, PLAINTEXT))).toBe(false);
  });

  it("re-encrypts a v1 ciphertext under v2 without changing the secret", () => {
    const old = sealSecret(keyringV1, binding, PLAINTEXT);
    // The old ciphertext still opens after the active key moved on.
    expect(openSecret(keyringV2, binding, old)).toBe(PLAINTEXT);

    const rotated = rotateSecret(keyringV2, binding, old);
    expect(rotated.keyVersion).toBe("v2");
    expect(rotated.ciphertext).not.toBe(old.ciphertext);
    expect(needsRotation(keyringV2, rotated)).toBe(false);
    expect(openSecret(keyringV2, binding, rotated)).toBe(PLAINTEXT);

    // Once v1 is retired, only the rotated copy survives.
    const onlyV2 = createKeyring(`v2:${Buffer.alloc(32, 2).toString("base64")}`, "v2");
    expect(openSecret(onlyV2, binding, rotated)).toBe(PLAINTEXT);
    expect(() => openSecret(onlyV2, binding, old)).toThrow(SecretDecryptionError);
  });

  it("returns a current ciphertext untouched", () => {
    const current = sealSecret(keyringV2, binding, PLAINTEXT);
    expect(rotateSecret(keyringV2, binding, current)).toBe(current);
  });

  it("refuses to rotate a ciphertext under the wrong binding", () => {
    const old = sealSecret(keyringV1, binding, PLAINTEXT);
    expect(() => rotateSecret(keyringV2, { ...binding, tenantId: "0d3c1b52-6f0e-4b63-9a55-0a1f6f6f0002" }, old)).toThrow(
      SecretDecryptionError,
    );
  });
});

describe("maskSecret", () => {
  it("shows at most the last four characters of a long secret", () => {
    expect(maskSecret(FAKE_LIVE_KEY)).toBe("••••••••p7dc");
    expect(maskSecret("123456789")).toBe("••••••••6789");
  });

  it("shows nothing of a short secret", () => {
    expect(maskSecret("12345678")).toBe("••••••••");
    expect(maskSecret("abc")).toBe("••••••••");
    expect(maskSecret("")).toBe("••••••••");
  });

  it("does not reveal the length of the secret", () => {
    expect(maskSecret("a".repeat(12))).toHaveLength(maskSecret("a".repeat(200)).length);
  });
});
