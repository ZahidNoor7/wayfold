import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { migrateDatabase } from "./setup";

/** Driver errors can carry connection details; print the reason and nothing else. */
export function describeFailure(error: unknown): string {
  const e = error as { message?: string; cause?: { message?: string } };
  return [e?.cause?.message, e?.message].filter(Boolean).join(" | ").slice(0, 400) || "unknown error";
}

/**
 * Applies every pending migration as the schema owner. This is the only job
 * that uses `DATABASE_MIGRATION_URL`; the web application never receives it.
 */
export async function runMigrations(url: string | undefined = process.env.DATABASE_MIGRATION_URL): Promise<void> {
  if (!url) {
    throw new Error("DATABASE_MIGRATION_URL is not set. It must be the schema owner's connection string.");
  }
  await migrateDatabase(url);
}

async function main(): Promise<void> {
  // Real environment variables win; the files only fill in what is missing.
  config({ path: [".env.local", ".env"], quiet: true });
  await runMigrations();
  console.log("Migrations are up to date.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`Migration failed: ${describeFailure(error)}`);
    process.exit(1);
  });
}
