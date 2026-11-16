import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_FOLDER = path.resolve(here, "../../drizzle");

export interface DatabaseUrls {
  /** Schema owner: migrations only. */
  migrationUrl: string;
  /** Member of wayfold_app: the runtime connection. */
  appUrl: string;
  /** Member of wayfold_platform: platform administration. */
  platformUrl: string;
}

export interface SetupOptions {
  /** Owner connection to any database on the server (must have CREATEDB, CREATEROLE). */
  adminUrl: string;
  database: string;
  /** Drop and recreate the database first. */
  recreate?: boolean;
  appLogin?: { user: string; password: string };
  platformLogin?: { user: string; password: string };
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function withDatabase(url: string, database: string, user?: { user: string; password: string }): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (user) {
    next.username = user.user;
    next.password = user.password;
  }
  return next.toString();
}

async function query(url: string, statements: string[]): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

export async function migrateDatabase(migrationUrl: string): Promise<void> {
  const client = new Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

/**
 * Creates (or recreates) a database, applies every migration as the schema
 * owner, and ensures two login users exist as members of the runtime and
 * platform group roles. Used by local development and by the test harness.
 */
export async function setupDatabase(options: SetupOptions): Promise<DatabaseUrls> {
  const appLogin = options.appLogin ?? { user: "wf_app", password: "wf_app_local" };
  const platformLogin = options.platformLogin ?? { user: "wf_platform", password: "wf_platform_local" };
  const database = ident(options.database);

  const admin = new Client({ connectionString: options.adminUrl });
  await admin.connect();
  try {
    if (options.recreate) {
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    }
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [options.database]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${database}`);
  } finally {
    await admin.end();
  }

  const migrationUrl = withDatabase(options.adminUrl, options.database);
  await migrateDatabase(migrationUrl);

  const login = (who: { user: string; password: string }, group: string) => `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(who.user)}) THEN
        CREATE ROLE ${ident(who.user)} LOGIN PASSWORD ${literal(who.password)}
          NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
      IF NOT pg_has_role(${literal(who.user)}, ${literal(group)}, 'member') THEN
        GRANT ${ident(group)} TO ${ident(who.user)};
      END IF;
    END $$;`;

  await query(migrationUrl, [
    // A fresh database lets PUBLIC connect; make access explicit instead.
    `REVOKE ALL ON DATABASE ${database} FROM PUBLIC`,
    login(appLogin, "wayfold_app"),
    login(platformLogin, "wayfold_platform"),
    `GRANT CONNECT ON DATABASE ${database} TO wayfold_app, wayfold_platform`,
  ]);

  return {
    migrationUrl,
    appUrl: withDatabase(options.adminUrl, options.database, appLogin),
    platformUrl: withDatabase(options.adminUrl, options.database, platformLogin),
  };
}

export async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  await query(adminUrl, [`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`]);
}
