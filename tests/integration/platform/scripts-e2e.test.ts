import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKeyring } from "@/server/crypto/keyring";
import { sealSecret } from "@/server/crypto/secret-box";
import { dropDatabase, setupDatabase, type DatabaseUrls } from "../../../scripts/db/setup";

/**
 * The scripts as an operator runs them: real `tsx` processes against a
 * database of their own, so nothing here can touch (or be touched by) the
 * database the rest of the suite shares.
 */
const run = promisify(execFile);
const root = path.resolve(__dirname, "../../..");
const tsx = createRequire(import.meta.url).resolve("tsx/cli");

const database = `wayfold_test_scripts_${randomBytes(4).toString("hex")}`;
const adminUrl = (() => {
  const url = new URL(process.env.DATABASE_MIGRATION_URL!);
  url.pathname = "/postgres";
  return url.toString();
})();

const API_SECRET = "legacy-secret-DO-NOT-PRINT-0001";
const OWNER_PASSWORD = "an-operator-chosen-password";
let urls: DatabaseUrls;

function script(file: string, args: string[] = [], env: Record<string, string> = {}) {
  return run(process.execPath, [tsx, path.join("scripts", file), ...args], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: urls.appUrl,
      DATABASE_PLATFORM_URL: urls.platformUrl,
      DATABASE_MIGRATION_URL: urls.migrationUrl,
      ...env,
    },
    timeout: 60_000,
  });
}

async function platformQuery<T extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: urls.platformUrl });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

describe("operational scripts, end to end", () => {
  beforeAll(async () => {
    urls = await setupDatabase({ adminUrl, database, recreate: true });
  });
  afterAll(async () => {
    await dropDatabase(adminUrl, database);
  });

  it("db:migrate reports an up-to-date database and fails clearly without the owner URL", async () => {
    const { stdout } = await script("db/migrate.ts");
    expect(stdout).toContain("Migrations are up to date.");

    const failure = await script("db/migrate.ts", [], { DATABASE_MIGRATION_URL: "" }).catch((error: { code: number; stderr: string }) => error);
    expect(failure).toMatchObject({ code: 1 });
    expect((failure as { stderr: string }).stderr).toContain("DATABASE_MIGRATION_URL is not set");
  });

  it("db:seed creates plans and the first platform owner, and changes nothing when re-run", async () => {
    const args = ["--", "--owner-email", "Root@Example.Test", "--owner-name", "Root Owner"];
    const first = await script("db/seed.ts", args, { WAYFOLD_OWNER_PASSWORD: OWNER_PASSWORD });
    expect(first.stdout).toContain("Plans created: free, starter, professional, business, enterprise.");
    expect(first.stdout).toContain("Default plan for new workspaces: free.");
    expect(first.stdout).toContain("Platform owner account created for Root@Example.Test.");
    expect(first.stdout + first.stderr).not.toContain(OWNER_PASSWORD);

    const again = await script("db/seed.ts", args, { WAYFOLD_OWNER_PASSWORD: "a-different-password-entirely" });
    expect(again.stdout).toContain("Plans already present; none created.");
    expect(again.stdout).toContain("is already a platform owner. Nothing changed.");

    const admins = await platformQuery<{ email: string; role: string; verified: boolean }>(
      "select u.email, a.role, u.email_verified_at is not null as verified from platform_admins a join users u on u.id = a.user_id",
    );
    expect(admins).toEqual([{ email: "root@example.test", role: "owner", verified: true }]);
    expect(await platformQuery("select code from plans where is_default")).toEqual([{ code: "free" }]);

    const invalid = await script("db/seed.ts", ["--owner-email", "second@example.test", "--owner-password", "short"]).catch(
      (error: { code: number; stderr: string }) => error,
    );
    expect(invalid).toMatchObject({ code: 1 });
    expect((invalid as { stderr: string }).stderr).toContain("Use at least 10 characters.");
    expect(await platformQuery("select 1 from users where email = 'second@example.test'")).toEqual([]);
  });

  it("rotate-credential-keys re-encrypts every workspace's credentials and prints counts only", async () => {
    // Two workspaces whose connections were sealed under the retired key v1.
    const [plan] = await platformQuery<{ id: string }>("select id from plans where code = 'free'");
    const keyringV1 = createKeyring(process.env.CREDENTIAL_ENCRYPTION_KEYS!, "v1");
    const integrationIds: string[] = [];
    for (const slug of ["rotate-one", "rotate-two"]) {
      const [tenant] = await platformQuery<{ id: string }>("insert into tenants (slug, name, plan_id) values ($1, $1, $2) returning id", [slug, plan!.id]);
      const id = randomUUID();
      const sealed = sealSecret(
        keyringV1,
        { tenantId: tenant!.id, recordId: id, purpose: "integration:cloudinary" },
        JSON.stringify({ apiKey: "legacy-key-0001", apiSecret: API_SECRET }),
      );
      await platformQuery(
        `insert into integrations (id, tenant_id, provider, category, label, is_default, config, secret_ciphertext, key_version)
         values ($1, $2, 'cloudinary', 'media', 'Default', true, '{"cloudName":"demo"}', $3, 'v1')`,
        [id, tenant!.id, sealed.ciphertext],
      );
      integrationIds.push(id);
    }

    const { stdout, stderr } = await script("rotate-credential-keys.ts");
    expect(stdout.trim().split("\n")).toEqual([
      "Workspaces checked: 2",
      "Tenant integrations re-encrypted: 2",
      "Platform integrations re-encrypted: 0",
    ]);
    expect(stdout + stderr).not.toContain(API_SECRET);
    expect(stdout + stderr).not.toContain("wf1.");
    for (const id of integrationIds) expect(stdout).not.toContain(id);

    expect(await platformQuery("select distinct key_version from integrations")).toEqual([{ key_version: "v2" }]);
    const again = await script("rotate-credential-keys.ts");
    expect(again.stdout).toContain("Tenant integrations re-encrypted: 0");
  });

  it("rotate-credential-keys exits non-zero and says how many workspaces it could not re-encrypt", async () => {
    await platformQuery("update integrations set key_version = 'v1', secret_ciphertext = 'wf1.AAAA.BBBB.CCCC' where tenant_id = (select id from tenants where slug = 'rotate-one')");

    const failure = await script("rotate-credential-keys.ts").catch((error: { code: number; stdout: string; stderr: string }) => error);
    expect(failure).toMatchObject({ code: 1 });
    const { stdout, stderr } = failure as { stdout: string; stderr: string };
    expect(stdout).toContain("Workspaces checked: 2");
    expect(stderr).toContain("Workspaces that could not be re-encrypted: 1.");
    expect(stdout + stderr).not.toContain("AAAA");
  });
});
