import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudinaryAdapter } from "@/server/integrations/adapters/cloudinary";
import { ProviderTimeoutError, TransientProviderError, withTimeout } from "@/server/integrations/http";
import { expectNoSecret, hangUntilAborted, jsonResponse, stubFetch, textResponse, thrownBy } from "./helpers";

const config = { cloudName: "caspian-trails", uploadFolder: "wayfold" };
const secrets = { apiKey: "731946285012345", apiSecret: "Qx7_secretValue-abc123XYZ" };
const credentials = { config, secrets };
const never = new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("cloudinary settings", () => {
  it("accepts a cloud name with an optional folder and tidies the folder path", () => {
    expect(cloudinaryAdapter.configSchema.parse({ cloudName: " caspian-trails ", uploadFolder: "/tours/2026/" })).toEqual({
      cloudName: "caspian-trails",
      uploadFolder: "tours/2026",
    });
    expect(cloudinaryAdapter.configSchema.parse({ cloudName: "demo" })).toEqual({ cloudName: "demo" });
    // An empty form field means "no folder".
    expect(cloudinaryAdapter.configSchema.parse({ cloudName: "demo", uploadFolder: "  " }).uploadFolder).toBeUndefined();
  });

  it("rejects values that could change the request path, and unknown keys", () => {
    for (const cloudName of ["", "my cloud", "../other", "a/b", "name?x=1"]) {
      expect(cloudinaryAdapter.configSchema.safeParse({ cloudName }).success, cloudName).toBe(false);
    }
    for (const uploadFolder of ["../up", "a//b", "has space", "x".repeat(121)]) {
      expect(cloudinaryAdapter.configSchema.safeParse({ cloudName: "demo", uploadFolder }).success, uploadFolder).toBe(false);
    }
    expect(cloudinaryAdapter.configSchema.safeParse({ cloudName: "demo", tenantId: "x" }).success).toBe(false);
  });

  it("requires both secrets in a shape that is safe inside a Basic auth header", () => {
    expect(cloudinaryAdapter.secretSchema.safeParse(secrets).success).toBe(true);
    expect(cloudinaryAdapter.secretSchema.safeParse({ apiKey: secrets.apiKey }).success).toBe(false);
    expect(cloudinaryAdapter.secretSchema.safeParse({ apiKey: "12:34567", apiSecret: secrets.apiSecret }).success).toBe(false);
    expect(cloudinaryAdapter.secretSchema.safeParse({ apiKey: secrets.apiKey, apiSecret: "has space in it" }).success).toBe(false);
    expect(cloudinaryAdapter.secretSchema.safeParse({ ...secrets, extra: "x" }).success).toBe(false);
  });

  it("describes its form, with both credentials marked secret", () => {
    expect(cloudinaryAdapter).toMatchObject({ id: "cloudinary", category: "media" });
    const secretKeys = cloudinaryAdapter.fields.filter((field) => field.secret).map((field) => field.key);
    expect(secretKeys.sort()).toEqual(["apiKey", "apiSecret"]);
    expect(cloudinaryAdapter.fields.every((field) => field.label && field.help)).toBe(true);
  });
});

describe("cloudinary connection test", () => {
  it("makes one authenticated usage call and reports the plan", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { plan: "Free", last_updated: "2026-11-15" }));
    const signal = new AbortController().signal;

    const result = await cloudinaryAdapter.test(credentials, signal);

    expect(result).toEqual({ ok: true, detail: "Connected to caspian-trails (Free plan)." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.cloudinary.com/v1_1/caspian-trails/usage");
    expect(init.method).toBe("GET");
    expect(init.signal).toBe(signal);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${secrets.apiKey}:${secrets.apiSecret}`).toString("base64")}`,
    );
    // The credentials travel in the header only, never in the URL.
    expectNoSecret(url, Object.values(secrets));
  });

  it("still succeeds when the response names no plan", async () => {
    stubFetch(jsonResponse(200, {}));
    expect(await cloudinaryAdapter.test(credentials, never)).toEqual({ ok: true, detail: "Connected to caspian-trails." });
  });

  it("reports bad credentials without repeating them, even when Cloudinary echoes them", async () => {
    stubFetch(jsonResponse(401, { error: { message: `unknown api_key ${secrets.apiKey} (secret ${secrets.apiSecret})` } }));

    const result = await cloudinaryAdapter.test(credentials, never);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ message: expect.stringContaining("did not accept the cloud name, API key or API secret") });
    expectNoSecret(result, Object.values(secrets));
  });

  it("explains a refused key, an unknown cloud and any other rejection", async () => {
    stubFetch(jsonResponse(403, { error: { message: "Account disabled" } }));
    expect(await cloudinaryAdapter.test(credentials, never)).toEqual({
      ok: false,
      message: "Cloudinary refused this API key (Account disabled). Check that the key is active.",
    });

    stubFetch(jsonResponse(404, { error: { message: "Not found" } }));
    expect(await cloudinaryAdapter.test(credentials, never)).toEqual({
      ok: false,
      message: 'Cloudinary could not find the cloud "caspian-trails". Check the cloud name.',
    });

    // A body that is not JSON falls back to the status code.
    stubFetch(textResponse(400, "<html>Bad request</html>"));
    expect(await cloudinaryAdapter.test(credentials, never)).toEqual({
      ok: false,
      message: "Cloudinary could not verify the connection (HTTP 400).",
    });
  });

  it("treats rate limiting and server errors as transient", async () => {
    for (const status of [420, 429, 500, 503]) {
      stubFetch(jsonResponse(status, { error: { message: `boom ${secrets.apiSecret}` } }));
      const error = await thrownBy(() => cloudinaryAdapter.test(credentials, never));
      expect(error, String(status)).toBeInstanceOf(TransientProviderError);
      expect(error.message).toContain(`HTTP ${status}`);
      expectNoSecret(error.message, Object.values(secrets));
    }
  });

  it("treats a network failure as transient and drops the runtime's message", async () => {
    stubFetch(new TypeError(`fetch failed for https://${secrets.apiKey}:${secrets.apiSecret}@api.cloudinary.com`));
    const error = await thrownBy(() => cloudinaryAdapter.test(credentials, never));
    expect(error).toBeInstanceOf(TransientProviderError);
    expect(error.message).toBe("Could not reach Cloudinary. Please try again in a moment.");
  });

  it("stops when the signal is aborted", async () => {
    stubFetch(hangUntilAborted);
    const controller = new AbortController();
    const pending = cloudinaryAdapter.test(credentials, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ProviderTimeoutError);

    // The same thing under the service's timeout wrapper.
    stubFetch(hangUntilAborted);
    await expect(withTimeout(20, (signal) => cloudinaryAdapter.test(credentials, signal))).rejects.toBeInstanceOf(ProviderTimeoutError);
  });
});
