import { robotsTxt } from "@/lib/storefront-format";
import { env } from "@/server/env";
import { requireActiveSite } from "@/server/storefront/context";
import { originFromHeaders } from "@/server/storefront/shell";

/** robots.txt of one storefront: open to every crawler, with the sitemap on the host that was asked. */
export async function GET(request: Request, { params }: { params: Promise<{ site: string }> }) {
  await requireActiveSite((await params).site);
  const origin = originFromHeaders(request.headers, env().APP_URL.startsWith("https://") ? "https" : "http");

  return new Response(robotsTxt(origin), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600", Vary: "Host" },
  });
}
