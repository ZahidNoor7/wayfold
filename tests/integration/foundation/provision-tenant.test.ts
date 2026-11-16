import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { resolveWorkspace } from "@/server/auth/workspace";
import { memberships, roles, subscriptions, tenants } from "@/server/db/schema";
import { withPlatform } from "@/server/platform/db";
import { provisionTenant, RESERVED_SLUGS, slugify, SlugUnavailableError, validateSlug } from "@/server/platform/provision-tenant";
import { ALL_PERMISSIONS, SYSTEM_ROLES } from "@/server/rbac/permissions";
import { createPlan, createUser, unique } from "../../helpers/fixtures";
import { rejection, sessionFor } from "./support";

/** Everything that exists for a slug, read on the platform connection. */
async function footprint(slug: string) {
  return withPlatform(async (tx) => {
    const found = await tx.select().from(tenants).where(eq(tenants.slug, slug));
    const ids = found.map((row) => row.id);
    if (ids.length === 0) return { tenants: found, roles: [], memberships: [], subscriptions: [] };
    return {
      tenants: found,
      roles: await tx.select().from(roles).where(inArray(roles.tenantId, ids)),
      memberships: await tx.select().from(memberships).where(inArray(memberships.tenantId, ids)),
      subscriptions: await tx.select().from(subscriptions).where(inArray(subscriptions.tenantId, ids)),
    };
  });
}

const membershipsOf = (userId: string) => withPlatform((tx) => tx.select().from(memberships).where(eq(memberships.userId, userId)));

describe("slugify", () => {
  it.each([
    ["Caspian Trails", "caspian-trails"],
    ["  Baku & Beyond!  ", "baku-beyond"],
    ["Şəki Səyahət", "s-ki-s-yah-t"],
    ["Café Zürich Tours", "cafe-zurich-tours"],
    ["---Already--Dashed---", "already-dashed"],
    ["UPPER lower 123", "upper-lower-123"],
    ["日本ツアー", ""],
    ["", ""],
  ])("turns %j into %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("caps the result at forty characters without a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(39)} tours and travel`);
    expect(slug).toBe("a".repeat(39));
    expect(slugify("x".repeat(100))).toHaveLength(40);
  });
});

describe("validateSlug", () => {
  it.each(["acme", "baku-tours-24", "abc", "a1b", "x".repeat(40)])("accepts %j", (slug) => {
    expect(() => validateSlug(slug)).not.toThrow();
  });

  it.each(["", "a", "ab", "-acme", "acme-", "ac--me", "Acme", "ac me", "ac_me", "ac.me", "acmé", "x".repeat(41), "../admin", "acme\n"])(
    "rejects %j as invalid",
    (slug) => {
      const error = (() => {
        try {
          validateSlug(slug);
        } catch (thrown) {
          return thrown as SlugUnavailableError;
        }
      })();
      expect(error).toBeInstanceOf(SlugUnavailableError);
      expect(error).toMatchObject({ reason: "invalid", name: "SlugUnavailableError", message: "Workspace address is invalid" });
    },
  );

  it("rejects reserved addresses", () => {
    for (const slug of ["www", "app", "api", "admin", "platform", "support", "billing", "login"]) {
      expect(RESERVED_SLUGS.has(slug)).toBe(true);
      expect(() => validateSlug(slug)).toThrow("Workspace address is reserved");
    }
  });
});

describe("provisionTenant", () => {
  it("creates the tenant, built-in roles, the owner's membership and a subscription", async () => {
    const plan = await createPlan();
    const owner = await createUser();
    const slug = unique("biz");

    const result = await provisionTenant({ name: "  Caspian Trails  ", slug, ownerUserId: owner.id, planCode: plan.code });

    const created = await footprint(slug);
    expect(created.tenants).toHaveLength(1);
    expect(created.tenants[0]).toMatchObject({ id: result.tenantId, slug, name: "Caspian Trails", planId: plan.id, status: "active" });
    expect(result.slug).toBe(slug);

    expect(created.roles.map((role) => role.systemKey).sort()).toEqual(SYSTEM_ROLES.map((role) => role.key).sort());
    const ownerRole = created.roles.find((role) => role.systemKey === "owner")!;
    expect(ownerRole.id).toBe(result.ownerRoleId);
    expect(ownerRole.permissions).toEqual(ALL_PERMISSIONS);

    expect(created.memberships).toEqual([expect.objectContaining({ userId: owner.id, roleId: result.ownerRoleId, status: "active" })]);
    expect(created.subscriptions).toEqual([expect.objectContaining({ tenantId: result.tenantId, planId: plan.id, status: "active" })]);
    const period = created.subscriptions[0]!.currentPeriodEnd.getTime() - Date.now();
    expect(period).toBeGreaterThan(27 * 86_400_000);
    expect(period).toBeLessThan(32 * 86_400_000);

    // The owner can immediately work in the new workspace.
    const resolution = await resolveWorkspace(sessionFor(owner, result.tenantId));
    expect(resolution).toMatchObject({ ok: true, workspace: { isOwner: true } });
  });

  it("refuses an invalid or reserved address before touching the database", async () => {
    const plan = await createPlan();
    const owner = await createUser();
    expect(await rejection(provisionTenant({ name: "Acme", slug: "Not Valid", ownerUserId: owner.id, planCode: plan.code }))).toMatchObject({
      reason: "invalid",
    });
    expect(await rejection(provisionTenant({ name: "Acme", slug: "admin", ownerUserId: owner.id, planCode: plan.code }))).toMatchObject({
      reason: "reserved",
    });
    expect(await membershipsOf(owner.id)).toEqual([]);
  });

  it.each(["A", "   x   ", "N".repeat(81)])("refuses the business name %j", async (name) => {
    const plan = await createPlan();
    const owner = await createUser();
    const slug = unique("biz");
    await expect(provisionTenant({ name, slug, ownerUserId: owner.id, planCode: plan.code })).rejects.toThrow("Business name must be 2 to 80 characters");
    expect((await footprint(slug)).tenants).toEqual([]);
  });

  it("refuses an unknown plan and creates nothing", async () => {
    const owner = await createUser();
    const slug = unique("biz");
    await expect(provisionTenant({ name: "Acme", slug, ownerUserId: owner.id, planCode: unique("no-such-plan") })).rejects.toThrow(
      "No subscription plan is available for new workspaces",
    );
    expect((await footprint(slug)).tenants).toEqual([]);
  });

  it("refuses an address that is already taken", async () => {
    const plan = await createPlan();
    const first = await createUser();
    const second = await createUser();
    const slug = unique("biz");
    const winner = await provisionTenant({ name: "First", slug, ownerUserId: first.id, planCode: plan.code });

    const error = (await rejection(provisionTenant({ name: "Second", slug, ownerUserId: second.id, planCode: plan.code }))) as SlugUnavailableError;
    expect(error).toBeInstanceOf(SlugUnavailableError);
    expect(error.reason).toBe("taken");

    const existing = await footprint(slug);
    expect(existing.tenants).toEqual([expect.objectContaining({ id: winner.tenantId, name: "First" })]);
    expect(await membershipsOf(second.id)).toEqual([]);
  });

  it("rolls everything back when a later step fails", async () => {
    const plan = await createPlan();
    const slug = unique("biz");
    // The owner does not exist, so the membership insert violates its foreign key.
    await expect(
      provisionTenant({ name: "Acme", slug, ownerUserId: "0d3c1b52-6f0e-4b63-9a55-0a1f6f6f0099", planCode: plan.code }),
    ).rejects.toThrow();
    expect(await footprint(slug)).toEqual({ tenants: [], roles: [], memberships: [], subscriptions: [] });
  });
});

describe("provisionTenant under a race for the same address", () => {
  it("lets exactly one of two simultaneous sign-ups win, and leaves nothing behind for the loser", async () => {
    const plan = await createPlan();

    // Repeated, because which request reaches the unique index first is timing.
    for (let round = 0; round < 6; round++) {
      const slug = unique("race");
      const contenders = [await createUser(), await createUser()];

      const outcomes = await Promise.allSettled(
        contenders.map((user, index) => provisionTenant({ name: `Contender ${index}`, slug, ownerUserId: user.id, planCode: plan.code })),
      );

      const won = outcomes.flatMap((outcome, index) => (outcome.status === "fulfilled" ? [{ index, value: outcome.value }] : []));
      const lost = outcomes.flatMap((outcome, index) => (outcome.status === "rejected" ? [{ index, reason: outcome.reason as unknown }] : []));
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0]!.reason).toBeInstanceOf(SlugUnavailableError);
      expect((lost[0]!.reason as SlugUnavailableError).reason).toBe("taken");

      const winner = contenders[won[0]!.index]!;
      const loser = contenders[lost[0]!.index]!;
      const after = await footprint(slug);

      // One tenant, with one complete set of rows, all belonging to the winner.
      expect(after.tenants).toEqual([expect.objectContaining({ id: won[0]!.value.tenantId, name: `Contender ${won[0]!.index}` })]);
      expect(after.roles).toHaveLength(SYSTEM_ROLES.length);
      expect(new Set(after.roles.map((role) => role.systemKey)).size).toBe(SYSTEM_ROLES.length);
      expect(after.memberships).toEqual([expect.objectContaining({ userId: winner.id, roleId: won[0]!.value.ownerRoleId })]);
      expect(after.subscriptions).toHaveLength(1);

      // Nothing was created for, or attached to, the loser.
      expect(await membershipsOf(loser.id)).toEqual([]);
      expect(await membershipsOf(winner.id)).toHaveLength(1);
    }
  });

  it("still lets only one win when many sign-ups collide", async () => {
    const plan = await createPlan();
    const slug = unique("race");
    const contenders = await Promise.all(Array.from({ length: 6 }, () => createUser()));

    const outcomes = await Promise.allSettled(
      contenders.map((user) => provisionTenant({ name: "Crowded", slug, ownerUserId: user.id, planCode: plan.code })),
    );

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(failures).toHaveLength(5);
    for (const failure of failures) {
      expect(failure.reason).toBeInstanceOf(SlugUnavailableError);
      expect((failure.reason as SlugUnavailableError).reason).toBe("taken");
    }

    const after = await footprint(slug);
    expect(after.tenants).toHaveLength(1);
    expect(after.roles).toHaveLength(SYSTEM_ROLES.length);
    expect(after.memberships).toHaveLength(1);
    expect(after.subscriptions).toHaveLength(1);

    const attached = await Promise.all(contenders.map((user) => membershipsOf(user.id)));
    expect(attached.filter((rows) => rows.length > 0)).toHaveLength(1);
  });

  it("gives different addresses to simultaneous sign-ups without interference", async () => {
    const plan = await createPlan();
    const users = await Promise.all([createUser(), createUser(), createUser()]);
    const slugs = users.map(() => unique("solo"));

    const results = await Promise.all(
      users.map((user, index) => provisionTenant({ name: "Solo", slug: slugs[index]!, ownerUserId: user.id, planCode: plan.code })),
    );

    expect(new Set(results.map((result) => result.tenantId)).size).toBe(3);
    for (const [index, result] of results.entries()) {
      expect(await membershipsOf(users[index]!.id)).toEqual([expect.objectContaining({ tenantId: result.tenantId })]);
    }
  });
});
