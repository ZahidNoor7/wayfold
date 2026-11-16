import Link from "next/link";
import { Suspense } from "react";
import { MediaLibrary } from "@/components/workspace/media/media-library";
import { toMediaItem } from "@/components/workspace/media/types";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { IntegrationError } from "@/server/errors";
import { IntegrationNotConfiguredError } from "@/server/integrations";
import { getStorageUsage, listFolders, listMedia, selectStorage } from "@/server/media";

export const metadata = { title: "Media library" };

export default function MediaPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const workspace = await requireWorkspace("media.view");

  const data = await inWorkspace(workspace, async (scope) => {
    // Only whether storage is usable leaves this function: the credentials stay on the server.
    let storage: "ready" | "missing" | "error" = "ready";
    let storageMessage: string | null = null;
    try {
      await selectStorage(scope);
    } catch (error) {
      if (error instanceof IntegrationNotConfiguredError) storage = "missing";
      else if (error instanceof IntegrationError) {
        storage = "error";
        storageMessage = error.message;
      } else throw error;
    }
    const folders = await listFolders(scope);
    const usage = await getStorageUsage(scope);
    const page = await listMedia(scope, { limit: 40 });
    return { storage, storageMessage, folders, usage, page };
  });

  const canConnect = can(workspace, "integrations.view");

  // Nothing stored and nowhere to store it: the library cannot be used yet.
  if (data.storage === "missing" && data.usage.assetCount === 0) {
    return (
      <>
        <PageHeader title="Media library" description="Photos and videos for your tours, destinations and journal." />
        <EmptyState
          title="Connect storage to add media"
          description={
            canConnect
              ? "Photos and videos are kept in a storage account that you connect. Add your Cloudinary account under Integrations, then come back here to upload."
              : "Photos and videos are kept in a storage account that has not been connected yet. Ask a workspace owner or administrator to connect one under Integrations."
          }
          action={
            canConnect ? (
              <Link href="/workspace/settings/integrations" className="btn btn-default">
                Connect storage
              </Link>
            ) : undefined
          }
        />
      </>
    );
  }

  return (
    <MediaLibrary
      initial={{ items: data.page.items.map(toMediaItem), nextCursor: data.page.nextCursor }}
      folders={data.folders.map((folder) => ({ id: folder.id, name: folder.name, assetCount: folder.assetCount }))}
      usage={data.usage}
      canManage={can(workspace, "media.manage")}
      storage={data.storage}
      storageMessage={data.storageMessage}
      canConnect={canConnect}
      timezone={workspace.tenant.timezone}
    />
  );
}
