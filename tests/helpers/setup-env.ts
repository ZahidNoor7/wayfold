import { afterAll, inject } from "vitest";

const urls = inject("databaseUrls");

// Infrastructure configuration for the code under test. Fixed, non-secret
// values: these keys protect nothing outside the throw-away test database.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: urls.appUrl,
  DATABASE_PLATFORM_URL: urls.platformUrl,
  DATABASE_MIGRATION_URL: urls.migrationUrl,
  DATABASE_DRIVER: "pg",
  DATABASE_POOL_MAX: "3",
  ROOT_DOMAIN: "wayfold.test",
  APP_HOST: "app.wayfold.test",
  APP_URL: "https://app.wayfold.test",
  SESSION_SECRET: "test-session-secret-0123456789abcdef0123456789abcdef",
  CREDENTIAL_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 1).toString("base64")},v2:${Buffer.alloc(32, 2).toString("base64")}`,
  CREDENTIAL_ENCRYPTION_ACTIVE_KEY: "v2",
});

afterAll(async () => {
  const { closeDatabases } = await import("@/server/db/client");
  await closeDatabases();
});
