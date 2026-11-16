"use server";

import { after } from "next/server";
import { z } from "zod";
import { assertOwnSession, destinationAfterSignIn } from "@/components/auth/destination";
import { anonymousAction, userAction } from "@/server/actions";
import { setSessionCookie } from "@/server/auth/guards";
import {
  emailSchema,
  login,
  loginSchema,
  normaliseEmail,
  passwordSchema,
  registerSchema,
  registerUser,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "@/server/auth/service";
import { setActiveTenant, validateSessionToken } from "@/server/auth/sessions";
import { withTenant } from "@/server/db/context";
import { ConflictError, UnauthenticatedError } from "@/server/errors";
import { findInvitationByToken } from "@/server/platform/invitations";
import { passwordResetMessage, PLATFORM_LINKS, sendPlatformEmail, verifyEmailMessage } from "@/server/platform/mailer";
import { acceptInvitation } from "@/server/team/invitations";

const tokenSchema = z.string().min(1).max(200);

/**
 * Creates the account when the address is new. The answer is identical either
 * way, and the e-mail goes out after the response, so neither the result nor
 * its timing says whether the address was already registered.
 */
export const registerAction = anonymousAction(
  registerSchema.extend({ terms: z.literal(true, "Accept the terms to create your account.") }),
  async ({ input, ip }) => {
    const { verificationToken } = await registerUser({ name: input.name, email: input.email, password: input.password }, { ip });
    if (verificationToken) {
      after(() =>
        sendPlatformEmail({ to: input.email, ...verifyEmailMessage({ name: input.name, url: PLATFORM_LINKS.verifyEmail(verificationToken) }) }),
      );
    }
    return null;
  },
);

export const loginAction = anonymousAction(
  loginSchema.extend({ next: z.string().max(600).optional() }),
  async ({ input, ip, userAgent }) => {
    const result = await login({ email: input.email, password: input.password }, { ip, userAgent });
    await setSessionCookie(result.token, result.expiresAt);
    const session = await validateSessionToken(result.token);
    if (!session) throw new UnauthenticatedError();
    return { redirectTo: await destinationAfterSignIn(session, input.next) };
  },
);

export const verifyEmailAction = anonymousAction(z.object({ token: tokenSchema }), async ({ input }) => {
  await verifyEmail(input.token);
  return null;
});

/** Sends a fresh confirmation link to the signed-in user, if still unverified. */
export const resendVerificationAction = userAction(z.object({}), async ({ session }) => {
  const token = await resendVerification(session.user.id);
  if (token) {
    after(() =>
      sendPlatformEmail({ to: session.user.email, ...verifyEmailMessage({ name: session.user.name, url: PLATFORM_LINKS.verifyEmail(token) }) }),
    );
  }
  return null;
});

/** Same confirmation whether or not an account exists for the address. */
export const requestPasswordResetAction = anonymousAction(z.object({ email: emailSchema }), async ({ input, ip }) => {
  const reset = await requestPasswordReset(input.email, { ip });
  if (reset) {
    after(() => sendPlatformEmail({ to: input.email, ...passwordResetMessage({ url: PLATFORM_LINKS.resetPassword(reset.token) }) }));
  }
  return null;
});

export const resetPasswordAction = anonymousAction(z.object({ token: tokenSchema, password: passwordSchema }), async ({ input }) => {
  await resetPassword(input.token, input.password);
  return null;
});

/**
 * Accepts a workspace invitation as the signed-in user. The workspace comes
 * from the token itself; `acceptInvitation` then checks, inside that
 * workspace, that this account owns the invited, verified address.
 */
export const acceptInvitationAction = userAction(z.object({ token: tokenSchema }), async ({ session, input }) => {
  assertOwnSession(session);
  const invitation = await findInvitationByToken(input.token);
  if (!invitation) throw new ConflictError("This invitation is no longer valid. Ask for a new one.", "invitation_invalid");

  await withTenant(
    invitation.tenantId,
    (scope) => acceptInvitation(scope, { token: input.token, userId: session.user.id, userEmail: normaliseEmail(session.user.email) }),
    { userId: session.user.id },
  );
  await setActiveTenant(session.id, invitation.tenantId);
  return { redirectTo: "/workspace", workspaceName: invitation.tenantName };
});
