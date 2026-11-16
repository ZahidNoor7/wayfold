import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Session } from "@/server/auth/sessions";
import { withTenant } from "@/server/db/context";
import { auditLogs, integrations, memberships, platformAdmins, roles, supportAccessGrants } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { getAdapter, registerAdapter } from "@/server/integrations/registry";
import { resetKeyring } from "@/server/integrations/service";
import type { Credentials, ProviderAdapter, TestResult } from "@/server/integrations/types";
import { withPlatform } from "@/server/platform/db";
import type { SystemRoleKey } from "@/server/rbac/permissions";
import { createUser, randomId } from "../../helpers/fixtures";

/** Postgres error code of a rejected statement, wherever the driver put it. */
export async function pgCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code ?? "unknown";
  }
}

/** Resolves to the rejection of `promise`, failing the test if it fulfils. */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the promise to reject");
}

/* ------------------------------------------------------------- sessions */

/** An in-memory session, as `validateSessionToken` would return it. */
export function sessionFor(
  user: { id: string; email: string },
  activeTenantId: string | null,
  options: { supportGrantId?: string | null; emailVerified?: boolean } = {},
): Session {
  return {
    id: randomId(),
    user: { id: user.id, email: user.email, name: "Test User", emailVerified: options.emailVerified ?? true },
    activeTenantId,
    supportGrantId: options.supportGrantId ?? null,
    expiresAt: new Date(Date.now() + 3_600_000),
  };
}

export async function addMember(
  tenantId: string,
  userId: string,
  role: SystemRoleKey | { roleId: string } = "staff",
  status: "active" | "deactivated" = "active",
): Promise<void> {
  await withPlatform(async (tx) => {
    let roleId: string;
    if (typeof role === "string") {
      const [row] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.systemKey, role)))
        .limit(1);
      roleId = row!.id;
    } else {
      roleId = role.roleId;
    }
    await tx.insert(memberships).values({ tenantId, userId, roleId, status });
  });
}

export async function createPlatformAdmin(role: "owner" | "support" = "support"): Promise<{ id: string; email: string }> {
  const user = await createUser();
  await withPlatform((tx) => tx.insert(platformAdmins).values({ userId: user.id, role }));
  return user;
}

export async function createGrant(input: {
  tenantId: string;
  requestedBy: string;
  status?: "requested" | "approved" | "denied" | "revoked" | "expired";
  expiresAt?: Date | null;
}): Promise<string> {
  const [row] = await withPlatform((tx) =>
    tx
      .insert(supportAccessGrants)
      .values({
        tenantId: input.tenantId,
        requestedBy: input.requestedBy,
        reason: "Investigating a reported booking problem",
        status: input.status ?? "approved",
        expiresAt: input.expiresAt === undefined ? new Date(Date.now() + 3_600_000) : input.expiresAt,
      })
      .returning({ id: supportAccessGrants.id }),
  );
  return row!.id;
}

/* ---------------------------------------------------------------- audit */

export function auditFor(tenantId: string) {
  return withTenant(tenantId, ({ tx }) =>
    tx.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)).orderBy(asc(auditLogs.createdAt), asc(auditLogs.id)),
  );
}

/* --------------------------------------------------------- integrations */

export const FAKE_MAIL = "fake_mail";
export const FAKE_MAPS = "fake_maps";

/** Distinctive values, so a leak anywhere is easy to assert on. */
export const SECRETS = {
  apiKey: "plain-APIKEY-4f9a1c7e22d0",
  apiSecret: "plain-APISECRET-88b3e6d154aa",
} as const;

export const CONFIG = { host: "smtp.fake-provider.test" } as const;

type FakeCredentials = Credentials<{ host: string }, { apiKey: string; apiSecret: string }>;
type FakeTest = (credentials: FakeCredentials, signal: AbortSignal) => Promise<TestResult>;

export interface FakeProvider {
  /** What the next provider call does. Tests replace this freely. */
  test: FakeTest;
  calls: { credentials: FakeCredentials; signal: AbortSignal }[];
  reset(): void;
}

const provider: FakeProvider = {
  test: async () => ({ ok: true }),
  calls: [],
  reset() {
    this.test = async () => ({ ok: true });
    this.calls = [];
  },
};

function fakeAdapter(id: string, category: "email" | "maps"): ProviderAdapter<FakeCredentials["config"], FakeCredentials["secrets"]> {
  return {
    id,
    category,
    name: id === FAKE_MAIL ? "Fake Mail" : "Fake Maps",
    description: "In-memory provider used by the test suite.",
    fields: [
      { key: "host", label: "Host", type: "text", secret: false, required: true },
      { key: "apiKey", label: "API key", type: "password", secret: true, required: true },
      { key: "apiSecret", label: "API secret", type: "password", secret: true, required: true },
    ],
    configSchema: z.object({ host: z.string().min(1, "Enter the host.") }),
    secretSchema: z.object({
      apiKey: z.string().min(8, "Enter the API key."),
      apiSecret: z.string().min(8, "Enter the API secret."),
    }),
    test(credentials, signal) {
      provider.calls.push({ credentials, signal });
      return provider.test(credentials, signal);
    },
  };
}

/**
 * Registers two fake providers (one e-mail, one maps) in this test file's
 * registry and returns the handle that controls their `test` call.
 */
export function installFakeProviders(): FakeProvider {
  if (!getAdapter(FAKE_MAIL)) registerAdapter(fakeAdapter(FAKE_MAIL, "email"));
  if (!getAdapter(FAKE_MAPS)) registerAdapter(fakeAdapter(FAKE_MAPS, "maps"));
  provider.reset();
  return provider;
}

/** The stored row, read on the platform connection so no policy hides it. */
export async function storedIntegration(id: string) {
  const [row] = await withPlatform((tx) => tx.select().from(integrations).where(eq(integrations.id, id)).limit(1));
  return row ?? null;
}

/* ---------------------------------------------------------- key rotation */

const ORIGINAL_KEYS = {
  keys: process.env.CREDENTIAL_ENCRYPTION_KEYS!,
  active: process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY!,
};

/**
 * Points the credential keyring at another active version (or key list), as
 * a deploy would during a rotation. Call `restoreKeys` afterwards.
 */
export function switchKeys(active: string, keys: string = ORIGINAL_KEYS.keys): void {
  process.env.CREDENTIAL_ENCRYPTION_KEYS = keys;
  process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY = active;
  resetEnvCache();
  resetKeyring();
}

export function restoreKeys(): void {
  switchKeys(ORIGINAL_KEYS.active, ORIGINAL_KEYS.keys);
}

/** The v2 entry on its own: what the key list looks like once v1 is retired. */
export function keysWithoutV1(): string {
  return ORIGINAL_KEYS.keys
    .split(",")
    .filter((entry) => entry.startsWith("v2:"))
    .join(",");
}
