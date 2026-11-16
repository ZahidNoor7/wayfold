import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import { parseInput, plainText } from "../content/shared";
import type { TenantScope } from "../db/context";
import { mediaAssets } from "../db/schema";
import { ValidationError } from "../errors";
import { readSiteDocument, writeSiteDocument } from "./tenant-settings";

/**
 * Icons a value proposition may use. The storefront maps each name to a
 * component; a name outside this list is refused, so stored content can never
 * choose arbitrary markup.
 */
export const VALUE_PROP_ICONS = [
  "award",
  "calendar",
  "camera",
  "car",
  "clock",
  "compass",
  "globe",
  "handshake",
  "heart",
  "leaf",
  "map",
  "mountain",
  "shield",
  "sparkles",
  "star",
  "sun",
  "users",
  "utensils",
] as const;
export type ValuePropIcon = (typeof VALUE_PROP_ICONS)[number];

const line = (max: number) => plainText(max).default("");
const paragraphs = (max: number) => plainText(max, { multiline: true }).default("");
const mediaId = z.uuid().nullable().default(null);
const year = z.string().trim().regex(/^\d{4}$/, "Use a four-digit year.");

const hero = z.object({
  kicker: line(80),
  headline: line(120),
  /** The italic tail of the headline, rendered after `headline`. */
  headlineEmphasis: line(80),
  body: paragraphs(400),
  imageMediaId: mediaId,
  /** "Now guiding" caption, e.g. "Sheki, Greater Caucasus". */
  nowGuiding: line(120),
});

const stats = z
  .array(z.object({ label: plainText(60, { min: 1 }), value: plainText(20, { min: 1 }) }))
  .max(6, "Show up to 6 figures.");

const valueProps = z
  .array(
    z.object({
      title: plainText(60, { min: 1 }),
      text: plainText(300, { multiline: true }).default(""),
      icon: z.enum(VALUE_PROP_ICONS, "Choose one of the listed icons."),
    }),
  )
  .max(8, "Show up to 8 reasons.");

const about = z.object({
  portraitMediaId: mediaId,
  credentialLine: line(120),
  shortBio: paragraphs(800),
  longBio: paragraphs(5000),
  philosophyQuote: paragraphs(400),
  licenceLine: line(160),
});

const languages = z
  .array(
    z.object({
      name: plainText(40, { min: 1 }),
      level: plainText(40).default(""),
      /** Proficiency bar width. */
      percent: z.number().int().min(0).max(100),
    }),
  )
  .max(12, "List up to 12 languages.");

const skills = z.array(plainText(60, { min: 1 })).max(20, "List up to 20 areas of expertise.");

const qualifications = z
  .array(z.object({ year, title: plainText(120, { min: 1 }), issuer: plainText(120).default("") }))
  .max(20, "List up to 20 qualifications.");

const milestones = z
  .array(z.object({ year, title: plainText(100, { min: 1 }), text: plainText(400, { multiline: true }).default("") }))
  .max(12, "List up to 12 milestones.");

const faq = z
  .array(z.object({ question: plainText(200, { min: 1 }), answer: plainText(2000, { min: 1, multiline: true }) }))
  .max(30, "List up to 30 questions.");

const contact = z
  .object({
    hours: paragraphs(200),
    /** Response-time promise, e.g. "I reply personally within 24 hours." */
    responseTime: line(120),
    mapLatitude: z.number().min(-90).max(90).nullable().default(null),
    mapLongitude: z.number().min(-180).max(180).nullable().default(null),
    serviceLocations: z.array(plainText(60, { min: 1 })).max(30, "List up to 30 locations.").default([]),
  })
  .refine((value) => (value.mapLatitude === null) === (value.mapLongitude === null), {
    path: ["mapLongitude"],
    message: "Set both latitude and longitude, or neither.",
  });

export const SEO_PAGES = ["home", "about", "experiences", "journey", "reviews", "contact", "offers"] as const;
export type SeoPage = (typeof SEO_PAGES)[number];

const seoPage = z.object({ title: line(70), description: line(200) });
// `prefault` runs the empty object through the schema, so a missing page still
// comes back with every key present.
const seo = z.object({
  home: seoPage.prefault({}),
  about: seoPage.prefault({}),
  experiences: seoPage.prefault({}),
  journey: seoPage.prefault({}),
  reviews: seoPage.prefault({}),
  contact: seoPage.prefault({}),
  offers: seoPage.prefault({}),
});

const footer = z.object({ blurb: paragraphs(300) });

const featured = z.object({
  /** How the home page picks its featured tours. */
  mode: z.enum(["manual", "popular", "rated"]).default("manual"),
});

const legal = z.object({ privacy: paragraphs(20_000), terms: paragraphs(20_000) });

/** One schema per section. Every section parses from nothing to usable defaults. */
export const siteContentSections = {
  hero,
  stats,
  valueProps,
  about,
  languages,
  skills,
  qualifications,
  milestones,
  faq,
  contact,
  seo,
  footer,
  featured,
  legal,
} as const;

export type SiteSection = keyof typeof siteContentSections;
export const SITE_SECTIONS = Object.keys(siteContentSections) as SiteSection[];
export type SiteContent = { [K in SiteSection]: z.output<(typeof siteContentSections)[K]> };
export type SiteSectionInput<K extends SiteSection> = z.input<(typeof siteContentSections)[K]>;

const LIST_SECTIONS: ReadonlySet<SiteSection> = new Set(["stats", "valueProps", "languages", "skills", "qualifications", "milestones", "faq"]);

function emptyValue(section: SiteSection): unknown {
  return LIST_SECTIONS.has(section) ? [] : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// TypeScript cannot follow the section key through the schema map, so the
// link between a key and its output type is stated once, here.
function schemaFor<K extends SiteSection>(section: K): z.ZodType<SiteContent[K]> {
  return siteContentSections[section] as unknown as z.ZodType<SiteContent[K]>;
}

function parseSection<K extends SiteSection>(section: K, stored: unknown): SiteContent[K] {
  const schema = schemaFor(section);
  const parsed = schema.safeParse(stored ?? emptyValue(section));
  // Damaged or outdated stored data must not take the storefront down: that
  // one section renders from its defaults instead.
  return parsed.success ? parsed.data : schema.parse(emptyValue(section));
}

/** The content of a workspace that has not written anything yet. */
export function defaultSiteContent(): SiteContent {
  return parseDocument({});
}

function parseDocument(document: Record<string, unknown>): SiteContent {
  const out: Partial<Record<SiteSection, unknown>> = {};
  for (const section of SITE_SECTIONS) out[section] = parseSection(section, document[section]);
  return out as SiteContent;
}

/** Stored content over defaults, section by section. Never throws on bad stored data. */
export async function getSiteContent(scope: TenantScope): Promise<SiteContent> {
  return parseDocument(await readSiteDocument(scope));
}

/** Refuses media ids that are not in this workspace's library. */
async function assertOwnMedia(scope: TenantScope, references: Record<string, string | null>): Promise<void> {
  const wanted = Object.entries(references).filter((entry): entry is [string, string] => entry[1] !== null);
  if (wanted.length === 0) return;
  const found = await scope.tx
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.tenantId, scope.tenantId), inArray(mediaAssets.id, wanted.map(([, id]) => id))));
  const known = new Set(found.map((row) => row.id));
  const missing = wanted.filter(([, id]) => !known.has(id));
  if (missing.length > 0) {
    throw new ValidationError(undefined, Object.fromEntries(missing.map(([field]) => [field, ["Choose an image from your media library."]])));
  }
}

/**
 * Replaces one section. Object sections merge the input over what is stored,
 * so a form may send only the fields it shows; list sections are replaced
 * whole, because order and removal are part of the edit.
 */
export async function updateSiteContent<K extends SiteSection>(scope: TenantScope, section: K, input: unknown): Promise<SiteContent[K]> {
  if (!Object.hasOwn(siteContentSections, section)) throw new ValidationError("That part of the website cannot be edited.");

  // The raw document is kept for the write, so saving one section never
  // rewrites (or discards) what is stored for the others.
  const document = await readSiteDocument(scope);
  const current = parseDocument(document);
  let candidate: unknown = input;
  if (!LIST_SECTIONS.has(section)) {
    if (!isRecord(input)) throw new ValidationError(undefined, { form: ["Send the section's fields as an object."] });
    const stored = current[section] as Record<string, unknown>;
    candidate = { ...stored, ...input };
    if (section === "seo") {
      // One level deeper: a form for one page must not blank the others, or
      // the field of that page it did not send.
      for (const [page, value] of Object.entries(input)) {
        if (isRecord(value) && isRecord(stored[page])) (candidate as Record<string, unknown>)[page] = { ...stored[page], ...value };
      }
    }
  }

  const next = parseInput(schemaFor(section), candidate);

  if (section === "hero") await assertOwnMedia(scope, { imageMediaId: (next as SiteContent["hero"]).imageMediaId });
  if (section === "about") await assertOwnMedia(scope, { portraitMediaId: (next as SiteContent["about"]).portraitMediaId });

  await writeSiteDocument(scope, { ...document, [section]: next });
  await recordAudit(scope, { action: "site_content.updated", targetType: "site_content", metadata: { section } });
  return next;
}
