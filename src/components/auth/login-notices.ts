/**
 * Messages the sign-in page may show above its form, chosen by `?notice=`.
 *
 * The parameter only ever selects one of these fixed sentences. Its value is
 * never written into the page, so a crafted link cannot put words in
 * Wayfold's mouth; anything not listed here shows nothing.
 */
export interface LoginNotice {
  tone: "success" | "info";
  message: string;
}

const NOTICES = {
  "password-reset": { tone: "success", message: "Password changed. Sign in with your new password." },
  "email-verified": { tone: "success", message: "E-mail confirmed. Sign in to continue." },
  "support-ended": { tone: "info", message: "Your support session has ended. Sign in again to return to the back office." },
} as const satisfies Record<string, LoginNotice>;

export type LoginNoticeKey = keyof typeof NOTICES;

/** The notice for a `?notice=` value, or null for anything unknown. */
export function loginNotice(value: unknown): LoginNotice | null {
  const key = Array.isArray(value) ? value[0] : value;
  if (typeof key !== "string" || !Object.hasOwn(NOTICES, key)) return null;
  return NOTICES[key as LoginNoticeKey];
}

/** Sign-in address that shows a notice, e.g. after a password reset. */
export function loginPathWithNotice(key: LoginNoticeKey): string {
  return `/login?notice=${key}`;
}
