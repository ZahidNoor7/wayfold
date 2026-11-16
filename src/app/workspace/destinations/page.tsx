import { Suspense } from "react";
import { PageSkeleton } from "@/components/workspace/page-header";
import { DestinationsManager } from "@/components/workspace/tours/destinations-manager";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { listDestinations } from "@/server/catalog/destinations";

export const metadata = { title: "Destinations" };

export default function DestinationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const workspace = await requireWorkspace("tours.manage");
  const destinations = await inWorkspace(workspace, listDestinations);

  return (
    <DestinationsManager
      destinations={destinations.map((destination) => ({
        id: destination.id,
        name: destination.name,
        slug: destination.slug,
        region: destination.region,
        tagline: destination.tagline,
        description: destination.description,
        coverMediaId: destination.coverMediaId,
        coverUrl: destination.coverUrl,
        latitude: destination.latitude,
        longitude: destination.longitude,
        isPublished: destination.isPublished,
        tourCount: destination.tourCount,
      }))}
      canPickMedia={can(workspace, "media.view")}
      canUploadMedia={can(workspace, "media.manage")}
    />
  );
}
