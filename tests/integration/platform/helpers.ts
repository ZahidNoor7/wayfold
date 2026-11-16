import { desc, eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll } from "vitest";
import { auditLogs, platformAdmins } from "@/server/db/schema";
import type { PlatformActor } from "@/server/platform/access";
import { withPlatform } from "@/server/platform/db";
import { createUser } from "../../helpers/fixtures";

/** A real user with a real `platform_admins` row, as the session would resolve it. */
export async function createAdmin(role: "owner" | "support" = "owner"): Promise<PlatformActor & { email: string }> {
  const user = await createUser({ name: role === "owner" ? "Olive Owner" : "Sam Support" });
  await withPlatform((tx) => tx.insert(platformAdmins).values({ userId: user.id, role }));
  return { userId: user.id, role, email: user.email };
}

export async function removeAdmin(userId: string): Promise<void> {
  await withPlatform((tx) => tx.delete(platformAdmins).where(eq(platformAdmins.userId, userId)));
}

/** Audit rows written by one actor, newest first. */
export async function auditBy(userId: string) {
  return withPlatform((tx) => tx.select().from(auditLogs).where(eq(auditLogs.actorUserId, userId)).orderBy(desc(auditLogs.createdAt)));
}

/** Resolves to the thrown error, or fails the test when nothing is thrown. */
export async function caught(run: () => Promise<unknown>): Promise<Error & { code?: string; status?: number; fieldErrors?: Record<string, string[]> }> {
  try {
    await run();
  } catch (error) {
    return error as Error & { code?: string; status?: number; fieldErrors?: Record<string, string[]> };
  }
  throw new Error("Expected the call to throw");
}

/**
 * Holds a session-level advisory lock for the lifetime of the enclosing
 * describe block (or file). Test files that touch the same database-wide
 * state take the same lock, which queues them behind each other across
 * workers instead of letting them interleave.
 */
function holdTestLock(name: string): void {
  let client: Client | undefined;
  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_PLATFORM_URL });
    await client.connect();
    await client.query("select pg_advisory_lock(hashtext($1))", [`wayfold-tests:${name}`]);
  });
  afterAll(async () => {
    // Closing the session releases the lock.
    await client?.end();
  });
}

/** `platform_integrations` holds one row per category for the whole database. */
export const holdPlatformIntegrationsLock = () => holdTestLock("platform_integrations");

/** Invoice numbers are one sequence for the whole database; tests that assert on it must not interleave. */
export const holdInvoiceNumberLock = () => holdTestLock("invoice_numbers");
