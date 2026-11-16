import type { Metadata } from "next";
import { Suspense } from "react";
import { PlatformIntegrations, type CategoryInfo } from "@/components/platform/platform-integrations";
import { PlatformHeader } from "@/components/platform/ui";
import { PageSkeleton } from "@/components/workspace/page-header";
import { listAdapters } from "@/server/integrations";
import { listPlatformIntegrations, PLATFORM_INTEGRATION_CATEGORIES, type PlatformIntegrationCategory } from "@/server/platform/integrations";
import { platformGuard } from "../../_lib/guard";

export const metadata: Metadata = { title: "Integrations" };

const COPY: Record<PlatformIntegrationCategory, { title: string; purpose: string; withoutIt: string }> = {
  media: {
    title: "Managed media storage",
    purpose: "Where uploads go for workspaces whose plan includes platform storage and that have not connected their own.",
    withoutIt: "Without it, those workspaces cannot upload photos until they connect storage of their own.",
  },
  email: {
    title: "Platform e-mail",
    purpose: "Sends Wayfold's own messages: address verification, password resets, invitations and support access requests.",
    withoutIt: "Without it, those messages are not delivered, so new accounts cannot verify their address or reset a password by e-mail.",
  },
};

export default function PlatformIntegrationsPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <Integrations />
    </Suspense>
  );
}

async function Integrations() {
  // Owner-only: the support role is sent back to the overview.
  const { actor } = await platformGuard("owner");
  const connections = await listPlatformIntegrations(actor);

  const categories: CategoryInfo[] = PLATFORM_INTEGRATION_CATEGORIES.map((category) => {
    const connection = connections.find((entry) => entry.category === category) ?? null;
    return {
      category,
      ...COPY[category],
      // Plain data only: an adapter's schemas and test function stay on the server.
      adapters: listAdapters(category).map((adapter) => ({
        id: adapter.id,
        name: adapter.name,
        description: adapter.description,
        docsUrl: adapter.docsUrl,
        fields: adapter.fields.map((field) => ({ ...field })),
      })),
      connection: connection
        ? {
            provider: connection.provider,
            providerName: connection.providerName,
            status: connection.status,
            config: connection.config,
            secretHints: connection.secretHints,
            lastTestedAt: connection.lastTestedAt,
            lastError: connection.lastError,
            updatedAt: connection.updatedAt,
          }
        : null,
    };
  });

  return (
    <>
      <PlatformHeader
        kicker="Connections Wayfold itself depends on. Each workspace manages its own providers separately."
        title="Platform integrations"
      />
      <PlatformIntegrations categories={categories} />
    </>
  );
}
