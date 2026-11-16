import { describe, expect, it } from "vitest";
import { loginNotice, loginPathWithNotice } from "./login-notices";

describe("loginNotice", () => {
  it("returns the fixed sentence for each known value", () => {
    expect(loginNotice("password-reset")).toEqual({ tone: "success", message: "Password changed. Sign in with your new password." });
    expect(loginNotice("email-verified")).toEqual({ tone: "success", message: "E-mail confirmed. Sign in to continue." });
    expect(loginNotice("support-ended")).toEqual({
      tone: "info",
      message: "Your support session has ended. Sign in again to return to the back office.",
    });
  });

  it("uses the first value when the parameter is repeated", () => {
    expect(loginNotice(["support-ended", "password-reset"])?.tone).toBe("info");
    expect(loginNotice(["nope", "support-ended"])).toBeNull();
  });

  it("shows nothing for unknown, crafted or non-string values", () => {
    for (const value of [undefined, null, "", "1", "Support-Ended", "support-ended ", "<b>Your account is locked</b>", "Call 555 to unlock", 7, {}, []]) {
      expect(loginNotice(value)).toBeNull();
    }
  });

  it("does not treat inherited object keys as notices", () => {
    for (const value of ["constructor", "toString", "__proto__", "hasOwnProperty"]) expect(loginNotice(value)).toBeNull();
  });
});

describe("loginPathWithNotice", () => {
  it("builds a sign-in path the page recognises", () => {
    expect(loginPathWithNotice("password-reset")).toBe("/login?notice=password-reset");
    expect(loginNotice(new URLSearchParams(loginPathWithNotice("email-verified").split("?")[1]).get("notice"))).not.toBeNull();
  });
});
