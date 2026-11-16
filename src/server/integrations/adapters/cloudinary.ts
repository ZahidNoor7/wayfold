import "server-only";
import { z } from "zod";
import type { CloudinaryConfig, CloudinarySecrets } from "../../platform/managed-storage";
import type { ProviderAdapter } from "../types";
import { blankToUndefined, providerGet, providerText, readJson, stringAt } from "./shared";

const API_BASE = "https://api.cloudinary.com/v1_1";

const configSchema: z.ZodType<CloudinaryConfig> = z.strictObject({
  // The cloud name becomes a URL path segment, so only URL-safe characters pass.
  cloudName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/, "Enter the cloud name exactly as shown in your Cloudinary dashboard."),
  uploadFolder: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(120, "Keep the folder path under 120 characters.")
      .transform((value) => value.replace(/^\/+|\/+$/g, ""))
      .refine(
        (value) => /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(value),
        "Use letters, numbers, hyphens and underscores, with / between folders.",
      )
      .optional(),
  ),
});

const secretSchema: z.ZodType<CloudinarySecrets> = z.strictObject({
  // Sent as `key:secret` in Basic auth, so neither may contain a colon or space.
  apiKey: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/, "That does not look like a Cloudinary API key."),
  apiSecret: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, "That does not look like a Cloudinary API secret."),
});

export const cloudinaryAdapter: ProviderAdapter<CloudinaryConfig, CloudinarySecrets> = {
  id: "cloudinary",
  category: "media",
  name: "Cloudinary",
  description: "Store and deliver tour photos from your own Cloudinary account.",
  docsUrl: "https://cloudinary.com/documentation/admin_api",
  fields: [
    {
      key: "cloudName",
      label: "Cloud name",
      type: "text",
      secret: false,
      required: true,
      placeholder: "my-tours",
      help: "Shown at the top of your Cloudinary dashboard.",
    },
    {
      key: "apiKey",
      label: "API key",
      type: "password",
      secret: true,
      required: true,
      help: "Cloudinary dashboard → Settings → API Keys.",
    },
    {
      key: "apiSecret",
      label: "API secret",
      type: "password",
      secret: true,
      required: true,
      help: "Shown next to the API key. Stored encrypted and never displayed again.",
    },
    {
      key: "uploadFolder",
      label: "Upload folder",
      type: "text",
      secret: false,
      required: false,
      placeholder: "wayfold",
      help: "Optional. Uploads are kept inside this folder of your account.",
    },
  ],
  configSchema,
  secretSchema,

  async test({ config, secrets }, signal) {
    // The usage report is the cheapest Admin API call that needs both the
    // key and the secret, and it names the cloud it answered for.
    const response = await providerGet("Cloudinary", `${API_BASE}/${encodeURIComponent(config.cloudName)}/usage`, signal, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${secrets.apiKey}:${secrets.apiSecret}`, "utf8").toString("base64")}`,
        Accept: "application/json",
      },
      // Cloudinary reports its Admin API rate limit as 420, not 429.
      transientStatuses: [420],
    });
    const body = await readJson(response);

    if (response.ok) {
      const plan = stringAt(body, "plan");
      return { ok: true, detail: plan ? `Connected to ${config.cloudName} (${plan} plan).` : `Connected to ${config.cloudName}.` };
    }

    const reason = providerText(stringAt(body, "error", "message"), { ...secrets }, `HTTP ${response.status}`);
    if (response.status === 401) {
      return { ok: false, message: `Cloudinary did not accept the cloud name, API key or API secret (${reason}).` };
    }
    if (response.status === 403) {
      return { ok: false, message: `Cloudinary refused this API key (${reason}). Check that the key is active.` };
    }
    if (response.status === 404) {
      return { ok: false, message: `Cloudinary could not find the cloud "${config.cloudName}". Check the cloud name.` };
    }
    return { ok: false, message: `Cloudinary could not verify the connection (${reason}).` };
  },
};
