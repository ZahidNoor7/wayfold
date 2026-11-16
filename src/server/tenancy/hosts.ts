/**
 * Pure host classification, shared by the request proxy and by tests. No I/O:
 * the proxy only decides which part of the app a host belongs to; the tenant
 * itself is resolved (and verified) from the database by the storefront.
 */
export type HostTarget =
  | { kind: "app" }
  | { kind: "marketing" }
  /** `{slug}.rootDomain` */
  | { kind: "tenant"; site: string }
  /** Any other host: a candidate custom domain. */
  | { kind: "custom"; site: string }
  | { kind: "invalid" };

export interface HostConfig {
  rootDomain: string;
  appHost: string;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Lower-cases, strips the port and a trailing dot. Returns null if malformed. */
export function normaliseHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const value = host.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(value)) return null;
  return value;
}

const stripPort = (host: string) => host.replace(/:\d+$/, "");

export function classifyHost(rawHost: string | null | undefined, config: HostConfig): HostTarget {
  const host = normaliseHost(rawHost);
  if (!host) return { kind: "invalid" };

  const root = config.rootDomain.toLowerCase();
  const app = config.appHost.toLowerCase();
  if (host === app) return { kind: "app" };
  if (host === root || host === `www.${root}`) return { kind: "marketing" };

  if (host.endsWith(`.${root}`)) {
    const label = host.slice(0, -(root.length + 1));
    // Exactly one label: nested sub-domains are never tenants.
    if (!LABEL.test(label)) return { kind: "invalid" };
    return { kind: "tenant", site: label };
  }

  const bare = stripPort(host);
  if (!HOSTNAME.test(bare)) return { kind: "invalid" };
  return { kind: "custom", site: bare };
}

/** Public origin of a tenant's storefront on the platform domain. */
export function tenantOrigin(slug: string, config: HostConfig, protocol: "http" | "https" = "https"): string {
  return `${protocol}://${slug}.${config.rootDomain}`;
}
