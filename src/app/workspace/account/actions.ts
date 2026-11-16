"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { userAction } from "@/server/actions";
import { changePassword, nameSchema, passwordSchema } from "@/server/auth/service";
import { deleteUserSessions } from "@/server/auth/sessions";
import { withUser } from "@/server/db/context";
import { users } from "@/server/db/schema";
import { AppError, ForbiddenError, ValidationError } from "@/server/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";

/** Account settings belong to the person, not to a support visit. */
function assertOwnAccount(session: { supportGrantId: string | null }): void {
  if (session.supportGrantId) throw new ForbiddenError("Account settings are not available during a support session.");
}

/**
 * Changes the display name. There is no service for this yet, so the update
 * runs here in the user's own scope: row-level security limits it to their
 * own row, and the runtime role may only write `name` among profile columns.
 */
export const updateNameAction = userAction(z.object({ name: nameSchema }), async ({ session, input }) => {
  assertOwnAccount(session);
  await withUser(session.user.id, ({ tx }) => tx.update(users).set({ name: input.name }).where(eq(users.id, session.user.id)));
  revalidatePath("/workspace", "layout");
  return { name: input.name };
});

export const changePasswordAction = userAction(
  // `next` is checked here so its message lands beside the field.
  z.object({ current: z.string().min(1, "Enter your current password.").max(200), next: passwordSchema }),
  async ({ session, input }) => {
    assertOwnAccount(session);
    if (input.current === input.next) throw new ValidationError(undefined, { next: ["Choose a password you are not already using."] });
    // The current password is being guessed here just as it is at sign-in.
    await enforceRateLimit(RATE_LIMITS.login, `password-change:${session.user.id}`);
    try {
      await changePassword(session.user.id, session.id, input.current, input.next);
    } catch (error) {
      // The service's wording is written for the sign-in form.
      if (error instanceof AppError && error.code === "invalid_credentials") {
        throw new ValidationError(undefined, { current: ["That is not your current password."] });
      }
      throw error;
    }
    return null;
  },
);

/** Ends every other session of this account. The one making the request stays. */
export const signOutOthersAction = userAction(z.object({}), async ({ session }) => {
  assertOwnAccount(session);
  await deleteUserSessions(session.user.id, session.id);
  return null;
});
