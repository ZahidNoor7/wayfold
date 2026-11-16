import { afterEach, describe, expect, it, vi } from "vitest";
import { stripeAdapter, stripeKeyMode } from "@/server/integrations/adapters/stripe";
import { ProviderTimeoutError, TransientProviderError } from "@/server/integrations/http";
import { expectNoSecret, hangUntilAborted, jsonResponse, stubFetch, textResponse, thrownBy } from "./helpers";

// Shaped like Stripe keys, but obviously not real ones.
const testKey = ["sk", "test", "51WayfoldFakeKeyForTests0000"].join("_");
const liveKey = ["rk", "live", "51WayfoldFakeKeyForTests1111"].join("_");
const webhookSecret = ["whsec", "WayfoldFakeSigningSecret2222"].join("_");
const never = new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("stripe settings", () => {
  it("accepts secret and restricted keys of either mode", () => {
    for (const secretKey of [testKey, liveKey, "sk_live_abcdefgh1234", "rk_test_abcdefgh1234"]) {
      expect(stripeAdapter.secretSchema.safeParse({ secretKey }).success, secretKey).toBe(true);
    }
    expect(stripeAdapter.secretSchema.parse({ secretKey: ` ${testKey} `, webhookSecret })).toEqual({ secretKey: testKey, webhookSecret });
  });

  it("rejects publishable keys, organisation keys and anything else, saying why", () => {
    const messageFor = (secretKey: string) => stripeAdapter.secretSchema.safeParse({ secretKey }).error?.issues[0]?.message;
    expect(messageFor("pk_test_51WayfoldFakeKeyForTests")).toMatch(/publishable key/);
    expect(messageFor("sk_org_live_51WayfoldFakeKey")).toMatch(/Organisation keys/);
    expect(messageFor("not-a-key")).toMatch(/sk_test_, sk_live_, rk_test_ or rk_live_/);
    expect(messageFor("sk_test_")).toMatch(/sk_test_/);
    expect(messageFor("sk_test_has space")).toBeDefined();
    expect(stripeAdapter.secretSchema.safeParse({}).success).toBe(false);
  });

  it("checks the webhook secret prefix and refuses unknown keys", () => {
    expect(stripeAdapter.secretSchema.safeParse({ secretKey: testKey, webhookSecret: "secret-without-prefix" }).success).toBe(false);
    expect(stripeAdapter.secretSchema.safeParse({ secretKey: testKey, publishableKey: "pk_test_x" }).success).toBe(false);
  });

  it("normalises the currency and treats empty optional fields as unset", () => {
    expect(stripeAdapter.configSchema.parse({ currency: " eur ", mode: "live" })).toEqual({ currency: "EUR", mode: "live" });
    expect(stripeAdapter.configSchema.parse({})).toEqual({});
    const blank = stripeAdapter.configSchema.parse({ currency: "", mode: "" });
    expect(blank.currency).toBeUndefined();
    expect(blank.mode).toBeUndefined();
    expect(stripeAdapter.configSchema.safeParse({ currency: "euro" }).success).toBe(false);
    expect(stripeAdapter.configSchema.safeParse({ mode: "production" }).success).toBe(false);
    expect(stripeAdapter.configSchema.safeParse({ currency: "USD", account: "acct_1" }).success).toBe(false);
  });

  it("reads the mode from the key prefix", () => {
    expect(stripeKeyMode(testKey)).toBe("test");
    expect(stripeKeyMode(liveKey)).toBe("live");
  });

  it("marks both credentials secret in its form", () => {
    expect(stripeAdapter).toMatchObject({ id: "stripe", category: "payments" });
    expect(stripeAdapter.fields.filter((field) => field.secret).map((field) => field.key)).toEqual(["secretKey", "webhookSecret"]);
    expect(stripeAdapter.fields.find((field) => field.key === "mode")?.options?.map((option) => option.value)).toEqual(["test", "live"]);
  });
});

describe("stripe connection test", () => {
  it("reads the balance with bearer auth and reports the mode", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { object: "balance", livemode: false, available: [] }));
    const signal = new AbortController().signal;

    const result = await stripeAdapter.test({ config: {}, secrets: { secretKey: testKey, webhookSecret } }, signal);

    expect(result).toEqual({ ok: true, detail: "Connected to Stripe in test mode." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/balance");
    expect(init.method).toBe("GET");
    expect(init.signal).toBe(signal);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${testKey}`);
    expectNoSecret(result, [testKey, webhookSecret]);
  });

  it("reports live mode for a live account", async () => {
    stubFetch(jsonResponse(200, { object: "balance", livemode: true }));
    expect(await stripeAdapter.test({ config: { mode: "live" }, secrets: { secretKey: liveKey } }, never)).toEqual({
      ok: true,
      detail: "Connected to Stripe in live mode.",
    });
  });

  it("refuses a key of the wrong mode before calling Stripe", async () => {
    const fetchMock = stubFetch(jsonResponse(200, {}));
    const result = await stripeAdapter.test({ config: { mode: "live" }, secrets: { secretKey: testKey } }, never);
    expect(result).toEqual({ ok: false, message: "This is a test mode key, but the connection is set to live mode." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a rejected key with a fixed message, whatever Stripe says", async () => {
    stubFetch(jsonResponse(401, { error: { type: "invalid_request_error", message: `Invalid API Key provided: ${testKey}` } }));
    const result = await stripeAdapter.test({ config: {}, secrets: { secretKey: testKey } }, never);
    expect(result).toEqual({ ok: false, message: "Stripe did not accept this API key. It may have been rotated, expired or mistyped." });
  });

  it("explains a restricted key without balance access and scrubs masked keys", async () => {
    stubFetch(
      jsonResponse(403, {
        error: { message: "The provided key 'rk_live_********************1111' does not have the required permissions for this endpoint." },
      }),
    );
    const result = await stripeAdapter.test({ config: {}, secrets: { secretKey: liveKey } }, never);
    expect(result.ok).toBe(false);
    const message = (result as { message: string }).message;
    expect(message).toContain("read access to Balance");
    expect(message).toContain("[redacted]");
    expect(message).not.toMatch(/rk_live_/);
    expectNoSecret(result, [liveKey]);
  });

  it("passes on any other rejection, sanitised, and survives a non-JSON body", async () => {
    stubFetch(jsonResponse(400, { error: { message: `Bad request for ${testKey} with ${webhookSecret}` } }));
    const result = await stripeAdapter.test({ config: {}, secrets: { secretKey: testKey, webhookSecret } }, never);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("Stripe could not verify the connection") });
    expectNoSecret(result, [testKey, webhookSecret]);

    stubFetch(textResponse(400, "nope"));
    expect(await stripeAdapter.test({ config: {}, secrets: { secretKey: testKey } }, never)).toEqual({
      ok: false,
      message: "Stripe could not verify the connection (HTTP 400).",
    });
  });

  it("treats 429 and 5xx as transient", async () => {
    for (const status of [429, 500, 502, 503, 504]) {
      stubFetch(jsonResponse(status, { error: { type: "api_error", message: "try later" } }));
      const error = await thrownBy(() => stripeAdapter.test({ config: {}, secrets: { secretKey: testKey } }, never));
      expect(error, String(status)).toBeInstanceOf(TransientProviderError);
      expectNoSecret(error.message, [testKey]);
    }
  });

  it("stops when the signal is aborted, and reports unreachable networks as transient", async () => {
    stubFetch(hangUntilAborted);
    const controller = new AbortController();
    const pending = stripeAdapter.test({ config: {}, secrets: { secretKey: testKey } }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ProviderTimeoutError);

    stubFetch(new TypeError("fetch failed"));
    await expect(stripeAdapter.test({ config: {}, secrets: { secretKey: testKey } }, never)).rejects.toBeInstanceOf(TransientProviderError);
  });
});
