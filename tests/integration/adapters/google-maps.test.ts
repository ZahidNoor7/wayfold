import { afterEach, describe, expect, it, vi } from "vitest";
import { googleMapsAdapter } from "@/server/integrations/adapters/google-maps";
import { ProviderTimeoutError, TransientProviderError } from "@/server/integrations/http";
import { expectNoSecret, hangUntilAborted, jsonResponse, stubFetch, textResponse, thrownBy } from "./helpers";

// Shaped like a Google API key, but not a real one.
const apiKey = "AIzaWayfoldFakeKeyForTests_0123456789-ab";
const credentials = { config: {}, secrets: { apiKey } };
const never = new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("google maps settings", () => {
  it("takes one secret key and no other settings", () => {
    expect(googleMapsAdapter).toMatchObject({ id: "google_maps", category: "maps" });
    expect(googleMapsAdapter.fields).toHaveLength(1);
    expect(googleMapsAdapter.fields[0]).toMatchObject({ key: "apiKey", secret: true, required: true, type: "password" });
    expect(googleMapsAdapter.configSchema.safeParse({}).success).toBe(true);
    expect(googleMapsAdapter.configSchema.safeParse({ region: "az" }).success).toBe(false);
  });

  it("validates the shape of the key", () => {
    expect(googleMapsAdapter.secretSchema.parse({ apiKey: ` ${apiKey} ` })).toEqual({ apiKey });
    for (const bad of ["", "short", "has spaces in the middle of it", "key&with=query-characters-0123456789"]) {
      expect(googleMapsAdapter.secretSchema.safeParse({ apiKey: bad }).success, bad).toBe(false);
    }
    expect(googleMapsAdapter.secretSchema.safeParse({ apiKey, other: "x" }).success).toBe(false);
  });
});

describe("google maps connection test", () => {
  it("sends one geocoding request and accepts OK", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { status: "OK", results: [{ formatted_address: "Mountain View" }] }));
    const signal = new AbortController().signal;

    const result = await googleMapsAdapter.test(credentials, signal);

    expect(result).toEqual({ ok: true, detail: "The Geocoding API accepted this key." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://maps.googleapis.com/maps/api/geocode/json");
    expect(parsed.searchParams.get("key")).toBe(apiKey);
    expect(parsed.searchParams.get("address")).toBeTruthy();
    expect(init.signal).toBe(signal);
    expectNoSecret(result, [apiKey]);
  });

  it("accepts ZERO_RESULTS, which still proves the key works", async () => {
    stubFetch(jsonResponse(200, { status: "ZERO_RESULTS", results: [] }));
    expect((await googleMapsAdapter.test(credentials, never)).ok).toBe(true);
  });

  it("fails on REQUEST_DENIED with Google's reason, minus the key", async () => {
    stubFetch(jsonResponse(200, { status: "REQUEST_DENIED", results: [], error_message: `The provided API key ${apiKey} is invalid.` }));

    const result = await googleMapsAdapter.test(credentials, never);

    expect(result).toEqual({ ok: false, message: "Google Maps denied the request: The provided API key [redacted] is invalid." });
    expectNoSecret(result, [apiKey]);
  });

  it("falls back to a neutral reason when Google gives none", async () => {
    stubFetch(jsonResponse(200, { status: "REQUEST_DENIED", results: [] }));
    expect(await googleMapsAdapter.test(credentials, never)).toEqual({
      ok: false,
      message: "Google Maps denied the request: no reason was given",
    });
  });

  it("explains billing, quota and other statuses", async () => {
    stubFetch(jsonResponse(200, { status: "OVER_DAILY_LIMIT", error_message: "Billing has not been enabled." }));
    expect(await googleMapsAdapter.test(credentials, never)).toEqual({
      ok: false,
      message: "Google Maps rejected the key or its billing set-up: Billing has not been enabled.",
    });

    stubFetch(jsonResponse(200, { status: "OVER_QUERY_LIMIT", error_message: "You have exceeded your quota." }));
    expect(await googleMapsAdapter.test(credentials, never)).toEqual({
      ok: false,
      message: "This key is over its Geocoding quota: You have exceeded your quota.",
    });

    stubFetch(jsonResponse(200, { status: "INVALID_REQUEST", error_message: "Missing address." }));
    expect(await googleMapsAdapter.test(credentials, never)).toEqual({
      ok: false,
      message: "Google Maps answered INVALID_REQUEST: Missing address.",
    });
  });

  it("reports a response it cannot read", async () => {
    stubFetch(textResponse(403, "<html>Forbidden</html>"));
    expect(await googleMapsAdapter.test(credentials, never)).toEqual({
      ok: false,
      message: "Google Maps sent an unexpected response (HTTP 403).",
    });
  });

  it("treats UNKNOWN_ERROR, 429 and 5xx as transient", async () => {
    stubFetch(jsonResponse(200, { status: "UNKNOWN_ERROR" }));
    await expect(googleMapsAdapter.test(credentials, never)).rejects.toBeInstanceOf(TransientProviderError);

    for (const status of [429, 500, 503]) {
      stubFetch(jsonResponse(status, { status: "UNKNOWN_ERROR" }));
      const error = await thrownBy(() => googleMapsAdapter.test(credentials, never));
      expect(error, String(status)).toBeInstanceOf(TransientProviderError);
      expectNoSecret(error.message, [apiKey]);
    }
  });

  it("never repeats the request URL, which carries the key, when the network fails", async () => {
    stubFetch(new TypeError(`request to https://maps.googleapis.com/maps/api/geocode/json?key=${apiKey} failed`));
    const error = await thrownBy(() => googleMapsAdapter.test(credentials, never));
    expect(error).toBeInstanceOf(TransientProviderError);
    expectNoSecret(error.message, [apiKey]);
  });

  it("stops when the signal is aborted", async () => {
    stubFetch(hangUntilAborted);
    const controller = new AbortController();
    const pending = googleMapsAdapter.test(credentials, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ProviderTimeoutError);
  });
});
