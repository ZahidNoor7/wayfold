import { afterEach, describe, expect, it } from "vitest";
import { env, parseEnv, resetEnvCache } from "@/server/env";

const KEY = Buffer.alloc(32, 7).toString("base64");

const valid = {
  DATABASE_URL: "postgres://app:app-password@db.internal/wayfold",
  DATABASE_PLATFORM_URL: "postgres://platform:platform-password@db.internal/wayfold",
  ROOT_DOMAIN: "wayfold.example",
  APP_HOST: "app.wayfold.example",
  APP_URL: "https://app.wayfold.example",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef-session",
  CREDENTIAL_ENCRYPTION_KEYS: `v1:${KEY}`,
  CREDENTIAL_ENCRYPTION_ACTIVE_KEY: "v1",
};

function failure(source: Record<string, string | undefined>): string {
  try {
    parseEnv(source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("parseEnv accepted an invalid environment");
}

describe("parseEnv", () => {
  it("accepts a complete environment and applies defaults", () => {
    const parsed = parseEnv(valid);
    expect(parsed).toMatchObject({ ...valid, NODE_ENV: "development", DATABASE_DRIVER: "neon", DATABASE_POOL_MAX: 5 });
  });

  it("coerces the pool size from its string form", () => {
    expect(parseEnv({ ...valid, DATABASE_POOL_MAX: "12", DATABASE_DRIVER: "pg", NODE_ENV: "production" })).toMatchObject({
      DATABASE_POOL_MAX: 12,
      DATABASE_DRIVER: "pg",
      NODE_ENV: "production",
    });
  });

  it("names every missing variable", () => {
    const message = failure({});
    for (const name of Object.keys(valid)) expect(message).toContain(name);
    expect(message).toMatch(/^Invalid or missing environment configuration: /);
  });

  it("names only the variable that is missing", () => {
    const message = failure({ ...valid, SESSION_SECRET: undefined });
    expect(message).toBe("Invalid or missing environment configuration: SESSION_SECRET");
  });

  it("reports invalid values by name and never echoes the value", () => {
    const bad = {
      ...valid,
      SESSION_SECRET: "hunter2-too-short",
      APP_URL: "not-a-url-with-pa55word",
      CREDENTIAL_ENCRYPTION_ACTIVE_KEY: "version-two-leak",
      DATABASE_POOL_MAX: "9999",
      DATABASE_DRIVER: "mysql-leak",
      NODE_ENV: "staging-leak",
      DATABASE_URL: "",
    };
    const message = failure(bad);

    for (const name of ["SESSION_SECRET", "APP_URL", "CREDENTIAL_ENCRYPTION_ACTIVE_KEY", "DATABASE_POOL_MAX", "DATABASE_DRIVER", "NODE_ENV", "DATABASE_URL"]) {
      expect(message).toContain(name);
    }
    for (const value of ["hunter2", "pa55word", "version-two-leak", "9999", "mysql-leak", "staging-leak"]) {
      expect(message).not.toContain(value);
    }
    // Valid neighbours are neither named nor echoed.
    expect(message).not.toContain("ROOT_DOMAIN");
    expect(message).not.toContain(valid.DATABASE_PLATFORM_URL);
    expect(message).not.toContain(KEY);
  });

  it("rejects a pool size that is not a whole number in range", () => {
    for (const value of ["0", "51", "2.5", "many"]) {
      expect(failure({ ...valid, DATABASE_POOL_MAX: value })).toBe("Invalid or missing environment configuration: DATABASE_POOL_MAX");
    }
  });
});

describe("env", () => {
  const original = process.env.DATABASE_POOL_MAX;

  afterEach(() => {
    process.env.DATABASE_POOL_MAX = original;
    resetEnvCache();
  });

  it("parses process.env once and caches the result", () => {
    resetEnvCache();
    const first = env();
    process.env.DATABASE_POOL_MAX = "9";
    expect(env()).toBe(first);
    expect(env().DATABASE_POOL_MAX).toBe(Number(original));
  });

  it("re-reads the environment after the cache is reset", () => {
    process.env.DATABASE_POOL_MAX = "9";
    resetEnvCache();
    expect(env().DATABASE_POOL_MAX).toBe(9);
  });

  it("fails with names only when process.env is invalid", () => {
    process.env.DATABASE_POOL_MAX = "not-a-number-secret";
    resetEnvCache();
    expect(() => env()).toThrow("Invalid or missing environment configuration: DATABASE_POOL_MAX");
  });
});
