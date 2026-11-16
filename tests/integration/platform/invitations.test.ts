import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { invitations, roles } from "@/server/db/schema";
import { withPlatform } from "@/server/platform/db";
import { findInvitationByToken } from "@/server/platform/invitations";
import { createTenant, unique, type TenantFixture } from "../../helpers/fixtures";

const HOUR = 3_600_000;

async function invite(tenant: TenantFixture, overrides: Partial<typeof invitations.$inferInsert> = {}) {
  const token = generateToken();
  const email = `${unique("invitee")}@example.test`;
  const [row] = await withPlatform(async (tx) => {
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenant.tenantId), eq(roles.systemKey, "tour_manager")));
    return tx
      .insert(invitations)
      .values({
        tenantId: tenant.tenantId,
        email,
        roleId: role!.id,
        tokenHash: hashToken(token),
        invitedBy: tenant.ownerId,
        expiresAt: new Date(Date.now() + 48 * HOUR),
        ...overrides,
      })
      .returning();
  });
  return { token, email, row: row! };
}

describe("findInvitationByToken", () => {
  it("resolves a pending invitation to its workspace, address and role", async () => {
    const tenant = await createTenant({ name: "Caspian Trails" });
    const other = await createTenant();
    const { token, email, row } = await invite(tenant);
    await invite(other);

    expect(await findInvitationByToken(token)).toEqual({
      invitationId: row.id,
      tenantId: tenant.tenantId,
      tenantName: "Caspian Trails",
      email,
      roleName: "Tour Manager",
      expiresAt: row.expiresAt,
    });
  });

  it("does not resolve accepted, revoked or expired invitations", async () => {
    const tenant = await createTenant();
    const accepted = await invite(tenant, { acceptedAt: new Date() });
    const revoked = await invite(tenant, { revokedAt: new Date() });
    const expired = await invite(tenant, { expiresAt: new Date(Date.now() - 1_000) });

    expect(await findInvitationByToken(accepted.token)).toBeNull();
    expect(await findInvitationByToken(revoked.token)).toBeNull();
    expect(await findInvitationByToken(expired.token)).toBeNull();
  });

  it("does not resolve unknown, malformed or look-alike tokens", async () => {
    const tenant = await createTenant();
    const { token, row } = await invite(tenant);

    expect(await findInvitationByToken(generateToken())).toBeNull();
    expect(await findInvitationByToken("")).toBeNull();
    expect(await findInvitationByToken("x".repeat(201))).toBeNull();
    expect(await findInvitationByToken(undefined as never)).toBeNull();
    // Neither the stored hash nor the row id works as a token.
    expect(await findInvitationByToken(row.tokenHash)).toBeNull();
    expect(await findInvitationByToken(row.id)).toBeNull();
    expect(await findInvitationByToken(`${token} `)).toBeNull();
    expect((await findInvitationByToken(token))?.invitationId).toBe(row.id);
  });
});
