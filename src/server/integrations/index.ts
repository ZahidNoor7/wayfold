import "server-only";
import { cloudinaryAdapter } from "./adapters/cloudinary";
import { googleMapsAdapter } from "./adapters/google-maps";
import { smtpAdapter } from "./adapters/smtp";
import { stripeAdapter } from "./adapters/stripe";
import { whatsappAdapter } from "./adapters/whatsapp";
import { getAdapter, registerAdapter } from "./registry";

const BUILT_IN = [cloudinaryAdapter, smtpAdapter, stripeAdapter, googleMapsAdapter, whatsappAdapter];

/**
 * Registers the built-in providers. Safe to call any number of times, and
 * again after the registry was cleared (tests, dev hot reload).
 */
export function ensureAdaptersRegistered(): void {
  for (const adapter of BUILT_IN) {
    if (!getAdapter(adapter.id)) registerAdapter(adapter);
  }
}

// Importing the integrations module is enough to have every provider available.
ensureAdaptersRegistered();

export * from "./service";
export { getAdapter, listAdapters } from "./registry";
export { INTEGRATION_CATEGORIES } from "./types";
export type { Credentials, FieldSpec, IntegrationCategory, IntegrationView, ProviderAdapter, TestResult } from "./types";
