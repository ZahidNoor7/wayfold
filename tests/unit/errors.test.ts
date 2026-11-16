import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  GENERIC_ERROR,
  IntegrationError,
  LimitExceededError,
  NotFoundError,
  toActionError,
  UnauthenticatedError,
  ValidationError,
} from "@/server/errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppError family", () => {
  it.each([
    [new ValidationError(), "ValidationError", "validation", 422, "Please check the highlighted fields."],
    [new UnauthenticatedError(), "UnauthenticatedError", "unauthenticated", 401, "Please sign in to continue."],
    [new ForbiddenError(), "ForbiddenError", "forbidden", 403, "You do not have permission to do that."],
    [new NotFoundError(), "NotFoundError", "not_found", 404, "Record not found."],
    [new NotFoundError("Tour"), "NotFoundError", "not_found", 404, "Tour not found."],
    [new ConflictError("Already taken."), "ConflictError", "conflict", 409, "Already taken."],
    [new ConflictError("Slug taken.", "slug_taken"), "ConflictError", "slug_taken", 409, "Slug taken."],
    [new LimitExceededError("maxPublishedTours", "Upgrade to add more."), "LimitExceededError", "plan_limit", 402, "Upgrade to add more."],
    [new IntegrationError("Provider refused."), "IntegrationError", "integration_failed", 502, "Provider refused."],
    [new IntegrationError("Bad key.", "integration_auth"), "IntegrationError", "integration_auth", 502, "Bad key."],
    [new AppError("custom", "Custom message."), "AppError", "custom", 400, "Custom message."],
  ])("%s carries name, code, status and message", (error, name, code, status, message) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.message).toBe(message);
  });

  it("keeps field errors and the exceeded limit", () => {
    expect(new ValidationError("Fix it.", { email: ["Required"] }).fieldErrors).toEqual({ email: ["Required"] });
    expect(new LimitExceededError("maxTeamMembers", "Too many.").limit).toBe("maxTeamMembers");
  });
});

describe("toActionError", () => {
  it("passes an AppError's code and message through without logging", () => {
    const log = vi.fn();
    expect(toActionError(new NotFoundError("Booking"), log)).toEqual({ ok: false, code: "not_found", error: "Booking not found." });
    expect(log).not.toHaveBeenCalled();
  });

  it("includes field errors only when there are some", () => {
    const log = vi.fn();
    expect(toActionError(new ValidationError(undefined, { name: ["Too short"] }), log)).toEqual({
      ok: false,
      code: "validation",
      error: "Please check the highlighted fields.",
      fieldErrors: { name: ["Too short"] },
    });
    expect(toActionError(new ValidationError(), log)).not.toHaveProperty("fieldErrors");
  });

  it.each([
    ["an Error", new Error('duplicate key value violates unique constraint "users_email_key" (email)=(ada@example.test)')],
    ["a TypeError", new TypeError("Cannot read properties of undefined (reading 'passwordHash')")],
    ["a driver-like object", { code: "23505", message: "password=hunter2 host=db.internal", detail: "Key (email)=(ada@example.test)" }],
    ["a string", "connection string postgres://app:hunter2@db.internal/wayfold"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
  ])("replaces %s with the generic message", (_name, thrown) => {
    const log = vi.fn();
    const result = toActionError(thrown, log);

    expect(result).toEqual({ ok: false, code: "internal", error: GENERIC_ERROR });
    const rendered = JSON.stringify(result);
    for (const leak of ["hunter2", "ada@example.test", "users_email_key", "passwordHash", "db.internal", "23505"]) {
      expect(rendered).not.toContain(leak);
    }
    expect(log).toHaveBeenCalledExactlyOnceWith(thrown);
  });

  it("does not trust a look-alike object that merely has a code and message", () => {
    const fake = { name: "NotFoundError", code: "not_found", message: "internal detail", status: 404 };
    expect(toActionError(fake, vi.fn())).toEqual({ ok: false, code: "internal", error: GENERIC_ERROR });
  });

  it("logs name, code and a capped message by default, never the raw object", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const thrown = Object.assign(new Error("x".repeat(1000)), { code: "23505", parameters: ["ada@example.test", "hunter2"] });

    expect(toActionError(thrown)).toEqual({ ok: false, code: "internal", error: GENERIC_ERROR });

    expect(spy).toHaveBeenCalledOnce();
    const [label, payload] = spy.mock.calls[0]!;
    expect(label).toBe("[wayfold] unhandled error");
    expect(payload).toEqual({ name: "Error", code: "23505", message: "x".repeat(300) });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("hunter2");
  });

  it("logs non-error values without throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    toActionError(null);
    toActionError("plain failure");
    expect(spy.mock.calls[0]![1]).toEqual({ name: undefined, code: undefined, message: "null" });
    expect(spy.mock.calls[1]![1]).toEqual({ name: undefined, code: undefined, message: "plain failure" });
  });
});
