import { request } from "node:http";
import { expect, test } from "@playwright/test";

/**
 * Host routing is the first tenant boundary: these checks need no UI and run
 * before anything else. They talk to the server directly with explicit Host
 * headers, the way a browser on each domain would.
 */
const PORT = Number(process.env.E2E_PORT ?? "3310");
const APP = `app.localhost:${PORT}`;

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * Plain HTTP with an explicit Host header. `fetch` treats Host as a
 * forbidden header, so node:http is used to address each domain directly.
 */
function get(path: string, host: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: PORT, path, method: "GET", headers: { host, ...headers } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * A storefront that does not exist. Pages stream, so Next.js may already have
 * sent a 200 when the tenant lookup fails; it then renders the not-found page
 * with a robots noindex tag (documented behaviour). Either way no storefront
 * content is served.
 */
function expectNotFound(response: RawResponse, what: string) {
  if (response.status === 404) return;
  expect(response.status, what).toBe(200);
  expect(response.body, what).toMatch(/<meta name="robots" content="noindex"/);
  expect(response.body, what).not.toMatch(/Book a tour/i);
}

const header = (response: RawResponse, name: string) => {
  const value = response.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : (value ?? null);
};

test.describe("host routing", () => {
  test("the internal storefront tree is unreachable by path from the app host", async () => {
    for (const path of ["/s", "/s/anything", "/s/anything/experiences"]) {
      expect((await get(path, APP)).status, path).toBe(404);
    }
  });

  test("an unknown tenant sub-domain is a 404, never another tenant", async () => {
    const response = await get("/", `no-such-business-${Date.now()}.localhost:${PORT}`);
    expectNotFound(response, "unknown sub-domain");
  });

  test("an unverified custom domain is a 404", async () => {
    const response = await get("/", "tours.example.org");
    expectNotFound(response, "unverified custom domain");
  });

  test("malformed hosts are rejected", async () => {
    for (const host of ["a..b.localhost", "-bad.localhost", "x_y.localhost"]) {
      expect((await get("/", host)).status, host).toBe(404);
    }
  });

  test("a nested path on a tenant host cannot reach another tenant's tree", async () => {
    const response = await get("/s/other-business", `no-such-business.localhost:${PORT}`);
    expectNotFound(response, "nested /s path");
  });

  test("dashboard paths on the marketing domain go to the app host", async () => {
    const response = await get("/workspace", `localhost:${PORT}`);
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(header(response, "location")).toContain(`//${APP}/workspace`);
  });

  test("the app host root opens the dashboard", async () => {
    const response = await get("/", APP);
    expect(header(response, "location")).toMatch(/\/workspace$/);
  });

  test("the dashboard requires a session", async () => {
    const response = await get("/workspace", APP);
    // Server components redirect with a 307 during streaming, or render a
    // redirect boundary; either way the user ends up at the login page.
    if (response.status >= 300 && response.status < 400) {
      expect(header(response, "location")).toMatch(/\/login/);
    } else {
      expect(response.body).toContain("/login");
    }
  });
});

test.describe("platform endpoints", () => {
  test("scheduled jobs refuse a request without the shared secret", async () => {
    expect((await get("/api/cron", "deploy.example.app")).status).toBe(404);
    expect((await get("/api/cron", "deploy.example.app", { authorization: "Bearer wrong" })).status).toBe(404);
  });

  test("health answers on any host and says nothing else", async () => {
    const response = await get("/api/health", "deploy.example.app");
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok" });
  });
});

test.describe("security headers", () => {
  test("every response carries the security headers", async () => {
    const response = await get("/offline.html", APP);
    expect(header(response, "content-security-policy")).toContain("frame-ancestors 'none'");
    expect(header(response, "x-content-type-options")).toBe("nosniff");
    expect(header(response, "x-frame-options")).toBe("DENY");
    expect(header(response, "referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(header(response, "x-powered-by")).toBeNull();
  });

  test("the service worker is never cached", async () => {
    const response = await get("/sw.js", APP);
    expect(response.status).toBe(200);
    expect(header(response, "cache-control")).toContain("no-store");
  });
});
