import type { z } from "zod";

export const INTEGRATION_CATEGORIES = {
  media: "Media storage",
  email: "E-mail delivery",
  payments: "Payments",
  maps: "Maps & location",
  messaging: "Messaging",
} as const;

export type IntegrationCategory = keyof typeof INTEGRATION_CATEGORIES;

export interface FieldSpec {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "boolean" | "select";
  /** Secret fields are encrypted at rest and never sent back to a browser. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export type TestResult = { ok: true; detail?: string } | { ok: false; message: string };

export interface Credentials<C, S> {
  config: C;
  secrets: S;
}

/**
 * One third-party provider. Adding a provider means adding one adapter file
 * and registering it; nothing else in the application changes.
 */
export interface ProviderAdapter<C = Record<string, unknown>, S = Record<string, string>> {
  id: string;
  category: IntegrationCategory;
  name: string;
  description: string;
  docsUrl?: string;
  fields: FieldSpec[];
  /** Non-secret settings. Stored as JSON, visible to permitted staff. */
  configSchema: z.ZodType<C>;
  /** Secret values. Stored only as ciphertext. */
  secretSchema: z.ZodType<S>;
  /**
   * Makes one cheap authenticated call to prove the credentials work. Must
   * honour `signal` and must never include a secret in a returned message.
   */
  test(credentials: Credentials<C, S>, signal: AbortSignal): Promise<TestResult>;
}

/** What the settings UI receives. There is no ciphertext or secret in it. */
export interface IntegrationView {
  id: string;
  provider: string;
  providerName: string;
  category: IntegrationCategory;
  label: string;
  isDefault: boolean;
  status: "untested" | "connected" | "error" | "disabled";
  config: Record<string, unknown>;
  /** Masked previews keyed by secret field, e.g. `••••••••a1b2`. */
  secretHints: Record<string, string>;
  lastTestedAt: Date | null;
  lastError: string | null;
  rotatedAt: Date | null;
  updatedAt: Date;
}
