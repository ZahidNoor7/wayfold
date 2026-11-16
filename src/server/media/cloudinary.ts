import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError, IntegrationError } from "../errors";
import { assertNotTransient, retry, sanitiseProviderMessage, withTimeout } from "../integrations/http";
import type { CloudinaryConfig, CloudinarySecrets } from "../platform/managed-storage";
import type { MediaResourceType } from "./rules";

export interface CloudinaryCredentials {
  config: CloudinaryConfig;
  secrets: CloudinarySecrets;
}

export type SignatureAlgorithm = "sha1" | "sha256";

export const PROVIDER_TIMEOUT_MS = 10_000;
/** Cloudinary accepts a signature for one hour after its timestamp. */
export const SIGNATURE_TTL_SECONDS = 3600;

const API_BASE = "https://api.cloudinary.com/v1_1";

// Sent with the request but, per Cloudinary's signing rules, never hashed.
const NEVER_SIGNED = new Set(["file", "cloud_name", "resource_type", "api_key", "signature"]);

export type SignableParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Cloudinary's string to sign: every sent parameter except the never-signed
 * ones, as `name=value`, sorted by name and joined with `&`.
 */
export function stringToSign(params: SignableParams): string {
  return Object.keys(params)
    .filter((key) => !NEVER_SIGNED.has(key))
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join("&");
}

/**
 * Hex digest of the string to sign with the API secret appended (no
 * separator). SHA-256 by default: Cloudinary validates SHA-1 and SHA-256
 * alike, and accounts restricted to SHA-256 reject SHA-1.
 */
export function signParams(params: SignableParams, apiSecret: string, algorithm: SignatureAlgorithm = "sha256"): string {
  return createHash(algorithm)
    .update(stringToSign(params) + apiSecret)
    .digest("hex");
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** Endpoint the browser posts the file to. Contains no credential. */
export function uploadUrl(cloudName: string, resourceType: MediaResourceType): string {
  return `${API_BASE}/${encodeURIComponent(cloudName)}/${resourceType}/upload`;
}

function resourceUrl(cloudName: string, resourceType: MediaResourceType, publicId: string): string {
  // The public id is a path; encode each segment but keep the slashes.
  const path = publicId.split("/").map(encodeURIComponent).join("/");
  return `${API_BASE}/${encodeURIComponent(cloudName)}/resources/${resourceType}/upload/${path}`;
}

function destroyUrl(cloudName: string, resourceType: MediaResourceType): string {
  return `${API_BASE}/${encodeURIComponent(cloudName)}/${resourceType}/destroy`;
}

const resourceSchema = z.object({
  public_id: z.string().min(1),
  resource_type: z.string(),
  type: z.string(),
  format: z.string().optional(),
  bytes: z.number().int().nonnegative(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
  secure_url: z.string().startsWith("https://"),
});

/** What the provider itself reports about a stored file. */
export interface ProviderResource {
  publicId: string;
  resourceType: string;
  deliveryType: string;
  format: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  secureUrl: string;
}

async function providerMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body?.error?.message === "string") return body.error.message;
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `HTTP ${response.status}`;
}

/**
 * Runs one provider request under a timeout, retrying transient failures, and
 * turns anything that goes wrong into a message with the credentials scrubbed.
 */
async function call<T>(
  credentials: CloudinaryCredentials,
  request: (signal: AbortSignal) => Promise<Response>,
  handle: (response: Response) => Promise<T>,
): Promise<T> {
  const secrets = [credentials.secrets.apiSecret, credentials.secrets.apiKey];
  try {
    return await retry(() =>
      withTimeout(PROVIDER_TIMEOUT_MS, async (signal) => {
        const response = await request(signal);
        assertNotTransient(response);
        return handle(response);
      }),
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new IntegrationError(`The media storage provider could not be reached: ${sanitiseProviderMessage(error, secrets)}`);
  }
}

async function rejected(response: Response, credentials: CloudinaryCredentials): Promise<IntegrationError> {
  if (response.status === 401 || response.status === 403) {
    return new IntegrationError("The media storage provider rejected the stored credentials. Check the media integration settings.");
  }
  const secrets = [credentials.secrets.apiSecret, credentials.secrets.apiKey];
  const message = sanitiseProviderMessage(await providerMessage(response), secrets);
  return new IntegrationError(`The media storage provider refused the request: ${message}`);
}

/**
 * Reads a stored file's details from the Admin API with the server-held
 * credentials. Returns null when the provider has no such file.
 */
export async function fetchResource(
  credentials: CloudinaryCredentials,
  resourceType: MediaResourceType,
  publicId: string,
): Promise<ProviderResource | null> {
  const { apiKey, apiSecret } = credentials.secrets;
  const authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;

  return call(
    credentials,
    (signal) =>
      fetch(resourceUrl(credentials.config.cloudName, resourceType, publicId), {
        method: "GET",
        headers: { Authorization: authorization, Accept: "application/json" },
        signal,
      }),
    async (response) => {
      if (response.status === 404) return null;
      if (!response.ok) throw await rejected(response, credentials);
      const parsed = resourceSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new IntegrationError("The media storage provider returned an unexpected response.");
      const resource = parsed.data;
      return {
        publicId: resource.public_id,
        resourceType: resource.resource_type,
        deliveryType: resource.type,
        format: resource.format ?? "",
        bytes: resource.bytes,
        width: resource.width === undefined ? null : Math.round(resource.width),
        height: resource.height === undefined ? null : Math.round(resource.height),
        durationSeconds: resource.duration === undefined ? null : Math.round(resource.duration),
        secureUrl: resource.secure_url,
      };
    },
  );
}

/**
 * Permanently deletes a stored file through the signed Upload API `destroy`
 * method, and asks the CDN to drop its cached copies.
 */
export async function destroyResource(credentials: CloudinaryCredentials, resourceType: MediaResourceType, publicId: string): Promise<void> {
  await call(
    credentials,
    (signal) => {
      // Signed per attempt so a retry never sends a stale timestamp.
      const params = { public_id: publicId, invalidate: "true", timestamp: String(unixNow()) };
      const body = new URLSearchParams({
        ...params,
        api_key: credentials.secrets.apiKey,
        signature: signParams(params, credentials.secrets.apiSecret),
      });
      return fetch(destroyUrl(credentials.config.cloudName, resourceType), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: body.toString(),
        signal,
      });
    },
    async (response) => {
      // Any 2xx is final, whatever `result` says: an already-missing file
      // must not block removing its catalogue row.
      if (!response.ok) throw await rejected(response, credentials);
    },
  );
}
