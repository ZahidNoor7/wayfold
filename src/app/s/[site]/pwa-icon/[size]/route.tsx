import { ImageResponse } from "next/og";
import { renderAppIcon } from "@/components/pwa/app-icon";
import { iconColors } from "@/components/storefront/theme-colors";
import { appIconLetter } from "@/lib/storefront-format";
import { requireActiveSite } from "@/server/storefront/context";

const SIZES: Record<string, { size: number; maskable: boolean }> = {
  "180": { size: 180, maskable: false },
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  maskable: { size: 512, maskable: true },
};

/** A storefront's app icon: the business's initial in its theme colours, drawn on request. */
export async function GET(_request: Request, { params }: { params: Promise<{ site: string; size: string }> }) {
  const { site, size } = await params;
  const spec = Object.hasOwn(SIZES, size) ? SIZES[size] : undefined;
  if (!spec) return new Response(null, { status: 404 });

  const tenant = await requireActiveSite(site);
  const { background, foreground } = iconColors(tenant.branding);
  return new ImageResponse(
    renderAppIcon({ size: spec.size, maskable: spec.maskable, background, foreground, letter: appIconLetter(tenant.name) }),
    { width: spec.size, height: spec.size, headers: { "Cache-Control": "public, max-age=3600", Vary: "Host" } },
  );
}
