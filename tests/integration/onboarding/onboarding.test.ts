import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { listWorkspaces, resolveWorkspace } from "@/server/auth/workspace";
import { withTenant } from "@/server/db/context";
import { plans, roles, subscriptions, tenants } from "@/server/db/schema";
import { ValidationError } from "@/server/errors";
import {
  checkSlugAvailability,
  createWorkspaceForUser,
  EmailNotVerifiedError,
  isSelfServicePlan,
  suggestSlug,
} from "@/server/onboarding";
import { withPlatform } from "@/server/platform/db";
import { ensureDefaultPlans } from "@/server/platform/plans";
import { SlugUnavailableError } from "@/server/platform/provision-tenant";
import { SYSTEM_ROLES } from "@/server/rbac/permissions";
import { createPlan, createTenant, createUser, randomId, unique } from "../../helpers/fixtures";

async function caught(run: () => Promise<unknown>): Promise<Error & { code?: string; reason?: string; fieldErrors?: Record<string, string[]> }> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the call to throw");
}

async function verifiedUser() {
  const user = await createUser();
  return { ...user, emailVerified: true };
}

async function tenantRow(id: string) {
  const [row] = await withPlatform((tx) => tx.select().from(tenants).where(eq(tenants.id, id)));
  return row!;
}

describe("onboarding", () => {
  beforeAll(async () => {
    await ensureDefaultPlans();
  });

  describe("createWorkspaceForUser", () => {
    it("creates a complete workspace owned by the user", async () => {
      const user = await verifiedUser();
      const slug = unique("caspian");
      const tenantId = await createWorkspaceForUser(user, { name: "  Caspian Trails  ", slug: slug.toUpperCase() });

      const tenant = await tenantRow(tenantId);
      expect(tenant).toMatchObject({ name: "Caspian Trails", slug, status: "active" });

      // Built-in roles, the owner's membership and a subscription all exist.
      const seeded = await withTenant(tenantId, ({ tx }) => tx.select({ key: roles.systemKey }).from(roles), { userId: user.id });
      expect(seeded.map((role) => role.key).sort()).toEqual(SYSTEM_ROLES.map((role) => role.key).sort());
      const [subscription] = await withTenant(tenantId, ({ tx }) => tx.select().from(subscriptions));
      expect(subscription).toMatchObject({ planId: tenant.planId, status: "active" });

      expect(await listWorkspaces(user.id)).toEqual([expect.objectContaining({ tenantId, slug, roleName: "Owner" })]);
      const resolution = await resolveWorkspace({
        id: randomId(),
        user: { id: user.id, email: user.email, name: "Owner", emailVerified: true },
        activeTenantId: tenantId,
        supportGrantId: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(resolution.ok && resolution.workspace.isOwner).toBe(true);
    });

    it("requires a verified e-mail address", async () => {
      const user = await createUser();
      const slug = unique("unverified");
      const error = await caught(() => createWorkspaceForUser({ id: user.id, emailVerified: false }, { name: "Not Yet", slug }));
      expect(error).toBeInstanceOf(EmailNotVerifiedError);
      expect(error.code).toBe("email_not_verified");
      expect((await checkSlugAvailability(slug)).available).toBe(true);
      expect(await listWorkspaces(user.id)).toEqual([]);
    });

    it("derives a free address from the business name when none is given", async () => {
      const user = await verifiedUser();
      const name = `Şəki Tours ${unique("x")}`;
      const first = await tenantRow(await createWorkspaceForUser(user, { name }));
      expect(first.slug).toMatch(/^s-ki-tours-x-[0-9a-f]+$/);

      // The same name again gets the next free variant instead of failing.
      const second = await tenantRow(await createWorkspaceForUser(user, { name, slug: "" }));
      expect(second.slug).toBe(`${first.slug}-2`);
      expect((await listWorkspaces(user.id)).map((workspace) => workspace.slug).sort()).toEqual([first.slug, second.slug].sort());
    });

    it("rejects an invalid, reserved or taken address with SlugUnavailableError", async () => {
      const user = await verifiedUser();
      const existing = await createTenant();
      const cases: [string, string][] = [
        ["ab", "invalid"],
        ["has space", "invalid"],
        ["double--hyphen", "invalid"],
        ["admin", "reserved"],
        ["www", "reserved"],
        [existing.slug, "taken"],
        [existing.slug.toUpperCase(), "taken"],
      ];
      for (const [slug, reason] of cases) {
        const error = await caught(() => createWorkspaceForUser(user, { name: "Valid Name", slug }));
        expect(error).toBeInstanceOf(SlugUnavailableError);
        expect(error.reason).toBe(reason);
      }
      expect(await listWorkspaces(user.id)).toEqual([]);
    });

    it("validates the business name", async () => {
      const user = await verifiedUser();
      for (const name of ["", " a ", "x".repeat(81)]) {
        const error = await caught(() => createWorkspaceForUser(user, { name, slug: unique("ok") }));
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.fieldErrors).toHaveProperty("name");
      }
    });

    it("lets a user choose only a public, free plan for themselves", async () => {
      const user = await verifiedUser();
      const freePublic = await createPlan();
      const paidPublic = await createPlan();
      const freePrivate = await createPlan();
      await withPlatform(async (tx) => {
        await tx.update(plans).set({ isPublic: true }).where(eq(plans.id, freePublic.id));
        await tx.update(plans).set({ isPublic: true, priceMonthly: 2_900, priceYearly: 29_000 }).where(eq(plans.id, paidPublic.id));
      });

      const tenantId = await createWorkspaceForUser(user, { name: "On A Plan", slug: unique("plan"), planCode: freePublic.code });
      expect((await tenantRow(tenantId)).planId).toBe(freePublic.id);

      // A paid plan, a private plan and a made-up code all get the same answer.
      for (const planCode of [paidPublic.code, freePrivate.code, "enterprise", "no-such-plan"]) {
        const error = await caught(() => createWorkspaceForUser(user, { name: "Sneaky", slug: unique("sneak"), planCode }));
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.fieldErrors).toEqual({ planCode: ["That plan cannot be selected at sign-up."] });
      }
      expect(await listWorkspaces(user.id)).toHaveLength(1);

      expect(isSelfServicePlan({ isPublic: true, priceMonthly: 0, priceYearly: 0 })).toBe(true);
      expect(isSelfServicePlan({ isPublic: true, priceMonthly: 0, priceYearly: 100 })).toBe(false);
      expect(isSelfServicePlan({ isPublic: false, priceMonthly: 0, priceYearly: 0 })).toBe(false);
    });

    it("puts a workspace without a chosen plan on the default plan", async () => {
      const user = await verifiedUser();
      const tenantId = await createWorkspaceForUser(user, { name: "Default Plan Co", slug: unique("dflt") });
      const tenant = await tenantRow(tenantId);
      const [plan] = await withPlatform((tx) => tx.select().from(plans).where(eq(plans.id, tenant.planId)));
      expect(plan).toBeDefined();
      const [subscription] = await withPlatform((tx) => tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)));
      expect(subscription!.planId).toBe(tenant.planId);
    });
  });

  describe("checkSlugAvailability", () => {
    it("reports a free address as available, normalised", async () => {
      const slug = unique("free");
      expect(await checkSlugAvailability(`  ${slug.toUpperCase()} `)).toEqual({ slug, available: true });
    });

    it("explains why an address is unavailable and offers a usable alternative", async () => {
      const existing = await createTenant();

      const taken = await checkSlugAvailability(existing.slug);
      expect(taken).toEqual({ slug: existing.slug, available: false, reason: "taken", suggestion: `${existing.slug}-2` });

      const reserved = await checkSlugAvailability("Admin");
      expect(reserved).toMatchObject({ slug: "admin", available: false, reason: "reserved" });
      const invalid = await checkSlugAvailability("My Tour Company!");
      expect(invalid).toMatchObject({ available: false, reason: "invalid" });
      expect(invalid.suggestion).toMatch(/^my-tour-company/);

      // Every suggestion is itself available.
      for (const result of [taken, reserved, invalid, await checkSlugAvailability(""), await checkSlugAvailability(undefined as never)]) {
        expect(result.available).toBe(false);
        expect(await checkSlugAvailability(result.suggestion!)).toEqual({ slug: result.suggestion, available: true });
      }
    });
  });

  describe("suggestSlug", () => {
    it("always returns a valid, unused address, whatever the text", async () => {
      for (const text of ["Caspian Trails", "A", "!!!", "Баку Туры", "x".repeat(120), "api", "-- --"]) {
        const slug = await suggestSlug(text);
        expect(slug).toMatch(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/);
        expect(slug).not.toContain("--");
        expect(await checkSlugAvailability(slug)).toEqual({ slug, available: true });
      }
      expect(await suggestSlug("A")).toMatch(/^a-tours/);
      expect((await suggestSlug("x".repeat(120))).length).toBeLessThanOrEqual(40);
    });

    it("falls back to a random tail once the numbered variants are used up", async () => {
      const user = await verifiedUser();
      const base = unique("busy");
      for (const slug of [base, ...[2, 3, 4, 5].map((n) => `${base}-${n}`)]) {
        await createWorkspaceForUser(user, { name: "Busy Name", slug });
      }
      const slug = await suggestSlug(base);
      expect(slug).toMatch(new RegExp(`^${base}-[0-9a-f]{6}$`));
      expect((await checkSlugAvailability(slug)).available).toBe(true);
    });
  });
});
