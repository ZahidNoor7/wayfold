import { Suspense, type ReactNode } from "react";
import { ThemedRoot } from "@/components/theme/themed-root";
import { WorkspaceChrome } from "@/components/workspace/chrome";
import { visibleNav } from "@/components/workspace/nav-config";
import { PageSkeleton } from "@/components/workspace/page-header";
import { SupportBanner } from "@/components/workspace/support-banner";
import { requireWorkspace } from "@/server/auth/guards";
import { inWorkspace } from "@/server/auth/workspace";
import { env } from "@/server/env";
import { tenantOrigin } from "@/server/tenancy/hosts";
import { getNavCounts } from "@/server/workspace-nav";

export const metadata = { title: { default: "Workspace", template: "%s · Workspace" }, robots: { index: false, follow: false } };

async function Shell({ children }: { children: ReactNode }) {
  const workspace = await requireWorkspace();
  const counts = await inWorkspace(workspace, getNavCounts);
  const protocol = env().APP_URL.startsWith("https://") ? "https" : "http";

  return (
    <ThemedRoot appearance={workspace.tenant.branding}>
      <div data-workspace-root className="contents">
        <WorkspaceChrome
          workspaceName={workspace.tenant.name}
          storefrontUrl={tenantOrigin(workspace.tenant.slug, { rootDomain: env().ROOT_DOMAIN, appHost: env().APP_HOST }, protocol)}
          user={{ name: workspace.user.name, email: workspace.user.email }}
          roleName={workspace.roleName}
          groups={visibleNav(workspace.permissions)}
          counts={counts}
          banner={workspace.support ? <SupportBanner workspaceName={workspace.tenant.name} expiresAt={workspace.support.expiresAt} /> : null}
        >
          {children}
        </WorkspaceChrome>
      </div>
    </ThemedRoot>
  );
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-muted/40 p-5 sm:p-8">
          <PageSkeleton />
        </div>
      }
    >
      <Shell>{children}</Shell>
    </Suspense>
  );
}
