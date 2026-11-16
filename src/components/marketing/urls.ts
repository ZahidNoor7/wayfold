import "server-only";
import { env } from "@/server/env";

/**
 * Wayfold runs on two hosts: the marketing site on the root domain and the
 * app (sign-in, dashboard) on the app host. Links that cross between them are
 * absolute, so the browser makes a normal navigation instead of the router
 * trying to load another origin's page in place.
 */
function protocol(): "http" | "https" {
  return env().APP_URL.startsWith("https://") ? "https" : "http";
}

/** Absolute URL on the app host, e.g. `appUrl("/register")`. */
export function appUrl(path: string): string {
  return new URL(path, env().APP_URL).toString();
}

/** Absolute URL on the marketing site, e.g. `marketingUrl("/pricing")`. */
export function marketingUrl(path = "/"): string {
  return new URL(path, `${protocol()}://${env().ROOT_DOMAIN}`).toString();
}

/** The address a workspace's website gets, e.g. `sunrise-tours.wayfold.com`. */
export function workspaceAddress(slug: string): string {
  return `${slug}.${env().ROOT_DOMAIN}`;
}

export function rootDomain(): string {
  return env().ROOT_DOMAIN;
}
