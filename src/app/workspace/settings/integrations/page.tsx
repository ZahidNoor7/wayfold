import { Lock } from "lucide-react";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import type { AdapterSpec } from "@/components/workspace/settings/integration-form";
import { IntegrationsManager, type CategoryInfo } from "@/components/workspace/settings/integrations-manager";
import { SettingsBreadcrumb } from "@/components/workspace/settings/settings-links";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { getEntitlements } from "@/server/billing/limits";
import { INTEGRATION_CATEGORIES, listAdapters, listIntegrations, type IntegrationCategory } from "@/server/integrations";

export const metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={5} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const workspace = await requireWorkspace("integrations.view");
  const { integrations, entitlements } = await inWorkspace(workspace, async (scope) => {
    const integrations = await listIntegrations(scope);
    const entitlements = await getEntitlements(scope);
    return { integrations, entitlements };
  });

  // Only what the form needs crosses to the browser: no schemas, no test code.
  const adapters: AdapterSpec[] = listAdapters().map((adapter) => ({
    id: adapter.id,
    category: adapter.category,
    name: adapter.name,
    description: adapter.description,
    ...(adapter.docsUrl ? { docsUrl: adapter.docsUrl } : {}),
    fields: adapter.fields.map((field) => ({ ...field, ...(field.options ? { options: field.options.map((option) => ({ ...option })) } : {}) })),
  }));

  const categories: CategoryInfo[] = (Object.keys(INTEGRATION_CATEGORIES) as IntegrationCategory[]).map((id) => ({
    id,
    label: INTEGRATION_CATEGORIES[id],
    allowed: entitlements.features.integrations.includes(id),
  }));

  return (
    <>
      <SettingsBreadcrumb current="Integrations" canOpenSettings={can(workspace, "workspace.manage")} />
      <PageHeader
        title="Integrations"
        description="Connect your own accounts for photos, e-mail, payments, maps and messaging. Wayfold always uses your accounts for these, never another business’s."
      />
      <p className="mb-6 flex max-w-3xl items-start gap-2 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" />
        <span>
          Credentials are encrypted as soon as you save them and take effect immediately. Afterwards only a masked hint is shown, and nobody, including
          your team, can read them back.
        </span>
      </p>
      <IntegrationsManager
        categories={categories}
        integrations={integrations}
        adapters={adapters}
        canManage={can(workspace, "integrations.manage")}
        canSeeBilling={can(workspace, "billing.view")}
        planName={entitlements.plan.name}
        timezone={workspace.tenant.timezone}
        managedStorage={entitlements.features.platformStorage}
      />
    </>
  );
}
