/**
 * Where to send someone after signing in, taken from a `?next=` parameter.
 *
 * The value is attacker-controlled (anyone can craft a sign-in link), so only
 * a path on this same origin is ever accepted: it must start with a single
 * "/" and contain nothing a browser could read as another host.
 */
const MAX_LENGTH = 512;

/** Paths that would loop back into signing in or out. */
const NEVER = /^\/(login|logout|register)(\/|\?|#|$)/;

export function safeNextPath(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith("/")) return null;
  // "//host" is protocol-relative, and browsers treat "\" like "/".
  if (raw.startsWith("//") || raw.includes("\\")) return null;
  // Control characters (tab, newline, ...) are stripped by URL parsers, which
  // can turn "/\t/host" into "//host".
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, "http://internal.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "http://internal.invalid") return null;

  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (path.startsWith("//") || NEVER.test(path)) return null;
  return path;
}

/** Appends a safe `next` to an internal path, e.g. `/login?next=%2Fworkspace`. */
export function withNext(path: string, next: string | null | undefined): string {
  const safe = safeNextPath(next);
  if (!safe) return path;
  return `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(safe)}`;
}

/** The invitation token inside a `next` path, when it points at the accept page. */
export function invitationTokenFrom(next: string | null | undefined): string | null {
  const safe = safeNextPath(next);
  if (!safe) return null;
  const url = new URL(safe, "http://internal.invalid");
  if (url.pathname !== "/invitations/accept") return null;
  const token = url.searchParams.get("token");
  return token && token.length <= 200 ? token : null;
}
