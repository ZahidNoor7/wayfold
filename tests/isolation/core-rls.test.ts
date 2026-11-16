import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { appDatabase } from "@/server/db/client";
import { withAuthEmail, withTenant, withUser, withoutTenant } from "@/server/db/context";
import {
  auditLogs,
  integrations,
  invoices,
  memberships,
  plans,
  platformAdmins,
  platformIntegrations,
  roles,
  subscriptions,
  tenantDomains,
  tenants,
  users,
} from "@/server/db/schema";
import { withPlatform } from "@/server/platform/db";
import { createTenant, createUser, unique } from "../helpers/fixtures";

/** Postgres error code of a rejected statement, wherever the driver put it. */
async function pgCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code ?? "unknown";
  }
}

const INSUFFICIENT_PRIVILEGE = "42501";
const FOREIGN_KEY_VIOLATION = "23503";

describe("database-level tenant isolation: core tables", () => {
  it("shows a tenant only its own roles and memberships", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const seen = await withTenant(a.tenantId, async ({ tx }) => ({
      roles: await tx.select({ tenantId: roles.tenantId }).from(roles),
      members: await tx.select({ tenantId: memberships.tenantId }).from(memberships),
    }));

    expect(seen.roles.length).toBeGreaterThan(0);
    expect(seen.roles.every((row) => row.tenantId === a.tenantId)).toBe(true);
    expect(seen.members).toEqual([{ tenantId: a.tenantId }]);

    // Asking for the other tenant by id, bypassing every repository, returns nothing.
    const direct = await withTenant(a.tenantId, ({ tx }) => tx.select().from(roles).where(eq(roles.tenantId, b.tenantId)));
    expect(direct).toEqual([]);
  });

  it("returns no tenant-owned rows when no tenant context is set", async () => {
    await createTenant();
    const rows = await withoutTenant(async (tx) => ({
      roles: await tx.select().from(roles),
      members: await tx.select().from(memberships),
      integrations: await tx.select().from(integrations),
      subscriptions: await tx.select().from(subscriptions),
      audit: await tx.select().from(auditLogs),
    }));
    expect(rows).toEqual({ roles: [], members: [], integrations: [], subscriptions: [], audit: [] });
  });

  it("returns no rows on a raw pooled connection outside any transaction", async () => {
    await createTenant();
    const result = await appDatabase().execute(sql`select count(*)::int as n from roles`);
    expect(result.rows[0]).toEqual({ n: 0 });
  });

  it("rejects writing a row into another tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const code = await pgCode(() =>
      withTenant(a.tenantId, ({ tx }) =>
        tx.insert(roles).values({ tenantId: b.tenantId, name: "Planted", permissions: ["tours.view"] }),
      ),
    );
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);

    const planted = await withTenant(b.tenantId, ({ tx }) => tx.select().from(roles).where(eq(roles.name, "Planted")));
    expect(planted).toEqual([]);
  });

  it("cannot update or delete another tenant's rows", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const changed = await withTenant(a.tenantId, async ({ tx }) => ({
      updated: await tx.update(roles).set({ name: "Hijacked" }).where(eq(roles.tenantId, b.tenantId)).returning(),
      deleted: await tx.delete(memberships).where(eq(memberships.tenantId, b.tenantId)).returning(),
    }));
    expect(changed).toEqual({ updated: [], deleted: [] });

    const intact = await withTenant(b.tenantId, async ({ tx }) => ({
      hijacked: await tx.select().from(roles).where(eq(roles.name, "Hijacked")),
      members: await tx.select().from(memberships),
    }));
    expect(intact.hijacked).toEqual([]);
    expect(intact.members).toHaveLength(1);
  });

  it("cannot move one of its own rows into another tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const code = await pgCode(() =>
      withTenant(a.tenantId, ({ tx }) => tx.update(roles).set({ tenantId: b.tenantId }).where(eq(roles.systemKey, "staff"))),
    );
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("refuses a membership that points at another tenant's role", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const user = await createUser();

    // Even the platform connection cannot create this relationship: the
    // composite foreign key ties a membership's role to its own tenant.
    const code = await pgCode(() =>
      withPlatform((tx) => tx.insert(memberships).values({ tenantId: a.tenantId, userId: user.id, roleId: b.ownerRoleId })),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("defaults tenant_id to the transaction's tenant", async () => {
    const a = await createTenant();
    const [role] = await withTenant(a.tenantId, ({ tx }) =>
      tx.insert(roles).values({ name: "Custom", permissions: [] }).returning({ tenantId: roles.tenantId }),
    );
    expect(role).toEqual({ tenantId: a.tenantId });
  });

  it("does not leak tenant context across pooled connections", async () => {
    const a = await createTenant();
    const b = await createTenant();

    // Interleave many transactions for two tenants over a 4-connection pool,
    // then confirm every connection comes back with an empty context.
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const tenant = i % 2 === 0 ? a : b;
        return withTenant(tenant.tenantId, async ({ tx }) => {
          const seen = await tx.selectDistinct({ tenantId: roles.tenantId }).from(roles);
          return { expected: tenant.tenantId, seen: seen.map((row) => row.tenantId) };
        });
      }),
    );
    for (const result of results) expect(result.seen).toEqual([result.expected]);

    const leftovers = await Promise.all(
      Array.from({ length: 8 }, () =>
        appDatabase().execute(sql`select current_setting('app.tenant_id', true) as tenant, count(*)::int as n from roles`),
      ),
    );
    for (const leftover of leftovers) {
      expect(leftover.rows[0]?.n).toBe(0);
      expect(leftover.rows[0]?.tenant ?? "").toBe("");
    }
  });

  it("rolls back the context together with a failed transaction", async () => {
    const a = await createTenant();
    await expect(
      withTenant(a.tenantId, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const result = await appDatabase().execute(sql`select count(*)::int as n from roles`);
    expect(result.rows[0]).toEqual({ n: 0 });
  });
});

describe("platform-controlled columns and tables", () => {
  it("lets a tenant edit its profile but not its plan, status, limits or slug", async () => {
    const a = await createTenant();
    const other = await createTenant();

    await withTenant(a.tenantId, ({ tx }) => tx.update(tenants).set({ tagline: "Slow travel" }).where(eq(tenants.id, a.tenantId)));

    for (const patch of [
      { planId: other.planId },
      { status: "suspended" as const },
      { limitOverrides: { maxPublishedTours: 9999 } },
      { slug: unique("stolen") },
    ]) {
      const code = await pgCode(() =>
        withTenant(a.tenantId, ({ tx }) => tx.update(tenants).set(patch).where(eq(tenants.id, a.tenantId))),
      );
      expect(code, JSON.stringify(patch)).toBe(INSUFFICIENT_PRIVILEGE);
    }

    const [row] = await withPlatform((tx) => tx.select().from(tenants).where(eq(tenants.id, a.tenantId)));
    expect(row).toMatchObject({ tagline: "Slow travel", planId: a.planId, status: "active", slug: a.slug });
  });

  it("cannot edit another tenant's profile", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const updated = await withTenant(a.tenantId, ({ tx }) =>
      tx.update(tenants).set({ name: "Defaced" }).where(eq(tenants.id, b.tenantId)).returning({ id: tenants.id }),
    );
    expect(updated).toEqual([]);
  });

  it("cannot create or delete tenants from the runtime role", async () => {
    const a = await createTenant();
    expect(
      await pgCode(() => withoutTenant((tx) => tx.insert(tenants).values({ name: "Rogue", slug: unique("rogue"), planId: a.planId }))),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await pgCode(() => withTenant(a.tenantId, ({ tx }) => tx.delete(tenants).where(eq(tenants.id, a.tenantId))))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("cannot grant platform administration from the runtime role", async () => {
    const a = await createTenant();
    const code = await pgCode(() =>
      withTenant(a.tenantId, ({ tx }) => tx.insert(platformAdmins).values({ userId: a.ownerId, role: "owner" }), {
        userId: a.ownerId,
      }),
    );
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("cannot write plans, subscriptions or invoices from the runtime role", async () => {
    const a = await createTenant();
    const end = new Date(Date.now() + 86_400_000);

    expect(await pgCode(() => withTenant(a.tenantId, ({ tx }) => tx.update(plans).set({ maxPublishedTours: 9999 })))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect(
      await pgCode(() => withTenant(a.tenantId, ({ tx }) => tx.update(subscriptions).set({ currentPeriodEnd: end }))),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(
      await pgCode(() =>
        withTenant(a.tenantId, ({ tx }) =>
          tx.insert(invoices).values({
            number: unique("INV"),
            description: "Forged",
            amount: 0,
            currency: "USD",
            status: "paid",
            periodStart: new Date(),
            periodEnd: end,
          }),
        ),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);

    const own = await withTenant(a.tenantId, ({ tx }) => tx.select({ tenantId: subscriptions.tenantId }).from(subscriptions));
    expect(own).toEqual([{ tenantId: a.tenantId }]);
  });

  it("hides platform-managed integrations from the runtime role entirely", async () => {
    const a = await createTenant();
    expect(await pgCode(() => withTenant(a.tenantId, ({ tx }) => tx.select().from(platformIntegrations)))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("keeps the audit log append-only and tenant-scoped", async () => {
    const a = await createTenant();
    const b = await createTenant();

    await withTenant(a.tenantId, ({ tx }) => tx.insert(auditLogs).values({ actorType: "system", action: "test.event" }));

    expect(await pgCode(() => withTenant(a.tenantId, ({ tx }) => tx.update(auditLogs).set({ action: "rewritten" })))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect(await pgCode(() => withTenant(a.tenantId, ({ tx }) => tx.delete(auditLogs)))).toBe(INSUFFICIENT_PRIVILEGE);
    expect(
      await pgCode(() =>
        withTenant(a.tenantId, ({ tx }) =>
          tx.insert(auditLogs).values({ tenantId: b.tenantId, actorType: "system", action: "forged.event" }),
        ),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    // Even the platform connection cannot rewrite history.
    expect(await pgCode(() => withPlatform((tx) => tx.update(auditLogs).set({ action: "rewritten" })))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );

    expect(await withTenant(b.tenantId, ({ tx }) => tx.select().from(auditLogs))).toEqual([]);
    expect(await withTenant(a.tenantId, ({ tx }) => tx.select({ action: auditLogs.action }).from(auditLogs))).toEqual([
      { action: "test.event" },
    ]);
  });
});

describe("identity visibility", () => {
  it("exposes users only to themselves, their workspace, or a lookup by exact e-mail", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const inA = await withTenant(a.tenantId, ({ tx }) => tx.select({ id: users.id }).from(users));
    expect(inA).toEqual([{ id: a.ownerId }]);

    const self = await withUser(b.ownerId, ({ tx }) => tx.select({ id: users.id }).from(users));
    expect(self).toEqual([{ id: b.ownerId }]);

    const byEmail = await withAuthEmail(a.ownerEmail.toUpperCase(), (tx) => tx.select({ id: users.id }).from(users));
    expect(byEmail).toEqual([{ id: a.ownerId }]);

    expect(await withoutTenant((tx) => tx.select().from(users))).toEqual([]);
  });

  it("lets a user change only their own account, and never their status or e-mail", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const touched = await withUser(a.ownerId, ({ tx }) =>
      tx.update(users).set({ name: "Renamed" }).where(eq(users.id, b.ownerId)).returning({ id: users.id }),
    );
    expect(touched).toEqual([]);

    expect(await pgCode(() => withUser(a.ownerId, ({ tx }) => tx.update(users).set({ status: "disabled" })))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect(await pgCode(() => withUser(a.ownerId, ({ tx }) => tx.update(users).set({ email: "x@example.test" })))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("shows a user their memberships across workspaces, read-only", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await withPlatform((tx) => tx.insert(memberships).values({ tenantId: b.tenantId, userId: a.ownerId, roleId: b.ownerRoleId }));

    const mine = await withUser(a.ownerId, ({ tx }) => tx.select({ tenantId: memberships.tenantId }).from(memberships));
    expect(mine.map((row) => row.tenantId).sort()).toEqual([a.tenantId, b.tenantId].sort());

    // Without a tenant context there is no write policy to satisfy.
    const removed = await withUser(a.ownerId, ({ tx }) => tx.delete(memberships).returning({ id: memberships.id }));
    expect(removed).toEqual([]);
  });
});

describe("custom domains", () => {
  it("exposes verified domains for host resolution but keeps pending claims private", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const verified = `${unique("tours")}.example.test`;
    const pending = `${unique("pending")}.example.test`;

    await withTenant(a.tenantId, ({ tx }) =>
      tx.insert(tenantDomains).values([
        { domain: verified, status: "verified", verificationToken: "tok-verified", verifiedAt: new Date() },
        { domain: pending, verificationToken: "tok-pending" },
      ]),
    );

    const publicView = await withoutTenant((tx) => tx.select({ domain: tenantDomains.domain }).from(tenantDomains));
    expect(publicView.map((row) => row.domain)).toContain(verified);
    expect(publicView.map((row) => row.domain)).not.toContain(pending);

    const fromB = await withTenant(b.tenantId, ({ tx }) => tx.select({ domain: tenantDomains.domain }).from(tenantDomains));
    expect(fromB.map((row) => row.domain)).not.toContain(pending);

    // A second tenant may file a claim, but cannot verify a host already proven by another.
    const code = await pgCode(() =>
      withTenant(b.tenantId, ({ tx }) =>
        tx.insert(tenantDomains).values({ domain: verified, status: "verified", verificationToken: "tok-b" }),
      ),
    );
    expect(code).toBe("23505");
  });
});

describe("policy coverage", () => {
  it("has forced row-level security and a policy on every table that carries tenant_id", async () => {
    const result = await withPlatform((tx) =>
      tx.execute<{ table: string; enabled: boolean; forced: boolean; policies: number }>(sql`
        select c.relname as "table", c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
               (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
        where c.relkind = 'r'
        order by 1
      `),
    );
    expect(result.rows.length).toBeGreaterThan(5);
    const unprotected = result.rows.filter((row) => !row.enabled || !row.forced || row.policies === 0);
    expect(unprotected).toEqual([]);
  });

  it("grants the runtime role nothing on tables it was not explicitly given", async () => {
    const result = await withPlatform((tx) =>
      tx.execute<{ table: string }>(sql`
        select c.relname as "table"
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where c.relkind = 'r' and not c.relrowsecurity
          and has_table_privilege('wayfold_app', c.oid, 'SELECT')
        order by 1
      `),
    );
    // Tables readable by the runtime role without row-level security. Each is
    // global by design; adding one here must be a deliberate decision.
    expect(result.rows.map((row) => row.table)).toEqual(["auth_tokens", "plans", "platform_admins", "rate_limits", "sessions"]);
  });
});
