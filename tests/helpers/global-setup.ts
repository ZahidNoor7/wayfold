import { randomBytes } from "node:crypto";
import type { TestProject } from "vitest/node";
import { dropDatabase, setupDatabase } from "../../scripts/db/setup";

const DEFAULT_ADMIN_URL = "postgres://wf_owner:wf_owner_local@127.0.0.1:54329/postgres";

/**
 * One throw-away database per test run, migrated exactly as production is.
 * Tests create their own tenants, so files can run in parallel against it.
 */
export default async function setup(project: TestProject) {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL;
  const database = `wayfold_test_${randomBytes(4).toString("hex")}`;

  let urls;
  try {
    urls = await setupDatabase({ adminUrl, database, recreate: true });
  } catch (error) {
    throw new Error(
      `Could not prepare the test database. Start the local cluster with "pnpm db:start" ` +
        `or set TEST_DATABASE_ADMIN_URL. Cause: ${describe(error)}`,
    );
  }

  project.provide("databaseUrls", urls);

  return async () => {
    await dropDatabase(adminUrl, database);
  };
}

function describe(error: unknown): string {
  const e = error as { message?: string; cause?: { message?: string } };
  return [e.cause?.message, e.message?.slice(0, 300)].filter(Boolean).join(" | ");
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrls: { migrationUrl: string; appUrl: string; platformUrl: string };
  }
}
