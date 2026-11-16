import { describe, expect, it } from "vitest";
import { errorFor, hasFieldError } from "./errors";

describe("errorFor", () => {
  it("returns the first message for a field", () => {
    expect(errorFor({ email: ["Enter a valid email address.", "Second"] }, "email")).toBe("Enter a valid email address.");
  });

  it("picks up nested messages for list and object fields", () => {
    expect(errorFor({ "languages.1": ["Use language codes such as en or pt-BR."] }, "languages")).toBe("Use language codes such as en or pt-BR.");
    expect(errorFor({ "social.instagram": ["Use a profile name or a web address."] }, "social.instagram")).toBe(
      "Use a profile name or a web address.",
    );
  });

  it("returns null when there is nothing for the field", () => {
    expect(errorFor(undefined, "email")).toBeNull();
    expect(errorFor({ name: ["x"] }, "email")).toBeNull();
    expect(errorFor({ email: [] }, "email")).toBeNull();
    expect(errorFor({ "emailx.1": ["x"], "email.2": [] }, "email")).toBeNull();
  });
});

describe("hasFieldError", () => {
  it("is true when any listed field has a message", () => {
    expect(hasFieldError({ phone: ["Enter a phone number."] }, ["email", "phone"])).toBe(true);
    expect(hasFieldError({ form: ["x"] }, ["email", "phone"])).toBe(false);
    expect(hasFieldError(undefined, ["email"])).toBe(false);
  });
});
