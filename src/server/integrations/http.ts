import "server-only";

export class ProviderTimeoutError extends Error {
  constructor() {
    super("The provider did not respond in time.");
    this.name = "ProviderTimeoutError";
  }
}

/** Runs `fn` with an abort signal that fires after `ms`. */
export async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError());
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  /** Decide whether a failure is worth retrying. Defaults to transient errors. */
  retryable?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export class TransientProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientProviderError";
  }
}

const defaultRetryable = (error: unknown) => error instanceof TransientProviderError || error instanceof ProviderTimeoutError;

/** Exponential backoff for transient provider failures (timeouts, 429, 5xx). */
export async function retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const base = options.baseDelayMs ?? 250;
  const retryable = options.retryable ?? defaultRetryable;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !retryable(error)) break;
      await sleep(base * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

/** Treats 429 and 5xx as transient so callers can wrap fetches in `retry`. */
export function assertNotTransient(response: { status: number }): void {
  if (response.status === 429 || response.status >= 500) {
    throw new TransientProviderError(`Provider responded with HTTP ${response.status}`);
  }
}

/**
 * Makes a provider error safe to store and show: every secret value is
 * scrubbed, URLs lose their query strings and credentials, and the text is
 * capped. Use it on anything derived from a provider response or exception.
 */
export function sanitiseProviderMessage(message: unknown, secrets: Iterable<string> = []): string {
  let text = typeof message === "string" ? message : message instanceof Error ? message.message : String(message);
  for (const secret of secrets) {
    if (secret && secret.length >= 4) text = text.split(secret).join("[redacted]");
  }
  text = text
    .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, "$1?[redacted]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]");
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
