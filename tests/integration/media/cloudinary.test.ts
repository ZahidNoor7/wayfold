import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "@/server/errors";
import { destroyResource, fetchResource, signParams, stringToSign, uploadUrl, type CloudinaryCredentials } from "@/server/media/cloudinary";
import { documentedSignature, FakeCloudinary, newAccount, type Account } from "./helpers";

const credentials = (account: Account): CloudinaryCredentials => ({
  config: { cloudName: account.cloudName },
  secrets: { apiKey: account.apiKey, apiSecret: account.apiSecret },
});

describe("Cloudinary request signing", () => {
  it("reproduces the documented timestamp-only example", () => {
    // https://cloudinary.com/documentation/authentication_signatures
    expect(stringToSign({ timestamp: 1315060510 })).toBe("timestamp=1315060510");
    expect(signParams({ timestamp: 1315060510 }, "abcd", "sha1")).toBe("a21ad0f63beb4de2e5575204b79ab90bffb02c10");
  });

  it("reproduces the documented example with extra parameters", () => {
    const params = { timestamp: "1315060510", public_id: "sample_image", eager: "w_400,h_300,c_pad|w_260,h_200,c_crop" };
    expect(stringToSign(params)).toBe("eager=w_400,h_300,c_pad|w_260,h_200,c_crop&public_id=sample_image&timestamp=1315060510");
    expect(signParams(params, "abcd", "sha1")).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });

  it("never signs file, cloud_name, resource_type, api_key or the signature, and skips empty values", () => {
    const params = {
      file: "sample.jpg",
      cloud_name: "demo",
      resource_type: "image",
      api_key: "1234",
      signature: "stale",
      timestamp: 1315060510,
      folder: "",
      tags: undefined,
      context: null,
      overwrite: false,
    };
    expect(stringToSign(params)).toBe("overwrite=false&timestamp=1315060510");
  });

  it("defaults to SHA-256 over the same string", () => {
    const params = { folder: "wayfold/t_1", public_id: "abc", timestamp: "1700000000" };
    const signature = signParams(params, "s3cret");
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).toBe(documentedSignature(params, "s3cret", "sha256"));
    expect(signParams(params, "s3cret", "sha1")).toBe(documentedSignature(params, "s3cret", "sha1"));
  });

  it("builds the upload endpoint for the account and resource type", () => {
    expect(uploadUrl("demo", "image")).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    expect(uploadUrl("my cloud", "video")).toBe("https://api.cloudinary.com/v1_1/my%20cloud/video/upload");
  });
});

describe("Cloudinary provider calls", () => {
  let cloud: FakeCloudinary;
  let account: Account;

  beforeEach(() => {
    cloud = new FakeCloudinary().install();
    account = cloud.addAccount(newAccount());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a resource from the Admin API with Basic authentication", async () => {
    cloud.put(account.cloudName, "image", "wayfold/t_1/pic one", { format: "png", bytes: 2048, width: 10.4, height: 20 });

    const resource = await fetchResource(credentials(account), "image", "wayfold/t_1/pic one");

    expect(resource).toEqual({
      publicId: "wayfold/t_1/pic one",
      resourceType: "image",
      deliveryType: "upload",
      format: "png",
      bytes: 2048,
      width: 10,
      height: 20,
      durationSeconds: null,
      secureUrl: expect.stringMatching(/^https:\/\/res\.cloudinary\.com\//),
    });
    const [call] = cloud.calls;
    expect(call?.method).toBe("GET");
    expect(call?.url).toBe(`https://api.cloudinary.com/v1_1/${account.cloudName}/resources/image/upload/wayfold/t_1/pic%20one`);
    expect(call?.authorization).toBe(`Basic ${Buffer.from(`${account.apiKey}:${account.apiSecret}`).toString("base64")}`);
    // Credentials travel in the header only.
    expect(call?.url).not.toContain(account.apiSecret);
  });

  it("reports video duration in whole seconds and tolerates missing optional fields", async () => {
    cloud.put(account.cloudName, "video", "wayfold/t_1/clip", { duration: 12.6 });
    expect((await fetchResource(credentials(account), "video", "wayfold/t_1/clip"))?.durationSeconds).toBe(13);

    cloud.scripted.push(
      new Response(JSON.stringify({ public_id: "x", resource_type: "image", type: "upload", bytes: 1, secure_url: "https://res.cloudinary.com/x" })),
    );
    expect(await fetchResource(credentials(account), "image", "x")).toMatchObject({ format: "", width: null, height: null, durationSeconds: null });
  });

  it("returns null for a resource the provider does not have", async () => {
    expect(await fetchResource(credentials(account), "image", "wayfold/t_1/missing")).toBeNull();
  });

  it("explains rejected credentials without echoing them", async () => {
    const wrong = credentials({ ...account, apiSecret: "wrong-secret-value" });
    const error = await fetchResource(wrong, "image", "wayfold/t_1/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    expect((error as Error).message).toMatch(/rejected the stored credentials/);
    expect((error as Error).message).not.toContain("wrong-secret-value");
  });

  it("scrubs secrets and query strings from provider error messages", async () => {
    cloud.scripted.push(
      new Response(JSON.stringify({ error: { message: `Bad call with ${account.apiSecret} at https://api.cloudinary.com/x?api_key=${account.apiKey}` } }), {
        status: 400,
      }),
    );
    const error = (await fetchResource(credentials(account), "image", "wayfold/t_1/x").catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.message).toContain("refused the request");
    expect(error.message).not.toContain(account.apiSecret);
    expect(error.message).not.toContain(account.apiKey);
  });

  it("falls back to the status code when an error body is not JSON", async () => {
    cloud.scripted.push(new Response("<html>teapot</html>", { status: 418 }));
    const error = (await fetchResource(credentials(account), "image", "x").catch((e: unknown) => e)) as Error;
    expect(error.message).toContain("HTTP 418");
  });

  it("rejects a success response that is not a resource", async () => {
    cloud.scripted.push(new Response(JSON.stringify({ public_id: "x", bytes: "many" }), { status: 200 }));
    await expect(fetchResource(credentials(account), "image", "x")).rejects.toThrow(/unexpected response/);

    cloud.scripted.push(new Response("not json", { status: 200 }));
    await expect(fetchResource(credentials(account), "image", "x")).rejects.toThrow(/unexpected response/);
  });

  it("retries a transient failure and then succeeds", async () => {
    cloud.put(account.cloudName, "image", "wayfold/t_1/pic");
    cloud.scripted.push(new Response("busy", { status: 503 }));

    const resource = await fetchResource(credentials(account), "image", "wayfold/t_1/pic");

    expect(resource?.publicId).toBe("wayfold/t_1/pic");
    expect(cloud.callsOf("details")).toHaveLength(2);
  });

  it("turns a network failure into a sanitised integration error", async () => {
    cloud.scripted.push(new TypeError(`connect failed for https://${account.apiKey}:${account.apiSecret}@api.cloudinary.com/v1_1/x`));
    const error = (await fetchResource(credentials(account), "image", "x").catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.message).toContain("could not be reached");
    expect(error.message).not.toContain(account.apiSecret);
  });

  it("destroys a resource with a correctly signed request", async () => {
    cloud.put(account.cloudName, "video", "wayfold/t_1/clip");

    await destroyResource(credentials(account), "video", "wayfold/t_1/clip");

    expect(cloud.has(account.cloudName, "video", "wayfold/t_1/clip")).toBe(false);
    const [call] = cloud.callsOf("destroy");
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(`https://api.cloudinary.com/v1_1/${account.cloudName}/video/destroy`);
    expect(call?.body).toMatchObject({ public_id: "wayfold/t_1/clip", invalidate: "true", api_key: account.apiKey });
    expect(Number(call?.body.timestamp)).toBeGreaterThan(1_700_000_000);
    // The fake accepted it, and so does an independent computation.
    expect(call?.body.signature).toBe(documentedSignature(call?.body ?? {}, account.apiSecret));
    expect(call?.body).not.toHaveProperty("api_secret");
    expect(JSON.stringify(call)).not.toContain(account.apiSecret);
  });

  it("treats an already-missing resource as destroyed", async () => {
    await expect(destroyResource(credentials(account), "image", "wayfold/t_1/gone")).resolves.toBeUndefined();
  });

  it("fails when the provider refuses to destroy", async () => {
    const wrong = credentials({ ...account, apiSecret: "another-secret" });
    await expect(destroyResource(wrong, "image", "wayfold/t_1/x")).rejects.toBeInstanceOf(IntegrationError);
  });
});
