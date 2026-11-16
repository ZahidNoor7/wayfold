import { describe, expect, it } from "vitest";
import { createKeyring } from "@/server/crypto/keyring";

const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");
const TENANT_A = "0d3c1b52-6f0e-4b63-9a55-0a1f6f6f0001";
const TENANT_B = "0d3c1b52-6f0e-4b63-9a55-0a1f6f6f0002";

describe("createKeyring", () => {
  it("parses versions and reports the active one", () => {
    const keyring = createKeyring(`v1:${K1},v2:${K2}`, "v2");
    expect(keyring.activeVersion).toBe("v2");
    expect(keyring.versions).toEqual(["v1", "v2"]);
    expect(keyring.hasVersion("v1")).toBe(true);
    expect(keyring.hasVersion("v3")).toBe(false);
  });

  it("tolerates whitespace and empty entries", () => {
    const keyring = createKeyring(` v1:${K1} , , v2:${K2},`, "v1");
    expect(keyring.versions).toEqual(["v1", "v2"]);
  });

  it("derives a 32-byte key that is stable for a tenant and version", () => {
    const keyring = createKeyring(`v1:${K1}`, "v1");
    const first = keyring.tenantKey("v1", TENANT_A);
    expect(first).toHaveLength(32);
    expect(first.equals(keyring.tenantKey("v1", TENANT_A))).toBe(true);
    // Never the master key itself.
    expect(first.equals(Buffer.alloc(32, 1))).toBe(false);
  });

  it("gives every tenant different key material", () => {
    const keyring = createKeyring(`v1:${K1}`, "v1");
    expect(keyring.tenantKey("v1", TENANT_A).equals(keyring.tenantKey("v1", TENANT_B))).toBe(false);
  });

  it("gives the same tenant a different key under each version", () => {
    const keyring = createKeyring(`v1:${K1},v2:${K2}`, "v2");
    expect(keyring.tenantKey("v1", TENANT_A).equals(keyring.tenantKey("v2", TENANT_A))).toBe(false);
  });

  it("returns a fresh buffer each time, so wiping one copy does not damage the next", () => {
    const keyring = createKeyring(`v1:${K1}`, "v1");
    const expected = Buffer.from(keyring.tenantKey("v1", TENANT_A));
    keyring.tenantKey("v1", TENANT_A).fill(0);
    expect(keyring.tenantKey("v1", TENANT_A).equals(expected)).toBe(true);
  });

  it("throws for a version it does not hold", () => {
    const keyring = createKeyring(`v1:${K1}`, "v1");
    expect(() => keyring.tenantKey("v9", TENANT_A)).toThrow("Unknown credential key version v9");
  });

  it("rejects an active version that is not listed", () => {
    expect(() => createKeyring(`v1:${K1}`, "v2")).toThrow("Active credential key v2 is not in the keyring");
    expect(() => createKeyring("", "v1")).toThrow("Active credential key v1 is not in the keyring");
  });

  it("rejects a version listed twice", () => {
    expect(() => createKeyring(`v1:${K1},v1:${K2}`, "v1")).toThrow("Credential key v1 is listed more than once");
  });

  it.each([
    ["no separator", K1],
    ["empty version", `:${K1}`],
    ["version without a number", `v:${K1}`],
    ["version with the wrong prefix", `key1:${K1}`],
    ["upper-case version", `V1:${K1}`],
  ])("rejects a malformed entry: %s", (_name, spec) => {
    expect(() => createKeyring(spec, "v1")).toThrow("Credential key entries must look like v<number>:<base64 key>");
  });

  it.each([
    ["too short", Buffer.alloc(16, 1).toString("base64")],
    ["too long", Buffer.alloc(48, 1).toString("base64")],
    ["empty", ""],
    ["not base64", "!!!not-base64!!!"],
  ])("rejects a key that does not decode to 32 bytes: %s", (_name, encoded) => {
    expect(() => createKeyring(`v1:${encoded}`, "v1")).toThrow("Credential key v1 must decode to 32 bytes");
  });

  it("never puts key material into an error message", () => {
    const leaky = Buffer.alloc(31, 9).toString("base64");
    for (const spec of [`v1:${leaky}`, `bad:${K1}`, `v1:${K1},v1:${K2}`]) {
      let message = "";
      try {
        createKeyring(spec, "v1");
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      for (const secret of [leaky, K1, K2]) expect(message).not.toContain(secret);
    }
  });
});
