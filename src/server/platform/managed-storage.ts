import "server-only";
import { resolvePlatformIntegration } from "./integrations";

export interface CloudinaryConfig {
  cloudName: string;
  /** Optional root folder inside the account. */
  uploadFolder?: string;
}

export interface CloudinarySecrets {
  apiKey: string;
  apiSecret: string;
}

export interface ManagedStorage {
  provider: "cloudinary";
  config: CloudinaryConfig;
  secrets: CloudinarySecrets;
}

const filled = (value: unknown): value is string => typeof value === "string" && value !== "";

/**
 * Platform-managed media storage, if the platform owner has explicitly
 * configured one. Tenants only reach it when their plan allows it; it is
 * never a silent fallback. Returns null when not configured.
 */
export async function getManagedStorage(): Promise<ManagedStorage | null> {
  const resolved = await resolvePlatformIntegration("media");
  // Disabled connections resolve to null as well; only Cloudinary is a managed store today.
  if (!resolved || resolved.provider !== "cloudinary") return null;

  const { cloudName, uploadFolder } = resolved.config;
  const { apiKey, apiSecret } = resolved.secrets;
  // A row that does not hold a complete credential set is not usable storage.
  if (!filled(cloudName) || !filled(apiKey) || !filled(apiSecret)) return null;

  return {
    provider: "cloudinary",
    config: { cloudName, ...(filled(uploadFolder) ? { uploadFolder } : {}) },
    secrets: { apiKey, apiSecret },
  };
}
