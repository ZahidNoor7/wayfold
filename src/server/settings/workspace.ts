import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isValidTimezone } from "@/lib/dates";
import { recordAudit } from "../audit";
import { parseInput, plainText } from "../content/shared";
import type { TenantScope } from "../db/context";
import { mediaAssets, tenants, type TenantBranding, type TenantSocial } from "../db/schema";
import { ForbiddenError, ValidationError } from "../errors";

/** ISO 4217 codes a workspace may price in. */
export const SUPPORTED_CURRENCIES = [
  "AED", "AMD", "ARS", "AUD", "AZN", "BDT", "BGN", "BHD", "BRL", "CAD", "CHF", "CLP", "CNY", "COP", "CZK", "DKK",
  "EGP", "EUR", "GBP", "GEL", "GHS", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JOD", "JPY", "KES", "KRW", "KWD",
  "KZT", "LKR", "MAD", "MXN", "MYR", "NGN", "NOK", "NPR", "NZD", "OMR", "PEN", "PHP", "PKR", "PLN", "QAR", "RON",
  "RSD", "SAR", "SEK", "SGD", "THB", "TRY", "TWD", "TZS", "UAH", "USD", "UZS", "VND", "ZAR",
] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export const THEMES = ["emerald", "caspian", "pomegranate", "graphite"] as const;
export const COLOR_MODES = ["light", "dark", "system"] as const;
export const RADII = ["none", "sm", "md", "lg"] as const;
export const HEADING_FONTS = ["classic", "modern", "sans"] as const;

export const DEFAULT_BRANDING: TenantBranding = { theme: "emerald", mode: "light", radius: "md", font: "classic" };

// Shape first (Intl alone also accepts abbreviations and any casing), then the
// runtime's own tz database decides whether the zone exists.
const TIMEZONE_SHAPE = /^(?:UTC|[A-Z][A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

const HANDLE = /^@?[A-Za-z0-9._-]{1,80}$/;
// Host and path only, optionally with http(s). No other scheme can get in,
// which matters because the storefront turns these into links.
const WEB_ADDRESS = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:\/[^\s<>"'`]*)?$/i;

const socialLink = z
  .string()
  .trim()
  .max(200, "Keep this under 200 characters.")
  .refine((value) => value === "" || HANDLE.test(value) || WEB_ADDRESS.test(value), "Use a profile name or a web address.");

const socialSchema = z.object({
  instagram: socialLink,
  youtube: socialLink,
  facebook: socialLink,
  tiktok: socialLink,
  whatsapp: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\+?[0-9][0-9 ()-]{5,23}$/.test(value), "Use a phone number with its country code."),
});

/** True for a string the URL parser itself accepts as an http(s) address. */
const isHttpUrl = (value: string) => URL.canParse(value) && ["http:", "https:"].includes(new URL(value).protocol);

// Stored value is always empty or a full http(s) URL: a bare host gets
// `https://` and the result must still parse as a URL.
const website = z
  .string()
  .trim()
  .max(200, "Keep this under 200 characters.")
  .refine((value) => value === "" || WEB_ADDRESS.test(value), "Enter a web address such as https://example.com.")
  .transform((value) => (value === "" || /^https?:\/\//i.test(value) ? value : `https://${value}`))
  .refine((value) => value === "" || isHttpUrl(value), "Enter a web address such as https://example.com.");

const LANGUAGE_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;

/** Canonical BCP 47 form (`pt-br` → `pt-BR`), or null when it is not a language tag. */
function canonicalLanguage(value: string): string | null {
  if (!LANGUAGE_SHAPE.test(value)) return null;
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

const languageTag = z
  .string()
  .trim()
  .refine((value) => canonicalLanguage(value) !== null, "Use language codes such as en or pt-BR.")
  .transform((value) => canonicalLanguage(value) ?? value);

const profileFields = {
  name: plainText(80, { min: 2, minMessage: "Add your business name." }),
  tagline: plainText(160),
  description: plainText(2000, { multiline: true }),
  /** Public contact address. Also receives inquiry alerts. Empty clears it. */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.union([z.literal(""), z.email("Enter a valid email address.").max(200, "Enter a valid email address.")])),
  phone: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\+?[0-9][0-9 ()./-]{4,28}$/.test(value), "Enter a phone number."),
  address: plainText(300, { multiline: true }),
  website,
  social: socialSchema.partial(),
  regions: z.array(plainText(80, { min: 1 })).max(30, "List up to 30 regions."),
  languages: z
    .array(languageTag)
    .min(1, "Keep at least one language.")
    .max(12, "List up to 12 languages.")
    .transform((tags) => [...new Set(tags)]),
  currency: z.enum(SUPPORTED_CURRENCIES, "Choose a supported currency."),
  timezone: z
    .string()
    .trim()
    .refine((value) => TIMEZONE_SHAPE.test(value) && isValidTimezone(value), "Choose a time zone such as Europe/London."),
};

/**
 * The columns a workspace may edit about itself. Address (slug), status, plan
 * and limits are deliberately absent: they belong to the platform, and the
 * database refuses them for the runtime role whatever is sent here.
 */
export const updateWorkspaceProfileSchema = z.object(profileFields).partial();
export type UpdateWorkspaceProfileInput = z.input<typeof updateWorkspaceProfileSchema>;

export interface WorkspaceProfile {
  id: string;
  /** Read-only: the workspace address is assigned by the platform. */
  slug: string;
  name: string;
  tagline: string;
  description: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  social: TenantSocial;
  regions: string[];
  languages: string[];
  currency: string;
  timezone: string;
  branding: TenantBranding;
  logoUrl: string | null;
  onboardingCompletedAt: Date | null;
}

const profileColumns = {
  id: tenants.id,
  slug: tenants.slug,
  name: tenants.name,
  tagline: tenants.tagline,
  description: tenants.description,
  email: tenants.email,
  phone: tenants.phone,
  address: tenants.address,
  website: tenants.website,
  social: tenants.social,
  regions: tenants.regions,
  languages: tenants.languages,
  currency: tenants.currency,
  timezone: tenants.timezone,
  branding: tenants.branding,
  onboardingCompletedAt: tenants.onboardingCompletedAt,
};

export async function getWorkspaceProfile(scope: TenantScope): Promise<WorkspaceProfile> {
  // The tenant directory is readable across workspaces by design (host
  // resolution), so the id filter here is the only fence: it is always the
  // scope's own tenant, never an id from input.
  const [row] = await scope.tx.select(profileColumns).from(tenants).where(eq(tenants.id, scope.tenantId)).limit(1);
  if (!row) throw new ForbiddenError("This workspace is not available.");

  const branding = { ...DEFAULT_BRANDING, ...row.branding };
  let logoUrl: string | null = null;
  if (branding.logoMediaId) {
    const [logo] = await scope.tx
      .select({ url: mediaAssets.url })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.id, branding.logoMediaId)))
      .limit(1);
    logoUrl = logo?.url ?? null;
  }
  return { ...row, branding, logoUrl };
}

export async function updateWorkspaceProfile(scope: TenantScope, input: UpdateWorkspaceProfileInput): Promise<WorkspaceProfile> {
  const data = parseInput(updateWorkspaceProfileSchema, input);
  const { social, ...columns } = data;
  // Only keys the caller actually sent; everything else keeps its value.
  const patch: Partial<typeof tenants.$inferInsert> = Object.fromEntries(Object.entries(columns).filter(([, value]) => value !== undefined));

  if (social) {
    const current = await getWorkspaceProfile(scope);
    const merged: Record<string, string | undefined> = { ...current.social, ...social };
    // An empty value removes the link instead of storing a blank one.
    patch.social = Object.fromEntries(Object.entries(merged).filter(([, value]) => value)) as TenantSocial;
  }

  const fields = Object.keys(patch);
  if (fields.length === 0) return getWorkspaceProfile(scope);

  await scope.tx.update(tenants).set(patch).where(eq(tenants.id, scope.tenantId));
  await recordAudit(scope, { action: "workspace.profile_updated", targetType: "workspace", targetId: scope.tenantId, metadata: { fields } });
  return getWorkspaceProfile(scope);
}

/** `H S% L%`, e.g. `160 84% 39%`. The only free-form value that reaches CSS. */
const ACCENT = /^(\d{1,3}(?:\.\d)?) (\d{1,3}(?:\.\d)?)% (\d{1,3}(?:\.\d)?)%$/;

function isAccent(value: string): boolean {
  const match = ACCENT.exec(value);
  if (!match) return false;
  return Number(match[1]) <= 360 && Number(match[2]) <= 100 && Number(match[3]) <= 100;
}

export const updateBrandingSchema = z
  .object({
    theme: z.enum(THEMES, "Choose one of the listed themes."),
    mode: z.enum(COLOR_MODES, "Choose light, dark or system."),
    radius: z.enum(RADII, "Choose one of the listed corner styles."),
    font: z.enum(HEADING_FONTS, "Choose one of the listed heading fonts."),
    /** An image from this workspace's media library, or null for no logo. */
    logoMediaId: z.uuid().nullable(),
    /** Accent override as `H S% L%`, or null to use the theme's own accent. */
    accent: z.string().trim().refine(isAccent, "Use the form H S% L%, for example 160 84% 39%.").nullable(),
  })
  .partial();
export type UpdateBrandingInput = z.input<typeof updateBrandingSchema>;

export async function updateBranding(scope: TenantScope, input: UpdateBrandingInput): Promise<TenantBranding> {
  const data = parseInput(updateBrandingSchema, input);
  const changes = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Partial<TenantBranding>;
  const current = (await getWorkspaceProfile(scope)).branding;
  const fields = Object.keys(changes);
  if (fields.length === 0) return current;

  if (changes.logoMediaId) {
    // Branding is JSON, so no foreign key guards this link: check it here.
    const [logo] = await scope.tx
      .select({ id: mediaAssets.id, resourceType: mediaAssets.resourceType })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.id, changes.logoMediaId)))
      .limit(1);
    if (!logo || logo.resourceType !== "image") {
      throw new ValidationError(undefined, { logoMediaId: ["Choose an image from your media library."] });
    }
  }

  const merged = { ...current, ...changes };
  // Rebuilt key by key so nothing outside the known shape is ever stored.
  const next: TenantBranding = {
    theme: merged.theme,
    mode: merged.mode,
    radius: merged.radius,
    font: merged.font,
    ...(merged.logoMediaId ? { logoMediaId: merged.logoMediaId } : {}),
    ...(merged.accent ? { accent: merged.accent } : {}),
  };

  await scope.tx.update(tenants).set({ branding: next }).where(eq(tenants.id, scope.tenantId));
  await recordAudit(scope, { action: "workspace.branding_updated", targetType: "workspace", targetId: scope.tenantId, metadata: { fields } });
  return next;
}

/** Marks first-run setup as finished. Idempotent: the first timestamp is kept. */
export async function completeOnboarding(scope: TenantScope): Promise<Date> {
  const current = await getWorkspaceProfile(scope);
  if (current.onboardingCompletedAt) return current.onboardingCompletedAt;
  const now = new Date();
  await scope.tx.update(tenants).set({ onboardingCompletedAt: now }).where(eq(tenants.id, scope.tenantId));
  await recordAudit(scope, { action: "workspace.onboarding_completed", targetType: "workspace", targetId: scope.tenantId });
  return now;
}
