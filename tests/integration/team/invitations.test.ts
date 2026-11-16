import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { hashToken } from "@/server/auth/tokens";
import { withTenant } from "@/server/db/context";
import { invitations, memberships, tenants, users } from "@/server/db/schema";
import { ConflictError, ForbiddenError, LimitExceededError, NotFoundError, ValidationError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import {
  acceptInvitation,
  INVITATION_TTL_MS,
  inviteMember,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from "@/server/team/invitations";
import { listMembers } from "@/server/team/members";
import { createTenant, createUser, randomId, unique, type TenantFixture } from "../../helpers/fixtures";
import { addMember, auditTrail, customRole, inTenant, ownerActor, systemRole } from "./helpers";

const address = () => `${unique("invitee")}@example.test`;

function invitationRow(tenant: TenantFixture, invitationId: string) {
  return inTenant(tenant, async ({ tx }) => {
    const [row] = await tx.select().from(invitations).where(eq(invitations.id, invitationId));
    return row!;
  });
}

/** Moves an invitation's expiry into the past, as time would. */
function expire(tenant: TenantFixture, invitationId: string) {
  return inTenant(tenant, ({ tx }) =>
    tx
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(invitations.id, invitationId)),
  );
}

/** Accepts as the invited user would: in the invitation's tenant, as themselves. */
function accept(tenant: TenantFixture, token: string, user: { id: string; email: string }) {
  return withTenant(tenant.tenantId, (scope) => acceptInvitation(scope, { token, userId: user.id, userEmail: user.email }), { userId: user.id });
}

describe("inviting a member", () => {
  it("stores only a hash of the token, expires in seven days, and records the invitation", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const email = address();
    const before = Date.now();

    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: `  ${email.toUpperCase()} `, roleId: staff.id }));

    const row = await invitationRow(tenant, issued.invitationId);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row.tokenHash).toBe(hashToken(issued.token));
    expect(row.tokenHash).not.toContain(issued.token);
    expect(row).toMatchObject({ email, roleId: staff.id, invitedBy: tenant.ownerId, acceptedAt: null, revokedAt: null });
    expect(row.expiresAt.getTime()).toBe(issued.expiresAt.getTime());
    expect(row.expiresAt.getTime() - before).toBeGreaterThanOrEqual(INVITATION_TTL_MS);
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(INVITATION_TTL_MS);

    const audit = (await auditTrail(tenant)).find((entry) => entry.action === "invitation.created");
    expect(audit).toMatchObject({ targetId: issued.invitationId, actorUserId: tenant.ownerId, metadata: { email, roleId: staff.id, role: "Staff" } });
    // The token must never reach the audit log.
    expect(JSON.stringify(await auditTrail(tenant))).not.toContain(issued.token);
  });

  it("lists invitations with role, inviter and status, and never the token hash", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const actor = ownerActor(tenant);
    const pending = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id }));
    const lapsed = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id }));
    const withdrawn = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id }));
    const taken = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id }));
    await expire(tenant, lapsed.invitationId);
    await inTenant(tenant, (scope) => revokeInvitation(scope, withdrawn.invitationId));
    const takenRow = await invitationRow(tenant, taken.invitationId);
    await accept(tenant, taken.token, await createUser({ email: takenRow.email }));

    const list = await inTenant(tenant, (scope) => listInvitations(scope));

    const status = (id: string) => list.find((entry) => entry.id === id)?.status;
    expect(list).toHaveLength(4);
    expect(status(pending.invitationId)).toBe("pending");
    expect(status(lapsed.invitationId)).toBe("expired");
    expect(status(withdrawn.invitationId)).toBe("revoked");
    expect(status(taken.invitationId)).toBe("accepted");
    expect(list[0]).toMatchObject({ roleId: staff.id, roleName: "Staff", invitedByName: "Test User" });
    expect(JSON.stringify(list)).not.toContain(takenRow.tokenHash);
    expect(Object.keys(list[0]!)).not.toContain("tokenHash");
  });

  it("rejects a malformed e-mail address or role id", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const actor = ownerActor(tenant);

    const badEmail = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: "not-an-email", roleId: staff.id })).catch(
      (error: unknown) => error,
    );
    expect(badEmail).toBeInstanceOf(ValidationError);
    expect((badEmail as ValidationError).fieldErrors).toHaveProperty("email");

    const badRole = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: "nope" })).catch(
      (error: unknown) => error,
    );
    expect((badRole as ValidationError).fieldErrors).toHaveProperty("roleId");

    await expect(inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: randomId() }))).rejects.toThrow("Role not found.");
    expect(await inTenant(tenant, (scope) => listInvitations(scope))).toEqual([]);
  });

  it("refuses a second pending invitation for the same address", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const admin = await systemRole(tenant, "admin");
    const email = address();
    await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email, roleId: staff.id }));

    const duplicate = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: email.toUpperCase(), roleId: admin.id })).catch(
      (error: unknown) => error,
    );

    expect(duplicate).toBeInstanceOf(ConflictError);
    expect(duplicate).toMatchObject({ code: "invitation_pending" });
    expect(await inTenant(tenant, (scope) => listInvitations(scope))).toHaveLength(1);
  });

  it("refuses to invite someone who is already an active member", async () => {
    const tenant = await createTenant();
    const member = await addMember(tenant, "staff");

    await expect(
      inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: member.email.toUpperCase(), roleId: member.roleId })),
    ).rejects.toMatchObject({ code: "already_member" });
    await expect(
      inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: tenant.ownerEmail, roleId: member.roleId })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("replaces a lapsed invitation for the same address instead of keeping two alive", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const email = address();
    const old = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email, roleId: staff.id }));
    await expire(tenant, old.invitationId);

    const fresh = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email, roleId: staff.id }));

    expect(fresh.invitationId).not.toBe(old.invitationId);
    expect((await invitationRow(tenant, old.invitationId)).revokedAt).toBeInstanceOf(Date);
    await expect(inTenant(tenant, (scope) => resendInvitation(scope, ownerActor(tenant), old.invitationId))).rejects.toMatchObject({
      code: "invitation_revoked",
    });
  });

  it("refuses to invite into a role beyond the actor's own permissions", async () => {
    const tenant = await createTenant();
    const teamLead = await addMember(tenant, await customRole(tenant, "Team lead", ["team.view", "team.manage", "tours.view"]));
    const admin = await systemRole(tenant, "admin");
    const reader = await customRole(tenant, "Reader", ["tours.view"]);

    await expect(
      inTenant(tenant, (scope) => inviteMember(scope, teamLead.actor, { email: address(), roleId: admin.id }), teamLead.userId),
    ).rejects.toThrow("You cannot give someone a role with permissions you do not hold yourself.");
    await expect(
      inTenant(tenant, (scope) => inviteMember(scope, teamLead.actor, { email: address(), roleId: tenant.ownerRoleId }), teamLead.userId),
    ).rejects.toThrow("Only an owner can assign or remove the Owner role.");
    expect(await inTenant(tenant, (scope) => listInvitations(scope))).toEqual([]);

    const allowed = await inTenant(tenant, (scope) => inviteMember(scope, teamLead.actor, { email: address(), roleId: reader.id }), teamLead.userId);
    expect((await invitationRow(tenant, allowed.invitationId)).invitedBy).toBe(teamLead.userId);
  });
});

describe("the seat limit", () => {
  it("counts active members plus pending invitations", async () => {
    const tenant = await createTenant({ plan: { maxTeamMembers: 3 } });
    const staff = await systemRole(tenant, "staff");
    const actor = ownerActor(tenant);
    await addMember(tenant, "staff");
    await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id }));

    const over = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id })).catch(
      (error: unknown) => error,
    );

    expect(over).toBeInstanceOf(LimitExceededError);
    expect(over).toMatchObject({ limit: "maxTeamMembers", status: 402 });
    expect(await inTenant(tenant, (scope) => listInvitations(scope))).toHaveLength(1);
  });

  it("frees the seat of a revoked or expired invitation, and ignores deactivated members", async () => {
    const tenant = await createTenant({ plan: { maxTeamMembers: 2 } });
    const staff = await systemRole(tenant, "staff");
    const actor = ownerActor(tenant);
    await addMember(tenant, "staff", { status: "deactivated" });

    const first = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id }));
    await inTenant(tenant, (scope) => revokeInvitation(scope, first.invitationId));
    const second = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id }));
    await expire(tenant, second.invitationId);
    const third = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id }));

    expect(third.invitationId).toBeTruthy();
    await expect(inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id }))).rejects.toBeInstanceOf(
      LimitExceededError,
    );
  });

  it("allows any number of seats on an unlimited plan", async () => {
    const tenant = await createTenant({ plan: { maxTeamMembers: null } });
    const staff = await systemRole(tenant, "staff");
    for (let index = 0; index < 4; index += 1) {
      await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: address(), roleId: staff.id }));
    }
    expect(await inTenant(tenant, (scope) => listInvitations(scope))).toHaveLength(4);
  });

  it("lets exactly one of two concurrent invitations take the last seat", async () => {
    const tenant = await createTenant({ plan: { maxTeamMembers: 3 } });
    const staff = await systemRole(tenant, "staff");
    const actor = ownerActor(tenant);
    await addMember(tenant, "staff");
    // Two of three seats are taken: one is left, and two requests race for it.

    for (let round = 0; round < 3; round += 1) {
      const results = await Promise.allSettled([
        inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id })),
        inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id })),
      ]);

      const won = results.filter((result) => result.status === "fulfilled");
      const lost = results.filter((result) => result.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(LimitExceededError);

      const pending = (await inTenant(tenant, (scope) => listInvitations(scope))).filter((entry) => entry.status === "pending");
      expect(pending).toHaveLength(1);
      // Free the seat again for the next round.
      await inTenant(tenant, (scope) => revokeInvitation(scope, pending[0]!.id));
    }
  });

  it("lets exactly one of two concurrent invitations to the same address through", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const email = address();

    const results = await Promise.allSettled([
      inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email, roleId: staff.id })),
      inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email, roleId: staff.id })),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "invitation_pending" });
  });
});

describe("revoking and resending", () => {
  it("revokes a pending invitation, records it, and is harmless to repeat", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const user = await createUser();
    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: user.email, roleId: staff.id }));

    await inTenant(tenant, (scope) => revokeInvitation(scope, issued.invitationId));
    await inTenant(tenant, (scope) => revokeInvitation(scope, issued.invitationId));

    expect((await auditTrail(tenant)).filter((entry) => entry.action === "invitation.revoked")).toHaveLength(1);
    await expect(accept(tenant, issued.token, user)).rejects.toMatchObject({ code: "invitation_revoked" });
    expect(await inTenant(tenant, (scope) => listMembers(scope))).toHaveLength(1);
    await expect(inTenant(tenant, (scope) => revokeInvitation(scope, randomId()))).rejects.toBeInstanceOf(NotFoundError);
    await expect(inTenant(tenant, (scope) => revokeInvitation(scope, "x"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("issues a new token on resend and kills the old one", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const user = await createUser();
    const first = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: user.email, roleId: staff.id }));

    const second = await inTenant(tenant, (scope) => resendInvitation(scope, ownerActor(tenant), first.invitationId));

    expect(second.invitationId).toBe(first.invitationId);
    expect(second.token).not.toBe(first.token);
    expect((await invitationRow(tenant, first.invitationId)).tokenHash).toBe(hashToken(second.token));
    expect((await auditTrail(tenant)).map((entry) => entry.action)).toContain("invitation.resent");
    await expect(accept(tenant, first.token, user)).rejects.toBeInstanceOf(NotFoundError);
    expect((await accept(tenant, second.token, user)).roleId).toBe(staff.id);
  });

  it("revives an expired invitation on resend, subject to the seat limit", async () => {
    const tenant = await createTenant({ plan: { maxTeamMembers: 2 } });
    const staff = await systemRole(tenant, "staff");
    const actor = ownerActor(tenant);
    const user = await createUser();
    const lapsed = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: user.email, roleId: staff.id }));
    await expire(tenant, lapsed.invitationId);
    await expect(accept(tenant, lapsed.token, user)).rejects.toMatchObject({ code: "invitation_expired" });

    // Its seat went to someone else in the meantime.
    const other = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id }));
    await expect(inTenant(tenant, (scope) => resendInvitation(scope, actor, lapsed.invitationId))).rejects.toBeInstanceOf(LimitExceededError);

    await inTenant(tenant, (scope) => revokeInvitation(scope, other.invitationId));
    const revived = await inTenant(tenant, (scope) => resendInvitation(scope, actor, lapsed.invitationId));
    expect(revived.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect((await accept(tenant, revived.token, user)).membershipId).toBeTruthy();
  });

  it("refuses to resend or revoke a finished invitation", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const actor = ownerActor(tenant);
    const user = await createUser();
    const used = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: user.email, roleId: staff.id }));
    await accept(tenant, used.token, user);
    const withdrawn = await inTenant(tenant, (scope) => inviteMember(scope, actor, { email: address(), roleId: staff.id }));
    await inTenant(tenant, (scope) => revokeInvitation(scope, withdrawn.invitationId));

    await expect(inTenant(tenant, (scope) => resendInvitation(scope, actor, used.invitationId))).rejects.toMatchObject({ code: "invitation_used" });
    await expect(inTenant(tenant, (scope) => revokeInvitation(scope, used.invitationId))).rejects.toMatchObject({ code: "invitation_used" });
    await expect(inTenant(tenant, (scope) => resendInvitation(scope, actor, withdrawn.invitationId))).rejects.toMatchObject({
      code: "invitation_revoked",
    });
    await expect(inTenant(tenant, (scope) => resendInvitation(scope, actor, randomId()))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("re-checks the actor's permissions on resend", async () => {
    const tenant = await createTenant();
    const teamLead = await addMember(tenant, await customRole(tenant, "Team lead", ["team.view", "team.manage"]));
    const admin = await systemRole(tenant, "admin");
    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: address(), roleId: admin.id }));

    await expect(
      inTenant(tenant, (scope) => resendInvitation(scope, teamLead.actor, issued.invitationId), teamLead.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await invitationRow(tenant, issued.invitationId)).tokenHash).toBe(hashToken(issued.token));
  });
});

describe("accepting an invitation", () => {
  it("creates the membership with the invited role and marks the invitation accepted", async () => {
    const tenant = await createTenant();
    const tourManager = await systemRole(tenant, "tour_manager");
    const user = await createUser({ name: "Nigar Hasanova" });
    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: user.email, roleId: tourManager.id }));

    // The address check ignores case, as mail does.
    const accepted = await accept(tenant, issued.token, { id: user.id, email: user.email.toUpperCase() });

    expect(accepted).toMatchObject({ roleId: tourManager.id, roleName: "Tour Manager" });
    const members = await inTenant(tenant, (scope) => listMembers(scope));
    expect(members.find((member) => member.id === accepted.membershipId)).toMatchObject({
      userId: user.id,
      name: "Nigar Hasanova",
      roleId: tourManager.id,
      status: "active",
    });
    expect((await invitationRow(tenant, issued.invitationId)).acceptedAt).toBeInstanceOf(Date);
    expect((await auditTrail(tenant)).find((entry) => entry.action === "invitation.accepted")).toMatchObject({
      targetId: issued.invitationId,
      actorUserId: user.id,
      metadata: { membershipId: accepted.membershipId, userId: user.id, reactivated: false },
    });
  });

  it("refuses a token that has already been used", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const user = await createUser();
    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: user.email, roleId: staff.id }));
    await accept(tenant, issued.token, user);

    const reused = await accept(tenant, issued.token, user).catch((error: unknown) => error);

    expect(reused).toBeInstanceOf(ConflictError);
    expect(reused).toMatchObject({ code: "invitation_used" });
    expect(await inTenant(tenant, (scope) => listMembers(scope))).toHaveLength(2);
  });

  it("lets only one of two simultaneous acceptances of the same token succeed", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const user = await createUser();
    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: user.email, roleId: staff.id }));

    const results = await Promise.allSettled([accept(tenant, issued.token, user), accept(tenant, issued.token, user)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "invitation_used" });
    expect(await inTenant(tenant, (scope) => listMembers(scope))).toHaveLength(2);
  });

  it("refuses an account whose e-mail is not the invited one", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const invited = await createUser();
    const intruder = await createUser();
    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: invited.email, roleId: staff.id }));

    // Honest about who they are.
    await expect(accept(tenant, issued.token, intruder)).rejects.toThrow("This invitation was sent to a different e-mail address.");
    // Claiming the invited address does not help: the stored account decides.
    await expect(accept(tenant, issued.token, { id: intruder.id, email: invited.email })).rejects.toBeInstanceOf(ForbiddenError);
    // Nor does the right account with the wrong claim.
    await expect(accept(tenant, issued.token, { id: invited.id, email: intruder.email })).rejects.toBeInstanceOf(ForbiddenError);

    expect(await inTenant(tenant, (scope) => listMembers(scope))).toHaveLength(1);
    expect((await invitationRow(tenant, issued.invitationId)).acceptedAt).toBeNull();
    // The invitation is still good for its real recipient.
    expect((await accept(tenant, issued.token, invited)).roleId).toBe(staff.id);
  });

  it("refuses an expired invitation", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const user = await createUser();
    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: user.email, roleId: staff.id }));
    await expire(tenant, issued.invitationId);

    const expired = await accept(tenant, issued.token, user).catch((error: unknown) => error);

    expect(expired).toBeInstanceOf(ConflictError);
    expect(expired).toMatchObject({ code: "invitation_expired" });
    expect(await inTenant(tenant, (scope) => listMembers(scope))).toHaveLength(1);
  });

  it("treats an unknown or malformed token as not found or invalid", async () => {
    const tenant = await createTenant();
    const user = await createUser();

    await expect(accept(tenant, "no-such-token", user)).rejects.toBeInstanceOf(NotFoundError);
    await expect(accept(tenant, "", user)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      withTenant(tenant.tenantId, (scope) => acceptInvitation(scope, { token: "t", userId: "not-a-uuid", userEmail: user.email })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires a verified, active account that the transaction can actually see", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const user = await createUser();
    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: user.email, roleId: staff.id }));

    await withPlatform((tx) => tx.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, user.id)));
    await expect(accept(tenant, issued.token, user)).rejects.toThrow("Verify your e-mail address before accepting this invitation.");

    await withPlatform((tx) => tx.update(users).set({ emailVerifiedAt: new Date(), status: "disabled" }).where(eq(users.id, user.id)));
    await expect(accept(tenant, issued.token, user)).rejects.toThrow("Sign in to accept this invitation.");

    await withPlatform((tx) => tx.update(users).set({ status: "active" }).where(eq(users.id, user.id)));
    // Acting as somebody else: the invited account is not visible, so it cannot be vouched for.
    await expect(
      inTenant(tenant, (scope) => acceptInvitation(scope, { token: issued.token, userId: user.id, userEmail: user.email })),
    ).rejects.toThrow("Sign in to accept this invitation.");
    await expect(accept(tenant, issued.token, { id: randomId(), email: user.email })).rejects.toBeInstanceOf(ForbiddenError);

    expect((await accept(tenant, issued.token, user)).membershipId).toBeTruthy();
  });

  it("reactivates a deactivated membership with the invited role", async () => {
    const tenant = await createTenant();
    const former = await addMember(tenant, "staff", { status: "deactivated" });
    const admin = await systemRole(tenant, "admin");
    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: former.email, roleId: admin.id }));

    const accepted = await accept(tenant, issued.token, { id: former.userId, email: former.email });

    expect(accepted.membershipId).toBe(former.membershipId);
    const members = await inTenant(tenant, (scope) => listMembers(scope));
    expect(members).toHaveLength(2);
    expect(members.find((member) => member.id === former.membershipId)).toMatchObject({ status: "active", roleId: admin.id });
    expect((await auditTrail(tenant)).find((entry) => entry.action === "invitation.accepted")?.metadata).toMatchObject({ reactivated: true });
  });

  it("refuses when the invited user became an active member some other way", async () => {
    const tenant = await createTenant();
    const staff = await systemRole(tenant, "staff");
    const user = await createUser();
    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: user.email, roleId: staff.id }));
    await inTenant(tenant, ({ tx }) => tx.insert(memberships).values({ userId: user.id, roleId: staff.id }));

    await expect(accept(tenant, issued.token, user)).rejects.toMatchObject({ code: "already_member" });
    await expect(inTenant(tenant, (scope) => resendInvitation(scope, ownerActor(tenant), issued.invitationId))).rejects.toMatchObject({
      code: "already_member",
    });
  });

  it("holds the invitation's seat, but not if the plan shrank in the meantime", async () => {
    const tenant = await createTenant({ plan: { maxTeamMembers: 2 } });
    const staff = await systemRole(tenant, "staff");
    const user = await createUser();
    // The workspace is full: the owner plus this invitation.
    const issued = await inTenant(tenant, (scope) => inviteMember(scope, ownerActor(tenant), { email: user.email, roleId: staff.id }));

    await withPlatform((tx) => tx.update(tenants).set({ limitOverrides: { maxTeamMembers: 1 } }).where(eq(tenants.id, tenant.tenantId)));
    await expect(accept(tenant, issued.token, user)).rejects.toBeInstanceOf(LimitExceededError);

    await withPlatform((tx) => tx.update(tenants).set({ limitOverrides: {} }).where(eq(tenants.id, tenant.tenantId)));
    expect((await accept(tenant, issued.token, user)).roleId).toBe(staff.id);
    const active = await inTenant(tenant, ({ tx }) =>
      tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenant.tenantId), eq(memberships.status, "active"))),
    );
    expect(active).toHaveLength(2);
  });
});
