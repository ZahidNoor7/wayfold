import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/server/auth/sessions";

const mocks = vi.hoisted(() => ({
  setActiveTenant: vi.fn(),
  resolveWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  getPlatformRole: vi.fn(),
}));

vi.mock("@/server/auth/sessions", () => ({ setActiveTenant: mocks.setActiveTenant }));
vi.mock("@/server/auth/workspace", () => ({
  resolveWorkspace: mocks.resolveWorkspace,
  listWorkspaces: mocks.listWorkspaces,
  getPlatformRole: mocks.getPlatformRole,
  can: (workspace: { permissions: readonly string[] }, permission: string) => workspace.permissions.includes(permission),
}));

import { assertOwnSession, destinationAfterSignIn, enterWorkspace } from "./destination";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

function session(overrides: Partial<Session> = {}, verified = true): Session {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    user: { id: "44444444-4444-4444-8444-444444444444", email: "guide@example.com", name: "Guide", emailVerified: verified },
    activeTenantId: null,
    supportGrantId: null,
    expiresAt: new Date("2030-01-01T00:00:00Z"),
    ...overrides,
  };
}

function resolved(onboardingCompleted: boolean, permissions: string[] = ["workspace.manage"]) {
  return { ok: true, workspace: { tenant: { onboardingCompleted }, permissions } };
}

const summary = (tenantId: string) => ({ tenantId, slug: "s", name: "N", roleName: "Owner", status: "active" as const });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPlatformRole.mockResolvedValue(null);
});

describe("assertOwnSession", () => {
  it("allows an ordinary session", () => {
    expect(() => assertOwnSession(session())).not.toThrow();
  });

  it("refuses a support session", () => {
    expect(() => assertOwnSession(session({ supportGrantId: "55555555-5555-4555-8555-555555555555" }))).toThrow(/support session/);
  });
});

describe("enterWorkspace", () => {
  it("activates the workspace and resolves it with the new tenant", async () => {
    mocks.resolveWorkspace.mockResolvedValue(resolved(true));
    const current = session();
    await expect(enterWorkspace(current, TENANT_A)).resolves.toBe("/workspace");
    expect(mocks.setActiveTenant).toHaveBeenCalledWith(current.id, TENANT_A);
    expect(mocks.resolveWorkspace).toHaveBeenCalledWith({ ...current, activeTenantId: TENANT_A });
  });

  it("sends someone who can manage an unfinished workspace to setup", async () => {
    mocks.resolveWorkspace.mockResolvedValue(resolved(false));
    await expect(enterWorkspace(session(), TENANT_A)).resolves.toBe("/onboarding");
  });

  it("sends other members of an unfinished workspace to the dashboard", async () => {
    mocks.resolveWorkspace.mockResolvedValue(resolved(false, ["bookings.view"]));
    await expect(enterWorkspace(session(), TENANT_A)).resolves.toBe("/workspace");
  });

  it("shows the suspended notice for a suspended workspace", async () => {
    mocks.resolveWorkspace.mockResolvedValue({ ok: false, reason: "suspended" });
    await expect(enterWorkspace(session(), TENANT_A)).resolves.toBe("/workspace-suspended");
  });

  it("falls back to the workspace list when membership no longer resolves", async () => {
    mocks.resolveWorkspace.mockResolvedValue({ ok: false, reason: "not_a_member" });
    await expect(enterWorkspace(session(), TENANT_A)).resolves.toBe("/workspaces");
  });

  it("never moves a support session", async () => {
    await expect(enterWorkspace(session({ supportGrantId: "55555555-5555-4555-8555-555555555555" }), TENANT_A)).rejects.toThrow(/support session/);
    expect(mocks.setActiveTenant).not.toHaveBeenCalled();
  });
});

describe("destinationAfterSignIn", () => {
  it("sends an unverified account to e-mail confirmation before anything else", async () => {
    await expect(destinationAfterSignIn(session({}, false), "/workspace/bookings")).resolves.toBe("/verify-email");
    expect(mocks.listWorkspaces).not.toHaveBeenCalled();
  });

  it("opens the only workspace", async () => {
    mocks.listWorkspaces.mockResolvedValue([summary(TENANT_A)]);
    mocks.resolveWorkspace.mockResolvedValue(resolved(true));
    await expect(destinationAfterSignIn(session(), undefined)).resolves.toBe("/workspace");
    expect(mocks.setActiveTenant).toHaveBeenCalledWith(expect.any(String), TENANT_A);
  });

  it("opens setup when the only workspace has not finished it", async () => {
    mocks.listWorkspaces.mockResolvedValue([summary(TENANT_A)]);
    mocks.resolveWorkspace.mockResolvedValue(resolved(false));
    await expect(destinationAfterSignIn(session(), null)).resolves.toBe("/onboarding");
  });

  it("honours a safe next path, still activating the only workspace", async () => {
    mocks.listWorkspaces.mockResolvedValue([summary(TENANT_A)]);
    mocks.resolveWorkspace.mockResolvedValue(resolved(true));
    await expect(destinationAfterSignIn(session(), "/workspace/bookings?status=pending")).resolves.toBe("/workspace/bookings?status=pending");
    expect(mocks.setActiveTenant).toHaveBeenCalledTimes(1);
  });

  it("ignores an unsafe next path", async () => {
    mocks.listWorkspaces.mockResolvedValue([summary(TENANT_A)]);
    mocks.resolveWorkspace.mockResolvedValue(resolved(true));
    await expect(destinationAfterSignIn(session(), "https://evil.example/workspace")).resolves.toBe("/workspace");
    await expect(destinationAfterSignIn(session(), "//evil.example")).resolves.toBe("/workspace");
  });

  it("lists the workspaces when there are several", async () => {
    mocks.listWorkspaces.mockResolvedValue([summary(TENANT_A), summary(TENANT_B)]);
    await expect(destinationAfterSignIn(session(), undefined)).resolves.toBe("/workspaces");
    expect(mocks.setActiveTenant).not.toHaveBeenCalled();
  });

  it("honours a safe next path with several workspaces", async () => {
    mocks.listWorkspaces.mockResolvedValue([summary(TENANT_A), summary(TENANT_B)]);
    await expect(destinationAfterSignIn(session(), "/invitations/accept?token=abc")).resolves.toBe("/invitations/accept?token=abc");
  });

  it("offers workspace creation to someone with none", async () => {
    mocks.listWorkspaces.mockResolvedValue([]);
    await expect(destinationAfterSignIn(session(), undefined)).resolves.toBe("/workspaces");
  });

  it("sends a platform admin with no workspace to the platform area", async () => {
    mocks.listWorkspaces.mockResolvedValue([]);
    mocks.getPlatformRole.mockResolvedValue("owner");
    await expect(destinationAfterSignIn(session(), undefined)).resolves.toBe("/platform");
  });

  it("does not send a platform admin who has workspaces to the platform area", async () => {
    mocks.listWorkspaces.mockResolvedValue([summary(TENANT_A), summary(TENANT_B)]);
    mocks.getPlatformRole.mockResolvedValue("owner");
    await expect(destinationAfterSignIn(session(), undefined)).resolves.toBe("/workspaces");
    expect(mocks.getPlatformRole).not.toHaveBeenCalled();
  });
});
