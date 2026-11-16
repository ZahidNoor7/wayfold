import "server-only";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { cache } from "react";
import { todayIn } from "@/lib/dates";
import { getEntitlements } from "../billing/limits";
import { listPublishedDestinations, type PublicDestination } from "../catalog/storefront";
import { withTenant, type TenantScope } from "../db/context";
import { integrations, journeyEntries, mediaAssets, tours, type TenantSocial } from "../db/schema";
import { whatsappChatLink } from "../integrations/adapters/whatsapp";
import { countPublicOffers } from "../promotions/offers";
import { getSiteContent, type SiteContent } from "../settings/site-content";
import type { SiteTenant } from "../tenancy/resolve";

/**
 * Everything the storefront chrome needs, read once per request: the header
 * (offers badge, WhatsApp button), the footer (blurb, destinations, branding
 * line) and the metadata (SEO copy, share image). Pages reuse `content` from
 * here instead of reading the site document again.
 */

export interface ShellImage {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface ShellWhatsApp {
  /** As the business wrote it, for display. */
  number: string;
  /** Click-to-chat link. */
  url: string;
}

export interface StorefrontShell {
  content: SiteContent;
  /** The home hero image; also the share image. Null until the business picks one. */
  heroImage: ShellImage | null;
  /** Live public offers, for the navigation badge. */
  offerCount: number;
  /** Whether the plan includes promotions (discount requests need it). */
  promotionsEnabled: boolean;
  /** Offers are linked whenever there is one to see. */
  showOffers: boolean;
  /** Published destinations in display order. */
  destinations: PublicDestination[];
  whatsapp: ShellWhatsApp | null;
  /** False when the plan removes the "Powered by Wayfold" line. */
  showPoweredBy: boolean;
  /** Whether any published image needs a credit: links the credits page. */
  hasPhotoCredits: boolean;
}

export interface ShellOptions {
  /** Today's calendar date in the business's timezone. */
  today: string;
  social: TenantSocial;
}

const PHONE = /^\+?[0-9][0-9 ().-]{5,23}$/;

function chatTarget(number: unknown): ShellWhatsApp | null {
  if (typeof number !== "string") return null;
  const value = number.trim();
  // At least seven digits: anything shorter cannot be dialled internationally.
  if (!PHONE.test(value) || value.replace(/\D/g, "").length < 7) return null;
  return { number: value, url: whatsappChatLink(value) };
}

/**
 * The number of the workspace's WhatsApp connection, if it has one that is
 * switched on. Only the public configuration is read: the encrypted secrets
 * of an integration are never touched on a storefront request.
 */
async function messagingNumber(scope: TenantScope): Promise<ShellWhatsApp | null> {
  const [row] = await scope.tx
    .select({ config: integrations.config })
    .from(integrations)
    .where(
      and(
        eq(integrations.tenantId, scope.tenantId),
        eq(integrations.category, "messaging"),
        eq(integrations.provider, "whatsapp"),
        ne(integrations.status, "disabled"),
      ),
    )
    .orderBy(desc(integrations.isDefault), asc(integrations.createdAt))
    .limit(1);
  return chatTarget(row?.config.phoneNumber);
}

/** Library image for a media id stored in site content. Null when it is unset, deleted, or not an image. */
export async function getSiteImage(scope: TenantScope, mediaId: string | null): Promise<ShellImage | null> {
  if (!mediaId) return null;
  const [row] = await scope.tx
    .select({ url: mediaAssets.url, alt: mediaAssets.alt, width: mediaAssets.width, height: mediaAssets.height })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.id, mediaId), eq(mediaAssets.resourceType, "image")))
    .limit(1);
  return row ?? null;
}

export async function loadStorefrontShell(scope: TenantScope, options: ShellOptions): Promise<StorefrontShell> {
  const content = await getSiteContent(scope);
  const { features } = await getEntitlements(scope);
  const offerCount = await countPublicOffers(scope, options.today);
  // A connected WhatsApp number is the deliberate choice; the profile's
  // number is the fallback. A plan without messaging ignores the connection.
  const connected = features.integrations.includes("messaging") ? await messagingNumber(scope) : null;

  return {
    content,
    heroImage: await getSiteImage(scope, content.hero.imageMediaId),
    offerCount,
    promotionsEnabled: features.promotions,
    showOffers: offerCount > 0,
    destinations: await listPublishedDestinations(scope),
    whatsapp: connected ?? chatTarget(options.social.whatsapp),
    showPoweredBy: !features.removeBranding,
    hasPhotoCredits: await hasMediaCredits(scope),
  };
}

async function hasMediaCredits(scope: TenantScope): Promise<boolean> {
  const [row] = await scope.tx
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.tenantId, scope.tenantId), ne(mediaAssets.credit, "")))
    .limit(1);
  return Boolean(row);
}

/**
 * The shell of one storefront request. De-duplicated per request by the
 * tenant object `getSite` returns, so the layout, its metadata and the page
 * share a single read.
 */
export const getStorefrontShell = cache(
  (tenant: Pick<SiteTenant, "id" | "timezone" | "social">): Promise<StorefrontShell> =>
    withTenant(tenant.id, (scope) => loadStorefrontShell(scope, { today: todayIn(tenant.timezone), social: tenant.social })),
);

const HOST = /^[a-z0-9.-]{1,253}(?::\d{1,5})?$/;

/**
 * The public origin a storefront request was made to, from its headers.
 * Canonical links, the sitemap and robots.txt are built on it, so each host a
 * storefront answers on describes itself. Null for a malformed host: nothing
 * is ever built on a value that is not a host name.
 */
export function originFromHeaders(headers: Pick<Headers, "get">, fallbackProtocol: "http" | "https"): string | null {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]!.trim().toLowerCase();
  if (!HOST.test(host)) return null;
  const forwarded = (headers.get("x-forwarded-proto") ?? "").split(",")[0]!.trim().toLowerCase();
  const protocol = forwarded === "http" || forwarded === "https" ? forwarded : fallbackProtocol;
  return `${protocol}://${host}`;
}

export interface SitemapData {
  /** Published tours, each a page of its own. */
  tours: { slug: string; updatedAt: Date }[];
  /** Published journal entries. They are shown on the journal page. */
  journal: { slug: string; updatedAt: Date }[];
}

const SITEMAP_LIMIT = 5000;

/** What a storefront's sitemap lists beyond its fixed pages. Published records only. */
export async function loadSitemap(scope: TenantScope): Promise<SitemapData> {
  const publishedTours = await scope.tx
    .select({ slug: tours.slug, updatedAt: tours.updatedAt })
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.status, "published")))
    .orderBy(asc(tours.sortOrder), asc(tours.slug))
    .limit(SITEMAP_LIMIT);
  const journal = await scope.tx
    .select({ slug: journeyEntries.slug, updatedAt: journeyEntries.updatedAt })
    .from(journeyEntries)
    .where(and(eq(journeyEntries.tenantId, scope.tenantId), eq(journeyEntries.isPublished, true)))
    .orderBy(desc(journeyEntries.updatedAt), asc(journeyEntries.slug))
    .limit(SITEMAP_LIMIT);
  return { tours: publishedTours, journal };
}
