import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { TenantScope } from "../db/context";
import { tenantSettings } from "../db/schema";
import { ValidationError } from "../errors";

export const bookingSettingsSchema = z.object({
  /** How long a pending request holds its seats. */
  holdHours: z.number().int().min(1).max(168).default(24),
  /** How far ahead customers may book. */
  horizonDays: z.number().int().min(7).max(730).default(365),
  /** Earliest bookable day, counted from today. */
  minNoticeDays: z.number().int().min(0).max(60).default(1),
  /** ISO weekdays (1 = Monday ... 7 = Sunday) on which nothing runs. */
  weeklyDaysOff: z.array(z.number().int().min(1).max(7)).max(6).default([]),
  /** Two to four letters that start every booking reference. */
  referencePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}$/)
    .default("WF"),
});
export type BookingSettings = z.infer<typeof bookingSettingsSchema>;

export const promotionSettingsSchema = z.object({
  /** Whether customers may ask for a discount on the storefront. */
  requestsEnabled: z.boolean().default(true),
  /** Largest discount a request may ask for, as a percentage. Never shown to customers. */
  maxRequestPercent: z.number().int().min(1).max(90).default(30),
  /** Promised response time shown to customers. */
  responseDays: z.number().int().min(1).max(3).default(2),
});
export type PromotionSettings = z.infer<typeof promotionSettingsSchema>;

/** Merges a patch over current settings: `undefined` means "leave as is". */
function applyPatch<T extends z.ZodType>(schema: T, current: z.output<T>, input: unknown): z.output<T> {
  const patch = Object.fromEntries(Object.entries((input ?? {}) as Record<string, unknown>).filter(([, value]) => value !== undefined));
  const result = schema.safeParse({ ...(current as object), ...patch });
  if (!result.success) {
    throw new ValidationError(undefined, z.flattenError(result.error).fieldErrors as Record<string, string[]>);
  }
  return result.data;
}

async function readRow(scope: TenantScope) {
  const [row] = await scope.tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, scope.tenantId)).limit(1);
  return row ?? null;
}

async function writeSection(scope: TenantScope, section: "booking" | "promotions" | "site", value: Record<string, unknown>) {
  await scope.tx
    .insert(tenantSettings)
    .values({ tenantId: scope.tenantId, [section]: value })
    .onConflictDoUpdate({ target: tenantSettings.tenantId, set: { [section]: value } });
}

/** Stored values over defaults. Unknown or invalid stored data falls back to defaults. */
export async function getBookingSettings(scope: TenantScope): Promise<BookingSettings> {
  const parsed = bookingSettingsSchema.safeParse((await readRow(scope))?.booking ?? {});
  return parsed.success ? parsed.data : bookingSettingsSchema.parse({});
}

export async function updateBookingSettings(scope: TenantScope, input: unknown): Promise<BookingSettings> {
  const next = applyPatch(bookingSettingsSchema, await getBookingSettings(scope), input);
  await writeSection(scope, "booking", next);
  return next;
}

export async function getPromotionSettings(scope: TenantScope): Promise<PromotionSettings> {
  const parsed = promotionSettingsSchema.safeParse((await readRow(scope))?.promotions ?? {});
  return parsed.success ? parsed.data : promotionSettingsSchema.parse({});
}

export async function updatePromotionSettings(scope: TenantScope, input: unknown): Promise<PromotionSettings> {
  const next = applyPatch(promotionSettingsSchema, await getPromotionSettings(scope), input);
  await writeSection(scope, "promotions", next);
  return next;
}

/** Raw website content document. Shape and validation live in `./site-content`. */
export async function readSiteDocument(scope: TenantScope): Promise<Record<string, unknown>> {
  return (await readRow(scope))?.site ?? {};
}

export async function writeSiteDocument(scope: TenantScope, document: Record<string, unknown>): Promise<void> {
  await writeSection(scope, "site", document);
}
