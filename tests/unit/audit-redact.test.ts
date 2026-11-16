import { describe, expect, it } from "vitest";
import { redact } from "@/server/audit";

describe("redact", () => {
  it("passes plain values through", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(42)).toBe(42);
    expect(redact(0)).toBe(0);
    expect(redact(true)).toBe(true);
    expect(redact(false)).toBe(false);
    expect(redact(null)).toBeNull();
  });

  it("turns undefined into null so the JSON column stays valid", () => {
    expect(redact(undefined)).toBeNull();
    expect(redact({ note: undefined })).toEqual({ note: null });
  });

  it("serialises dates and stringifies exotic values", () => {
    expect(redact(new Date("2025-03-09T10:00:00Z"))).toBe("2025-03-09T10:00:00.000Z");
    expect(redact(BigInt(12))).toBe("12");
    expect(redact(Symbol("s"))).toBe("Symbol(s)");
    expect(typeof redact(() => "fn")).toBe("string");
  });

  it.each([
    "secret",
    "clientSecret",
    "client_secret",
    "password",
    "newPassword",
    "token",
    "accessToken",
    "refresh_token",
    "apiKey",
    "api_key",
    "api-key",
    "APIKEY",
    "authorization",
    "Authorization",
    "credential",
    "credentials",
    "privateKey",
    "private_key",
    "private-key",
    "signature",
    "webhookSignature",
    "cookie",
    "setCookie",
  ])("redacts the value under %j", (key) => {
    expect(redact({ [key]: "hunter2-value" })).toEqual({ [key]: "[redacted]" });
  });

  it("redacts whatever sits under a sensitive key, including objects and arrays", () => {
    expect(redact({ credentials: { user: "ada", pass: "hunter2" }, tokens: ["a", "b"], password: 12345 })).toEqual({
      credentials: "[redacted]",
      tokens: "[redacted]",
      password: "[redacted]",
    });
  });

  it("redacts secrets nested inside objects and arrays", () => {
    const input = {
      provider: "smtp",
      request: { headers: { authorization: "Bearer abc.def", accept: "json" }, body: { user: "ada", password: "hunter2" } },
      attempts: [{ apiKey: "sk_live_1", ok: false }, { apiKey: "sk_live_2", ok: true }],
    };
    const output = redact(input);
    expect(output).toEqual({
      provider: "smtp",
      request: { headers: { authorization: "[redacted]", accept: "json" }, body: { user: "ada", password: "[redacted]" } },
      attempts: [{ apiKey: "[redacted]", ok: false }, { apiKey: "[redacted]", ok: true }],
    });
    const rendered = JSON.stringify(output);
    for (const leak of ["hunter2", "sk_live", "abc.def"]) expect(rendered).not.toContain(leak);
  });

  it("keeps ordinary keys that merely look businesslike", () => {
    const input = { provider: "stripe", label: "Primary", fields: ["apiKey", "apiSecret"], count: 2, key: "value" };
    expect(redact(input)).toEqual(input);
  });

  it("does not modify its input", () => {
    const input = { password: "hunter2", nested: { token: "t" } };
    redact(input);
    expect(input).toEqual({ password: "hunter2", nested: { token: "t" } });
  });

  it("truncates long strings to 500 characters plus an ellipsis", () => {
    expect(redact("a".repeat(500))).toBe("a".repeat(500));
    expect(redact("a".repeat(501))).toBe(`${"a".repeat(500)}…`);
    expect(redact({ note: "b".repeat(5_000) })).toEqual({ note: `${"b".repeat(500)}…` });
  });

  it("keeps at most 50 array items", () => {
    const output = redact(Array.from({ length: 80 }, (_, index) => index)) as number[];
    expect(output).toHaveLength(50);
    expect(output[49]).toBe(49);
  });

  it("bounds nesting depth", () => {
    const deep = { a: { b: { c: { d: { e: { password: "hunter2", f: "too deep" } } } } } };
    const output = redact(deep);
    expect(output).toEqual({ a: { b: { c: { d: "[truncated]" } } } });
    expect(JSON.stringify(output)).not.toContain("hunter2");
  });

  it("still returns scalars found at the depth limit", () => {
    expect(redact({ a: { b: { c: { d: "leaf", n: 1, when: new Date("2025-01-01T00:00:00Z") } } } })).toEqual({
      a: { b: { c: { d: "leaf", n: 1, when: "2025-01-01T00:00:00.000Z" } } },
    });
  });

  it("bounds depth through arrays too", () => {
    expect(redact([[[[["deep"]]]]])).toEqual([[[["[truncated]"]]]]);
  });

  it("honours an explicit starting depth", () => {
    expect(redact({ a: 1 }, 4)).toBe("[truncated]");
    expect(redact("text", 4)).toBe("text");
  });
});
