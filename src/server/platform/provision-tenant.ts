import "server-only";
import { eq } from "drizzle-orm";
import { memberships, plans, roles, subscriptions, tenants } from "../db/schema";
import { SYSTEM_ROLES } from "../rbac/permissions";
import { withPlatform } from "./db";

export const RESERVED_SLUGS = new Set([
  "www", "app", "api", "admin", "platform", "wayfold", "mail", "smtp", "ftp", "cdn", "static", "assets",
  "status", "help", "support", "docs", "blog", "billing", "auth", "login", "register", "signup", "dashboard",
  "workspace", "s", "_next", "test", "staging", "dev", "demo", "root", "system",
]);

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export class SlugUnavailableError extends Error {
  constructor(readonly reason: "invalid" | "reserved" | "taken") {
    super(`Workspace address is ${reason}`);
    this.name = "SlugUnavailableError";
  }
}

/** Lower-cases and strips a business name down to a DNS-safe label. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function validateSlug(slug: string): void {
  if (!SLUG.test(slug) || slug.includes("--")) throw new SlugUnavailableError("invalid");
  if (RESERVED_SLUGS.has(slug)) throw new SlugUnavailableError("reserved");
}

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  ownerUserId: string;
  /** Plan code; defaults to the plan flagged `is_default`. */
  planCode?: string;
}

export interface ProvisionedTenant {
  tenantId: string;
  slug: string;
  ownerRoleId: string;
}

/**
 * Creates a workspace atomically: tenant row, built-in roles, the owner's
 * membership and the initial subscription. Tenant creation is the one write
 * the runtime role is not allowed to make, so it lives here on the platform
 * connection and nowhere else.
 */
export async function provisionTenant(input: ProvisionTenantInput): Promise<ProvisionedTenant> {
  validateSlug(input.slug);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new Error("Business name must be 2 to 80 characters");

  return withPlatform(async (tx) => {
    const [plan] = await tx
      .select({ id: plans.id })
      .from(plans)
      .where(input.planCode ? eq(plans.code, input.planCode) : eq(plans.isDefault, true))
      .limit(1);
    if (!plan) throw new Error("No subscription plan is available for new workspaces");

    const taken = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug)).limit(1);
    if (taken.length > 0) throw new SlugUnavailableError("taken");

    // Two sign-ups can pass the check above at the same moment; the unique
    // index decides the winner and the loser gets the same "taken" answer.
    const [tenant] = await tx
      .insert(tenants)
      .values({ name, slug: input.slug, planId: plan.id })
      .onConflictDoNothing({ target: tenants.slug })
      .returning({ id: tenants.id });
    if (!tenant) throw new SlugUnavailableError("taken");
    const tenantId = tenant.id;

    const createdRoles = await tx
      .insert(roles)
      .values(
        SYSTEM_ROLES.map((role) => ({
          tenantId,
          systemKey: role.key,
          name: role.name,
          description: role.description,
          permissions: [...role.permissions],
        })),
      )
      .returning({ id: roles.id, systemKey: roles.systemKey });
    const ownerRoleId = createdRoles.find((role) => role.systemKey === "owner")!.id;

    await tx.insert(memberships).values({ tenantId, userId: input.ownerUserId, roleId: ownerRoleId });

    const periodEnd = new Date();
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    await tx.insert(subscriptions).values({ tenantId, planId: plan.id, currentPeriodEnd: periodEnd });

    return { tenantId, slug: input.slug, ownerRoleId };
  });
}
