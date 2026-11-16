import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setupDatabase, type DatabaseUrls } from "./setup";

/** Owner login created by `scripts/local-db.sh start` on the project-local cluster. */
export const LOCAL_ADMIN_URL = "postgres://wf_owner:wf_owner_local@127.0.0.1:54329/postgres";
export const DEV_DATABASE = "wayfold_dev";

export interface DevSetupOptions {
  adminUrl?: string;
  database?: string;
  /** Drop the database first. Destroys all local data. */
  recreate?: boolean;
}

/**
 * Creates the development database on the local cluster, migrates it, and
 * makes sure the runtime and platform logins exist. Safe to re-run: existing
 * data is kept unless `recreate` is set.
 */
export function setupDevDatabase(options: DevSetupOptions = {}): Promise<DatabaseUrls> {
  return setupDatabase({
    adminUrl: options.adminUrl ?? LOCAL_ADMIN_URL,
    database: options.database ?? DEV_DATABASE,
    recreate: options.recreate ?? false,
  });
}

/** The lines for `.env.local`. Nothing is written to disk: the developer pastes them. */
export function envLines(urls: DatabaseUrls): string {
  const secret = () => randomBytes(32).toString("base64");
  return [
    "# Database (local cluster). Paste into .env.local:",
    `DATABASE_URL=${urls.appUrl}`,
    `DATABASE_PLATFORM_URL=${urls.platformUrl}`,
    `DATABASE_MIGRATION_URL=${urls.migrationUrl}`,
    "DATABASE_DRIVER=pg",
    "",
    "# Also required. Add these only if .env.local does not have them yet:",
    "# replacing an existing CREDENTIAL_ENCRYPTION_KEYS makes stored credentials unreadable,",
    "# and replacing SESSION_SECRET signs everyone out.",
    "ROOT_DOMAIN=localhost:3000",
    "APP_HOST=app.localhost:3000",
    "APP_URL=http://app.localhost:3000",
    `SESSION_SECRET=${secret()}`,
    `CREDENTIAL_ENCRYPTION_KEYS=v1:${secret()}`,
    "CREDENTIAL_ENCRYPTION_ACTIVE_KEY=v1",
  ].join("\n");
}

function describeFailure(error: unknown): string {
  const e = error as { message?: string; cause?: { message?: string } };
  return [e?.cause?.message, e?.message].filter(Boolean).join(" | ").slice(0, 400) || "unknown error";
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    // pnpm forwards a bare `--` separator; it carries no meaning here.
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: { database: { type: "string" }, recreate: { type: "boolean", default: false } },
  });
  const database = values.database ?? process.env.WAYFOLD_DEV_DATABASE ?? DEV_DATABASE;
  const urls = await setupDevDatabase({ adminUrl: process.env.WAYFOLD_DEV_ADMIN_URL, database, recreate: values.recreate });
  console.log(`Database "${database}" is migrated and ready.\n`);
  console.log(envLines(urls));
  console.log('\nNext: "pnpm db:seed" creates the plans (and, with --owner-email, the first platform owner).');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`Could not set up the development database: ${describeFailure(error)}`);
    console.error('Is the local cluster running? Start it with "pnpm db:start".');
    process.exit(1);
  });
}
