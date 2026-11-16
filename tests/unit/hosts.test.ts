import { describe, expect, it } from "vitest";
import { classifyHost, normaliseHost, tenantOrigin, type HostConfig, type HostTarget } from "@/server/tenancy/hosts";

const config: HostConfig = { rootDomain: "wayfold.test", appHost: "app.wayfold.test" };
const local: HostConfig = { rootDomain: "localhost:3000", appHost: "app.localhost:3000" };

const INVALID: HostTarget = { kind: "invalid" };

describe("normaliseHost", () => {
  it("lower-cases, trims and drops one trailing dot", () => {
    expect(normaliseHost("  Acme.Wayfold.TEST.  ")).toBe("acme.wayfold.test");
    expect(normaliseHost("example.com:8080")).toBe("example.com:8080");
  });

  it.each([null, undefined, "", "   ", "exa mple.com", "exa_mple.com", "example.com:", "example.com:123456", "example.com:80:80", "[::1]:3000"])(
    "returns null for %j",
    (value) => {
      expect(normaliseHost(value)).toBeNull();
    },
  );
});

describe("classifyHost", () => {
  it.each<[string, string, HostTarget]>([
    ["the app host", "app.wayfold.test", { kind: "app" }],
    ["the app host in upper case", "APP.WAYFOLD.TEST", { kind: "app" }],
    ["the app host with a trailing dot", "app.wayfold.test.", { kind: "app" }],
    ["the root domain", "wayfold.test", { kind: "marketing" }],
    ["the root domain with a trailing dot", "wayfold.test.", { kind: "marketing" }],
    ["www on the root domain", "www.wayfold.test", { kind: "marketing" }],
    ["www in mixed case", "WWW.Wayfold.Test", { kind: "marketing" }],
    ["a tenant label", "acme.wayfold.test", { kind: "tenant", site: "acme" }],
    ["a tenant label in upper case", "ACME.WAYFOLD.TEST", { kind: "tenant", site: "acme" }],
    ["a tenant label with a trailing dot", "acme.wayfold.test.", { kind: "tenant", site: "acme" }],
    ["a tenant label with digits and hyphens", "baku-tours-24.wayfold.test", { kind: "tenant", site: "baku-tours-24" }],
    ["a single-character tenant label", "a.wayfold.test", { kind: "tenant", site: "a" }],
    ["a 63-character tenant label", `${"a".repeat(63)}.wayfold.test`, { kind: "tenant", site: "a".repeat(63) }],
    ["a custom domain", "tours.example.com", { kind: "custom", site: "tours.example.com" }],
    ["an apex custom domain", "example.com", { kind: "custom", site: "example.com" }],
    ["a custom domain in upper case", "Tours.Example.COM", { kind: "custom", site: "tours.example.com" }],
    ["a custom domain with a trailing dot", "tours.example.com.", { kind: "custom", site: "tours.example.com" }],
    ["a custom domain with a port", "tours.example.com:8443", { kind: "custom", site: "tours.example.com" }],
    ["a look-alike that only ends with the root domain text", "evilwayfold.test", { kind: "custom", site: "evilwayfold.test" }],
    ["the root domain used as a prefix of another domain", "wayfold.test.evil.com", { kind: "custom", site: "wayfold.test.evil.com" }],
    ["the app host used as a prefix of another domain", "app.wayfold.test.evil.com", { kind: "custom", site: "app.wayfold.test.evil.com" }],
  ])("classifies %s", (_name, host, expected) => {
    expect(classifyHost(host, config)).toEqual(expected);
  });

  it.each<[string, string | null | undefined]>([
    ["a missing header", null],
    ["an undefined header", undefined],
    ["an empty header", ""],
    ["whitespace", "   "],
    ["a nested sub-domain", "a.b.wayfold.test"],
    ["a deeply nested sub-domain", "www.acme.wayfold.test"],
    ["an empty label", ".wayfold.test"],
    ["a label starting with a hyphen", "-acme.wayfold.test"],
    ["a label ending with a hyphen", "acme-.wayfold.test"],
    ["a 64-character label", `${"a".repeat(64)}.wayfold.test`],
    ["a double trailing dot", "wayfold.test.."],
    ["an underscore", "ac_me.wayfold.test"],
    ["a space inside", "acme .wayfold.test"],
    ["a single-label host", "localhost"],
    ["an IPv4 address", "127.0.0.1"],
    ["an IPv4 address with a port", "10.0.0.1:8080"],
    ["an IPv6 literal", "[::1]"],
    ["a numeric top-level label", "example.123"],
    ["consecutive dots", "tours..example.com"],
    ["a leading dot", ".example.com"],
    ["a host longer than 253 characters", `${"a.".repeat(130)}com`],
    ["a port that is not numeric", "example.com:http"],
    ["an oversized port", "example.com:999999"],
    ["a URL instead of a host", "https://app.wayfold.test"],
    ["a path", "app.wayfold.test/workspace"],
    ["a query string", "app.wayfold.test?x=1"],
    ["userinfo before the app host", "evil.com@app.wayfold.test"],
    ["userinfo after the app host", "app.wayfold.test@evil.com"],
    ["a backslash", "app.wayfold.test\\.evil.com"],
    ["a null byte", "app.wayfold.test\u0000.evil.com"],
    ["a header-splitting newline", "app.wayfold.test\r\nX-Forwarded-Host: evil.com"],
    ["a tab inside", "acme\t.wayfold.test"],
    ["a comma-separated list", "acme.wayfold.test, evil.com"],
    ["SQL injection", "' OR 1=1 --"],
    ["SQL injection with a valid suffix", "x'; drop table tenants; --.wayfold.test"],
    ["a script tag", "<script>alert(1)</script>"],
    ["a wildcard", "*.wayfold.test"],
    ["a percent-encoded dot", "acme%2Ewayfold.test"],
    ["a Cyrillic homoglyph of the app host", "аpp.wayfold.test"],
    ["a full-width character", "ａcme.wayfold.test"],
    ["an emoji label", "🚀.wayfold.test"],
  ])("rejects %s", (_name, host) => {
    expect(classifyHost(host, config)).toEqual(INVALID);
  });

  it("never treats the app or marketing host as a tenant", () => {
    for (const host of ["app.wayfold.test", "www.wayfold.test", "wayfold.test"]) {
      expect(classifyHost(host, config).kind).not.toBe("tenant");
    }
  });

  it("matches the configured port exactly when the root domain carries one", () => {
    expect(classifyHost("app.localhost:3000", local)).toEqual({ kind: "app" });
    expect(classifyHost("localhost:3000", local)).toEqual({ kind: "marketing" });
    expect(classifyHost("www.localhost:3000", local)).toEqual({ kind: "marketing" });
    expect(classifyHost("acme.localhost:3000", local)).toEqual({ kind: "tenant", site: "acme" });
    expect(classifyHost("ACME.LOCALHOST:3000", local)).toEqual({ kind: "tenant", site: "acme" });
    expect(classifyHost("a.b.localhost:3000", local)).toEqual(INVALID);
  });

  it("never grants app, marketing or tenant status to a platform host on an unexpected port", () => {
    // Fails closed: such a host can only ever be looked up as a custom domain,
    // and that lookup needs a verified ownership record.
    for (const host of ["app.wayfold.test:8443", "acme.wayfold.test:8443", "wayfold.test:8443"]) {
      expect(["custom", "invalid"]).toContain(classifyHost(host, config).kind);
    }
    for (const host of ["app.localhost:4000", "acme.localhost:4000", "acme.localhost", "localhost:4000"]) {
      expect(["custom", "invalid"]).toContain(classifyHost(host, local).kind);
    }
  });

  it("compares against the configuration case-insensitively", () => {
    const shouting: HostConfig = { rootDomain: "WAYFOLD.TEST", appHost: "App.Wayfold.Test" };
    expect(classifyHost("app.wayfold.test", shouting)).toEqual({ kind: "app" });
    expect(classifyHost("wayfold.test", shouting)).toEqual({ kind: "marketing" });
    expect(classifyHost("acme.wayfold.test", shouting)).toEqual({ kind: "tenant", site: "acme" });
  });

  it("returns a site that is always a plain lower-case host or label", () => {
    const hosts = ["ACME.wayfold.test", "Tours.Example.com:443", "x-1.wayfold.test.", "MiXeD.Example.Org"];
    for (const host of hosts) {
      const target = classifyHost(host, config);
      if (target.kind !== "tenant" && target.kind !== "custom") throw new Error(`unexpected kind for ${host}`);
      expect(target.site).toMatch(/^[a-z0-9.-]+$/);
    }
  });
});

describe("tenantOrigin", () => {
  it("builds the storefront origin on the platform domain", () => {
    expect(tenantOrigin("acme", config)).toBe("https://acme.wayfold.test");
    expect(tenantOrigin("acme", local, "http")).toBe("http://acme.localhost:3000");
  });
});
