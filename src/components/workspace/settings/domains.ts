/** Display helpers for the Website domains page. */

/** The address every workspace has: `{slug}.{root}`. A port in the root (development) is kept. */
export function defaultAddress(slug: string, rootDomain: string): string {
  return `${slug}.${rootDomain.trim().toLowerCase()}`;
}

/**
 * What a pasted value becomes before it is sent, so the person sees the bare
 * host the server will store ("https://Tours.Example.com/about" → "tours.example.com").
 */
export function cleanDomainInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
}

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** First check in the browser; the server applies the full rules. */
export function domainInputError(raw: string): string | null {
  const host = cleanDomainInput(raw);
  if (!host) return "Enter a domain name such as tours.example.com.";
  if (!HOSTNAME.test(host)) return "Enter a domain name such as tours.example.com.";
  return null;
}

/** The host part of a TXT record name, as most DNS panels want it ("_wayfold.tours"). */
export function recordHostLabel(recordName: string, domain: string): string {
  const parts = domain.split(".");
  // The zone is usually the last two labels (example.com); many panels add it themselves.
  const zone = parts.slice(-2).join(".");
  return recordName.endsWith(`.${zone}`) ? recordName.slice(0, -(zone.length + 1)) : recordName;
}
