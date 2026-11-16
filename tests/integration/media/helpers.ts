import { createHash } from "node:crypto";
import { vi } from "vitest";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { withTenant, type TenantScope } from "@/server/db/context";
import { getAdapter, registerAdapter } from "@/server/integrations/registry";
import { saveIntegration } from "@/server/integrations/service";
import { auditLogs } from "@/server/db/schema";
import { createUploadSignature, finalizeUpload, type MediaAsset, type UploadSignature } from "@/server/media";
import type { ManagedStorage } from "@/server/platform/managed-storage";
import { unique, type TenantFixture } from "../../helpers/fixtures";

export const MB = 1024 * 1024;

/**
 * Cloudinary's documented signing rule, written independently of the code
 * under test: drop file / cloud_name / resource_type / api_key (and the
 * signature itself), sort by name, join `name=value` with `&`, append the API
 * secret, hash, hex-encode.
 */
export function documentedSignature(fields: Record<string, string>, apiSecret: string, algorithm: "sha1" | "sha256" = "sha256"): string {
  const excluded = ["file", "cloud_name", "resource_type", "api_key", "signature"];
  const toSign = Object.entries(fields)
    .filter(([name]) => !excluded.includes(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  return createHash(algorithm)
    .update(toSign + apiSecret)
    .digest("hex");
}

/** The real adapter belongs to another module; tests only need its credential shape. */
export function registerCloudinaryAdapter(): void {
  if (getAdapter("cloudinary")) return;
  registerAdapter({
    id: "cloudinary",
    category: "media",
    name: "Cloudinary",
    description: "Image and video storage",
    fields: [],
    configSchema: z.object({ cloudName: z.string().min(1), uploadFolder: z.string().optional() }),
    secretSchema: z.object({ apiKey: z.string().min(1), apiSecret: z.string().min(1) }),
    test: async () => ({ ok: true }),
  });
}

export interface Account {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  uploadFolder?: string;
}

export function newAccount(overrides: Partial<Account> = {}): Account {
  return { cloudName: unique("cloud"), apiKey: unique("key"), apiSecret: unique("secret"), ...overrides };
}

export const inTenant = <T>(tenant: TenantFixture, fn: (scope: TenantScope) => Promise<T>): Promise<T> =>
  withTenant(tenant.tenantId, fn, { userId: tenant.ownerId });

/** Stores an encrypted Cloudinary connection for the tenant through the real service. */
export async function connectCloudinary(tenant: TenantFixture, account: Account = newAccount()): Promise<Account & { integrationId: string }> {
  registerCloudinaryAdapter();
  const view = await inTenant(tenant, (scope) =>
    saveIntegration(scope, {
      provider: "cloudinary",
      config: { cloudName: account.cloudName, ...(account.uploadFolder ? { uploadFolder: account.uploadFolder } : {}) },
      secrets: { apiKey: account.apiKey, apiSecret: account.apiSecret },
    }),
  );
  return { ...account, integrationId: view.id };
}

export function auditActions(tenant: TenantFixture, targetId: string): Promise<string[]> {
  return inTenant(tenant, async ({ tx, tenantId }) => {
    const rows = await tx
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.targetId, targetId)))
      .orderBy(auditLogs.createdAt);
    return rows.map((row) => row.action);
  });
}

export function managedStorage(account: Account): ManagedStorage {
  return {
    provider: "cloudinary",
    config: { cloudName: account.cloudName, ...(account.uploadFolder ? { uploadFolder: account.uploadFolder } : {}) },
    secrets: { apiKey: account.apiKey, apiSecret: account.apiSecret },
  };
}

interface StoredResource {
  public_id: string;
  resource_type: string;
  type: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  secure_url: string;
}

export interface RecordedCall {
  kind: "details" | "destroy" | "unknown";
  method: string;
  url: string;
  cloudName: string;
  resourceType: string;
  publicId: string;
  authorization: string | null;
  body: Record<string, string>;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * A stand-in for api.cloudinary.com at the `fetch` boundary. It checks
 * credentials and signatures the way the documentation describes, so a wrong
 * key, secret or signature fails here exactly as it would for real.
 */
export class FakeCloudinary {
  readonly accounts = new Map<string, Account>();
  readonly resources = new Map<string, StoredResource>();
  readonly calls: RecordedCall[] = [];
  /** Responses (or thrown errors) served before normal handling, in order. */
  readonly scripted: (Response | Error)[] = [];

  install(): this {
    vi.stubGlobal("fetch", vi.fn(this.handle));
    return this;
  }

  addAccount<T extends Account>(account: T): T {
    this.accounts.set(account.cloudName, account);
    return account;
  }

  private key(cloudName: string, resourceType: string, publicId: string): string {
    return `${cloudName}|${resourceType}|${publicId}`;
  }

  put(cloudName: string, resourceType: string, publicId: string, overrides: Partial<StoredResource> = {}): StoredResource {
    const format = overrides.format ?? (resourceType === "video" ? "mp4" : "jpg");
    const resource: StoredResource = {
      public_id: publicId,
      resource_type: resourceType,
      type: "upload",
      format,
      bytes: 120_253,
      ...(resourceType === "video" ? { width: 1280, height: 720, duration: 12.4 } : { width: 864, height: 576 }),
      secure_url: `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/v1719304854/${publicId}.${format}`,
      ...overrides,
    };
    this.resources.set(this.key(cloudName, resourceType, publicId), resource);
    return resource;
  }

  has(cloudName: string, resourceType: string, publicId: string): boolean {
    return this.resources.has(this.key(cloudName, resourceType, publicId));
  }

  callsOf(kind: RecordedCall["kind"]): RecordedCall[] {
    return this.calls.filter((call) => call.kind === kind);
  }

  /**
   * What the browser does with an upload signature: post the fields to the
   * upload URL. Returns Cloudinary's verdict; on success the file exists.
   */
  browserUpload(
    signature: Pick<UploadSignature, "uploadUrl" | "fields">,
    file: { format: string; bytes: number; width?: number; height?: number; duration?: number },
    tamper: Record<string, string> = {},
  ): Response {
    const match = /^https:\/\/api\.cloudinary\.com\/v1_1\/([^/]+)\/(image|video)\/upload$/.exec(signature.uploadUrl);
    if (!match) return json(404, { error: { message: "Unknown endpoint" } });
    const [, cloudName, resourceType] = match as unknown as [string, string, string];
    const account = this.accounts.get(cloudName);
    const fields: Record<string, string> = { ...signature.fields, ...tamper };
    if (!account || fields.api_key !== account.apiKey) return json(401, { error: { message: "Unknown API key" } });
    if (fields.signature !== documentedSignature(fields, account.apiSecret)) return json(401, { error: { message: "Invalid Signature" } });
    if (fields.allowed_formats && !fields.allowed_formats.split(",").includes(file.format)) {
      return json(400, { error: { message: `${file.format} is not allowed` } });
    }
    const publicId = fields.folder ? `${fields.folder}/${fields.public_id}` : (fields.public_id as string);
    if (fields.overwrite === "false" && this.has(cloudName, resourceType, publicId)) {
      return json(200, { ...this.resources.get(this.key(cloudName, resourceType, publicId)), existing: true });
    }
    const { format, bytes, ...dimensions } = file;
    return json(200, this.put(cloudName, resourceType, publicId, { format, bytes, ...dimensions }));
  }

  private handle = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const body = Object.fromEntries(new URLSearchParams(typeof init.body === "string" ? init.body : ""));
    const call: RecordedCall = { kind: "unknown", method, url, cloudName: "", resourceType: "", publicId: "", authorization: headers.get("authorization"), body };
    this.calls.push(call);

    const details = /^https:\/\/api\.cloudinary\.com\/v1_1\/([^/]+)\/resources\/(image|video)\/upload\/(.+)$/.exec(url);
    const destroy = /^https:\/\/api\.cloudinary\.com\/v1_1\/([^/]+)\/(image|video)\/destroy$/.exec(url);
    if (details && method === "GET") {
      Object.assign(call, { kind: "details", cloudName: details[1], resourceType: details[2], publicId: decodeURIComponent(details[3] as string) });
    } else if (destroy && method === "POST") {
      Object.assign(call, { kind: "destroy", cloudName: destroy[1], resourceType: destroy[2], publicId: body.public_id ?? "" });
    }

    const scripted = this.scripted.shift();
    if (scripted instanceof Error) throw scripted;
    if (scripted) return scripted;

    const account = this.accounts.get(call.cloudName);
    if (call.kind === "details") {
      const expected = account ? `Basic ${Buffer.from(`${account.apiKey}:${account.apiSecret}`).toString("base64")}` : null;
      if (!expected || call.authorization !== expected) return json(401, { error: { message: "Invalid credentials" } });
      const resource = this.resources.get(this.key(call.cloudName, call.resourceType, call.publicId));
      return resource ? json(200, resource) : json(404, { error: { message: `Resource not found - ${call.publicId}` } });
    }
    if (call.kind === "destroy") {
      if (!account || body.api_key !== account.apiKey || body.signature !== documentedSignature(body, account.apiSecret)) {
        return json(401, { error: { message: "Invalid Signature" } });
      }
      const existed = this.resources.delete(this.key(call.cloudName, call.resourceType, call.publicId));
      return json(200, { result: existed ? "ok" : "not found" });
    }
    return json(404, { error: { message: "Unknown endpoint" } });
  };
}

export interface TestFile {
  resourceType?: "image" | "video";
  filename?: string;
  contentType?: string;
  /** Provider-side format; defaults to match the content type. */
  format?: string;
  bytes?: number;
  alt?: string;
  folderId?: string;
}

/** Signs, "uploads" from the browser, and returns what finalize needs. */
export async function signAndUpload(tenant: TenantFixture, cloud: FakeCloudinary, file: TestFile = {}): Promise<UploadSignature> {
  const resourceType = file.resourceType ?? "image";
  const bytes = file.bytes ?? 250_000;
  const signature = await inTenant(tenant, (scope) =>
    createUploadSignature(scope, {
      resourceType,
      filename: file.filename ?? (resourceType === "video" ? "clip.mp4" : "beach.jpg"),
      bytes,
      contentType: file.contentType ?? (resourceType === "video" ? "video/mp4" : "image/jpeg"),
    }),
  );
  const response = cloud.browserUpload(signature, { format: file.format ?? signature.fields.allowed_formats, bytes });
  if (response.status !== 200) throw new Error(`fake upload failed: ${await response.text()}`);
  return signature;
}

/** A complete upload: sign, browser upload, server-side finalize. */
export async function uploadFile(tenant: TenantFixture, cloud: FakeCloudinary, file: TestFile = {}): Promise<MediaAsset> {
  const signature = await signAndUpload(tenant, cloud, file);
  return inTenant(tenant, (scope) =>
    finalizeUpload(scope, {
      publicId: signature.publicId,
      resourceType: signature.resourceType,
      filename: file.filename ?? (signature.resourceType === "video" ? "clip.mp4" : "beach.jpg"),
      ...(file.alt !== undefined ? { alt: file.alt } : {}),
      ...(file.folderId ? { folderId: file.folderId } : {}),
    }),
  );
}
