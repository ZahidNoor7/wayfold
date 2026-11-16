import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setupDatabase } from "../db/setup";

/**
 * Builds a clean database for one end-to-end run and writes the environment
 * the app under test starts with. Everything here is disposable: fixed,
 * non-secret values that protect only the throw-away e2e database.
 */
const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://wf_owner:wf_owner_local@127.0.0.1:54329/postgres";
const PORT = process.env.E2E_PORT ?? "3310";
const WORK_DIR = path.resolve(".local/e2e");

async function main() {
  rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });

  const urls = await setupDatabase({ adminUrl: ADMIN_URL, database: "wayfold_e2e", recreate: true });

  const env: Record<string, string> = {
    DATABASE_URL: urls.appUrl,
    DATABASE_PLATFORM_URL: urls.platformUrl,
    DATABASE_MIGRATION_URL: urls.migrationUrl,
    DATABASE_DRIVER: "pg",
    DATABASE_POOL_MAX: "5",
    ROOT_DOMAIN: `localhost:${PORT}`,
    APP_HOST: `app.localhost:${PORT}`,
    APP_URL: `http://app.localhost:${PORT}`,
    SESSION_SECRET: "e2e-session-secret-0123456789abcdef0123456789abcdef",
    CREDENTIAL_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 7).toString("base64")}`,
    CREDENTIAL_ENCRYPTION_ACTIVE_KEY: "v1",
    CRON_SECRET: "e2e-cron-secret-0123456789abcdef",
    // The platform mailer appends messages here instead of sending them, so
    // tests can follow verification and invitation links. Ignored in production.
    PLATFORM_MAIL_CAPTURE_FILE: path.join(WORK_DIR, "mail.jsonl"),
    NEXT_DIST_DIR: ".next-e2e",
  };
  writeFileSync(path.join(WORK_DIR, "env.json"), JSON.stringify(env, null, 2));
  writeFileSync(path.join(WORK_DIR, "mail.jsonl"), "");
  console.log(`e2e database ready; app will listen on ${env.APP_URL}`);
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
