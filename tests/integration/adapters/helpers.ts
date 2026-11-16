import { expect, vi } from "vitest";

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

type FetchArgs = [url: string, init: RequestInit & { signal: AbortSignal }];

/** Replaces global fetch. Each call consumes the next queued answer; the last one repeats. */
export function stubFetch(...answers: (Response | Error | ((...args: FetchArgs) => Promise<Response>))[]) {
  let call = 0;
  const mock = vi.fn(async (...args: FetchArgs): Promise<Response> => {
    const answer = answers[Math.min(call++, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    if (typeof answer === "function") return answer(...args);
    // A Response body can be read once, so repeats get a fresh copy.
    return answer!.clone();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** A fetch that never answers and rejects the way the platform does when aborted. */
export const hangUntilAborted = (_url: string, init: { signal: AbortSignal }) =>
  new Promise<Response>((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
  });

/** Fails if any secret value appears anywhere in `value`, in plain, base64 or URL-encoded form. */
export function expectNoSecret(value: unknown, secrets: string[]): void {
  const haystack = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) {
    expect(haystack).not.toContain(secret);
    expect(haystack).not.toContain(Buffer.from(secret).toString("base64"));
    expect(haystack).not.toContain(encodeURIComponent(secret));
  }
}

/** Runs a call that is expected to throw and returns what it threw. */
export async function thrownBy(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the call to throw");
}
