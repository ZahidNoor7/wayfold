import "server-only";
import { getEntitlements } from "../billing/limits";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { formatMoney, isIsoDate } from "../../lib/dates";
import type { TenantScope } from "../db/context";
import { tenants } from "../db/schema";
import { ValidationError } from "../errors";

export type DiscountType = "percent" | "fixed";

/** Largest percentage any campaign or personal discount may carry. */
export const MAX_PERCENT = 90;
/** Keeps fixed amounts inside a 32-bit integer column with room to spare. */
export const MAX_FIXED_MINOR_UNITS = 100_000_000;

export const FOREIGN_KEY_VIOLATION = "23503";

export const discountTypeSchema = z.enum(["percent", "fixed"]);

export const discountValueSchema = z
  .number("Enter a discount above 0.")
  .int("Enter a whole number.")
  .positive("Enter a discount above 0.")
  .max(MAX_FIXED_MINOR_UNITS, "That amount is too large.");

/** Trimmed and lower-cased before it is checked, so stored e-mails always compare equal. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid e-mail address."));

export const isoDateSchema = z.string().refine(isIsoDate, "Enter a valid date.");

/** Parses service input, turning schema failures into field errors a form can show. */
export function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(undefined, z.flattenError(result.error).fieldErrors as Record<string, string[]>);
  }
  return result.data;
}

/** Shared by campaign and personal-discount schemas: a percentage stops at 90. */
export function checkPercentCap(value: { type: DiscountType; value: number }, ctx: z.core.$RefinementCtx): void {
  if (value.type === "percent" && value.value > MAX_PERCENT) {
    ctx.addIssue({ code: "custom", path: ["value"], message: `Percentages can’t exceed ${MAX_PERCENT}%.` });
  }
}

/** Customer-facing wording, e.g. `15% off` or `$300 off`. */
export function formatDiscount(type: DiscountType, value: number, currency: string): string {
  return type === "percent" ? `${value}% off` : `${formatMoney(value, currency)} off`;
}

/** What one child pays, rounded to a whole minor unit like the booking price snapshot. */
export function childUnitPrice(priceAdult: number, childPricePercent: number): number {
  return Math.round((priceAdult * childPricePercent) / 100);
}

/** Price of a party before any discount, minor units. */
export function partyBaseAmount(tour: { priceAdult: number; childPricePercent: number }, adults: number, children: number): number {
  return adults * tour.priceAdult + children * childUnitPrice(tour.priceAdult, tour.childPricePercent);
}

export interface TenantProfile {
  name: string;
  email: string;
  currency: string;
}

/** The current tenant's display name, contact e-mail and currency. */
export async function tenantProfile(scope: TenantScope): Promise<TenantProfile> {
  const [row] = await scope.tx
    .select({ name: tenants.name, email: tenants.email, currency: tenants.currency })
    .from(tenants)
    .where(eq(tenants.id, scope.tenantId))
    .limit(1);
  return row ?? { name: "", email: "", currency: "USD" };
}

/** Postgres error code and constraint, wherever the driver or Drizzle put them. */
export function pgError(error: unknown): { code?: string; constraint?: string } {
  const e = (error ?? {}) as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return { code: e.cause?.code ?? e.code, constraint: e.cause?.constraint ?? e.constraint };
}

/**
 * Serialises work on one tenant-scoped key until the transaction ends. Used
 * where correctness depends on reading then writing (next reference number,
 * replacing an active personal discount) and no unique index can express it.
 */
export async function lockInTenant(scope: TenantScope, purpose: string, key = ""): Promise<void> {
  const digest = createHash("sha256").update(`wayfold.promotions.${purpose}\n${scope.tenantId}\n${key}`).digest();
  await scope.tx.execute(sql`select pg_advisory_xact_lock(${digest.readInt32BE(0)}::int, ${digest.readInt32BE(4)}::int)`);
}

/**
 * Whether the workspace's plan includes promotions. When it does not, no
 * discount is offered, shown or applied anywhere, while existing campaigns
 * and discounts stay stored for when the plan allows them again.
 */
export async function promotionsEnabled(scope: TenantScope): Promise<boolean> {
  const { features } = await getEntitlements(scope);
  return features.promotions;
}
