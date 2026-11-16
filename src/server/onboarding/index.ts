import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withoutTenant } from "../db/context";
import { plans, tenants } from "../db/schema";
import { AppError, ValidationError } from "../errors";
import { provisionTenant, slugify, SlugUnavailableError, validateSlug } from "../platform/provision-tenant";

/**
 * Self-service workspace creation for a signed-in user. Everything here runs
 * on the tenant-restricted connection; the single cross-tenant step (creating
 * the tenant row) is delegated to `provisionTenant`.
 */

export class EmailNotVerifiedError extends AppError {
  constructor() {
    super("email_not_verified", "Confirm your e-mail address before creating a workspace.", 403);
  }
}

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Enter your business name.").max(80, "Keep the name under 80 characters."),
  /** Left out or blank, an available address is derived from the name. */
  slug: z.string().trim().toLowerCase().max(60).optional(),
  planCode: z.string().trim().min(1).max(40).optional(),
});
export type CreateWorkspaceInput = z.input<typeof createWorkspaceSchema>;

export interface SlugAvailability {
  /** The address as it would be stored (trimmed, lower-cased). */
  slug: string;
  available: boolean;
  reason?: "invalid" | "reserved" | "taken";
  /** A free address close to the one asked for, when it is not available. */
  suggestion?: string;
}

const SLUG_MAX = 40;

// The tenant directory is readable by the runtime role (it is what host
// resolution uses), so availability needs no cross-tenant connection.
async function isTaken(slug: string): Promise<boolean> {
  const rows = await withoutTenant((tx) => tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1));
  return rows.length > 0;
}

function reasonFor(slug: string): "invalid" | "reserved" | null {
  try {
    validateSlug(slug);
    return null;
  } catch (error) {
    if (error instanceof SlugUnavailableError && error.reason !== "taken") return error.reason;
    throw error;
  }
}

function withSuffix(base: string, suffix: string): string {
  return `${base.slice(0, SLUG_MAX - suffix.length - 1).replace(/-+$/g, "")}-${suffix}`;
}

/**
 * A valid, unreserved, unused address derived from free text such as the
 * business name. Falls back to a generic stem when the text has no usable
 * Latin letters or digits.
 */
export async function suggestSlug(text: string): Promise<string> {
  let base = slugify(text);
  if (base.length < 3) base = base ? withSuffix(base, "tours") : "tours";

  const candidates = [base, ...[2, 3, 4, 5].map((n) => withSuffix(base, String(n)))];
  for (const candidate of candidates) {
    if (reasonFor(candidate) === null && !(await isTaken(candidate))) return candidate;
  }
  // Busy name: a random tail ends the search instead of probing forever.
  for (;;) {
    const candidate = withSuffix(base, randomBytes(3).toString("hex"));
    if (reasonFor(candidate) === null && !(await isTaken(candidate))) return candidate;
  }
}

/** For the sign-up form: is this workspace address usable, and if not, what is close? */
export async function checkSlugAvailability(input: string): Promise<SlugAvailability> {
  const slug = String(input ?? "").trim().toLowerCase();
  const reason = reasonFor(slug) ?? ((await isTaken(slug)) ? "taken" : null);
  if (reason === null) return { slug, available: true };
  return { slug, available: false, reason, suggestion: await suggestSlug(slug) };
}

/**
 * A plan someone may pick for themselves at sign-up: listed publicly and
 * free. Paid plans are switched on by the platform (`changeTenantPlan`) once
 * billing is arranged, so choosing one here cannot be a way around paying.
 */
export function isSelfServicePlan(plan: { isPublic: boolean; priceMonthly: number; priceYearly: number }): boolean {
  return plan.isPublic && plan.priceMonthly === 0 && plan.priceYearly === 0;
}

/**
 * Creates a workspace owned by `user` and returns its tenant id.
 *
 * `user` comes from the verified session. Throws `EmailNotVerifiedError` for
 * an unconfirmed address, `SlugUnavailableError` when a requested address is
 * invalid, reserved or taken, and `ValidationError` for anything else.
 */
export async function createWorkspaceForUser(
  user: { id: string; emailVerified: boolean },
  input: CreateWorkspaceInput,
): Promise<string> {
  if (!user.emailVerified) throw new EmailNotVerifiedError();

  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(undefined, z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  const data = parsed.data;

  if (data.planCode) {
    const [plan] = await withoutTenant((tx) =>
      tx
        .select({ isPublic: plans.isPublic, priceMonthly: plans.priceMonthly, priceYearly: plans.priceYearly })
        .from(plans)
        .where(eq(plans.code, data.planCode!))
        .limit(1),
    );
    // One answer for "no such plan" and "not yours to pick": private plan codes stay private.
    if (!plan || !isSelfServicePlan(plan)) {
      throw new ValidationError(undefined, { planCode: ["That plan cannot be selected at sign-up."] });
    }
  }

  let slug: string;
  if (data.slug) {
    slug = data.slug;
    validateSlug(slug);
    if (await isTaken(slug)) throw new SlugUnavailableError("taken");
  } else {
    slug = await suggestSlug(data.name);
  }

  // provisionTenant checks the address again inside its own transaction.
  const { tenantId } = await provisionTenant({ name: data.name, slug, ownerUserId: user.id, planCode: data.planCode });
  return tenantId;
}
