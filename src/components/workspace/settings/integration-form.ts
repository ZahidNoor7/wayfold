import type { FieldSpec, IntegrationCategory, IntegrationView } from "@/server/integrations/types";

/**
 * Turns an adapter's field list into form values and back. Secret values only
 * ever travel browser → server: the form starts every secret empty, and an
 * empty secret on an existing connection means "keep the stored value".
 */

/** What the browser knows about a provider: its form, never its code. */
export interface AdapterSpec {
  id: string;
  category: IntegrationCategory;
  name: string;
  description: string;
  docsUrl?: string;
  fields: FieldSpec[];
}

export type FieldValue = string | boolean;
export type FieldValues = Record<string, FieldValue>;

export interface IntegrationPayload {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

/** Starting values: stored non-secret settings, empty secrets, defaults for the rest. */
export function initialFieldValues(fields: readonly FieldSpec[], config: Record<string, unknown> = {}): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    if (field.secret) {
      values[field.key] = "";
      continue;
    }
    const stored = config[field.key];
    if (field.type === "boolean") {
      values[field.key] = typeof stored === "boolean" ? stored : false;
    } else if (stored === undefined || stored === null) {
      values[field.key] = "";
    } else {
      values[field.key] = String(stored);
    }
  }
  return values;
}

/**
 * Splits form values into the `config` and `secrets` the server expects.
 * Numbers are sent as numbers, switches as booleans, blank secrets not at all.
 */
export function buildIntegrationPayload(fields: readonly FieldSpec[], values: FieldValues): IntegrationPayload {
  const config: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.secret) {
      const text = typeof value === "string" ? value.trim() : "";
      if (text) secrets[field.key] = text;
      continue;
    }
    if (field.type === "boolean") {
      config[field.key] = value === true;
    } else if (field.type === "number") {
      const text = typeof value === "string" ? value.trim() : "";
      const number = Number(text);
      config[field.key] = text !== "" && Number.isFinite(number) ? number : text;
    } else {
      config[field.key] = typeof value === "string" ? value.trim() : "";
    }
  }
  return { config, secrets };
}

/**
 * Immediate checks before anything is sent: required fields that are empty,
 * and numbers that are not numbers. A required secret may stay empty when
 * the connection already has a stored value for it.
 */
export function checkFieldValues(
  fields: readonly FieldSpec[],
  values: FieldValues,
  secretHints: Record<string, string> = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (field.type === "boolean") continue;
    const value = values[field.key];
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      const kept = field.secret && Boolean(secretHints[field.key]);
      if (field.required && !kept) errors[field.key] = `Enter the ${field.label.toLowerCase()}.`;
      continue;
    }
    if (field.type === "number" && !Number.isFinite(Number(text))) errors[field.key] = "Enter a number.";
  }
  return errors;
}

/** Help under a secret input on an existing connection. */
export function keepSecretHint(hint: string | undefined): string | null {
  return hint ? `Leave blank to keep the current value ${hint}` : null;
}

export const STATUS_META: Record<IntegrationView["status"], { label: string; badge: string }> = {
  untested: { label: "Not tested yet", badge: "badge-outline" },
  connected: { label: "Connected", badge: "badge-confirmed" },
  error: { label: "Connection failed", badge: "badge-cancelled" },
  disabled: { label: "Turned off", badge: "badge-completed" },
};

/** What stops working when the last usable connection of a category goes away. */
export const CATEGORY_DEPENDENTS: Record<IntegrationCategory, string> = {
  media: "Uploading photos and videos to your media library",
  email: "Booking confirmations and other e-mails to your customers",
  payments: "Taking card payments for bookings",
  maps: "Maps and location lookups on your tours",
  messaging: "WhatsApp chat buttons on your website",
};

/** Connections grouped under each category, in the order the categories are listed. */
export function groupIntegrations<T extends { category: IntegrationCategory }>(
  categories: readonly IntegrationCategory[],
  items: readonly T[],
): { category: IntegrationCategory; items: T[] }[] {
  return categories.map((category) => ({ category, items: items.filter((item) => item.category === category) }));
}

/**
 * Message for the delete confirmation, naming what depends on the connection.
 * `fallback` describes what takes over when nothing of the business's own is
 * left (Wayfold-managed media storage on plans that include it).
 */
export function deleteConsequence(
  view: Pick<IntegrationView, "category" | "isDefault" | "status">,
  otherUsable: number,
  fallback?: string,
): string {
  const feature = CATEGORY_DEPENDENTS[view.category];
  if (view.status === "disabled") return "This connection is turned off, so nothing uses it right now.";
  if (!view.isDefault) return "It is not your default connection, so features keep using the default.";
  if (otherUsable > 0) return "Your oldest remaining connection in this category becomes the default.";
  if (fallback) return fallback;
  return `${feature} will stop working until you connect another account.`;
}
