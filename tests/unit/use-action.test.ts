import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { isNavigation } = await import("@/hooks/use-action");

describe("isNavigation", () => {
  it("recognises Next.js redirect and not-found control flow", () => {
    expect(isNavigation({ digest: "NEXT_REDIRECT;replace;/login;307;" })).toBe(true);
    expect(isNavigation({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })).toBe(true);
  });

  it("treats everything else as a real failure", () => {
    expect(isNavigation(new Error("fetch failed"))).toBe(false);
    expect(isNavigation({ digest: 42 })).toBe(false);
    expect(isNavigation({ digest: "SOMETHING_ELSE" })).toBe(false);
    expect(isNavigation(null)).toBe(false);
    expect(isNavigation(undefined)).toBe(false);
  });
});
