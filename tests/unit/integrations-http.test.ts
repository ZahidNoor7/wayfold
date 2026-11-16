import { afterEach, describe, expect, it, vi } from "vitest";
import {

  assertNotTransient,
  ProviderTimeoutError,
  retry,
  sanitiseProviderMessage,
  TransientProviderError,
  withTimeout,
} from "@/server/integrations/http";

// Shaped like a Stripe live key but not one; assembled at runtime so secret
// scanners do not mistake the source for a leaked credential.
const FAKE_LIVE_KEY = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("returns the result and leaves the signal untouched when the call is fast", async () => {
    let seen: AbortSignal | undefined;
    const result = await withTimeout(1_000, async (signal) => {
      seen = signal;
      return "pong";
    });
    expect(result).toBe("pong");
    expect(seen?.aborted).toBe(false);
  });

  it("rejects with ProviderTimeoutError and aborts the signal when the call is slow", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const pending = withTimeout(8_000, (signal) => {
      seen = signal;
      return new Promise<string>(() => {});
    });
    const outcome = expect(pending).rejects.toBeInstanceOf(ProviderTimeoutError);

    await vi.advanceTimersByTimeAsync(7_999);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(seen?.aborted).toBe(true);
  });

  it("describes a timeout without any request detail", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(10, () => new Promise<never>(() => {}));
    const outcome = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    const error = (await outcome) as Error;
    expect(error.name).toBe("ProviderTimeoutError");
    expect(error.message).toBe("The provider did not respond in time.");
  });

  it("propagates the call's own failure and clears the timer", async () => {
    vi.useFakeTimers();
    await expect(
      withTimeout(5_000, async () => {
        throw new Error("401 from provider");
      }),
    ).rejects.toThrow("401 from provider");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timer after success", async () => {
    vi.useFakeTimers();
    await withTimeout(5_000, async () => "ok");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("retry", () => {
  it("returns the first success without sleeping", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async (attempt: number) => `attempt ${attempt}`);
    await expect(retry(fn, { sleep })).resolves.toBe("attempt 1");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries transient failures with exponential backoff", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async (attempt: number) => {
      if (attempt < 3) throw new TransientProviderError(`busy ${attempt}`);
      return "done";
    });
    await expect(retry(fn, { sleep })).resolves.toBe("done");
    expect(fn.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
  });

  it("retries a timeout", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async (attempt: number) => {
      if (attempt === 1) throw new ProviderTimeoutError();
      return "recovered";
    });
    await expect(retry(fn, { sleep, baseDelayMs: 40 })).resolves.toBe("recovered");
    expect(sleep.mock.calls).toEqual([[40]]);
  });

  it("gives up after the configured attempts and throws the last error", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async (attempt: number) => {
      throw new TransientProviderError(`busy ${attempt}`);
    });
    await expect(retry(fn, { sleep, attempts: 4, baseDelayMs: 10 })).rejects.toThrow("busy 4");
    expect(fn).toHaveBeenCalledTimes(4);
    // No sleep after the final attempt.
    expect(sleep.mock.calls).toEqual([[10], [20], [40]]);
  });

  it("does not retry a permanent failure", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => {
      throw new Error("invalid api key");
    });
    await expect(retry(fn, { sleep })).rejects.toThrow("invalid api key");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("lets the caller decide what is retryable", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async (attempt: number) => {
      if (attempt === 1) throw new Error("ECONNRESET");
      return "ok";
    });
    await expect(retry(fn, { sleep, retryable: (error) => (error as Error).message === "ECONNRESET" })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);

    const never = vi.fn(async () => {
      throw new TransientProviderError("busy");
    });
    await expect(retry(never, { sleep, retryable: () => false })).rejects.toThrow("busy");
    expect(never).toHaveBeenCalledTimes(1);
  });

  it("makes a single attempt when attempts is 1", async () => {
    const fn = vi.fn(async () => {
      throw new TransientProviderError("busy");
    });
    await expect(retry(fn, { attempts: 1 })).rejects.toThrow("busy");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("sleeps with setTimeout between attempts by default", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async (attempt: number) => {
      if (attempt === 1) throw new TransientProviderError("busy");
      return "ok";
    });
    const pending = retry(fn);
    await vi.advanceTimersByTimeAsync(249);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("assertNotTransient", () => {
  it.each([429, 500, 502, 503, 504, 599])("treats HTTP %d as transient", (status) => {
    expect(() => assertNotTransient({ status })).toThrow(TransientProviderError);
    expect(() => assertNotTransient({ status })).toThrow(`Provider responded with HTTP ${status}`);
  });

  it.each([200, 201, 204, 301, 400, 401, 403, 404, 422, 499])("lets HTTP %d through", (status) => {
    expect(() => assertNotTransient({ status })).not.toThrow();
  });
});

describe("sanitiseProviderMessage", () => {
  const apiKey = FAKE_LIVE_KEY;

  it("scrubs every occurrence of every secret", () => {
    const message = `Invalid key ${apiKey}; retry with ${apiKey} or password s3cr3t-pass`;
    const clean = sanitiseProviderMessage(message, [apiKey, "s3cr3t-pass"]);
    expect(clean).toBe("Invalid key [redacted]; retry with [redacted] or password [redacted]");
  });

  it("reads the message of an Error and stringifies anything else", () => {
    expect(sanitiseProviderMessage(new Error(`bad credentials: ${apiKey}`), [apiKey])).toBe("bad credentials: [redacted]");
    expect(sanitiseProviderMessage({ toString: () => `object with ${apiKey}` }, [apiKey])).toBe("object with [redacted]");
    expect(sanitiseProviderMessage(undefined)).toBe("undefined");
    expect(sanitiseProviderMessage(404)).toBe("404");
  });

  it("ignores empty and very short secrets instead of shredding the text", () => {
    expect(sanitiseProviderMessage("the cat sat", ["", "at", "the"])).toBe("the cat sat");
    expect(sanitiseProviderMessage("pin 1234 rejected", ["1234"])).toBe("pin [redacted] rejected");
  });

  it("accepts any iterable of secrets", () => {
    expect(sanitiseProviderMessage(`key ${apiKey}`, new Set([apiKey]))).toBe("key [redacted]");
    expect(sanitiseProviderMessage(`key ${apiKey}`, Object.values({ apiKey }))).toBe("key [redacted]");
  });

  it("strips credentials embedded in URLs", () => {
    expect(sanitiseProviderMessage("connect failed: https://user:hunter2@smtp.example.com/send")).toBe(
      "connect failed: https://[redacted]@smtp.example.com/send",
    );
    expect(sanitiseProviderMessage("HTTP://admin:pw@host.example/path")).toBe("HTTP://[redacted]@host.example/path");
  });

  it("strips query strings from URLs but keeps the fragment", () => {
    expect(sanitiseProviderMessage("GET https://api.example.com/v1/ping?api_key=abc123&sig=zzz failed")).toBe(
      "GET https://api.example.com/v1/ping?[redacted] failed",
    );
    expect(sanitiseProviderMessage("see https://api.example.com/docs?token=abc#errors")).toBe(
      "see https://api.example.com/docs?[redacted]#errors",
    );
  });

  it("strips bearer and basic credentials", () => {
    expect(sanitiseProviderMessage("header Authorization: Bearer eyJhbGciOi.payload.sig-_ rejected")).toBe(
      "header Authorization: Bearer [redacted] rejected",
    );
    expect(sanitiseProviderMessage("sent basic dXNlcjpwYXNz== and got 401")).toBe("sent basic [redacted] and got 401");
  });

  it("caps the length", () => {
    const clean = sanitiseProviderMessage("e".repeat(1_000));
    expect(clean).toBe(`${"e".repeat(300)}…`);
    expect(sanitiseProviderMessage("e".repeat(300))).toHaveLength(300);
  });

  it("scrubs before truncating, so a secret cannot survive at the cut", () => {
    const message = `${"x".repeat(290)} ${apiKey}`;
    const clean = sanitiseProviderMessage(message, [apiKey]);
    expect(clean).not.toContain("sk_live");
    expect(clean).not.toContain(apiKey.slice(0, 6));
  });
});
