import { z } from "zod";
import { socialUrl } from "@/lib/storefront-format";

/**
 * Rules behind the public contact page: turning stored contact details into
 * safe links, and the form's client-side validation (the server validates
 * again and has the last word).
 */

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 1000;
/** Matches the server's limit on how far ahead a preferred date may lie. */
export const PREFERRED_DATE_YEARS = 3;

const SOCIAL_NETWORKS = [
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "facebook", label: "Facebook" },
  { key: "tiktok", label: "TikTok" },
] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]["key"];

export interface SocialLink {
  network: SocialNetwork;
  label: string;
  href: string;
}

/**
 * The business's social profiles as labelled links, in a fixed order. Each
 * address comes from the same rule the footer uses, so the two never
 * disagree; a stored value that is neither a profile name nor an http(s)
 * address gives no link at all.
 */
export function socialLinks(social: Partial<Record<SocialNetwork, string | undefined>> | null | undefined): SocialLink[] {
  return SOCIAL_NETWORKS.flatMap((network) => {
    const href = socialUrl(network.key, social?.[network.key]);
    return href ? [{ network: network.key, label: network.label, href }] : [];
  });
}

/** `tel:` link for a displayed phone number; null when it holds no digits. */
export function telHref(phone: string | null | undefined): string | null {
  const value = phone?.trim() ?? "";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 5) return null;
  return `tel:${value.startsWith("+") ? "+" : ""}${digits}`;
}

/** Opens the point in Google Maps (Maps URLs search action; the comma must be encoded). */
export function mapsHref(latitude: number | null | undefined, longitude: number | null | undefined): string | null {
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

/** The name to greet the sender by: the first word of what they typed. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** `today` moved a number of years ahead, as text (exact for `YYYY-MM-DD`). */
export function latestPreferredDate(today: string, years = PREFERRED_DATE_YEARS): string {
  return `${Number(today.slice(0, 4)) + years}${today.slice(4)}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The contact form as the visitor fills it in. Mirrors the server's rules so
 * mistakes are caught before sending; `today` is the business's calendar date.
 */
export function contactFormSchema(today: string) {
  const latest = latestPreferredDate(today);
  return z.object({
    name: z
      .string()
      .transform((value) => value.replace(/\s+/g, " ").trim())
      .pipe(z.string().min(2, "Enter your name (at least 2 characters).").max(200, "Keep your name under 200 characters.")),
    email: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().max(200, "Enter a valid email address.").regex(EMAIL, "Enter a valid email address, like name@example.com.")),
    phone: z
      .string()
      .transform((value) => value.replace(/\s+/g, " ").trim())
      .pipe(z.string().max(50, "Keep the phone number under 50 characters.")),
    preferredDate: z
      .string()
      .refine((value) => value === "" || ISO_DATE.test(value), "Choose a date from the calendar.")
      .refine((value) => value === "" || !ISO_DATE.test(value) || value >= today, "Choose today or a later date.")
      .refine((value) => value === "" || !ISO_DATE.test(value) || value <= latest, `Choose a date within the next ${PREFERRED_DATE_YEARS} years.`),
    tourId: z.string(),
    message: z
      .string()
      .transform((value) => value.replace(/\r\n?/g, "\n").trim())
      .pipe(
        z
          .string()
          .min(MESSAGE_MIN, `Write a short message (at least ${MESSAGE_MIN} characters).`)
          .max(MESSAGE_MAX, `Keep your message under ${MESSAGE_MAX} characters.`),
      ),
    /** Hidden trap field: people never see it, so it normally stays empty. */
    trap: z.string(),
  });
}

export type ContactFormValues = z.input<ReturnType<typeof contactFormSchema>>;
export type ContactFormOutput = z.output<ReturnType<typeof contactFormSchema>>;

export const EMPTY_CONTACT_FORM: ContactFormValues = { name: "", email: "", phone: "", preferredDate: "", tourId: "", message: "", trap: "" };

/** Form fields in the order they appear, for moving focus to the first one with an error. */
export const CONTACT_FIELD_ORDER = ["name", "email", "phone", "preferredDate", "tourId", "message"] as const;
export type ContactField = (typeof CONTACT_FIELD_ORDER)[number];

/** The first field, in visual order, that the server reported a problem with. */
export function firstInvalidField(fieldErrors: Record<string, string[]> | undefined): ContactField | null {
  if (!fieldErrors) return null;
  return CONTACT_FIELD_ORDER.find((field) => (fieldErrors[field]?.length ?? 0) > 0) ?? null;
}
