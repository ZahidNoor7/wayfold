import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Migrations run as the schema owner (`DATABASE_MIGRATION_URL`), never as the
 * runtime role. Row-level security, roles and grants are hand-written SQL
 * migrations in ./drizzle so that every policy is reviewable.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL ?? "" },
  strict: true,
  verbose: true,
});
