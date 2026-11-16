import { describe, expect, it } from "vitest";
import { invitationTokenFrom, safeNextPath, withNext } from "./safe-next";

describe("safeNextPath", () => {
  it("accepts plain same-origin paths and keeps query and hash", () => {
    expect(safeNextPath("/workspace")).toBe("/workspace");
    expect(safeNextPath("/workspace/bookings?status=pending#top")).toBe("/workspace/bookings?status=pending#top");
    expect(safeNextPath("/invitations/accept?token=abc")).toBe("/invitations/accept?token=abc");
  });

  it("takes the first value when the parameter is repeated", () => {
    expect(safeNextPath(["/workspace/team", "https://evil.example"])).toBe("/workspace/team");
    expect(safeNextPath(["https://evil.example", "/workspace"])).toBeNull();
  });

  it("rejects anything that is not a string", () => {
    for (const value of [undefined, null, 42, {}, [], [undefined]]) expect(safeNextPath(value)).toBeNull();
  });

  it("rejects empty and over-long values", () => {
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath(`/${"a".repeat(512)}`)).toBeNull();
    expect(safeNextPath(`/${"a".repeat(511)}`)).toBe(`/${"a".repeat(511)}`);
  });

  it("rejects absolute and scheme URLs", () => {
    for (const value of ["https://evil.example", "http://evil.example/workspace", "javascript:alert(1)", "mailto:a@b.c", "workspace", "evil.example/x"]) {
      expect(safeNextPath(value)).toBeNull();
    }
  });

  it("rejects protocol-relative and backslash tricks", () => {
    for (const value of ["//evil.example", "///evil.example", "/\\evil.example", "/\\/evil.example", "/ok\\path"]) {
      expect(safeNextPath(value)).toBeNull();
    }
  });

  it("rejects control characters that URL parsers strip", () => {
    for (const value of ["/\t/evil.example", "/\n/evil.example", "/work\rspace", "/a\u0000b", "/a\u007fb"]) {
      expect(safeNextPath(value)).toBeNull();
    }
  });

  it("rejects paths that normalise to a protocol-relative URL", () => {
    expect(safeNextPath("/.//evil.example")).toBeNull();
    expect(safeNextPath("/x/..//evil.example")).toBeNull();
  });

  it("normalises dot segments on allowed paths", () => {
    expect(safeNextPath("/workspace/../workspaces")).toBe("/workspaces");
  });

  it("keeps a stray percent sign and encodes spaces", () => {
    expect(safeNextPath("/%")).toBe("/%");
    expect(safeNextPath("/a b")).toBe("/a%20b");
  });

  it("never returns to sign-in, sign-out or registration", () => {
    for (const value of ["/login", "/login?next=/workspace", "/logout", "/register", "/register/", "/login#x", "/workspace/../login"]) {
      expect(safeNextPath(value)).toBeNull();
    }
    expect(safeNextPath("/login-history")).toBe("/login-history");
  });
});

describe("withNext", () => {
  it("appends an encoded next when it is safe", () => {
    expect(withNext("/login", "/invitations/accept?token=a b")).toBe("/login?next=%2Finvitations%2Faccept%3Ftoken%3Da%2520b");
    expect(withNext("/login?reset=1", "/workspace")).toBe("/login?reset=1&next=%2Fworkspace");
  });

  it("leaves the path alone when next is missing or unsafe", () => {
    expect(withNext("/login", null)).toBe("/login");
    expect(withNext("/login", undefined)).toBe("/login");
    expect(withNext("/register", "https://evil.example")).toBe("/register");
  });
});

describe("invitationTokenFrom", () => {
  it("returns the token of an invitation link", () => {
    expect(invitationTokenFrom("/invitations/accept?token=abc123")).toBe("abc123");
  });

  it("returns null for other paths, missing tokens and unsafe values", () => {
    expect(invitationTokenFrom("/workspace?token=abc")).toBeNull();
    expect(invitationTokenFrom("/invitations/accept")).toBeNull();
    expect(invitationTokenFrom("/invitations/accept?token=")).toBeNull();
    expect(invitationTokenFrom("//evil.example/invitations/accept?token=abc")).toBeNull();
    expect(invitationTokenFrom(null)).toBeNull();
    expect(invitationTokenFrom(`/invitations/accept?token=${"a".repeat(201)}`)).toBeNull();
  });
});
