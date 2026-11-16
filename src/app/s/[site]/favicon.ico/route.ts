/**
 * Browsers ask every host for /favicon.ico. On a storefront that is the
 * business's own icon, never Wayfold's. The redirect is relative on purpose:
 * behind the host rewrite, `request.url` names the server, not the tenant's
 * host, and an absolute URL built from it would point at the wrong site.
 */
export function GET() {
  // Temporary (307): a permanent redirect is cached by browsers indefinitely.
  return new Response(null, { status: 307, headers: { Location: "/pwa-icon/192" } });
}
