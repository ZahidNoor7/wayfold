import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALLOWED_FORMATS,
  BYTES_PER_MB,
  MAX_UPLOAD_BYTES,
  UploadError,
  UploadQueue,
  acceptAttribute,
  checkFile,
  describeAllowed,
  fileExtension,
  formatBytes,
  formatDuration,
  kindFromUrl,
  storagePercent,
  thumbnailUrl,
  uploadMediaFile,
  uploadToStorage,
  videoPosterUrl,
  type DirectUpload,
  type StepResult,
  type SignedUpload,
  type UploadOutcome,
} from "./media-upload";

const file = (name: string, type: string, size = 1024) => new File([new Uint8Array(size)], name, { type });

describe("limits shown to the uploader", () => {
  it("mirrors the server's formats and sizes", () => {
    expect(ALLOWED_FORMATS.image).toEqual(["jpg", "png", "webp", "avif", "gif"]);
    expect(ALLOWED_FORMATS.video).toEqual(["mp4", "webm", "mov"]);
    expect(MAX_UPLOAD_BYTES).toEqual({ image: 15 * BYTES_PER_MB, video: 200 * BYTES_PER_MB });
  });

  it("builds the accept attribute for all kinds or one", () => {
    expect(acceptAttribute()).toBe("image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/webm,video/quicktime");
    expect(acceptAttribute("video")).toBe("video/mp4,video/webm,video/quicktime");
  });

  it("describes what is allowed", () => {
    expect(describeAllowed("image")).toBe("JPEG, PNG, WebP, AVIF or GIF up to 15 MB");
    expect(describeAllowed()).toBe("JPEG, PNG, WebP, AVIF or GIF up to 15 MB · MP4, WebM or MOV up to 200 MB");
  });

  it("reads a file extension", () => {
    expect(fileExtension("Sheki.Palace.JPG")).toBe("jpg");
    expect(fileExtension("README")).toBe("");
  });
});

describe("checkFile", () => {
  it("accepts a supported image and video", () => {
    expect(checkFile({ name: "a.jpeg", type: "image/jpeg", size: 10 })).toEqual({ ok: true, resourceType: "image", contentType: "image/jpeg" });
    expect(checkFile({ name: "clip.MOV", type: "video/quicktime", size: 10 })).toEqual({ ok: true, resourceType: "video", contentType: "video/quicktime" });
  });

  it("falls back to the extension when the browser gives no type", () => {
    expect(checkFile({ name: "a.avif", type: "", size: 10 })).toEqual({ ok: true, resourceType: "image", contentType: "image/avif" });
    expect(checkFile({ name: "notes", type: "", size: 10 }).ok).toBe(false);
  });

  it("refuses unsupported types with the list of supported ones", () => {
    const all = checkFile({ name: "a.pdf", type: "application/pdf", size: 10 });
    expect(all).toEqual({
      ok: false,
      reason: "This file type is not supported. Upload an image (JPEG, PNG, WebP, AVIF or GIF) or a video (MP4, WebM or MOV).",
    });
    const imagesOnly = checkFile({ name: "a.svg", type: "image/svg+xml", size: 10 }, "image");
    expect(imagesOnly).toEqual({ ok: false, reason: "This file type is not supported. Upload an image (JPEG, PNG, WebP, AVIF or GIF)." });
  });

  it("refuses the wrong kind when one kind is required", () => {
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: 10 }, "image")).toEqual({ ok: false, reason: "Choose an image: JPEG, PNG, WebP, AVIF or GIF." });
    expect(checkFile({ name: "a.png", type: "image/png", size: 10 }, "video")).toEqual({ ok: false, reason: "Choose a video: MP4, WebM or MOV." });
  });

  it("refuses a name that does not match the type", () => {
    expect(checkFile({ name: "a.png", type: "image/jpeg", size: 10 })).toEqual({ ok: false, reason: "The file name must end in .jpg to match its type." });
  });

  it("refuses empty and oversized files", () => {
    expect(checkFile({ name: "a.png", type: "image/png", size: 0 })).toEqual({ ok: false, reason: "This file is empty." });
    expect(checkFile({ name: "a.png", type: "image/png", size: 16 * BYTES_PER_MB })).toEqual({
      ok: false,
      reason: "Images can be up to 15 MB. This file is 16 MB.",
    });
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: 201 * BYTES_PER_MB }).ok).toBe(false);
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: 200 * BYTES_PER_MB }).ok).toBe(true);
  });
});

describe("display helpers", () => {
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(Number.NaN)).toBe("0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(15 * BYTES_PER_MB)).toBe("15 MB");
    expect(formatBytes(150.4 * BYTES_PER_MB)).toBe("150 MB");
    expect(formatBytes(3 * 1024 * BYTES_PER_MB)).toBe("3 GB");
    // Terabytes are the largest unit, however big the number gets.
    expect(formatBytes(5000 * 1024 * 1024 * BYTES_PER_MB)).toBe("5000 TB");
  });

  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(75)).toBe("1:15");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(-4)).toBe("0:00");
  });

  it("works out the share of storage in use", () => {
    expect(storagePercent(50 * BYTES_PER_MB, 200)).toBe(25);
    expect(storagePercent(500 * BYTES_PER_MB, 200)).toBe(100);
    expect(storagePercent(10, null)).toBeNull();
    expect(storagePercent(10, 0)).toBe(100);
  });

  it("derives a poster image for videos", () => {
    expect(videoPosterUrl("https://res.cloudinary.com/demo/video/upload/v1/wayfold/t_1/clip.mp4")).toBe(
      "https://res.cloudinary.com/demo/video/upload/v1/wayfold/t_1/clip.jpg",
    );
    expect(videoPosterUrl("https://res.cloudinary.com/demo/video/upload/v1/clip")).toBe("https://res.cloudinary.com/demo/video/upload/v1/clip.jpg");
    expect(videoPosterUrl("https://cdn.example.com/a.b/clip.webm?x=1")).toBe("https://cdn.example.com/a.b/clip.jpg?x=1");
    expect(thumbnailUrl({ url: "https://res.cloudinary.com/demo/video/upload/clip.mov", resourceType: "video" })).toBe(
      "https://res.cloudinary.com/demo/video/upload/clip.jpg",
    );
    expect(thumbnailUrl({ url: "https://res.cloudinary.com/demo/image/upload/a.png", resourceType: "image" })).toBe(
      "https://res.cloudinary.com/demo/image/upload/a.png",
    );
  });
});

/* ------------------------------------------------------------- XHR upload */

type Handler = (() => void) | null;

class FakeRequest {
  static last: FakeRequest;
  method = "";
  url = "";
  body: FormData | null = null;
  status = 0;
  responseText = "";
  aborted = false;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: Handler = null;
  onerror: Handler = null;
  ontimeout: Handler = null;
  onabort: Handler = null;

  constructor() {
    FakeRequest.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status: number, responseText = "") {
    this.status = status;
    this.responseText = responseText;
    this.onload?.();
  }
}

function direct(overrides: Partial<DirectUpload> = {}): DirectUpload {
  return {
    uploadUrl: "https://api.cloudinary.com/v1_1/demo/image/upload",
    fields: { api_key: "key", timestamp: "1", signature: "sig", folder: "wayfold/t_1", public_id: "abc", allowed_formats: "png", overwrite: "false" },
    file: file("a.png", "image/png"),
    filename: "a.png",
    ...overrides,
  };
}

describe("kindFromUrl", () => {
  it("reads the kind from the delivery address", () => {
    expect(kindFromUrl("https://res.cloudinary.com/demo/video/upload/v1/clip.mp4")).toBe("video");
    expect(kindFromUrl("https://res.cloudinary.com/demo/image/upload/v1/a.jpg")).toBe("image");
    // With no kind given, a cover that is a video still gets a still image.
    expect(thumbnailUrl({ url: "https://res.cloudinary.com/demo/video/upload/v1/clip.mp4" })).toBe("https://res.cloudinary.com/demo/video/upload/v1/clip.jpg");
    expect(thumbnailUrl({ url: "https://res.cloudinary.com/demo/image/upload/v1/a.jpg" })).toBe("https://res.cloudinary.com/demo/image/upload/v1/a.jpg");
  });
});

describe("uploadToStorage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts every signed field and then the file, reporting progress", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const progress: number[] = [];
    const pending = uploadToStorage(direct({ onProgress: (fraction) => progress.push(fraction) }));
    const request = FakeRequest.last;

    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    const names = [...(request.body as FormData).keys()];
    expect(names).toEqual(["api_key", "timestamp", "signature", "folder", "public_id", "allowed_formats", "overwrite", "file"]);
    expect((request.body as FormData).get("signature")).toBe("sig");
    expect(((request.body as FormData).get("file") as File).name).toBe("a.png");
    // No secret is ever part of the request the browser sends.
    expect(names).not.toContain("api_secret");

    request.upload.onprogress?.({ lengthComputable: false, loaded: 1, total: 0 });
    request.upload.onprogress?.({ lengthComputable: true, loaded: 512, total: 1024 });
    request.respond(200, "{}");
    await expect(pending).resolves.toBeUndefined();
    expect(progress).toEqual([0.5, 1]);
  });

  it("explains a refusal using the provider's message when there is one", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const refused = uploadToStorage(direct());
    FakeRequest.last.respond(400, JSON.stringify({ error: { message: "Invalid image file" } }));
    await expect(refused).rejects.toThrow("The storage provider refused this file: Invalid image file");

    const opaque = uploadToStorage(direct());
    FakeRequest.last.respond(500, "<html>");
    await expect(opaque).rejects.toThrow("The storage provider refused this file. Try again.");

    const empty = uploadToStorage(direct());
    FakeRequest.last.respond(401, JSON.stringify({ error: { message: "  " } }));
    await expect(empty).rejects.toBeInstanceOf(UploadError);
  });

  it("turns network failures, timeouts and aborts into readable errors", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const offline = uploadToStorage(direct());
    FakeRequest.last.onerror?.();
    await expect(offline).rejects.toThrow("The upload was interrupted. Check your connection and try again.");

    const slow = uploadToStorage(direct());
    FakeRequest.last.ontimeout?.();
    await expect(slow).rejects.toThrow("The upload took too long. Try again.");

    const controller = new AbortController();
    const cancelled = uploadToStorage(direct({ signal: controller.signal }));
    const request = FakeRequest.last;
    controller.abort();
    expect(request.aborted).toBe(true);
    await expect(cancelled).rejects.toThrow("Upload cancelled.");

    const already = new AbortController();
    already.abort();
    await expect(uploadToStorage(direct({ signal: already.signal }))).rejects.toThrow("Upload cancelled.");
  });
});

/* ------------------------------------------------------------- whole flow */

const signed: SignedUpload = {
  uploadUrl: "https://api.cloudinary.com/v1_1/demo/image/upload",
  fields: { api_key: "key", signature: "sig" },
  publicId: "wayfold/t_1/abc",
  resourceType: "image",
};

describe("uploadMediaFile", () => {
  it("signs, sends and completes, in that order", async () => {
    const calls: string[] = [];
    const phases: [string, number][] = [];
    const sign = vi.fn(async (): Promise<StepResult<SignedUpload>> => {
      calls.push("sign");
      return { ok: true, data: signed };
    });
    const send = vi.fn(async (upload: DirectUpload) => {
      calls.push("send");
      upload.onProgress?.(0.4);
    });
    const complete = vi.fn(async (): Promise<StepResult<{ id: string }>> => {
      calls.push("complete");
      return { ok: true, data: { id: "m1" } };
    });

    const outcome = await uploadMediaFile(file("a.png", "image/png", 2048), {
      steps: { sign, send, complete },
      folderId: "f1",
      onProgress: (phase, fraction) => phases.push([phase, fraction]),
    });

    expect(outcome).toEqual({ ok: true, asset: { id: "m1" } });
    expect(calls).toEqual(["sign", "send", "complete"]);
    expect(sign).toHaveBeenCalledWith({ resourceType: "image", filename: "a.png", bytes: 2048, contentType: "image/png", folderId: "f1" });
    expect(send.mock.calls[0]![0]).toMatchObject({ uploadUrl: signed.uploadUrl, fields: signed.fields, filename: "a.png" });
    expect(complete).toHaveBeenCalledWith({ publicId: "wayfold/t_1/abc", resourceType: "image", filename: "a.png", folderId: "f1" });
    expect(phases).toEqual([
      ["sending", 0],
      ["sending", 0.4],
      ["processing", 1],
    ]);
  });

  it("leaves the folder out when there is none", async () => {
    const sign = vi.fn(async (): Promise<StepResult<SignedUpload>> => ({ ok: true, data: signed }));
    const complete = vi.fn(async (): Promise<StepResult<string>> => ({ ok: true, data: "ok" }));
    await uploadMediaFile(file("a.png", "image/png"), { steps: { sign, complete, send: async () => undefined } });
    expect(sign.mock.calls[0]).toEqual([{ resourceType: "image", filename: "a.png", bytes: 1024, contentType: "image/png" }]);
    expect(complete.mock.calls[0]).toEqual([{ publicId: "wayfold/t_1/abc", resourceType: "image", filename: "a.png" }]);
  });

  it("stops before any request when the file is not allowed", async () => {
    const sign = vi.fn();
    const outcome = await uploadMediaFile(file("a.mp4", "video/mp4"), { steps: { sign, complete: vi.fn() }, only: "image" });
    expect(outcome).toEqual({ ok: false, reason: "Choose an image: JPEG, PNG, WebP, AVIF or GIF." });
    expect(sign).not.toHaveBeenCalled();
  });

  it("reports the server's reason when signing or completing is refused", async () => {
    const refusedSign = await uploadMediaFile(file("a.png", "image/png"), {
      steps: {
        sign: async () => ({ ok: false, error: "Please check the highlighted fields.", fieldErrors: { bytes: ["Images can be up to 15 MB."] } }),
        complete: vi.fn(),
      },
    });
    expect(refusedSign).toEqual({ ok: false, reason: "Images can be up to 15 MB." });

    const send = vi.fn(async () => undefined);
    const overQuota = await uploadMediaFile(file("a.png", "image/png"), {
      steps: { sign: async () => ({ ok: true, data: signed }), send, complete: async () => ({ ok: false, error: "Your Starter plan includes 500 MB of media storage. Upgrade to add more." }) },
    });
    expect(overQuota).toEqual({ ok: false, reason: "Your Starter plan includes 500 MB of media storage. Upgrade to add more." });

    const emptyFieldErrors = await uploadMediaFile(file("a.png", "image/png"), {
      steps: { sign: async () => ({ ok: false, error: "Not allowed.", fieldErrors: { bytes: [] } }), complete: vi.fn() },
    });
    expect(emptyFieldErrors).toEqual({ ok: false, reason: "Not allowed." });
  });

  it("reports a failed transfer and an unreachable server", async () => {
    const transfer = await uploadMediaFile(file("a.png", "image/png"), {
      steps: {
        sign: async () => ({ ok: true, data: signed }),
        send: async () => {
          throw new UploadError("The upload was interrupted. Check your connection and try again.");
        },
        complete: vi.fn(),
      },
    });
    expect(transfer).toEqual({ ok: false, reason: "The upload was interrupted. Check your connection and try again." });

    const offline = await uploadMediaFile(file("a.png", "image/png"), {
      steps: {
        sign: async () => {
          throw new TypeError("fetch failed");
        },
        complete: vi.fn(),
      },
    });
    expect(offline).toEqual({ ok: false, reason: "We could not reach the server. Check your connection and try again." });
  });
});

/* ------------------------------------------------------------------ queue */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("UploadQueue", () => {
  it("runs at most `concurrency` uploads at a time and reports each result", async () => {
    const jobs = new Map<string, ReturnType<typeof deferred<UploadOutcome<string>>>>();
    const progress = new Map<string, (phase: "sending" | "processing", fraction: number) => void>();
    const uploaded: string[] = [];
    const queue = new UploadQueue<string>(
      (item, onProgress) => {
        const job = deferred<UploadOutcome<string>>();
        jobs.set(item.name, job);
        progress.set(item.name, onProgress);
        return job.promise;
      },
      (asset) => uploaded.push(asset),
      2,
    );
    const notified = vi.fn();
    const unsubscribe = queue.subscribe(notified);

    queue.add([file("a.png", "image/png"), file("b.png", "image/png"), file("c.png", "image/png"), file("d.pdf", "application/pdf")]);
    expect(queue.getSnapshot().map((entry) => [entry.name, entry.status])).toEqual([
      ["a.png", "sending"],
      ["b.png", "sending"],
      ["c.png", "queued"],
      ["d.pdf", "error"],
    ]);
    expect(queue.getSnapshot()[3]).toMatchObject({ retryable: false, reason: expect.stringContaining("not supported") });
    expect(queue.busy).toBe(true);
    expect(notified).toHaveBeenCalled();

    progress.get("a.png")!("sending", 0.5);
    expect(queue.getSnapshot()[0]).toMatchObject({ status: "sending", progress: 0.5 });
    progress.get("a.png")!("processing", 1);
    expect(queue.getSnapshot()[0]).toMatchObject({ status: "processing" });

    // An upload in flight cannot be dismissed.
    queue.dismiss(queue.getSnapshot()[0]!.key);
    expect(queue.getSnapshot()).toHaveLength(4);

    jobs.get("a.png")!.resolve({ ok: true, asset: "asset-a" });
    await settle();
    expect(uploaded).toEqual(["asset-a"]);
    expect(queue.getSnapshot().map((entry) => entry.status)).toEqual(["done", "sending", "sending", "error"]);

    jobs.get("b.png")!.resolve({ ok: false, reason: "Over quota." });
    jobs.get("c.png")!.reject(new Error("boom"));
    await settle();
    expect(queue.getSnapshot().map((entry) => [entry.status, entry.reason, entry.retryable])).toEqual([
      ["done", null, true],
      ["error", "Over quota.", true],
      ["error", "We could not reach the server. Check your connection and try again.", true],
      ["error", expect.stringContaining("not supported"), false],
    ]);
    expect(queue.busy).toBe(false);

    queue.clearFinished();
    expect(queue.getSnapshot().map((entry) => entry.name)).toEqual(["b.png", "c.png", "d.pdf"]);

    unsubscribe();
    const before = notified.mock.calls.length;
    queue.clearFinished();
    expect(notified.mock.calls.length).toBe(before);
  });

  it("retries a failed upload and ignores retries that cannot help", async () => {
    let attempt = 0;
    const uploaded: string[] = [];
    const queue = new UploadQueue<string>(
      async () => {
        attempt += 1;
        return attempt === 1 ? { ok: false, reason: "The upload was interrupted." } : { ok: true, asset: "second-try" };
      },
      (asset) => uploaded.push(asset),
    );
    queue.add([file("a.png", "image/png"), file("b.txt", "text/plain")]);
    await settle();
    const [failed, unsupported] = queue.getSnapshot();
    expect(uploaded).toEqual([]);
    expect(failed).toMatchObject({ status: "error", retryable: true });

    queue.retry(unsupported!.key);
    queue.retry("missing");
    expect(attempt).toBe(1);

    queue.retry(failed!.key);
    await settle();
    expect(uploaded).toEqual(["second-try"]);
    expect(queue.getSnapshot()[0]).toMatchObject({ status: "done", reason: null });

    // A finished upload has nothing left to retry.
    queue.retry(failed!.key);
    expect(attempt).toBe(2);
  });

  it("passes the folder a file was added for, and tells the newest handler", async () => {
    const folders: (string | null)[] = [];
    const first: string[] = [];
    const second: string[] = [];
    const queue = new UploadQueue<string>(async (item, _onProgress, folderId) => {
      folders.push(folderId);
      return { ok: true, asset: item.name };
    });
    // Without a handler, a finished upload is simply recorded in the list.
    queue.add([file("a.png", "image/png")]);
    await settle();
    expect(queue.getSnapshot()[0]).toMatchObject({ status: "done" });

    queue.setUploadedHandler((asset) => first.push(asset));
    queue.add([file("b.png", "image/png")], undefined, "folder-1");
    await settle();
    queue.setUploadedHandler((asset) => second.push(asset));
    queue.add([file("c.png", "image/png")], "image", "folder-2");
    await settle();

    expect(folders).toEqual([null, "folder-1", "folder-2"]);
    expect(first).toEqual(["b.png"]);
    expect(second).toEqual(["c.png"]);
  });

  it("dismisses waiting and failed entries, and ignores empty batches", async () => {
    const job = deferred<UploadOutcome<string>>();
    const started: string[] = [];
    const queue = new UploadQueue<string>(
      (item) => {
        started.push(item.name);
        return job.promise;
      },
      () => undefined,
      1,
    );
    const notified = vi.fn();
    queue.subscribe(notified);
    queue.add([]);
    expect(notified).not.toHaveBeenCalled();

    queue.add([file("a.png", "image/png"), file("b.png", "image/png"), file("c.gif", "image/png")], "image");
    const [, waiting, mismatched] = queue.getSnapshot();
    queue.dismiss(waiting!.key);
    queue.dismiss(mismatched!.key);
    queue.dismiss("missing");
    expect(queue.getSnapshot().map((entry) => entry.name)).toEqual(["a.png"]);

    job.resolve({ ok: true, asset: "a" });
    await settle();
    // The dismissed file never started.
    expect(started).toEqual(["a.png"]);
  });
});
