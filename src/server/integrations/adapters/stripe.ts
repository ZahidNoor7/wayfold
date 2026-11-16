import "server-only";
import { z } from "zod";
import type { ProviderAdapter } from "../types";
import { blankToUndefined, providerGet, providerText, readJson, stringAt } from "./shared";

const API_BASE = "https://api.stripe.com";

export type StripeMode = "test" | "live";

export interface StripeConfig {
  /** ISO 4217 code, upper case like every currency in Wayfold. */
  currency?: string;
  /** When set, the key must belong to this mode or the test fails. */
  mode?: StripeMode;
}

export interface StripeSecrets {
  secretKey: string;
  webhookSecret?: string;
}

const KEY_SHAPE = /^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/;

/** Which mode a key belongs to, read from its documented prefix. */
export function stripeKeyMode(secretKey: string): StripeMode {
  return /^(sk|rk)_live_/.test(secretKey) ? "live" : "test";
}

/** Why a pasted value cannot be used as the server-side key, if it cannot. */
function keyProblem(value: string): string | null {
  if (value.startsWith("pk_")) return "That is a publishable key. Paste the secret or restricted key instead.";
  if (value.startsWith("sk_org_")) return "Organisation keys are not supported. Use a key from the account itself.";
  return KEY_SHAPE.test(value) ? null : "Stripe keys start with sk_test_, sk_live_, rk_test_ or rk_live_.";
}

const configSchema: z.ZodType<StripeConfig> = z.strictObject({
  currency: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code such as USD or EUR.")
      .optional(),
  ),
  mode: z.preprocess(blankToUndefined, z.enum(["test", "live"], "Choose test or live.").optional()),
});

const secretSchema: z.ZodType<StripeSecrets> = z.strictObject({
  secretKey: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const problem = keyProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  webhookSecret: z
    .string()
    .trim()
    .regex(/^whsec_\S{8,}$/, "Webhook signing secrets start with whsec_.")
    .optional(),
});

/** Stripe quotes masked keys in some errors; nothing key-shaped survives. */
function scrubKeys(text: string): string {
  return text.replace(/\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_*.]+/g, "[redacted]");
}

export const stripeAdapter: ProviderAdapter<StripeConfig, StripeSecrets> = {
  id: "stripe",
  category: "payments",
  name: "Stripe",
  description: "Take card payments and deposits into your own Stripe account.",
  docsUrl: "https://docs.stripe.com/keys",
  fields: [
    {
      key: "secretKey",
      label: "Secret or restricted key",
      type: "password",
      secret: true,
      required: true,
      placeholder: "rk_live_…",
      help: "Stripe Dashboard → Developers → API keys. A restricted key is safest; it needs read access to Balance for the connection test.",
    },
    {
      key: "webhookSecret",
      label: "Webhook signing secret",
      type: "password",
      secret: true,
      required: false,
      placeholder: "whsec_…",
      help: "Optional. Shown on the webhook endpoint in the Stripe Dashboard; lets Wayfold confirm that payment updates really come from Stripe.",
    },
    {
      key: "mode",
      label: "Mode",
      type: "select",
      secret: false,
      required: false,
      options: [
        { value: "test", label: "Test (sandbox)" },
        { value: "live", label: "Live" },
      ],
      help: "Optional safety check: the connection test fails if the key belongs to the other mode.",
    },
    {
      key: "currency",
      label: "Charge currency",
      type: "text",
      secret: false,
      required: false,
      placeholder: "USD",
      help: "Optional three-letter code. Leave empty to charge in your workspace currency.",
    },
  ],
  configSchema,
  secretSchema,

  async test({ config, secrets }, signal) {
    const keyMode = stripeKeyMode(secrets.secretKey);
    if (config.mode && config.mode !== keyMode) {
      return { ok: false, message: `This is a ${keyMode} mode key, but the connection is set to ${config.mode} mode.` };
    }

    // Reading the balance changes nothing and works for every account.
    const response = await providerGet("Stripe", `${API_BASE}/v1/balance`, signal, {
      headers: { Authorization: `Bearer ${secrets.secretKey}`, Accept: "application/json" },
    });
    const body = await readJson(response);

    if (response.ok) {
      const live = typeof body === "object" && body !== null && (body as { livemode?: unknown }).livemode === true;
      return { ok: true, detail: `Connected to Stripe in ${live ? "live" : "test"} mode.` };
    }

    if (response.status === 401) {
      return { ok: false, message: "Stripe did not accept this API key. It may have been rotated, expired or mistyped." };
    }
    const reason = scrubKeys(providerText(stringAt(body, "error", "message"), { ...secrets }, `HTTP ${response.status}`));
    if (response.status === 403) {
      return {
        ok: false,
        message: `Stripe recognised the key but it may not read the balance (${reason}). Give a restricted key read access to Balance.`,
      };
    }
    return { ok: false, message: `Stripe could not verify the connection (${reason}).` };
  },
};
