import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { defaultAddress } from "@/components/workspace/settings/domains";
import { DomainsManager } from "@/components/workspace/settings/domains-manager";
import { SettingsBreadcrumb } from "@/components/workspace/settings/settings-links";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { getEntitlements } from "@/server/billing/limits";
import { env } from "@/server/env";
import { listDomains } from "@/server/settings/domains";
import { tenantOrigin } from "@/server/tenancy/hosts";

export const metadata = { title: "Domains" };

export default function DomainsPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const workspace = await requireWorkspace("domains.manage");
  const { domains, entitlements } = await inWorkspace(workspace, async (scope) => {
    const domains = await listDomains(scope);
    const entitlements = await getEntitlements(scope);
    return { domains, entitlements };
  });

  const { ROOT_DOMAIN, APP_HOST, APP_URL } = env();
  const protocol = APP_URL.startsWith("https://") ? "https" : "http";

  return (
    <>
      <SettingsBreadcrumb current="Domains" canOpenSettings={can(workspace, "workspace.manage")} />
      <PageHeader title="Website domains" description="Where people find your public website. Your Wayfold address always works; you can add your own domain as well." />
      <DomainsManager
        domains={domains}
        defaultAddress={defaultAddress(workspace.tenant.slug, ROOT_DOMAIN)}
        defaultUrl={tenantOrigin(workspace.tenant.slug, { rootDomain: ROOT_DOMAIN, appHost: APP_HOST }, protocol)}
        allowed={entitlements.features.customDomain}
        planName={entitlements.plan.name}
        canSeeBilling={can(workspace, "billing.view")}
      />
    </>
  );
}
