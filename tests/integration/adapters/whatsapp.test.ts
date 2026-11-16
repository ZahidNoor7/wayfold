import { describe, expect, it, vi } from "vitest";
import { whatsappAdapter, whatsappChatLink } from "@/server/integrations/adapters/whatsapp";
import { ProviderTimeoutError } from "@/server/integrations/http";

const never = new AbortController().signal;

describe("whatsapp settings", () => {
  it("normalises a pasted number to E.164", () => {
    expect(whatsappAdapter.configSchema.parse({ phoneNumber: "+994 (50) 123-45-67" })).toEqual({ phoneNumber: "+994501234567" });
    expect(whatsappAdapter.configSchema.parse({ phoneNumber: "+1.415.555.2671" })).toEqual({ phoneNumber: "+14155552671" });
  });

  it("rejects numbers that are not full international numbers", () => {
    for (const phoneNumber of ["994501234567", "+0501234567", "0501234567", "+12345", "+1234567890123456", "+99450abc4567", ""]) {
      expect(whatsappAdapter.configSchema.safeParse({ phoneNumber }).success, phoneNumber).toBe(false);
    }
    expect(whatsappAdapter.configSchema.safeParse({ phoneNumber: "+994501234567", apiToken: "x" }).success).toBe(false);
  });

  it("has no secrets at all", () => {
    expect(whatsappAdapter).toMatchObject({ id: "whatsapp", category: "messaging" });
    expect(whatsappAdapter.fields.some((field) => field.secret)).toBe(false);
    expect(whatsappAdapter.secretSchema.safeParse({}).success).toBe(true);
    expect(whatsappAdapter.secretSchema.safeParse({ token: "x" }).success).toBe(false);
  });
});

describe("whatsapp chat link", () => {
  it("uses digits only, as wa.me requires", () => {
    expect(whatsappChatLink("+994501234567")).toBe("https://wa.me/994501234567");
    expect(whatsappChatLink("+994 50 123-45-67", "  ")).toBe("https://wa.me/994501234567");
  });

  it("URL-encodes a pre-filled message", () => {
    expect(whatsappChatLink("+994501234567", "Hi! Is the Sheki tour free on 14 March?")).toBe(
      "https://wa.me/994501234567?text=Hi!%20Is%20the%20Sheki%20tour%20free%20on%2014%20March%3F",
    );
  });
});

describe("whatsapp connection test", () => {
  it("returns the link without making any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await whatsappAdapter.test({ config: { phoneNumber: "+994501234567" }, secrets: {} }, never);
      expect(result).toEqual({ ok: true, detail: "Travellers will open https://wa.me/994501234567" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails on a stored number that is no longer valid", async () => {
    const result = await whatsappAdapter.test({ config: { phoneNumber: "050 123 45 67" }, secrets: {} }, never);
    expect(result).toEqual({ ok: false, message: "Enter the full international number, starting with + and the country code." });
  });

  it("honours an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(whatsappAdapter.test({ config: { phoneNumber: "+994501234567" }, secrets: {} }, controller.signal)).rejects.toBeInstanceOf(
      ProviderTimeoutError,
    );
  });
});
