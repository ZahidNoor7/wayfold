import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { SiteFooter } from "@/components/storefront/site-footer";
import { SiteHeader } from "@/components/storefront/site-header";
import { ThemedRoot } from "@/components/theme/themed-root";
import { isCloudinaryUrl } from "@/lib/storefront-format";
import { env } from "@/server/env";
import { requireActiveSite, siteToday } from "@/server/storefront/context";
import { getStorefrontShell, originFromHeaders } from "@/server/storefront/shell";

interface SiteParams {
  params: Promise<{ site: string }>;
}

const appProtocol = () => (env().APP_URL.startsWith("https://") ? "https" : "http");

/**
 * Metadata every storefront page starts from. Pages set their own `title`
 * (it is completed with the business name) and `alternates.canonical`.
 */
export async function generateMetadata({ params }: SiteParams): Promise<Metadata> {
  const { site } = await params;
  const tenant = await requireActiveSite(site);
  const { content, heroImage } = await getStorefrontShell(tenant);
  const origin = originFromHeaders(await headers(), appProtocol());

  const seo = content.seo.home;
  const title = seo.title || (tenant.tagline ? `${tenant.name} — ${tenant.tagline}` : tenant.name);
  // Always set: an empty description would let the root layout's (Wayfold's own) show through.
  const description = seo.description || tenant.description || tenant.tagline || `Tours and experiences with ${tenant.name}.`;
  const shareImage = heroImage && isCloudinaryUrl(heroImage.url) ? heroImage : null;

  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    // `absolute`, not `default`: a default would be wrapped in the root layout's "· Wayfold" template.
    title: { absolute: title, template: `%s — ${tenant.name}` },
    description,
    applicationName: tenant.name,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [{ url: "/pwa-icon/192", sizes: "192x192", type: "image/png" }],
      apple: "/pwa-icon/180",
    },
    appleWebApp: { capable: true, title: tenant.name, statusBarStyle: "default" },
    openGraph: {
      type: "website",
      siteName: tenant.name,
      title,
      description,
      ...(shareImage ? { images: [{ url: shareImage.url, alt: shareImage.alt || tenant.name }] } : {}),
    },
    twitter: { card: shareImage ? "summary_large_image" : "summary", title, description },
  };
}

async function Shell({ params, children }: SiteParams & { children: ReactNode }) {
  const { site } = await params;
  const tenant = await requireActiveSite(site);
  const shell = await getStorefrontShell(tenant);
  const { content } = shell;

  return (
    // `relative isolate`: the header's backdrop strip is placed against this root, behind the page.
    <ThemedRoot appearance={tenant.branding} className="relative isolate overflow-x-clip font-sans">
      <a
        href="#main"
        className="btn btn-default fixed left-4 top-4 z-[60] -translate-y-24 rounded-full transition-transform focus-visible:translate-y-0"
      >
        Skip to content
      </a>
      <SiteHeader
        name={tenant.name}
        offerCount={shell.offerCount}
        showOffers={shell.showOffers}
        whatsappUrl={shell.whatsapp?.url ?? null}
        email={tenant.email}
        phone={tenant.phone}
      />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter
        name={tenant.name}
        blurb={content.footer.blurb || tenant.description || tenant.tagline}
        social={tenant.social}
        showOffers={shell.showOffers}
        destinations={shell.destinations.map(({ name, slug }) => ({ name, slug }))}
        email={tenant.email}
        phone={tenant.phone}
        whatsapp={shell.whatsapp}
        address={tenant.address}
        hours={content.contact.hours}
        licenceLine={content.about.licenceLine}
        year={siteToday(tenant).slice(0, 4)}
        poweredByUrl={shell.showPoweredBy ? `${appProtocol()}://${env().ROOT_DOMAIN}` : null}
      />
    </ThemedRoot>
  );
}

/**
 * The storefront every tenant gets. The tenant comes from the `[site]`
 * segment, which the proxy derives from the request host; an unknown or
 * suspended business is a 404. Its theme is applied on the server, so the
 * first paint already has the right colours, corners and heading font.
 */
export default function SiteLayout({ params, children }: SiteParams & { children: ReactNode }) {
  return (
    // Nothing tenant-specific is known before the tenant resolves, so the
    // fallback is deliberately blank rather than a frame in the wrong theme.
    <Suspense fallback={<div className="min-h-dvh" />}>
      <Shell params={params}>{children}</Shell>
    </Suspense>
  );
}
