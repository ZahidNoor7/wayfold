import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Client } from "pg";
import { migrateDatabase } from "./setup";

/**
 * Provisions a hosted database (Neon in production) for Wayfold:
 *
 *   1. applies every migration as the schema owner,
 *   2. creates (or re-keys) the two login users the app runs as,
 *      `wf_app` (member of wayfold_app) and `wf_platform` (member of
 *      wayfold_platform), with fresh random passwords and no bypass rights,
 *   3. proves the runtime user is subject to row-level security,
 *   4. writes their connection strings to a gitignored env file.
 *
 * Passwords are never printed. Re-running rotates both passwords.
 *
 *   DATABASE_MIGRATION_URL=<owner, direct host> pnpm exec tsx scripts/db/provision.ts \
 *     [--out .env.production.local] [--pooled-host <host>]
 *
 * On Neon the pooled host is derived automatically (`ep-x.region...` →
 * `ep-x-pooler.region...`); the app should connect through the pooler.
 */
const { values } = parseArgs({
  options: {
    out: { type: "string", default: ".env.production.local" },
    "pooled-host": { type: "string" },
  },
});

const ownerUrl = process.env.DATABASE_MIGRATION_URL;
if (!ownerUrl) {
  console.error("Set DATABASE_MIGRATION_URL to the schema owner's direct (non-pooled) connection string.");
  process.exit(2);
}

/** Neon's own roles (and anything with BYPASSRLS) must never run the app, so these are always our own. */
const LOGINS = [
  { user: "wf_app", group: "wayfold_app" },
  { user: "wf_platform", group: "wayfold_platform" },
] as const;

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

function pooledHost(host: string): string {
  if (values["pooled-host"]) return values["pooled-host"];
  const neon = host.match(/^(ep-[a-z0-9-]+?)(-pooler)?\.(.+\.neon\.tech)$/);
  return neon ? `${neon[1]}-pooler.${neon[3]}` : host;
}

function loginUrl(base: URL, user: string, password: string): string {
  const url = new URL(base.toString());
  url.username = user;
  url.password = password;
  url.hostname = pooledHost(base.hostname);
  // verify-full: encrypted and the server certificate checked.
  url.search = "?sslmode=verify-full";
  return url.toString();
}

async function run(url: string, statements: string[]): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const base = new URL(ownerUrl!);
  const database = decodeURIComponent(base.pathname.slice(1));

  await migrateDatabase(ownerUrl!);
  console.log("Migrations applied.");

  const credentials = LOGINS.map((login) => ({ ...login, password: randomBytes(24).toString("base64url") }));
  await run(
    ownerUrl!,
    [
      `REVOKE ALL ON DATABASE ${ident(database)} FROM PUBLIC`,
      ...credentials.flatMap(({ user, group, password }) => [
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(user)}) THEN
             CREATE ROLE ${ident(user)} LOGIN;
           END IF;
         END $$`,
        // Re-asserted on every run, so a role edited by hand is put right.
        // SUPERUSER and REPLICATION are off by default and hosted owners (Neon)
        // may not touch them at all; the check below verifies the outcome.
        `ALTER ROLE ${ident(user)} WITH LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${literal(password)}`,
        `GRANT ${ident(group)} TO ${ident(user)}`,
      ]),
      `GRANT CONNECT ON DATABASE ${ident(database)} TO wayfold_app, wayfold_platform`,
    ],
  );
  console.log("Login users wf_app and wf_platform are ready (passwords rotated).");

  const appUrl = loginUrl(base, "wf_app", credentials[0]!.password);
  const platformUrl = loginUrl(base, "wf_platform", credentials[1]!.password);

  // Proof, as the runtime user through the pooler: no bypass, not platform,
  // and with no tenant context it sees no tenant rows at all.
  const client = new Client({ connectionString: appUrl });
  await client.connect();
  try {
    const role = await client.query<{ bypass: boolean; superuser: boolean; platform: boolean; app: boolean }>(`
      select r.rolbypassrls as bypass, r.rolsuper as superuser,
             pg_has_role(current_user, 'wayfold_platform', 'member') as platform,
             pg_has_role(current_user, 'wayfold_app', 'member') as app
      from pg_roles r where r.rolname = current_user`);
    const visible = await client.query<{ n: number }>("select count(*)::int as n from roles");
    const unprotected = await client.query<{ n: number }>(`
      select count(*)::int as n from pg_class c
      join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)`);
    const check = role.rows[0]!;
    const ok = !check.bypass && !check.superuser && !check.platform && check.app && visible.rows[0]!.n === 0 && unprotected.rows[0]!.n === 0;
    console.log(
      `Runtime user check: bypassrls=${check.bypass} superuser=${check.superuser} platform=${check.platform} app=${check.app} ` +
        `rows-visible-without-tenant=${visible.rows[0]!.n} tenant-tables-without-forced-rls=${unprotected.rows[0]!.n} → ${ok ? "OK" : "FAILED"}`,
    );
    if (!ok) process.exit(1);
  } finally {
    await client.end();
  }

  const out = path.resolve(values.out!);
  writeFileSync(
    out,
    [
      "# Generated by scripts/db/provision.ts. Secrets: never commit; copy into the hosting provider's",
      "# environment settings, then delete this file. Re-running the script rotates both passwords.",
      `DATABASE_URL=${appUrl}`,
      `DATABASE_PLATFORM_URL=${platformUrl}`,
      "DATABASE_DRIVER=neon",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log(`Connection strings written to ${path.relative(process.cwd(), out)} (not printed).`);
}

main().catch((error: unknown) => {
  // Message only: driver errors can carry connection details.
  console.error("Provisioning failed:", (error as Error).message);
  process.exit(1);
});
