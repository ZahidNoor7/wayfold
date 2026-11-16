import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs, authTokens, users } from "@/server/db/schema";
import { ValidationError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { SlugUnavailableError } from "@/server/platform/provision-tenant";
import { createTenantManually } from "@/server/platform/tenants";
import { createUser, unique } from "../../helpers/fixtures";
import { caught, createAdmin } from "./helpers";

// Fault injection: provisioning runs in its own transaction after the owner
// account exists, so it can still lose a race for the address. The failure is
// simulated here; everything before and after it is real.
const fault = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock("@/server/platform/provision-tenant", async (original) => {
  const actual = await original<typeof import("@/server/platform/provision-tenant")>();
  return {
    ...actual,
    provisionTenant: (input: Parameters<typeof actual.provisionTenant>[0]) => {
      if (fault.error) throw fault.error;
      return actual.provisionTenant(input);
    },
  };
});

describe("createTenantManually when provisioning fails", () => {
  beforeEach(() => {
    fault.error = null;
  });

  it("removes the account it had just created and reports the address as taken", async () => {
    const owner = await createAdmin();
    const email = `${unique("raced")}@example.test`;
    fault.error = new SlugUnavailableError("taken");

    const error = await caught(() => createTenantManually(owner, { name: "Raced Tours", slug: unique("raced"), ownerEmail: email }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors).toHaveProperty("slug");

    expect(await withPlatform((tx) => tx.select().from(users).where(eq(users.email, email)))).toEqual([]);
    const created = await withPlatform((tx) => tx.select().from(auditLogs).where(eq(auditLogs.actorUserId, owner.userId)));
    expect(created.map((row) => row.action)).not.toContain("tenant.created");
  });

  it("never deletes an account that already existed", async () => {
    const owner = await createAdmin();
    const existing = await createUser();
    fault.error = new Error("connection lost");

    const error = await caught(() => createTenantManually(owner, { name: "Raced Tours", slug: unique("raced"), ownerEmail: existing.email }));
    expect(error.message).toBe("connection lost");

    const [kept] = await withPlatform((tx) => tx.select().from(users).where(eq(users.id, existing.id)));
    expect(kept).toMatchObject({ id: existing.id, status: "active" });
    expect(await withPlatform((tx) => tx.select().from(authTokens).where(eq(authTokens.userId, existing.id)))).toEqual([]);
  });
});
