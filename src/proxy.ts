import { NextResponse, type NextRequest } from "next/server";
import { classifyHost } from "@/server/tenancy/hosts";

/**
 * Host-based routing. One deployment serves three surfaces:
 *
 *   app host            dashboard, auth, platform admin   (routes as written)
 *   root domain         marketing site                    (routes as written)
 *   {slug}.root, custom tenant storefront                 (rewritten to /s/{site}/...)
 *
 * The proxy only classifies the host. It performs no database work and makes
 * no authorisation decision: the storefront resolves and verifies the tenant
 * itself, and every page and action re-checks the session.
 */
const APP_ONLY = /^\/(workspace|workspaces|workspace-suspended|platform|onboarding|login|register|logout|verify-email|forgot-password|reset-password|invitations)(\/|$)/;

/** Files in /public that are identical on every host and must not be rewritten. */
const SHARED_STATIC = /^\/(sw\.js|offline\.html)$/;

/**
 * Platform endpoints that are not tied to a host: the scheduler and uptime
 * monitors call the deployment's own URL, which is neither the app host nor a
 * tenant. They carry no tenant data and authenticate by secret where needed.
 */
const HOSTLESS_API = /^\/api\/(cron|health)$/;

export function proxy(request: NextRequest) {
  const config = {
    rootDomain: process.env.ROOT_DOMAIN ?? "localhost:3000",
    appHost: process.env.APP_HOST ?? "app.localhost:3000",
  };
  const { pathname, search } = request.nextUrl;
  if (HOSTLESS_API.test(pathname)) return NextResponse.next();

  const target = classifyHost(request.headers.get("host"), config);

  if (target.kind === "invalid") return new NextResponse(null, { status: 404 });
  if (SHARED_STATIC.test(pathname)) return NextResponse.next();

  if (target.kind === "tenant" || target.kind === "custom") {
    // Everything on a tenant host lives under that tenant's tree. A request
    // for /s/other/... becomes /s/{site}/s/other/... and simply 404s.
    const url = request.nextUrl.clone();
    url.pathname = `/s/${target.site}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // The storefront tree is internal: never reachable by path from app or root.
  if (pathname === "/s" || pathname.startsWith("/s/")) return new NextResponse(null, { status: 404 });

  // The app host has no landing page of its own: its front door is the dashboard.
  if (target.kind === "app" && pathname === "/") {
    return NextResponse.redirect(new URL("/workspace", request.url));
  }

  if (target.kind === "marketing" && APP_ONLY.test(pathname)) {
    const protocol = request.nextUrl.protocol;
    return NextResponse.redirect(`${protocol}//${config.appHost}${pathname}${search}`);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip build assets and the image optimiser. Everything else, including
    // the manifest and service worker, is routed per host.
    "/((?!_next/static|_next/image).*)",
  ],
};
