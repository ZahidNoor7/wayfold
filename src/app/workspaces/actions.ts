"use server";

import { after } from "next/server";
import { z } from "zod";
import { assertOwnSession, enterWorkspace } from "@/components/auth/destination";
import { userAction } from "@/server/actions";
import { setActiveTenant } from "@/server/auth/sessions";
import { isActiveMember, listWorkspaces } from "@/server/auth/workspace";
import { env } from "@/server/env";
import { NotFoundError, ValidationError } from "@/server/errors";
import { checkSlugAvailability, createWorkspaceForUser, createWorkspaceSchema, suggestSlug } from "@/server/onboarding";
import { appLink, sendPlatformEmail, workspaceCreatedMessage } from "@/server/platform/mailer";
import { SlugUnavailableError } from "@/server/platform/provision-tenant";
import { tenantOrigin } from "@/server/tenancy/hosts";

const SLUG_MESSAGES = {
  invalid: "Use 3 to 40 lowercase letters, numbers and single hyphens, starting and ending with a letter or number.",
  reserved: "That address is reserved. Choose another.",
  taken: "That address has just been taken. Choose another.",
} as const;

/**
 * Switches the session to one of the user's workspaces. The id is a request
 * to switch, not a claim of access: membership is checked here, and again on
 * every request by `resolveWorkspace`.
 */
export const openWorkspaceAction = userAction(z.object({ tenantId: z.uuid() }), async ({ session, input }) => {
  assertOwnSession(session);
  if (!(await isActiveMember(session.user.id, input.tenantId))) throw new NotFoundError("Workspace");
  return { redirectTo: await enterWorkspace(session, input.tenantId) };
});

/** A free, valid address derived from the business name. */
export const suggestSlugAction = userAction(z.object({ name: z.string().trim().min(1).max(80) }), async ({ input }) => {
  return { slug: await suggestSlug(input.name) };
});

export const checkSlugAction = userAction(z.object({ slug: z.string().trim().max(60) }), async ({ input }) => {
  return checkSlugAvailability(input.slug);
});

/** One line, bounded: a business or personal name can never add lines to an e-mail. */
function oneLine(value: string, max = 80): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export const createWorkspaceAction = userAction(createWorkspaceSchema, async ({ session, input }) => {
  assertOwnSession(session);

  let tenantId: string;
  try {
    tenantId = await createWorkspaceForUser({ id: session.user.id, emailVerified: session.user.emailVerified }, input);
  } catch (error) {
    // Not an AppError, so it would otherwise surface as a generic failure.
    if (error instanceof SlugUnavailableError) throw new ValidationError(undefined, { slug: [SLUG_MESSAGES[error.reason]] });
    throw error;
  }
  await setActiveTenant(session.id, tenantId);

  const created = (await listWorkspaces(session.user.id)).find((workspace) => workspace.tenantId === tenantId);
  after(() => {
    const protocol = env().APP_URL.startsWith("https://") ? "https" : "http";
    const workspaceUrl = appLink("/workspace");
    // The shared builder's subject fits; its body is written for workspaces
    // the platform sets up on someone's behalf (it asks them to choose a
    // password), so this account's own, accurate body is used instead.
    const { subject } = workspaceCreatedMessage({ name: session.user.name, tenantName: input.name, url: workspaceUrl });
    const lines = [
      `Hello ${oneLine(session.user.name) || "there"},`,
      "",
      `Your Wayfold workspace ${oneLine(input.name)} is ready, with you as its owner.`,
      "",
      ...(created ? [`Your website address: ${tenantOrigin(created.slug, { rootDomain: env().ROOT_DOMAIN, appHost: env().APP_HOST }, protocol)}`] : []),
      `Open your workspace: ${workspaceUrl}`,
      "",
      "Sign in with the e-mail address and password you registered with.",
      "",
      "Wayfold",
    ];
    return sendPlatformEmail({ to: session.user.email, subject, text: lines.join("\n") });
  });

  return { redirectTo: "/onboarding" };
});
