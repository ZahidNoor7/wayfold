import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { storefrontOrigin } from "@/components/workspace/content/storefront-origin";
import { JournalForm } from "@/components/workspace/content/journal/journal-form";
import { loadJournalOptions } from "@/components/workspace/content/journal/journal-options";
import { PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { getJourneyEntry } from "@/server/content/journey";
import { NotFoundError } from "@/server/errors";

export const metadata: Metadata = { title: "Edit journal entry" };

export default function EditJournalEntryPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await requireWorkspace("content.manage");

  const loaded = await inWorkspace(workspace, async (scope) => {
    try {
      const entry = await getJourneyEntry(scope, id);
      return { entry, options: await loadJournalOptions(scope) };
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  });
  if (!loaded) notFound();
  const { entry, options } = loaded;

  return (
    <>
      <Link href="/workspace/journal" className="btn btn-ghost btn-sm -ml-3 mb-2">
        <ArrowLeft aria-hidden="true" />
        Journal
      </Link>
      <PageHeader title={entry.title} description={entry.isPublished ? "Published on your website." : "Draft: only your team can see it."} />
      <JournalForm
        key={entry.id}
        entry={{
          id: entry.id,
          title: entry.title,
          slug: entry.slug,
          destinationId: entry.destinationId,
          location: entry.location,
          visitedOn: entry.visitedOn,
          category: entry.category,
          teaser: entry.teaser,
          description: entry.description,
          highlights: entry.highlights,
          coverMediaId: entry.coverMediaId,
          coverUrl: entry.coverUrl,
          relatedTourId: entry.relatedTourId,
          isPublished: entry.isPublished,
          photos: entry.photos.map(({ id: photoId, url, alt, resourceType }) => ({ id: photoId, url, alt, resourceType })),
        }}
        destinations={options.destinations}
        tours={options.tours}
        origin={storefrontOrigin(workspace)}
        canUpload={can(workspace, "media.manage")}
      />
    </>
  );
}
