import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPassword } from "@/server/auth/password";
import { login } from "@/server/auth/service";
import { getPlatformRole } from "@/server/auth/workspace";
import { createKeyring } from "@/server/crypto/keyring";
import { sealSecret } from "@/server/crypto/secret-box";
import { withTenant } from "@/server/db/context";
import { auditLogs, integrations, platformAdmins, platformIntegrations, users } from "@/server/db/schema";
import { ConflictError, ValidationError } from "@/server/errors";
import { resolveIntegration } from "@/server/integrations";
import { ensurePlatformOwner } from "@/server/platform/admins";
import { withPlatform } from "@/server/platform/db";
import { savePlatformIntegration } from "@/server/platform/integrations";
import { rotateAllCredentialKeys } from "@/server/platform/key-rotation";
import { getManagedStorage } from "@/server/platform/managed-storage";
import { listPlans } from "@/server/platform/plans";
import { parseSeedArgs, seed } from "../../../scripts/db/seed";
import { describeFailure, runMigrations } from "../../../scripts/db/migrate";
import { DEV_DATABASE, envLines, LOCAL_ADMIN_URL } from "../../../scripts/db/dev-setup";
import { createTenant, createUser, unique } from "../../helpers/fixtures";
import { caught, createAdmin, holdPlatformIntegrationsLock } from "./helpers";

const PASSWORD = "correct-horse-battery-staple";

describe("ensurePlatformOwner", () => {
  it("creates the first owner account, verified and able to sign in", async () => {
    const email = `${unique("root")}@Example.Test`;
    const result = await ensurePlatformOwner({ email, password: PASSWORD, name: "Rana Root" });
    expect(result).toMatchObject({ userCreated: true, promoted: true });

    const [user] = await withPlatform((tx) => tx.select().from(users).where(eq(users.id, result.userId)));
    expect(user).toMatchObject({ email: email.toLowerCase(), name: "Rana Root", status: "active" });
    expect(user!.emailVerifiedAt).not.toBeNull();
    expect(user!.passwordHash).not.toContain(PASSWORD);
    expect(await getPlatformRole(result.userId)).toBe("owner");

    const session = await login({ email, password: PASSWORD }, { ip: unique("ip") });
    expect(session.userId).toBe(result.userId);

    const [audit] = await withPlatform((tx) => tx.select().from(auditLogs).where(eq(auditLogs.targetId, result.userId)));
    expect(audit).toMatchObject({ action: "platform_admin.owner_granted", actorType: "system", actorUserId: null, tenantId: null });
    expect(JSON.stringify(audit!.metadata)).not.toContain(PASSWORD);
  });

  it("is idempotent and never changes an existing password", async () => {
    const email = `${unique("root")}@example.test`;
    const first = await ensurePlatformOwner({ email, password: PASSWORD });
    const again = await ensurePlatformOwner({ email, password: "a-completely-different-password" });
    expect(again).toEqual({ userId: first.userId, userCreated: false, promoted: false });

    const [user] = await withPlatform((tx) => tx.select().from(users).where(eq(users.id, first.userId)));
    expect(user!.name).toBe("Platform Owner");
    expect(await verifyPassword(user!.passwordHash, PASSWORD)).toBe(true);
    const grants = await withPlatform((tx) => tx.select().from(auditLogs).where(eq(auditLogs.targetId, first.userId)));
    expect(grants).toHaveLength(1);
  });

  it("promotes an existing account, including a support admin, without a password", async () => {
    const plain = await createUser();
    expect(await ensurePlatformOwner({ email: plain.email })).toEqual({ userId: plain.id, userCreated: false, promoted: true });
    expect(await getPlatformRole(plain.id)).toBe("owner");

    const support = await createAdmin("support");
    expect(await ensurePlatformOwner({ email: support.email })).toMatchObject({ userCreated: false, promoted: true });
    const rows = await withPlatform((tx) => tx.select().from(platformAdmins).where(eq(platformAdmins.userId, support.userId)));
    expect(rows).toEqual([expect.objectContaining({ role: "owner" })]);
  });

  it("rejects bad input, a missing password for a new account, and disabled accounts", async () => {
    expect(await caught(() => ensurePlatformOwner({ email: "not-an-email", password: PASSWORD }))).toBeInstanceOf(ValidationError);
    expect(await caught(() => ensurePlatformOwner({ email: `${unique("r")}@example.test`, password: "short" }))).toBeInstanceOf(ValidationError);

    const fresh = `${unique("r")}@example.test`;
    expect(await caught(() => ensurePlatformOwner({ email: fresh }))).toBeInstanceOf(ConflictError);
    expect(await withPlatform((tx) => tx.select().from(users).where(eq(users.email, fresh)))).toEqual([]);

    const disabled = await createUser();
    await withPlatform((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, disabled.id)));
    expect(await caught(() => ensurePlatformOwner({ email: disabled.email, password: PASSWORD }))).toBeInstanceOf(ConflictError);
    expect(await getPlatformRole(disabled.id)).toBeNull();
  });
});

describe("credential key rotation", () => {
  holdPlatformIntegrationsLock();
  afterEach(async () => {
    await withPlatform((tx) => tx.delete(platformIntegrations));
  });

  const oldKeyring = () => createKeyring(process.env.CREDENTIAL_ENCRYPTION_KEYS!, "v1");

  /** A tenant connection sealed under the retired key, as if it predated the rotation. */
  async function legacyIntegration(tenantId: string, secrets: Record<string, string>, label = "Default") {
    const id = randomUUID();
    const sealed = sealSecret(oldKeyring(), { tenantId, recordId: id, purpose: "integration:cloudinary" }, JSON.stringify(secrets));
    await withTenant(tenantId, ({ tx }) =>
      tx.insert(integrations).values({
        id,
        tenantId,
        provider: "cloudinary",
        category: "media",
        label,
        isDefault: label === "Default",
        config: { cloudName: "demo" },
        secretCiphertext: sealed.ciphertext,
        keyVersion: sealed.keyVersion,
      }),
    );
    return id;
  }

  async function versions(tenantId: string): Promise<string[]> {
    const rows = await withPlatform((tx) => tx.select({ v: integrations.keyVersion }).from(integrations).where(eq(integrations.tenantId, tenantId)));
    return rows.map((row) => row.v).sort();
  }

  it("re-encrypts tenant and platform credentials under the active key, tenant by tenant", async () => {
    const owner = await createAdmin();
    const a = await createTenant();
    const b = await createTenant();
    const untouched = await createTenant();
    await legacyIntegration(a.tenantId, { apiKey: "key-a-000001", apiSecret: "secret-a-000001" });
    await legacyIntegration(a.tenantId, { apiKey: "key-a-000002", apiSecret: "secret-a-000002" }, "Second");
    await legacyIntegration(b.tenantId, { apiKey: "key-b-000001", apiSecret: "secret-b-000001" });
    await legacyIntegration(untouched.tenantId, { apiKey: "key-u-000001", apiSecret: "secret-u-000001" });

    // The platform's own connection, also under the old key.
    const saved = await savePlatformIntegration(owner, {
      provider: "cloudinary",
      config: { cloudName: "shared" },
      secrets: { apiKey: "key-p-000001", apiSecret: "secret-p-000001" },
    });
    const old = sealSecret(
      oldKeyring(),
      { tenantId: "platform", recordId: saved.id, purpose: "integration:cloudinary" },
      JSON.stringify({ apiKey: "key-p-000001", apiSecret: "secret-p-000001" }),
    );
    await withPlatform((tx) =>
      tx.update(platformIntegrations).set({ secretCiphertext: old.ciphertext, keyVersion: "v1" }).where(eq(platformIntegrations.id, saved.id)),
    );

    const report = await rotateAllCredentialKeys({ tenantIds: [a.tenantId, b.tenantId] });
    expect(report).toEqual({ tenants: 2, tenantIntegrationsRotated: 3, tenantsFailed: 0, platformIntegrationsRotated: 1 });
    // Counts only: nothing that identifies a credential.
    expect(Object.values(report).every((value) => typeof value === "number")).toBe(true);

    expect(await versions(a.tenantId)).toEqual(["v2", "v2"]);
    expect(await versions(b.tenantId)).toEqual(["v2"]);
    expect(await versions(untouched.tenantId)).toEqual(["v1"]);

    // Still the same secrets, each readable only inside its own tenant.
    const resolved = await withTenant(b.tenantId, (scope) => resolveIntegration(scope, "media"));
    expect(resolved.secrets).toEqual({ apiKey: "key-b-000001", apiSecret: "secret-b-000001" });
    expect((await getManagedStorage())?.secrets).toEqual({ apiKey: "key-p-000001", apiSecret: "secret-p-000001" });

    // A second run finds nothing left to do.
    expect(await rotateAllCredentialKeys({ tenantIds: [a.tenantId, b.tenantId] })).toEqual({
      tenants: 2,
      tenantIntegrationsRotated: 0,
      tenantsFailed: 0,
      platformIntegrationsRotated: 0,
    });
  });

  it("counts a workspace it cannot re-encrypt, leaves it untouched and carries on", async () => {
    const broken = await createTenant();
    const healthy = await createTenant();
    const good = await legacyIntegration(broken.tenantId, { apiKey: "key-g-000001", apiSecret: "secret-g-000001" });
    const bad = await legacyIntegration(broken.tenantId, { apiKey: "key-x-000001", apiSecret: "secret-x-000001" }, "Corrupt");
    await legacyIntegration(healthy.tenantId, { apiKey: "key-h-000001", apiSecret: "secret-h-000001" });
    // Move a ciphertext onto another row: authentication fails, as it would for a lost key.
    await withPlatform(async (tx) => {
      const [donor] = await tx.select().from(integrations).where(eq(integrations.id, good));
      await tx.update(integrations).set({ secretCiphertext: donor!.secretCiphertext }).where(and(eq(integrations.id, bad)));
    });

    const report = await rotateAllCredentialKeys({ tenantIds: [broken.tenantId, healthy.tenantId] });
    expect(report).toEqual({ tenants: 2, tenantIntegrationsRotated: 1, tenantsFailed: 1, platformIntegrationsRotated: 0 });
    // The failed workspace rolled back as a whole; the healthy one was rotated.
    expect(await versions(broken.tenantId)).toEqual(["v1", "v1"]);
    expect(await versions(healthy.tenantId)).toEqual(["v2"]);
  });
});

describe("operational scripts", () => {
  it("seed: creates the plan catalogue and the platform owner, and can be re-run", async () => {
    const email = `${unique("seed")}@example.test`;
    const first = await seed({ ownerEmail: email, ownerPassword: PASSWORD, ownerName: "Seeded Owner" });
    expect(first.owner).toEqual({ userCreated: true, promoted: true });
    expect(first.defaultPlan).toEqual(expect.any(String));

    const again = await seed({ ownerEmail: email, ownerPassword: PASSWORD });
    expect(again).toEqual({ plansCreated: [], defaultPlan: first.defaultPlan, owner: { userCreated: false, promoted: false } });
    expect(await seed()).toEqual({ plansCreated: [], defaultPlan: first.defaultPlan, owner: null });

    const [user] = await withPlatform((tx) => tx.select().from(users).where(eq(users.email, email)));
    expect(user!.name).toBe("Seeded Owner");
    const codes = (await listPlans({ userId: user!.id, role: "owner" })).map((plan) => plan.code);
    expect(codes).toEqual(expect.arrayContaining(["free", "starter", "professional", "business", "enterprise"]));
  });

  it("seed: reads its options from flags, with the password also accepted from the environment", () => {
    expect(parseSeedArgs(["--", "--owner-email", "a@example.test", "--owner-name", "A B", "--owner-password", "from-flag"], {})).toEqual({
      ownerEmail: "a@example.test",
      ownerName: "A B",
      ownerPassword: "from-flag",
    });
    expect(parseSeedArgs(["--owner-email=a@example.test"], { WAYFOLD_OWNER_PASSWORD: "from-env" })).toEqual({
      ownerEmail: "a@example.test",
      ownerName: undefined,
      ownerPassword: "from-env",
    });
    expect(parseSeedArgs([], {})).toEqual({ ownerEmail: undefined, ownerName: undefined, ownerPassword: undefined });
    expect(() => parseSeedArgs(["--owner-emial", "typo@example.test"], {})).toThrow();
  });

  it("migrate: needs the owner connection and is a no-op on an up-to-date database", async () => {
    await expect(runMigrations("")).rejects.toThrow(/DATABASE_MIGRATION_URL is not set/);
    await expect(runMigrations(process.env.DATABASE_MIGRATION_URL)).resolves.toBeUndefined();
    expect(describeFailure(Object.assign(new Error("outer"), { cause: new Error("inner") }))).toBe("inner | outer");
    expect(describeFailure(undefined)).toBe("unknown error");
  });

  it("dev-setup: prints the env lines without touching any file", () => {
    expect(LOCAL_ADMIN_URL).toContain("127.0.0.1:54329");
    expect(DEV_DATABASE).toBe("wayfold_dev");
    const lines = envLines({ appUrl: "postgres://app@h/db", platformUrl: "postgres://platform@h/db", migrationUrl: "postgres://owner@h/db" }).split("\n");
    expect(lines).toEqual(
      expect.arrayContaining([
        "DATABASE_URL=postgres://app@h/db",
        "DATABASE_PLATFORM_URL=postgres://platform@h/db",
        "DATABASE_MIGRATION_URL=postgres://owner@h/db",
        "DATABASE_DRIVER=pg",
        "CREDENTIAL_ENCRYPTION_ACTIVE_KEY=v1",
      ]),
    );
    const key = lines.find((line) => line.startsWith("CREDENTIAL_ENCRYPTION_KEYS=v1:"))!.split("v1:")[1]!;
    expect(Buffer.from(key, "base64")).toHaveLength(32);
    expect(lines.find((line) => line.startsWith("SESSION_SECRET="))!.length).toBeGreaterThan(32 + "SESSION_SECRET=".length);
  });
});
