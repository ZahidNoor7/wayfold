import "server-only";
import { z } from "zod";
import { ProviderTimeoutError } from "../http";
import type { ProviderAdapter } from "../types";

export interface WhatsAppConfig {
  /** E.164, e.g. `+994501234567`. */
  phoneNumber: string;
}

export type WhatsAppSecrets = Record<string, never>;

const E164 = /^\+[1-9]\d{6,14}$/;

const configSchema: z.ZodType<WhatsAppConfig> = z.strictObject({
  phoneNumber: z
    .string()
    // People paste numbers with spaces, dashes, dots and brackets.
    .transform((value) => value.replace(/[\s().-]/g, ""))
    .refine((value) => E164.test(value), "Enter the full international number, starting with + and the country code."),
});

const secretSchema: z.ZodType<WhatsAppSecrets> = z.strictObject({});

/**
 * A click-to-chat link. WhatsApp wants the international number as digits
 * only: no plus sign, zeroes, brackets or dashes in front.
 */
export function whatsappChatLink(phoneNumber: string, text?: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  const message = text?.trim();
  return message ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/${digits}`;
}

export const whatsappAdapter: ProviderAdapter<WhatsAppConfig, WhatsAppSecrets> = {
  id: "whatsapp",
  category: "messaging",
  name: "WhatsApp chat link",
  description: "Add a WhatsApp button so travellers can message your number in one tap. No Business API account needed.",
  docsUrl: "https://faq.whatsapp.com/5913398998672934",
  fields: [
    {
      key: "phoneNumber",
      label: "WhatsApp number",
      type: "text",
      secret: false,
      required: true,
      placeholder: "+994 50 123 45 67",
      help: "The number travellers will chat with, in international format with the country code.",
    },
  ],
  configSchema,
  secretSchema,

  // Click-to-chat has no API to call, so the check is the number itself.
  async test({ config }, signal) {
    if (signal.aborted) throw new ProviderTimeoutError();
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "The WhatsApp number is not valid." };
    }
    return { ok: true, detail: `Travellers will open ${whatsappChatLink(parsed.data.phoneNumber)}` };
  },
};
