import "server-only";
import { redirect } from "next/navigation";
import { getSession, requirePlatformAdmin, type PlatformAdmin } from "@/server/auth/guards";
import type { PlatformActor } from "@/server/platform/access";

export interface PlatformContext {
  admin: PlatformAdmin;
  /** What the platform services take as their first argument. */
  actor: PlatformActor;
  /** Only owners may change anything; support may read. */
  isOwner: boolean;
}

/**
 * The gate for every page and layout in the platform back office.
 *
 * A support session carries no platform powers, and `requirePlatformAdmin`
 * would send it to /workspace. When the grant behind it has ended, the
 * workspace sends it straight back here, so that case is caught first and
 * shown a page that can end the session instead of bouncing forever.
 */
export async function platformGuard(minimum: "support" | "owner" = "support"): Promise<PlatformContext> {
  const session = await getSession();
  if (session?.supportGrantId) redirect("/platform/support/session");
  const admin = await requirePlatformAdmin(minimum);
  return { admin, actor: toActor(admin), isOwner: admin.role === "owner" };
}

export function toActor(admin: PlatformAdmin): PlatformActor {
  return { userId: admin.session.user.id, role: admin.role };
}
