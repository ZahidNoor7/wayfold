import "server-only";
import { ProviderTimeoutError, TransientProviderError, sanitiseProviderMessage } from "../http";

export interface ProviderFetchOptions {
  headers?: Record<string, string>;
  /** Extra status codes this provider uses for "slow down" (Cloudinary answers 420). */
  transientStatuses?: number[];
}

/**
 * One GET against a provider. Network failures and "try again" statuses are
 * thrown as retryable errors; every other response is returned for the adapter
 * to interpret.
 */
export async function providerGet(
  provider: string,
  url: string,
  signal: AbortSignal,
  options: ProviderFetchOptions = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers: options.headers, signal, cache: "no-store" });
  } catch {
    // The runtime's error can quote the request URL, and some providers take
    // the key in the query string, so the original message is never reused.
    if (signal.aborted) throw new ProviderTimeoutError();
    throw new TransientProviderError(`Could not reach ${provider}. Please try again in a moment.`);
  }
  if (response.status === 429 || response.status >= 500 || options.transientStatuses?.includes(response.status)) {
    throw new TransientProviderError(`${provider} is temporarily unavailable (HTTP ${response.status}). Please try again in a moment.`);
  }
  return response;
}

/** The response body as JSON, or null when it is not JSON. */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Reads a nested string from untrusted JSON without trusting its shape. */
export function stringAt(value: unknown, ...path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() !== "" ? current.trim() : undefined;
}

/**
 * Text that came from a provider, made safe to show and store. Secrets are
 * removed in their plain, base64 and URL-encoded forms, because a server may
 * echo back what it was sent in any of them.
 */
export function providerText(text: string | undefined, secrets: Record<string, string | undefined>, fallback: string): string {
  if (!text) return fallback;
  const variants = new Set<string>();
  for (const value of Object.values(secrets)) {
    if (!value) continue;
    variants.add(value);
    variants.add(Buffer.from(value, "utf8").toString("base64"));
    variants.add(encodeURIComponent(value));
  }
  return sanitiseProviderMessage(text.replace(/\s+/g, " ").trim(), variants);
}

/** Form fields post an empty string for "not set"; schemas treat that as absent. */
export function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}
