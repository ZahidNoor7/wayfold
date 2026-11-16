/**
 * Where people reach Wayfold support. A constant rather than configuration:
 * it appears on pages that must render even when the environment is broken.
 */
export const SUPPORT_EMAIL = "support@wayfold.com";

/** `mailto:` link with a prefilled subject, e.g. for a suspended workspace. */
export function supportMailto(subject?: string): string {
  return subject ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}` : `mailto:${SUPPORT_EMAIL}`;
}
