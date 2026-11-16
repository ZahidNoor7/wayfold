import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTenant } from "@/server/db/context";
import { auditLogs, sessions } from "@/server/db/schema";
import { withPlatform } from "@/server/platform/db";
import { capturePlatformEmails, stopCapturingPlatformEmails } from "@/server/platform/mailer";
import { requestSupportAccess, startSupportSession } from "@/server/platform/support";
import { approveSupportGrant } from "@/server/support";
import { createTenant } from "../../helpers/fixtures";
import { caught, createAdmin } from "./helpers";

// Fault injection at the transaction boundary: the real transaction runs, and
// when armed it fails at the very end, exactly like a commit that does not go
// through. Nothing about the database itself is replaced.
const fault = vi.hoisted(() => ({ failNextCommit: false }));
vi.mock("@/server/platform/db", async (original) => {
  const actual = await original<typeof import("@/server/platform/db")>();
  return {
    withPlatform: <T>(fn: Parameters<typeof actual.withPlatform<T>>[0]) =>
      actual.withPlatform<T>(async (tx) => {
        const result = await fn(tx);
        if (fault.failNextCommit) {
          fault.failNextCommit = false;
          throw new Error("simulated commit failure");
        }
        return result;
      }),
  };
});

describe("support session atomicity", () => {
  afterEach(() => {
    fault.failNextCommit = false;
    stopCapturingPlatformEmails();
  });

  it("leaves no session behind when its audit record fails to commit", async () => {
    const support = await createAdmin("support");
    const tenant = await createTenant();
    capturePlatformEmails();
    const { grantId } = await requestSupportAccess(support, tenant.tenantId, "Investigating a failed payment webhook");
    await withTenant(
      tenant.tenantId,
      (scope) => approveSupportGrant(scope, { userId: tenant.ownerId, permissions: [], isOwner: true }, grantId, { hours: 1 }),
      { userId: tenant.ownerId },
    );

    fault.failNextCommit = true;
    const error = await caught(() => startSupportSession(support, grantId));
    expect(error.message).toBe("simulated commit failure");

    // Neither half survived: no session without an audit row, no audit row without a session.
    const leftover = await withPlatform((tx) => tx.select().from(sessions).where(eq(sessions.userId, support.userId)));
    expect(leftover).toEqual([]);
    const log = await withPlatform((tx) => tx.select().from(auditLogs).where(eq(auditLogs.tenantId, tenant.tenantId)));
    expect(log.map((row) => row.action)).not.toContain("support.session_started");

    // With the fault gone the same call succeeds and both are written.
    const started = await startSupportSession(support, grantId);
    const now = await withPlatform((tx) => tx.select().from(sessions).where(eq(sessions.userId, support.userId)));
    expect(now).toHaveLength(1);
    expect(now[0]!.supportGrantId).toBe(grantId);
    expect(started.tenantId).toBe(tenant.tenantId);
  });
});
