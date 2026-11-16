import "server-only";
import { ValidationError } from "../errors";

export type MediaResourceType = "image" | "video";

export const BYTES_PER_MB = 1024 * 1024;

/** Largest file accepted per kind, in bytes. */
export const MAX_UPLOAD_BYTES: Record<MediaResourceType, number> = {
  image: 15 * BYTES_PER_MB,
  video: 200 * BYTES_PER_MB,
};

interface AllowedType {
  /** Format name as the storage provider reports it. */
  format: string;
  extensions: readonly string[];
}

/**
 * The only file types the library accepts. Keyed by the MIME type the browser
 * declares; the provider's own detected format is checked again on finalize.
 */
const ALLOWED_TYPES: Record<MediaResourceType, Record<string, AllowedType>> = {
  image: {
    "image/jpeg": { format: "jpg", extensions: ["jpg", "jpeg"] },
    "image/png": { format: "png", extensions: ["png"] },
    "image/webp": { format: "webp", extensions: ["webp"] },
    "image/avif": { format: "avif", extensions: ["avif"] },
    "image/gif": { format: "gif", extensions: ["gif"] },
  },
  video: {
    "video/mp4": { format: "mp4", extensions: ["mp4"] },
    "video/webm": { format: "webm", extensions: ["webm"] },
    "video/quicktime": { format: "mov", extensions: ["mov"] },
  },
};

export const ALLOWED_FORMATS: Record<MediaResourceType, readonly string[]> = {
  image: Object.values(ALLOWED_TYPES.image).map((type) => type.format),
  video: Object.values(ALLOWED_TYPES.video).map((type) => type.format),
};

const KIND_LABEL: Record<MediaResourceType, string> = { image: "Images", video: "Videos" };
const TYPE_HELP: Record<MediaResourceType, string> = {
  image: "Upload a JPEG, PNG, WebP, AVIF or GIF image.",
  video: "Upload an MP4, WebM or MOV video.",
};

export function describeSizeLimit(resourceType: MediaResourceType): string {
  return `${KIND_LABEL[resourceType]} can be up to ${MAX_UPLOAD_BYTES[resourceType] / BYTES_PER_MB} MB.`;
}

/** The provider calls JPEG `jpg`; treat both spellings as one format. */
export function normaliseFormat(format: string): string {
  const lower = format.trim().toLowerCase();
  return lower === "jpeg" ? "jpg" : lower;
}

export interface DeclaredUpload {
  resourceType: MediaResourceType;
  filename: string;
  bytes: number;
  contentType: string;
}

/**
 * Checks what the browser says it is about to upload and returns the single
 * provider format that upload may have. Nothing here is trusted later: the
 * stored file is inspected again when the upload is finalised.
 */
export function assertDeclaredUploadAllowed(upload: DeclaredUpload): string {
  const allowed = ALLOWED_TYPES[upload.resourceType][upload.contentType.trim().toLowerCase()];
  if (!allowed) throw new ValidationError(undefined, { contentType: [TYPE_HELP[upload.resourceType]] });

  const dot = upload.filename.lastIndexOf(".");
  const extension = dot >= 0 ? upload.filename.slice(dot + 1).toLowerCase() : "";
  if (!allowed.extensions.includes(extension)) {
    throw new ValidationError(undefined, { filename: ["The file extension does not match the file type."] });
  }
  if (upload.bytes > MAX_UPLOAD_BYTES[upload.resourceType]) {
    throw new ValidationError(undefined, { bytes: [describeSizeLimit(upload.resourceType)] });
  }
  return allowed.format;
}

/** Why a file the provider actually holds may not enter the library, or null. */
export function storedUploadProblem(resourceType: MediaResourceType, format: string, bytes: number): string | null {
  if (!ALLOWED_FORMATS[resourceType].includes(normaliseFormat(format))) return TYPE_HELP[resourceType];
  if (bytes > MAX_UPLOAD_BYTES[resourceType]) return describeSizeLimit(resourceType);
  return null;
}
