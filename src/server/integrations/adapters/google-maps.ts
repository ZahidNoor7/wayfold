import "server-only";
import { z } from "zod";
import { TransientProviderError } from "../http";
import type { ProviderAdapter } from "../types";
import { providerGet, providerText, readJson, stringAt } from "./shared";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
/** A fixed, well-known address: the test needs any query the API can answer. */
const PROBE_ADDRESS = "1600 Amphitheatre Parkway, Mountain View, CA";

export type GoogleMapsConfig = Record<string, never>;

export interface GoogleMapsSecrets {
  apiKey: string;
}

const configSchema: z.ZodType<GoogleMapsConfig> = z.strictObject({});

const secretSchema: z.ZodType<GoogleMapsSecrets> = z.strictObject({
  // The key travels in a query string, so it must be URL-safe with no spaces.
  apiKey: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{20,128}$/, "That does not look like a Google Maps API key."),
});

export const googleMapsAdapter: ProviderAdapter<GoogleMapsConfig, GoogleMapsSecrets> = {
  id: "google_maps",
  category: "maps",
  name: "Google Maps",
  description: "Show meeting points and routes on your tour pages with your own Google Maps key.",
  docsUrl: "https://developers.google.com/maps/documentation/geocoding/requests-geocoding",
  fields: [
    {
      key: "apiKey",
      label: "API key",
      type: "password",
      secret: true,
      required: true,
      help: "Google Cloud Console → APIs & Services → Credentials. Enable the Geocoding API for this key and keep billing active on the project.",
    },
  ],
  configSchema,
  secretSchema,

  async test({ secrets }, signal) {
    const url = `${GEOCODE_URL}?${new URLSearchParams({ address: PROBE_ADDRESS, key: secrets.apiKey }).toString()}`;
    const response = await providerGet("Google Maps", url, signal, { headers: { Accept: "application/json" } });
    const body = await readJson(response);

    // Google reports most failures inside a 200 response, in `status`.
    const status = stringAt(body, "status");
    const reason = providerText(stringAt(body, "error_message"), { ...secrets }, "no reason was given");

    if (status === "OK" || status === "ZERO_RESULTS") return { ok: true, detail: "The Geocoding API accepted this key." };
    if (status === "UNKNOWN_ERROR") throw new TransientProviderError("Google Maps had a temporary server error. Please try again in a moment.");
    if (status === "REQUEST_DENIED") return { ok: false, message: `Google Maps denied the request: ${reason}` };
    if (status === "OVER_DAILY_LIMIT") {
      return { ok: false, message: `Google Maps rejected the key or its billing set-up: ${reason}` };
    }
    if (status === "OVER_QUERY_LIMIT") {
      return { ok: false, message: `This key is over its Geocoding quota: ${reason}` };
    }
    if (status) return { ok: false, message: `Google Maps answered ${status}: ${reason}` };
    return { ok: false, message: `Google Maps sent an unexpected response (HTTP ${response.status}).` };
  },
};
