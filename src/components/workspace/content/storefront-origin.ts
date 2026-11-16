import "server-only";
import type { Workspace } from "@/server/auth/workspace";
import { env } from "@/server/env";
import { tenantOrigin } from "@/server/tenancy/hosts";

/** The workspace's public website, computed the same way as the workspace shell does. */
export function storefrontOrigin(workspace: Pick<Workspace, "tenant">): string {
  const protocol = env().APP_URL.startsWith("https://") ? "https" : "http";
  return tenantOrigin(workspace.tenant.slug, { rootDomain: env().ROOT_DOMAIN, appHost: env().APP_HOST }, protocol);
}
