import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { hashToken } from "../auth/tokens";
import { invitations, roles, tenants } from "../db/schema";
import { withPlatform } from "./db";

export interface InvitationLookup {
  invitationId: string;
  tenantId: string;
  tenantName: string;
  /** The address the invitation was sent to. Only that account may accept it. */
  email: string;
  roleName: string;
  expiresAt: Date;
}

/**
 * System-only: finds the invitation an e-mailed link points at, before the
 * visitor has any workspace. This has to cross tenants, because the token is
 * the only thing known at that point; it is also the whole credential, so the
 * lookup is by its keyed hash and returns only what the acceptance screen
 * shows. Accepted, revoked and expired invitations do not resolve.
 */
export async function findInvitationByToken(token: string): Promise<InvitationLookup | null> {
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return null;
  const tokenHash = hashToken(token);

  const [row] = await withPlatform((tx) =>
    tx
      .select({
        invitationId: invitations.id,
        tenantId: invitations.tenantId,
        tenantName: tenants.name,
        email: invitations.email,
        roleName: roles.name,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
      .innerJoin(roles, and(eq(roles.tenantId, invitations.tenantId), eq(roles.id, invitations.roleId)))
      .where(
        and(
          eq(invitations.tokenHash, tokenHash),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .limit(1),
  );
  return row ?? null;
}
