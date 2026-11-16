import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "../auth/password";
import { emailSchema, nameSchema, passwordSchema } from "../auth/service";
import { platformAdmins, users } from "../db/schema";
import { ConflictError } from "../errors";
import { parse } from "./access";
import { recordPlatformAudit } from "./audit";
import { withPlatform } from "./db";

export const platformOwnerSchema = z.object({
  email: emailSchema,
  /** Needed only when the account does not exist yet. */
  password: passwordSchema.optional(),
  name: nameSchema.default("Platform Owner"),
});
export type PlatformOwnerInput = z.input<typeof platformOwnerSchema>;

export interface EnsuredPlatformOwner {
  userId: string;
  /** A new account was created with the given password. */
  userCreated: boolean;
  /** The account was not a platform owner before this call. */
  promoted: boolean;
}

/**
 * System-only (seed script): makes sure the account with this e-mail exists
 * and is a platform owner. This is how the very first owner comes to be,
 * since granting platform access otherwise needs an owner already. Safe to
 * re-run: an existing account keeps its password and name.
 */
export async function ensurePlatformOwner(input: PlatformOwnerInput): Promise<EnsuredPlatformOwner> {
  const data = parse(platformOwnerSchema, input);
  // Hashing is slow by design; do it before the transaction opens.
  const passwordHash = data.password ? await hashPassword(data.password) : null;

  return withPlatform(async (tx) => {
    const [existing] = await tx.select({ id: users.id, status: users.status }).from(users).where(eq(users.email, data.email)).limit(1);
    if (existing && existing.status !== "active") throw new ConflictError("That account is disabled and cannot be a platform owner.");

    let userId = existing?.id;
    if (!userId) {
      if (!passwordHash) throw new ConflictError("A password is required to create the platform owner account.");
      const [created] = await tx
        .insert(users)
        .values({ email: data.email, name: data.name, passwordHash, emailVerifiedAt: new Date() })
        .returning({ id: users.id });
      userId = created!.id;
    }

    const [current] = await tx.select({ role: platformAdmins.role }).from(platformAdmins).where(eq(platformAdmins.userId, userId)).limit(1);
    const promoted = current?.role !== "owner";
    if (promoted) {
      await tx
        .insert(platformAdmins)
        .values({ userId, role: "owner" })
        .onConflictDoUpdate({ target: platformAdmins.userId, set: { role: "owner" } });
      await recordPlatformAudit(tx, {
        admin: null,
        action: "platform_admin.owner_granted",
        targetType: "user",
        targetId: userId,
        metadata: { userCreated: !existing },
      });
    }
    return { userId, userCreated: !existing, promoted };
  });
}
