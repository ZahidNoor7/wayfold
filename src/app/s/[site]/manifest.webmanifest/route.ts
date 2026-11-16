import type { MetadataRoute } from "next";
import { manifestColors } from "@/components/storefront/theme-colors";
import { shortAppName } from "@/lib/storefront-format";
import { requireActiveSite } from "@/server/storefront/context";

/**
 * Web app manifest of one storefront: installed, it carries the business's
 * name and theme colours, not Wayfold's. The tenant is resolved from the
 * `[site]` segment on every request, and the response is keyed by host.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ site: string }> }) {
  const tenant = await requireActiveSite((await params).site);
  const { themeColor, backgroundColor } = manifestColors(tenant.branding);

  const manifest: MetadataRoute.Manifest = {
    id: "/",
    name: tenant.name,
    short_name: shortAppName(tenant.name),
    ...(tenant.description || tenant.tagline ? { description: tenant.description || tenant.tagline } : {}),
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: backgroundColor,
    theme_color: themeColor,
    categories: ["travel"],
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Experiences", url: "/experiences" },
      { name: "Book a tour", url: "/book" },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      // Short-lived: a rebrand should reach installed apps the same day.
      "Cache-Control": "public, max-age=300",
      Vary: "Host",
    },
  });
}
