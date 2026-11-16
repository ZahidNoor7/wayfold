import "server-only";
import { getEntitlements } from "../billing/limits";
import type { TenantScope } from "../db/context";
import { IntegrationError, ValidationError } from "../errors";
import { IntegrationNotConfiguredError, resolveIntegration } from "../integrations/service";
import { getManagedStorage, type CloudinaryConfig, type CloudinarySecrets } from "../platform/managed-storage";

export const MEDIA_PROVIDER = "cloudinary";

/** The provider account a file lives in, with the credentials to reach it. */
export interface MediaStorage {
  owner: "tenant" | "platform";
  /** The tenant's integration row; null for platform storage. */
  integrationId: string | null;
  provider: typeof MEDIA_PROVIDER;
  config: CloudinaryConfig;
  secrets: CloudinarySecrets;
}

/**
 * Where this tenant's new uploads go: its own default media integration, or,
 * only when the plan includes it and the platform owner has set it up, the
 * platform's storage. Nothing else is ever consulted, so one tenant can never
 * end up holding another tenant's credentials.
 */
export async function selectStorage(scope: TenantScope): Promise<MediaStorage> {
  try {
    const own = await resolveIntegration<CloudinaryConfig, CloudinarySecrets>(scope, "media");
    return fromIntegration(own);
  } catch (error) {
    if (!(error instanceof IntegrationNotConfiguredError)) throw error;
  }

  const { features } = await getEntitlements(scope);
  if (features.platformStorage) {
    const managed = await getManagedStorage();
    if (managed) return { owner: "platform", integrationId: null, provider: MEDIA_PROVIDER, config: managed.config, secrets: managed.secrets };
  }
  throw new IntegrationNotConfiguredError("media");
}

function fromIntegration(integration: { id: string; provider: string; config: CloudinaryConfig; secrets: CloudinarySecrets }): MediaStorage {
  if (integration.provider !== MEDIA_PROVIDER) {
    throw new IntegrationError("The connected media provider is not supported by the media library.", "media_provider_unsupported");
  }
  return { owner: "tenant", integrationId: integration.id, provider: MEDIA_PROVIDER, config: integration.config, secrets: integration.secrets };
}

/**
 * The storage that holds an existing file, for deleting or replacing it.
 * Null when its credentials no longer exist (the tenant removed the
 * integration, or the platform withdrew managed storage): the catalogue row
 * can still be removed, but the provider can no longer be reached.
 */
export async function storageForAsset(
  scope: TenantScope,
  asset: { storageOwner: "tenant" | "platform"; integrationId: string | null; provider: string },
): Promise<MediaStorage | null> {
  if (asset.provider !== MEDIA_PROVIDER) return null;
  if (asset.storageOwner === "platform") {
    const managed = await getManagedStorage();
    return managed ? { owner: "platform", integrationId: null, provider: MEDIA_PROVIDER, config: managed.config, secrets: managed.secrets } : null;
  }
  if (!asset.integrationId) return null;
  const own = await resolveIntegration<CloudinaryConfig, CloudinarySecrets>(scope, "media", { integrationId: asset.integrationId });
  return fromIntegration(own);
}

// Letters, digits, `_`, `-`, inner spaces and dots: nothing that could break
// out of a path segment or add a parameter to the string that gets signed.
const FOLDER_SEGMENT = /^[A-Za-z0-9_-](?:[A-Za-z0-9 _.-]*[A-Za-z0-9_-])?$/;

function rootSegments(uploadFolder: string | undefined): string[] {
  const segments = (uploadFolder ?? "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");
  for (const segment of segments) {
    // Cloudinary reserves `v<digits>` segments for version numbers.
    if (!FOLDER_SEGMENT.test(segment) || /^v\d/.test(segment)) {
      throw new ValidationError("The media integration's upload folder contains unsupported characters.");
    }
  }
  return segments;
}

/**
 * Folder every file of this tenant lives under at the provider:
 * `{uploadFolder?}/wayfold/t_{tenantId}`. The tenant id comes from the scope,
 * never from input, and a provider id outside this prefix is never accepted.
 */
export function tenantFolderPrefix(scope: Pick<TenantScope, "tenantId">, config: Pick<CloudinaryConfig, "uploadFolder">): string {
  return [...rootSegments(config.uploadFolder), "wayfold", `t_${scope.tenantId}`].join("/");
}

/** True when `publicId` names a file inside this tenant's folder. */
export function isInsideTenantFolder(scope: Pick<TenantScope, "tenantId">, config: Pick<CloudinaryConfig, "uploadFolder">, publicId: string): boolean {
  const prefix = `${tenantFolderPrefix(scope, config)}/`;
  if (!publicId.startsWith(prefix)) return false;
  // No empty, `.` or `..` segments: the id must not be able to climb out.
  return publicId
    .slice(prefix.length)
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
