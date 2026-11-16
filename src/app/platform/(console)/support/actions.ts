"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { platformAction } from "@/server/actions";
import { requestMeta, setSessionCookie } from "@/server/auth/guards";
import { deleteSession } from "@/server/auth/sessions";
import { startSupportSession } from "@/server/platform/support";
import { toActor } from "../../_lib/guard";

/**
 * Swaps the admin's platform session for a view-only session inside the
 * workspace that approved the grant, then opens the workspace. The server
 * refuses any grant this admin did not request or that is no longer live.
 */
export const startSupportSessionAction = platformAction("support", z.object({ grantId: z.uuid() }), async ({ admin, input, ip }) => {
  const { userAgent } = await requestMeta();
  const support = await startSupportSession(toActor(admin), input.grantId, { ip, userAgent });
  await setSessionCookie(support.token, support.expiresAt);
  // The cookie that held the platform session has just been replaced, so that
  // session can never be presented again. Remove it rather than leave it valid.
  await deleteSession(admin.session.id);
  redirect("/workspace");
});
