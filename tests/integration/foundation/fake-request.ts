/**
 * Stand-in for `next/headers`, which only works inside a Next.js request.
 * Tests install it with `vi.mock("next/headers", () => import("./fake-request"))`
 * and then describe the incoming request through `fakeRequest`.
 *
 * Shapes follow the Next.js 16 docs shipped in
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/{cookies,headers}.md:
 * both functions are async; `cookies()` offers get/set/delete, `headers()`
 * returns a read-only Web `Headers`.
 */
export interface CookieWrite {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

const state = {
  cookies: new Map<string, string>(),
  headers: new Map<string, string>(),
  written: [] as CookieWrite[],
  deleted: [] as string[],
};

export const fakeRequest = {
  /** Starts a new, empty request. */
  reset(): void {
    state.cookies.clear();
    state.headers.clear();
    state.written = [];
    state.deleted = [];
  },
  setCookie(name: string, value: string): void {
    state.cookies.set(name, value);
  },
  setHeaders(headers: Record<string, string>): void {
    state.headers.clear();
    for (const [name, value] of Object.entries(headers)) state.headers.set(name.toLowerCase(), value);
  },
  setHeader(name: string, value: string): void {
    state.headers.set(name.toLowerCase(), value);
  },
  get written(): CookieWrite[] {
    return state.written;
  },
  get deleted(): string[] {
    return state.deleted;
  },
  cookie(name: string): string | undefined {
    return state.cookies.get(name);
  },
};

export async function cookies() {
  return {
    get(name: string) {
      const value = state.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    has(name: string) {
      return state.cookies.has(name);
    },
    set(name: string, value: string, options: Record<string, unknown> = {}) {
      state.cookies.set(name, value);
      state.written.push({ name, value, options });
    },
    delete(name: string) {
      state.cookies.delete(name);
      state.deleted.push(name);
    },
  };
}

export async function headers(): Promise<Headers> {
  return new Headers([...state.headers.entries()]);
}

/** Path a thrown Next.js redirect points at, or a rethrow of anything else. */
export async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    // `NEXT_REDIRECT;<type>;<url>;<status>;` as built by next/navigation.
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return digest.split(";").slice(2, -2).join(";");
    throw error;
  }
  throw new Error("Expected a redirect, but the call returned");
}
