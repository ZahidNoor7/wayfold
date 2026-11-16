import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { clearAdapters, getAdapter, listAdapters, registerAdapter } from "@/server/integrations/registry";
import type { FieldSpec, IntegrationCategory, ProviderAdapter } from "@/server/integrations/types";

function adapter(id: string, category: IntegrationCategory = "email", fields: FieldSpec[] = []): ProviderAdapter {
  return {
    id,
    category,
    name: `Adapter ${id}`,
    description: "Test adapter",
    fields,
    configSchema: z.record(z.string(), z.unknown()),
    secretSchema: z.record(z.string(), z.string()),
    test: async () => ({ ok: true }),
  };
}

beforeEach(() => {
  clearAdapters();
});

describe("adapter registry", () => {
  it("registers and returns an adapter by id", () => {
    const smtp = adapter("smtp");
    registerAdapter(smtp);
    expect(getAdapter("smtp")).toBe(smtp);
    expect(getAdapter("stripe")).toBeUndefined();
  });

  it("lists adapters, optionally by category", () => {
    registerAdapter(adapter("smtp", "email"));
    registerAdapter(adapter("resend", "email"));
    registerAdapter(adapter("cloudinary", "media"));

    expect(listAdapters().map((entry) => entry.id)).toEqual(["smtp", "resend", "cloudinary"]);
    expect(listAdapters("email").map((entry) => entry.id)).toEqual(["smtp", "resend"]);
    expect(listAdapters("media").map((entry) => entry.id)).toEqual(["cloudinary"]);
    expect(listAdapters("payments")).toEqual([]);
  });

  it("refuses to register the same id twice", () => {
    registerAdapter(adapter("smtp"));
    expect(() => registerAdapter(adapter("smtp", "media"))).toThrow("Adapter smtp is already registered");
    expect(getAdapter("smtp")?.category).toBe("email");
  });

  it.each(["", "S", "Smtp", "1smtp", "smtp-relay", "smtp relay", "a", "x".repeat(32), "../etc", "__proto__"])(
    "rejects the invalid id %j",
    (id) => {
      expect(() => registerAdapter(adapter(id))).toThrow(`Invalid adapter id: ${id}`);
      expect(listAdapters()).toEqual([]);
    },
  );

  it.each(["ab", "google_maps", "s3", `a${"b".repeat(30)}`])("accepts the id %j", (id) => {
    registerAdapter(adapter(id));
    expect(getAdapter(id)?.id).toBe(id);
  });

  it("refuses a password field that is not marked secret", () => {
    const fields: FieldSpec[] = [
      { key: "host", label: "Host", type: "text", secret: false, required: true },
      { key: "password", label: "Password", type: "password", secret: false, required: true },
    ];
    expect(() => registerAdapter(adapter("smtp", "email", fields))).toThrow("Adapter smtp: password field password must be marked secret");
    expect(getAdapter("smtp")).toBeUndefined();
  });

  it("accepts secret password fields and secret text fields", () => {
    registerAdapter(
      adapter("smtp", "email", [
        { key: "password", label: "Password", type: "password", secret: true, required: true },
        { key: "signingKey", label: "Signing key", type: "text", secret: true, required: false },
      ]),
    );
    expect(getAdapter("smtp")?.fields).toHaveLength(2);
  });

  it("forgets everything when cleared", () => {
    registerAdapter(adapter("smtp"));
    clearAdapters();
    expect(listAdapters()).toEqual([]);
    expect(getAdapter("smtp")).toBeUndefined();
  });
});
