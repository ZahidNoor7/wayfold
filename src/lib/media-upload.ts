/**
 * Browser half of the media upload flow, plus the small display helpers the
 * media screens share. Nothing here imports server code.
 *
 * Flow per file: ask the server to sign one upload → POST the file straight
 * to the storage provider with the signed fields → ask the server to verify
 * what arrived and add it to the library. The API secret never reaches the
 * browser: the server only hands back the signature.
 *
 * The type and size limits below DUPLICATE `src/server/media/rules.ts`
 * (`ALLOWED_TYPES`, `MAX_UPLOAD_BYTES`), because server modules cannot be
 * bundled for the client. They exist for instant feedback only; the server
 * checks the declared file again when signing and the stored file again when
 * finalising. Keep the two lists in step.
 */

export type MediaKind = "image" | "video";

export const BYTES_PER_MB = 1024 * 1024;

/** Largest file accepted per kind, in bytes. Mirrors the server. */
export const MAX_UPLOAD_BYTES: Record<MediaKind, number> = {
  image: 15 * BYTES_PER_MB,
  video: 200 * BYTES_PER_MB,
};

interface AllowedType {
  format: string;
  label: string;
  extensions: readonly string[];
}

/** Accepted MIME types per kind. Mirrors the server. */
export const ALLOWED_TYPES: Record<MediaKind, Record<string, AllowedType>> = {
  image: {
    "image/jpeg": { format: "jpg", label: "JPEG", extensions: ["jpg", "jpeg"] },
    "image/png": { format: "png", label: "PNG", extensions: ["png"] },
    "image/webp": { format: "webp", label: "WebP", extensions: ["webp"] },
    "image/avif": { format: "avif", label: "AVIF", extensions: ["avif"] },
    "image/gif": { format: "gif", label: "GIF", extensions: ["gif"] },
  },
  video: {
    "video/mp4": { format: "mp4", label: "MP4", extensions: ["mp4"] },
    "video/webm": { format: "webm", label: "WebM", extensions: ["webm"] },
    "video/quicktime": { format: "mov", label: "MOV", extensions: ["mov"] },
  },
};

export const ALLOWED_FORMATS: Record<MediaKind, readonly string[]> = {
  image: Object.values(ALLOWED_TYPES.image).map((type) => type.format),
  video: Object.values(ALLOWED_TYPES.video).map((type) => type.format),
};

const KINDS: readonly MediaKind[] = ["image", "video"];
const KIND_NOUN: Record<MediaKind, string> = { image: "Images", video: "Videos" };

function joinWithOr(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

function typeLabels(kind: MediaKind): string {
  return joinWithOr(Object.values(ALLOWED_TYPES[kind]).map((type) => type.label));
}

/** Value for `<input type="file" accept>`. */
export function acceptAttribute(only?: MediaKind): string {
  return (only ? [only] : KINDS).flatMap((kind) => Object.keys(ALLOWED_TYPES[kind])).join(",");
}

/** One line for under a dropzone: what may be uploaded and how large. */
export function describeAllowed(only?: MediaKind): string {
  return (only ? [only] : KINDS)
    .map((kind) => `${typeLabels(kind)} up to ${MAX_UPLOAD_BYTES[kind] / BYTES_PER_MB} MB`)
    .join(" · ");
}

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export type FileCheck =
  | { ok: true; resourceType: MediaKind; contentType: string }
  | { ok: false; reason: string };

function findByMime(contentType: string): { kind: MediaKind; type: AllowedType } | null {
  for (const kind of KINDS) {
    const type = ALLOWED_TYPES[kind][contentType];
    if (type) return { kind, type };
  }
  return null;
}

function findByExtension(extension: string): { kind: MediaKind; contentType: string; type: AllowedType } | null {
  for (const kind of KINDS) {
    for (const [contentType, type] of Object.entries(ALLOWED_TYPES[kind])) {
      if (type.extensions.includes(extension)) return { kind, contentType, type };
    }
  }
  return null;
}

/**
 * Decides whether a chosen file can be uploaded before any network call.
 * `only` restricts the kind (a picker that wants images, or a replacement
 * that must stay the same kind as the file it replaces).
 */
export function checkFile(file: FileLike, only?: MediaKind): FileCheck {
  const extension = fileExtension(file.name);
  const declared = file.type.trim().toLowerCase();
  // Some browsers leave the type empty for newer formats; fall back to the name.
  const byMime = declared ? findByMime(declared) : null;
  const match = byMime ? { kind: byMime.kind, contentType: declared, type: byMime.type } : declared ? null : findByExtension(extension);

  if (!match) {
    return { ok: false, reason: `This file type is not supported. Upload ${supportedSentence(only)}` };
  }
  if (only && match.kind !== only) {
    return { ok: false, reason: only === "image" ? `Choose an image: ${typeLabels("image")}.` : `Choose a video: ${typeLabels("video")}.` };
  }
  if (!match.type.extensions.includes(extension)) {
    return { ok: false, reason: `The file name must end in .${match.type.extensions[0]} to match its type.` };
  }
  if (file.size <= 0) return { ok: false, reason: "This file is empty." };
  if (file.size > MAX_UPLOAD_BYTES[match.kind]) {
    return {
      ok: false,
      reason: `${KIND_NOUN[match.kind]} can be up to ${MAX_UPLOAD_BYTES[match.kind] / BYTES_PER_MB} MB. This file is ${formatBytes(file.size)}.`,
    };
  }
  return { ok: true, resourceType: match.kind, contentType: match.contentType };
}

function supportedSentence(only?: MediaKind): string {
  const kinds = only ? [only] : KINDS;
  return `${joinWithOr(kinds.map((kind) => `${kind === "image" ? "an image" : "a video"} (${typeLabels(kind)})`))}.`;
}

/* ---------------------------------------------------------------- display */

/** `1536` → `1.5 KB`, `15728640` → `15 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** `75` → `1:15`, `3725` → `1:02:05`. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Share of the plan's storage in use, 0–100; null when the plan has no limit. */
export function storagePercent(usedBytes: number, limitMb: number | null): number | null {
  if (limitMb === null) return null;
  if (limitMb <= 0) return 100;
  return Math.min(100, Math.max(0, (usedBytes / (limitMb * BYTES_PER_MB)) * 100));
}

/**
 * Still image for a stored video. The storage provider renders a frame when
 * a video's delivery URL is requested with an image extension (Cloudinary:
 * "Video previews and posters").
 */
export function videoPosterUrl(url: string): string {
  const [path, query] = url.split("?", 2) as [string, string | undefined];
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const base = dot > slash ? path.slice(0, dot) : path;
  return `${base}.jpg${query ? `?${query}` : ""}`;
}

/**
 * Whether a stored file is a video, for places that only have its address
 * (a tour's cover, for example). The provider's delivery URLs name the kind
 * as a path segment: `/image/upload/...` or `/video/upload/...`.
 */
export function kindFromUrl(url: string): MediaKind {
  return /\/video\/upload\//.test(url) ? "video" : "image";
}

/** The image to show for a file in a grid: the file itself, or a video's poster. */
export function thumbnailUrl(item: { url: string; resourceType?: MediaKind }): string {
  return (item.resourceType ?? kindFromUrl(item.url)) === "video" ? videoPosterUrl(item.url) : item.url;
}

/* ----------------------------------------------------------------- upload */

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export interface DirectUpload {
  uploadUrl: string;
  /** Signed form fields, sent unchanged. */
  fields: Record<string, string>;
  file: Blob;
  filename: string;
  /** Called with 0–1 as bytes leave the browser. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

function providerMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed?.error?.message;
    return typeof message === "string" && message.trim() ? message.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}

/**
 * Posts one file to the storage provider as multipart/form-data: every signed
 * field first, then `file`. XMLHttpRequest rather than fetch, because it is
 * what reports upload progress.
 */
export function uploadToStorage({ uploadUrl, fields, file, filename, onProgress, signal }: DirectUpload): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadError("Upload cancelled."));
      return;
    }
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    form.append("file", file, filename);

    const request = new XMLHttpRequest();
    request.open("POST", uploadUrl);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      const detail = providerMessage(request.responseText);
      reject(new UploadError(detail ? `The storage provider refused this file: ${detail}` : "The storage provider refused this file. Try again."));
    };
    request.onerror = () => reject(new UploadError("The upload was interrupted. Check your connection and try again."));
    request.ontimeout = () => reject(new UploadError("The upload took too long. Try again."));
    request.onabort = () => reject(new UploadError("Upload cancelled."));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(form);
  });
}

/** The shape Server Actions answer with (`ActionResult`), without importing it. */
export type StepResult<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export interface SignedUpload {
  uploadUrl: string;
  fields: Record<string, string>;
  publicId: string;
  resourceType: MediaKind;
}

export interface UploadSteps<TAsset> {
  /** Server Action that authorises one upload. */
  sign: (input: { resourceType: MediaKind; filename: string; bytes: number; contentType: string; folderId?: string | null }) => Promise<StepResult<SignedUpload>>;
  /** Server Action that verifies the stored file and records it (finalise or replace). */
  complete: (input: { publicId: string; resourceType: MediaKind; filename: string; folderId?: string | null }) => Promise<StepResult<TAsset>>;
  /** Overridable for tests. */
  send?: (upload: DirectUpload) => Promise<void>;
}

export interface UploadOptions<TAsset> {
  steps: UploadSteps<TAsset>;
  folderId?: string | null;
  only?: MediaKind;
  /** `phase` is "sending" while bytes travel and "processing" while the server verifies. */
  onProgress?: (phase: "sending" | "processing", fraction: number) => void;
  signal?: AbortSignal;
}

export type UploadOutcome<TAsset> = { ok: true; asset: TAsset } | { ok: false; reason: string };

const UNREACHABLE = "We could not reach the server. Check your connection and try again.";

function failure(result: { error: string; fieldErrors?: Record<string, string[]> }): string {
  const first = result.fieldErrors ? Object.values(result.fieldErrors).find((messages) => messages.length > 0)?.[0] : undefined;
  return first ?? result.error;
}

/**
 * Runs the whole flow for one file and always resolves: a failed step comes
 * back as `{ ok: false, reason }` in words that can be shown beside the file.
 */
export async function uploadMediaFile<TAsset>(file: File, options: UploadOptions<TAsset>): Promise<UploadOutcome<TAsset>> {
  const { steps, folderId, only, onProgress, signal } = options;
  const check = checkFile(file, only);
  if (!check.ok) return { ok: false, reason: check.reason };

  try {
    const signed = await steps.sign({
      resourceType: check.resourceType,
      filename: file.name,
      bytes: file.size,
      contentType: check.contentType,
      ...(folderId ? { folderId } : {}),
    });
    if (!signed.ok) return { ok: false, reason: failure(signed) };

    onProgress?.("sending", 0);
    await (steps.send ?? uploadToStorage)({
      uploadUrl: signed.data.uploadUrl,
      fields: signed.data.fields,
      file,
      filename: file.name,
      onProgress: (fraction) => onProgress?.("sending", fraction),
      signal,
    });

    onProgress?.("processing", 1);
    const completed = await steps.complete({
      publicId: signed.data.publicId,
      resourceType: signed.data.resourceType,
      filename: file.name,
      ...(folderId ? { folderId } : {}),
    });
    if (!completed.ok) return { ok: false, reason: failure(completed) };
    return { ok: true, asset: completed.data };
  } catch (error) {
    return { ok: false, reason: error instanceof UploadError ? error.message : UNREACHABLE };
  }
}

/* ------------------------------------------------------------------ queue */

export type UploadStatus = "queued" | "sending" | "processing" | "done" | "error";

export interface UploadEntry {
  key: string;
  name: string;
  size: number;
  status: UploadStatus;
  /** 0–1 while sending. */
  progress: number;
  /** Why it failed, in words for the person uploading. */
  reason: string | null;
  /** False when trying again cannot help (wrong type, too large). */
  retryable: boolean;
}

export type UploadRunner<TAsset> = (
  file: File,
  onProgress: (phase: "sending" | "processing", fraction: number) => void,
  /** The folder the file was added for; a retry goes to the same one. */
  folderId: string | null,
) => Promise<UploadOutcome<TAsset>>;

/**
 * Uploads a batch of files a few at a time and keeps a list the interface
 * can render: one entry per file with its progress, and for a failure the
 * reason and whether a retry makes sense. Framework-free; React reads it
 * through `subscribe` / `getSnapshot`.
 */
export class UploadQueue<TAsset> {
  private entries: UploadEntry[] = [];
  private readonly files = new Map<string, { file: File; folderId: string | null }>();
  private readonly waiting: string[] = [];
  private readonly listeners = new Set<() => void>();
  private active = 0;
  private sequence = 0;

  constructor(
    private readonly run: UploadRunner<TAsset>,
    private onUploaded: (asset: TAsset) => void = () => undefined,
    private readonly concurrency = 2,
  ) {}

  /** Replaces who is told about each file that reaches the library. */
  setUploadedHandler(handler: (asset: TAsset) => void): void {
    this.onUploaded = handler;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): UploadEntry[] => this.entries;

  /** True while any file is waiting or in flight. */
  get busy(): boolean {
    return this.entries.some((entry) => entry.status === "queued" || entry.status === "sending" || entry.status === "processing");
  }

  /** Adds files. Ones that fail the type and size check are listed as failed without being sent. */
  add(files: readonly File[], only?: MediaKind, folderId: string | null = null): void {
    const added: UploadEntry[] = [];
    for (const file of files) {
      this.sequence += 1;
      const key = `upload-${this.sequence}`;
      const check = checkFile(file, only);
      if (check.ok) {
        this.files.set(key, { file, folderId });
        this.waiting.push(key);
        added.push({ key, name: file.name, size: file.size, status: "queued", progress: 0, reason: null, retryable: true });
      } else {
        added.push({ key, name: file.name, size: file.size, status: "error", progress: 0, reason: check.reason, retryable: false });
      }
    }
    if (added.length === 0) return;
    this.commit([...this.entries, ...added]);
    this.pump();
  }

  retry(key: string): void {
    const entry = this.entries.find((candidate) => candidate.key === key);
    if (!entry || entry.status !== "error" || !entry.retryable || !this.files.has(key)) return;
    this.patch(key, { status: "queued", progress: 0, reason: null });
    this.waiting.push(key);
    this.pump();
  }

  /** Removes a finished or failed entry from the list. In-flight uploads stay. */
  dismiss(key: string): void {
    const entry = this.entries.find((candidate) => candidate.key === key);
    if (!entry || entry.status === "sending" || entry.status === "processing") return;
    const waitingAt = this.waiting.indexOf(key);
    if (waitingAt >= 0) this.waiting.splice(waitingAt, 1);
    this.files.delete(key);
    this.commit(this.entries.filter((candidate) => candidate.key !== key));
  }

  clearFinished(): void {
    this.commit(this.entries.filter((entry) => entry.status !== "done"));
  }

  private commit(entries: UploadEntry[]): void {
    this.entries = entries;
    for (const listener of this.listeners) listener();
  }

  private patch(key: string, changes: Partial<UploadEntry>): void {
    this.commit(this.entries.map((entry) => (entry.key === key ? { ...entry, ...changes } : entry)));
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const key = this.waiting.shift() as string;
      const item = this.files.get(key);
      if (!item) continue;
      this.active += 1;
      this.patch(key, { status: "sending", progress: 0 });
      void this.run(item.file, (phase, fraction) => this.patch(key, { status: phase, progress: fraction }), item.folderId)
        .catch((): UploadOutcome<TAsset> => ({ ok: false, reason: UNREACHABLE }))
        .then((outcome) => {
          this.active -= 1;
          if (outcome.ok) {
            this.files.delete(key);
            this.patch(key, { status: "done", progress: 1 });
            this.onUploaded(outcome.asset);
          } else {
            this.patch(key, { status: "error", reason: outcome.reason, retryable: true });
          }
          this.pump();
        });
    }
  }
}
