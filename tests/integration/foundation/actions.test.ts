import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { z } from "zod";
import {
  anonymousAction,
  currentSiteTenant,
  parseInput,
  platformAction,
  siteAction,
  userAction,
  workspaceAction,
} from "@/server/actions";
import { sessionCookieName } from "@/server/auth/guards";
import { createSession } from "@/server/auth/sessions";
import { withTenant } from "@/server/db/context";
import { notificationOutbox, roles, tenantDomains, tenants } from "@/server/db/schema";
import { GENERIC_ERROR, NotFoundError, ValidationError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import type { RateLimitRule } from "@/server/rate-limit";
import { createTenant, createUser, unique, type TenantFixture } from "../../helpers/fixtures";
import { fakeRequest, redirectOf } from "./fake-request";
import { addMember, auditFor, createGrant, createPlatformAdmin, rejection } from "./support";

// next/headers needs a live Next.js request; next/navigation is the real one.
vi.mock("next/headers", () => import("./fake-request"));
// `after` needs a live request too; record what is scheduled instead.
const scheduled = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => void scheduled.push(task),
}));

const noteSchema = z.object({ name: z.string().trim().min(2, "Enter a name.") });

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  scheduled.length = 0;
  fakeRequest.reset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function signIn(userId: string, options: { activeTenantId?: string | null; supportGrantId?: string | null } = {}): Promise<void> {
  const { token } = await createSession(userId, {}, options);
  fakeRequest.setCookie(sessionCookieName(), token);
}

const customRoles = (tenantId: string) =>
  withTenant(tenantId, ({ tx }) => tx.select({ name: roles.name, tenantId: roles.tenantId }).from(roles).where(eq(roles.description, "made by a test action")));

/** A dashboard action that leaves a visible mark in the tenant it ran in. */
function roleAction(handler = vi.fn()) {
  const action = workspaceAction("roles.manage", noteSchema.extend({ tenantId: z.string().optional() }), async (context) => {
    handler(context);
    const [row] = await context.scope.tx
      .insert(roles)
      .values({ name: context.input.name, description: "made by a test action", permissions: [] })
      .returning({ id: roles.id, tenantId: roles.tenantId });
    return row!;
  });
  return { action, handler };
}

describe("parseInput", () => {
  it("returns the parsed, transformed value", () => {
    expect(parseInput(noteSchema, { name: "  Guides  ", extra: "dropped" })).toEqual({ name: "Guides" });
  });

  it("throws a ValidationError carrying per-field messages", () => {
    try {
      parseInput(noteSchema, { name: "x" });
      throw new Error("expected a ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors).toEqual({ name: ["Enter a name."] });
    }
  });
});

describe("workspaceAction", () => {
  it("runs after-commit work only once the transaction has committed", async () => {
    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    const sent: string[] = [];
    const action = workspaceAction("roles.manage", noteSchema, async ({ scope, input, afterCommit }) => {
      await scope.tx.insert(roles).values({ name: input.name, description: "made by a test action", permissions: [] });
      afterCommit(() => sent.push(input.name));
      return null;
    });

    expect(await action({ name: "Committed" })).toEqual({ ok: true, data: null });
    expect(sent).toEqual([]);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(sent).toEqual(["Committed"]);
  });

  it("drops after-commit work when the handler fails", async () => {
    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    const action = workspaceAction("roles.manage", noteSchema, async ({ afterCommit }) => {
      afterCommit(() => {
        throw new Error("must never run");
      });
      throw new NotFoundError("Thing");
    });

    expect(await action({ name: "Rolled back" })).toMatchObject({ ok: false, code: "not_found" });
    expect(scheduled).toEqual([]);
  });

  it("refuses an unauthenticated caller before running anything", async () => {
    const { action, handler } = roleAction();
    expect(await action({ name: "Guides" })).toEqual({ ok: false, code: "unauthenticated", error: "Please sign in to continue." });
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a session with no workspace", async () => {
    const a = await createTenant();
    await signIn(a.ownerId);
    const { action, handler } = roleAction();
    expect(await action({ name: "Guides" })).toEqual({ ok: false, code: "forbidden", error: "This workspace is not available." });
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a session that points at a workspace the user does not belong to", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await signIn(b.ownerId, { activeTenantId: a.tenantId });
    const { action, handler } = roleAction();

    expect(await action({ name: "Planted" })).toEqual({ ok: false, code: "forbidden", error: "This workspace is not available." });
    expect(handler).not.toHaveBeenCalled();
    expect(await customRoles(a.tenantId)).toEqual([]);
  });

  it("refuses a member without the permission", async () => {
    const a = await createTenant();
    const staff = await createUser();
    await addMember(a.tenantId, staff.id, "staff");
    await signIn(staff.id, { activeTenantId: a.tenantId });
    const { action, handler } = roleAction();

    expect(await action({ name: "Guides" })).toEqual({ ok: false, code: "forbidden", error: "You do not have permission to do that." });
    expect(handler).not.toHaveBeenCalled();
    expect(await customRoles(a.tenantId)).toEqual([]);
  });

  it("checks the permission before looking at the input", async () => {
    const a = await createTenant();
    const staff = await createUser();
    await addMember(a.tenantId, staff.id, "staff");
    await signIn(staff.id, { activeTenantId: a.tenantId });
    const { action } = roleAction();
    expect(await action({ name: "" })).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("returns field errors for invalid input", async () => {
    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    const { action, handler } = roleAction();

    expect(await action({ name: " x " })).toEqual({
      ok: false,
      code: "validation",
      error: "Please check the highlighted fields.",
      fieldErrors: { name: ["Enter a name."] },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler in the session's tenant and returns its result", async () => {
    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    fakeRequest.setHeaders({ "x-real-ip": "203.0.113.50" });
    const { action, handler } = roleAction();

    const result = await action({ name: "  Guides  " });

    expect(result).toEqual({ ok: true, data: { id: expect.any(String), tenantId: a.tenantId } });
    const context = handler.mock.calls[0]![0];
    expect(context.input).toEqual({ name: "Guides" });
    expect(context.ip).toBe("203.0.113.50");
    expect(context.scope).toMatchObject({ tenantId: a.tenantId, userId: a.ownerId });
    expect(context.workspace).toMatchObject({ tenantId: a.tenantId, isOwner: true });
    expect(await customRoles(a.tenantId)).toEqual([{ name: "Guides", tenantId: a.tenantId }]);
  });

  it("ignores a tenant id in the payload", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    const { action, handler } = roleAction();

    const result = await action({ name: "Guides", tenantId: b.tenantId });

    expect(result).toMatchObject({ ok: true, data: { tenantId: a.tenantId } });
    expect(handler.mock.calls[0]![0].scope.tenantId).toBe(a.tenantId);
    expect(await customRoles(a.tenantId)).toHaveLength(1);
    expect(await customRoles(b.tenantId)).toEqual([]);
  });

  it("stamps audit entries with the actor and the request address", async () => {
    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    fakeRequest.setHeaders({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" });
    const action = workspaceAction("tours.manage", noteSchema, async ({ audit, input }) => {
      await audit({ action: "tour.created", targetType: "tour", targetId: "tour-1", metadata: { name: input.name, password: "never-stored" } });
      return "done";
    });

    expect(await action({ name: "Sheki" })).toEqual({ ok: true, data: "done" });
    const [row] = await auditFor(a.tenantId);
    expect(row).toMatchObject({
      action: "tour.created",
      actorType: "user",
      actorUserId: a.ownerId,
      ip: "198.51.100.9",
      targetType: "tour",
      targetId: "tour-1",
      metadata: { name: "Sheki", password: "[redacted]" },
    });
  });

  it("marks audit entries written during a support session, and keeps that session read-only", async () => {
    const a = await createTenant();
    const admin = await createPlatformAdmin();
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: admin.id });
    await signIn(admin.id, { activeTenantId: a.tenantId, supportGrantId: grantId });

    const view = workspaceAction("bookings.view", noteSchema, async ({ audit }) => {
      await audit({ action: "booking.viewed" });
      return "seen";
    });
    expect(await view({ name: "lookup" })).toEqual({ ok: true, data: "seen" });
    expect(await auditFor(a.tenantId)).toEqual([expect.objectContaining({ action: "booking.viewed", actorType: "support_session", actorUserId: admin.id })]);

    const { action, handler } = roleAction();
    expect(await action({ name: "Planted" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("replaces an internal failure with the generic message and rolls the transaction back", async () => {
    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    const action = workspaceAction("roles.manage", noteSchema, async ({ scope, input }) => {
      await scope.tx.insert(roles).values({ name: input.name, description: "made by a test action", permissions: [] });
      throw new Error('relation "secret_table" does not exist; password=hunter2');
    });

    const result = await action({ name: "Half written" });

    expect(result).toEqual({ ok: false, code: "internal", error: GENERIC_ERROR });
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("secret_table");
    expect(await customRoles(a.tenantId)).toEqual([]);
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("does not leak a database error raised by the handler", async () => {
    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    const action = workspaceAction("roles.manage", noteSchema, async ({ scope }) => {
      // Violates the unique (tenant, name) key: a real driver error.
      await scope.tx.insert(roles).values({ name: "Owner", permissions: [] });
    });

    const result = await action({ name: "anything" });
    expect(result).toEqual({ ok: false, code: "internal", error: GENERIC_ERROR });
    expect(JSON.stringify(result)).not.toMatch(/roles_tenant_name_key|duplicate|insert into/i);
  });

  it("passes a handler's AppError through unchanged", async () => {
    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    const action = workspaceAction("tours.view", noteSchema, async () => {
      throw new NotFoundError("Tour");
    });
    expect(await action({ name: "lookup" })).toEqual({ ok: false, code: "not_found", error: "Tour not found." });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("lets a redirect thrown by the handler through to the framework", async () => {
    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    const action = workspaceAction("tours.view", noteSchema, async () => {
      redirect("/workspace/tours");
    });
    expect(await redirectOf(action({ name: "go" }))).toBe("/workspace/tours");
  });
});

describe("siteAction", () => {
  const rule = (limit = 100): RateLimitRule => ({ name: unique("site-rule"), limit, windowSeconds: 600 });

  /** A storefront action that records which tenant it ran for. */
  function enquiryAction(limit?: number) {
    const handler = vi.fn();
    const action = siteAction(rule(limit), noteSchema.extend({ tenantId: z.string().optional(), slug: z.string().optional() }), async (context) => {
      handler(context);
      const visible = await context.scope.tx.selectDistinct({ tenantId: roles.tenantId }).from(roles);
      return { tenantId: context.tenant.id, scopeTenantId: context.scope.tenantId, visible: visible.map((row) => row.tenantId) };
    });
    return { action, handler };
  }

  const visit = (t: TenantFixture, ip = "203.0.113.77") => fakeRequest.setHeaders({ host: `${t.slug}.wayfold.test`, "x-real-ip": ip });
  const SITE_NOT_FOUND = { ok: false, code: "not_found", error: "Site not found." };

  it("takes the tenant from the Host header", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const { action, handler } = enquiryAction();

    visit(a);
    expect(await action({ name: "Ada" })).toEqual({ ok: true, data: { tenantId: a.tenantId, scopeTenantId: a.tenantId, visible: [a.tenantId] } });

    visit(b);
    expect(await action({ name: "Ada" })).toEqual({ ok: true, data: { tenantId: b.tenantId, scopeTenantId: b.tenantId, visible: [b.tenantId] } });

    const context = handler.mock.calls[0]![0];
    expect(context.tenant).toMatchObject({ id: a.tenantId, slug: a.slug, status: "active" });
    expect(context.scope.userId).toBeNull();
    expect(context.ip).toBe("203.0.113.77");
    expect(context.input).toEqual({ name: "Ada" });
  });

  it("sends the tenant's queued e-mails after a successful submission, and only then", async () => {
    const a = await createTenant();
    const { action } = enquiryAction();
    await withTenant(a.tenantId, ({ tx }) =>
      tx.insert(notificationOutbox).values({ kind: "inquiry.staff_alert", toEmail: "owner@example.test", subject: "New enquiry", bodyText: "Hello" }),
    );

    visit(a);
    expect(await action({ name: "x" })).toMatchObject({ ok: false, code: "validation" });
    expect(scheduled).toEqual([]);

    expect(await action({ name: "Ada" })).toMatchObject({ ok: true });
    expect(scheduled).toHaveLength(1);
    // No e-mail connection: delivery runs and marks the message skipped,
    // without ever borrowing another account.
    await scheduled[0]!();
    const [row] = await withTenant(a.tenantId, ({ tx }) => tx.select({ status: notificationOutbox.status }).from(notificationOutbox));
    expect(row).toEqual({ status: "skipped" });
  });

  it("never lets a delivery failure reach the visitor", async () => {
    const { deliverNotificationsNow } = await import("@/server/actions");
    await expect(deliverNotificationsNow("not-a-uuid")).resolves.toBeUndefined();
  });

  it("ignores a tenant id or slug in the payload", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const { action } = enquiryAction();
    visit(a);

    const result = await action({ name: "Ada", tenantId: b.tenantId, slug: b.slug });
    expect(result).toEqual({ ok: true, data: { tenantId: a.tenantId, scopeTenantId: a.tenantId, visible: [a.tenantId] } });
  });

  it("ignores tenant hints in other headers", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const { action } = enquiryAction();
    fakeRequest.setHeaders({
      host: `${a.slug}.wayfold.test`,
      "x-forwarded-host": `${b.slug}.wayfold.test`,
      "x-tenant-id": b.tenantId,
      origin: `https://${b.slug}.wayfold.test`,
      referer: `https://${b.slug}.wayfold.test/tours`,
    });
    expect(await action({ name: "Ada" })).toMatchObject({ ok: true, data: { tenantId: a.tenantId, scopeTenantId: a.tenantId } });
  });

  it("works with no session at all, and is not swayed by one", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const { action } = enquiryAction();
    visit(a);
    // A dashboard session for B must not redirect a storefront call on A.
    await signIn(b.ownerId, { activeTenantId: b.tenantId });
    expect(await action({ name: "Ada" })).toMatchObject({ ok: true, data: { tenantId: a.tenantId } });
  });

  it.each([
    ["no Host header", {}],
    ["the app host", { host: "app.wayfold.test" }],
    ["the marketing host", { host: "wayfold.test" }],
    ["www on the root domain", { host: "www.wayfold.test" }],
    ["a slug nobody owns", { host: "nobody-here-0000.wayfold.test" }],
    ["a nested sub-domain", { host: "a.b.wayfold.test" }],
    ["a malformed host", { host: "acme.wayfold.test/evil" }],
    ["an unverified custom domain", { host: "unclaimed.example.test" }],
  ])("answers site not found for %s", async (_name, headers) => {
    await createTenant();
    const { action, handler } = enquiryAction();
    fakeRequest.setHeaders(headers as Record<string, string>);
    expect(await action({ name: "Ada" })).toEqual(SITE_NOT_FOUND);
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers site not found for a suspended tenant", async () => {
    const a = await createTenant();
    await withPlatform((tx) => tx.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, a.tenantId)));
    const { action, handler } = enquiryAction();
    visit(a);
    expect(await action({ name: "Ada" })).toEqual(SITE_NOT_FOUND);
    expect(handler).not.toHaveBeenCalled();
  });

  it("serves a verified custom domain and refuses a pending one", async () => {
    const a = await createTenant();
    const verified = `${unique("tours")}.example.test`;
    const pending = `${unique("pending")}.example.test`;
    await withTenant(a.tenantId, ({ tx }) =>
      tx.insert(tenantDomains).values([
        { domain: verified, status: "verified", verificationToken: "tok-v", verifiedAt: new Date() },
        { domain: pending, verificationToken: "tok-p" },
      ]),
    );
    const { action } = enquiryAction();

    fakeRequest.setHeaders({ host: verified.toUpperCase() });
    expect(await action({ name: "Ada" })).toMatchObject({ ok: true, data: { tenantId: a.tenantId } });

    fakeRequest.setHeaders({ host: pending });
    expect(await action({ name: "Ada" })).toEqual(SITE_NOT_FOUND);
  });

  it("returns field errors for invalid input", async () => {
    const a = await createTenant();
    const { action, handler } = enquiryAction();
    visit(a);
    expect(await action({ name: "" })).toEqual({
      ok: false,
      code: "validation",
      error: "Please check the highlighted fields.",
      fieldErrors: { name: ["Enter a name."] },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rate limits per visitor and per site, with a message the visitor can read", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const { action, handler } = enquiryAction(2);

    visit(a, "203.0.113.1");
    expect((await action({ name: "Ada" })).ok).toBe(true);
    expect((await action({ name: "Ada" })).ok).toBe(true);
    expect(await action({ name: "Ada" })).toEqual({ ok: false, code: "rate_limited", error: "Too many attempts. Please wait and try again." });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(consoleError).not.toHaveBeenCalled();

    // Another visitor to the same site, and the same visitor on another site, are unaffected.
    visit(a, "203.0.113.2");
    expect((await action({ name: "Ada" })).ok).toBe(true);
    visit(b, "203.0.113.1");
    expect((await action({ name: "Ada" })).ok).toBe(true);
  });

  it("counts invalid submissions against the limit too", async () => {
    const a = await createTenant();
    const { action } = enquiryAction(1);
    visit(a, "203.0.113.3");
    expect(await action({ name: "" })).toMatchObject({ code: "validation" });
    expect(await action({ name: "Ada" })).toMatchObject({ code: "rate_limited" });
  });

  it("replaces an internal failure with the generic message", async () => {
    const a = await createTenant();
    visit(a);
    const action = siteAction(rule(), noteSchema, async () => {
      throw new Error("SMTP password hunter2 rejected");
    });
    const result = await action({ name: "Ada" });
    expect(result).toEqual({ ok: false, code: "internal", error: GENERIC_ERROR });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });
});

describe("currentSiteTenant", () => {
  it("returns the public profile of the tenant behind the request host", async () => {
    const a = await createTenant({ name: "Caspian Trails" });
    fakeRequest.setHeaders({ host: `${a.slug.toUpperCase()}.WAYFOLD.TEST` });
    expect(await currentSiteTenant()).toMatchObject({ id: a.tenantId, slug: a.slug, name: "Caspian Trails" });
  });

  it("throws not found for the app host and for unknown sites", async () => {
    fakeRequest.setHeaders({ host: "app.wayfold.test" });
    expect(await rejection(currentSiteTenant())).toBeInstanceOf(NotFoundError);
    fakeRequest.setHeaders({ host: "nobody-here-0000.wayfold.test" });
    expect((await rejection(currentSiteTenant())).message).toBe("Site not found.");
  });
});

describe("userAction", () => {
  const action = userAction(noteSchema, async ({ session, input, ip, userAgent }) => ({ userId: session.user.id, name: input.name, ip, userAgent }));

  it("refuses an unauthenticated caller", async () => {
    expect(await action({ name: "Ada" })).toEqual({ ok: false, code: "unauthenticated", error: "Please sign in to continue." });
  });

  it("runs for a signed-in user without needing a workspace", async () => {
    const user = await createUser();
    await signIn(user.id);
    fakeRequest.setHeaders({ "x-real-ip": "203.0.113.60", "user-agent": "Vitest/5" });
    expect(await action({ name: " Ada " })).toEqual({ ok: true, data: { userId: user.id, name: "Ada", ip: "203.0.113.60", userAgent: "Vitest/5" } });
  });

  it("returns field errors for invalid input", async () => {
    const user = await createUser();
    await signIn(user.id);
    expect(await action({ name: "" })).toMatchObject({ ok: false, code: "validation", fieldErrors: { name: ["Enter a name."] } });
  });
});

describe("anonymousAction", () => {
  it("validates input and passes request details to the handler", async () => {
    const action = anonymousAction(noteSchema, async ({ input, ip, userAgent }) => ({ name: input.name, ip, userAgent }));
    fakeRequest.setHeaders({ "x-forwarded-for": "198.51.100.3" });

    expect(await action({ name: "Ada" })).toEqual({ ok: true, data: { name: "Ada", ip: "198.51.100.3", userAgent: null } });
    expect(await action({ name: "" })).toMatchObject({ ok: false, code: "validation" });
  });

  it("replaces an internal failure with the generic message", async () => {
    const action = anonymousAction(noteSchema, async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'passwordHash')");
    });
    expect(await action({ name: "Ada" })).toEqual({ ok: false, code: "internal", error: GENERIC_ERROR });
  });
});

describe("platformAction", () => {
  const supportLevel = platformAction("support", noteSchema, async ({ admin, input, ip }) => ({ role: admin.role, name: input.name, ip }));
  const ownerLevel = platformAction("owner", noteSchema, async ({ admin }) => ({ role: admin.role }));

  it("answers page not found to anyone who is not platform staff", async () => {
    const PAGE_NOT_FOUND = { ok: false, code: "not_found", error: "Page not found." };
    expect(await supportLevel({ name: "Ada" })).toEqual(PAGE_NOT_FOUND);

    const a = await createTenant();
    await signIn(a.ownerId, { activeTenantId: a.tenantId });
    expect(await supportLevel({ name: "Ada" })).toEqual(PAGE_NOT_FOUND);
    expect(await ownerLevel({ name: "Ada" })).toEqual(PAGE_NOT_FOUND);
  });

  it("lets support staff run support-level actions only", async () => {
    const support = await createPlatformAdmin("support");
    await signIn(support.id);
    fakeRequest.setHeaders({ "x-real-ip": "203.0.113.70" });

    expect(await supportLevel({ name: "Ada" })).toEqual({ ok: true, data: { role: "support", name: "Ada", ip: "203.0.113.70" } });
    expect(await ownerLevel({ name: "Ada" })).toEqual({ ok: false, code: "forbidden", error: "You do not have permission to do that." });
  });

  it("lets a platform owner run both levels", async () => {
    const owner = await createPlatformAdmin("owner");
    await signIn(owner.id);
    expect(await ownerLevel({ name: "Ada" })).toEqual({ ok: true, data: { role: "owner" } });
    expect(await supportLevel({ name: "Ada" })).toMatchObject({ ok: true, data: { role: "owner" } });
    expect(await ownerLevel({ name: "" })).toMatchObject({ ok: false, code: "validation" });
  });

  it("refuses a platform owner who is inside a support session", async () => {
    const a = await createTenant();
    const owner = await createPlatformAdmin("owner");
    const grantId = await createGrant({ tenantId: a.tenantId, requestedBy: owner.id });
    await signIn(owner.id, { activeTenantId: a.tenantId, supportGrantId: grantId });
    expect(await ownerLevel({ name: "Ada" })).toMatchObject({ ok: false, code: "not_found" });
  });
});
