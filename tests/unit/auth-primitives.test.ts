import { afterEach, describe, expect, it } from "vitest";
import { burnPasswordCheck, hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyPassword } from "@/server/auth/password";
import { generateToken, hashToken, safeEqual } from "@/server/auth/tokens";
import { resetEnvCache } from "@/server/env";

describe("password hashing", () => {
  it("hashes with Argon2id and verifies the right password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery stapl")).toBe(false);
    expect(await verifyPassword(hash, "Correct horse battery staple")).toBe(false);
    expect(await verifyPassword(hash, "")).toBe(false);
  });

  it("salts every hash", async () => {
    const [first, second] = await Promise.all([hashPassword("same-password-1"), hashPassword("same-password-1")]);
    expect(first).not.toBe(second);
  });

  it("treats a malformed or placeholder hash as a failed check, not an error", async () => {
    for (const stored of ["!", "", "not-a-hash", "$argon2id$v=19$broken", "plaintext-password"]) {
      await expect(verifyPassword(stored, "plaintext-password")).resolves.toBe(false);
    }
  });

  it("burns a verification for unknown accounts without throwing", async () => {
    await expect(burnPasswordCheck("whatever-was-typed")).resolves.toBeUndefined();
    // Second call reuses the cached decoy hash.
    await expect(burnPasswordCheck("wayfold-decoy-password")).resolves.toBeUndefined();
  });

  it("publishes sane length bounds", () => {
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(10);
    expect(PASSWORD_MAX_LENGTH).toBeGreaterThan(PASSWORD_MIN_LENGTH);
  });
});

describe("tokens", () => {
  const originalSecret = process.env.SESSION_SECRET;

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
    resetEnvCache();
  });

  it("generates 256-bit URL-safe tokens that do not repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
  });

  it("hashes deterministically to something that is not the token", () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toBe(hashToken(token));
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
    expect(hashToken(`${token}x`)).not.toBe(hash);
  });

  it("keys the hash with the server secret", () => {
    const token = generateToken();
    const before = hashToken(token);
    process.env.SESSION_SECRET = "another-session-secret-0123456789abcdef-zz";
    resetEnvCache();
    expect(hashToken(token)).not.toBe(before);
  });

  it("compares strings in constant time and by value", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
    expect(safeEqual("abc123", "abc124")).toBe(false);
    expect(safeEqual("abc123", "abc12")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("é", "e")).toBe(false);
  });
});
