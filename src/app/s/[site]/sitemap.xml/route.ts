import { latest, sitemapXml, type SitemapEntry } from "@/lib/storefront-format";
import { env } from "@/server/env";
import { inSite, requireActiveSite } from "@/server/storefront/context";
import { getStorefrontShell, loadSitemap, originFromHeaders } from "@/server/storefront/shell";

/**
 * Sitemap of one storefront: its fixed pages, every published tour and every
 * published journal entry, on the host that was asked. Drafts and archived
 * tours are never listed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ site: string }> }) {
  const tenant = await requireActiveSite((await params).site);
  const origin = originFromHeaders(request.headers, env().APP_URL.startsWith("https://") ? "https" : "http");
  if (!origin) return new Response(null, { status: 400 });

  const shell = await getStorefrontShell(tenant);
  const { tours, journal } = await inSite(tenant, loadSitemap);
  const toursChanged = latest(tours.map((tour) => tour.updatedAt));
  const journalChanged = latest(journal.map((entry) => entry.updatedAt));

  const entries: SitemapEntry[] = [
    { path: "/", lastModified: latest([toursChanged, journalChanged]) },
    { path: "/experiences", lastModified: toursChanged },
    ...(shell.showOffers ? [{ path: "/offers" }] : []),
    { path: "/about" },
    { path: "/journey", lastModified: journalChanged },
    { path: "/reviews" },
    { path: "/contact" },
    { path: "/book" },
    { path: "/privacy" },
    { path: "/terms" },
    ...tours.map((tour) => ({ path: `/experiences/${tour.slug}`, lastModified: tour.updatedAt })),
    ...journal.map((entry) => ({ path: `/journey/${entry.slug}`, lastModified: entry.updatedAt })),
  ];

  return new Response(sitemapXml(origin, entries), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600", Vary: "Host" },
  });
}
