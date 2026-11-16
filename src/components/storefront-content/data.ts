import "server-only";
import type { Metadata } from "next";
import { cache } from "react";
import type { ReviewFilters } from "@/lib/review-display";
import { isCloudinaryUrl } from "@/lib/storefront-format";
import { listPublishedJourneyEntries, type PublicJourneyEntry } from "@/server/content/journey";
import { listPublishedReviews, type PublicReview } from "@/server/content/reviews";
import type { TenantScope } from "@/server/db/context";
import type { SeoPage, SiteContent } from "@/server/settings/site-content";
import { requireActiveSite } from "@/server/storefront/context";
import { getStorefrontShell, type StorefrontShell } from "@/server/storefront/shell";
import type { SiteTenant } from "@/server/tenancy/resolve";
import { excerpt, firstText } from "./text";

export interface SiteData {
  tenant: SiteTenant;
  content: SiteContent;
  /** What the layout already read for this request: WhatsApp target, destinations, share image. */
  shell: StorefrontShell;
}

/**
 * The storefront's tenant and its site content. The shell is read once per
 * request and shared with the layout, so a page and its `generateMetadata`
 * add no read of their own. Unknown and suspended sites are a 404.
 */
export const loadSite = cache(async (site: string): Promise<SiteData> => {
  const tenant = await requireActiveSite(site);
  const shell = await getStorefrontShell(tenant);
  return { tenant, content: shell.content, shell };
});

interface MetadataInput {
  /** Short page title; the layout completes it with the business name. */
  title: string;
  /** Set when the business wrote its own title: used as written for sharing. */
  shareTitle?: string;
  description: string;
  /** Storefront path of the page, e.g. `/about`. Filtered views share it. */
  path: string;
  imageUrl?: string | null;
}

/**
 * Metadata for a storefront page, in the shape the layout expects: a short
 * title it completes with the business name, a canonical path, and sharing
 * tags that repeat both (a page's `openGraph` replaces the layout's whole).
 */
export function buildMetadata(
  { tenant, shell }: Pick<SiteData, "tenant" | "shell">,
  { title, shareTitle, description, path, imageUrl }: MetadataInput,
): Metadata {
  const summary = excerpt(description, 200) || undefined;
  const fullTitle = shareTitle ?? `${title} — ${tenant.name}`;
  const image = [imageUrl, shell.heroImage?.url].find((url) => isCloudinaryUrl(url)) ?? null;
  return {
    title,
    description: summary,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: tenant.name,
      title: fullTitle,
      description: summary,
      url: path,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title: fullTitle, description: summary },
  };
}

/**
 * Metadata for one of the pages the business can write SEO text for. What it
 * wrote wins; otherwise the page's own title and summary are used, then the
 * business's description.
 */
export async function seoMetadata(
  site: string,
  page: SeoPage,
  path: string,
  fallback: (data: SiteData) => { title: string; description?: string },
): Promise<Metadata> {
  const data = await loadSite(site);
  const { tenant, content } = data;
  const defaults = fallback(data);
  const written = content.seo[page].title.trim();
  return buildMetadata(data, {
    title: written || defaults.title,
    ...(written ? { shareTitle: written } : {}),
    description: firstText(content.seo[page].description, defaults.description, tenant.description, tenant.tagline),
    path,
  });
}

/** Published journal entries are read in pages of this size (the service's maximum). */
const JOURNAL_PAGE = 60;
/** More than a journal page can usefully show; a guard, not a product limit. */
const JOURNAL_MAX = 600;

/**
 * Every published journal entry, most recent visit first. The journal page
 * needs the whole set to count entries per destination and category.
 */
export async function loadJournal(scope: TenantScope): Promise<PublicJourneyEntry[]> {
  const entries: PublicJourneyEntry[] = [];
  for (let offset = 0; offset < JOURNAL_MAX; offset += JOURNAL_PAGE) {
    const page = await listPublishedJourneyEntries(scope, { limit: JOURNAL_PAGE, offset });
    entries.push(...page.items);
    if (page.items.length < JOURNAL_PAGE || entries.length >= page.total) break;
  }
  return entries;
}

/** The reviews service returns at most this many rows per call. */
const REVIEW_PAGE = 50;

/**
 * The first `shown` published reviews for the page's filters, with how many
 * match in total. "Load more" raises `shown`, so a shared or reloaded address
 * shows exactly what the visitor had revealed.
 */
export async function loadReviews(
  scope: TenantScope,
  filters: Pick<ReviewFilters, "rating" | "tourId" | "sort" | "shown">,
): Promise<{ items: PublicReview[]; total: number }> {
  const items: PublicReview[] = [];
  let total = 0;
  for (let offset = 0; offset < filters.shown; offset += REVIEW_PAGE) {
    const page = await listPublishedReviews(scope, {
      ...(filters.rating ? { rating: filters.rating } : {}),
      ...(filters.tourId ? { tourId: filters.tourId } : {}),
      sort: filters.sort,
      limit: Math.min(REVIEW_PAGE, filters.shown - offset),
      offset,
    });
    items.push(...page.items);
    total = page.total;
    if (page.items.length === 0 || items.length >= total) break;
  }
  return { items, total };
}
