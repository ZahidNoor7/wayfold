import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cache, Suspense } from "react";
import { buildMetadata, loadSite } from "@/components/storefront-content/data";
import { EntryGallery, type GalleryItem } from "@/components/storefront-content/entry-gallery";
import { entryMedia, journeyHref } from "@/components/storefront-content/journey-helpers";
import { ContentSkeleton, Paragraphs } from "@/components/storefront-content/prose";
import { firstText } from "@/components/storefront-content/text";
import { formatMonthYear } from "@/lib/review-display";
import { getPublishedJourneyEntry, type PublicJourneyEntry } from "@/server/content/journey";
import { NotFoundError } from "@/server/errors";
import { inSite } from "@/server/storefront/context";

interface Props {
  params: Promise<{ site: string; slug: string }>;
}

/** One read per request, shared by the page and its metadata. Drafts and unknown slugs are a 404. */
const loadEntry = cache(async (site: string, slug: string): Promise<PublicJourneyEntry> => {
  const { tenant } = await loadSite(site);
  try {
    return await inSite(tenant, (scope) => getPublishedJourneyEntry(scope, slug));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});

function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    notFound();
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { site, slug } = await params;
  const data = await loadSite(site);
  const entry = await loadEntry(site, decodeSlug(slug));
  return buildMetadata(data, {
    title: entry.title,
    description: firstText(entry.teaser, entry.description, data.tenant.description),
    path: `/journey/${entry.slug}`,
    imageUrl: entry.cover?.url,
  });
}

export default function JourneyEntryPage(props: Props) {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: Props) {
  const { site, slug } = await params;
  const entry = await loadEntry(site, decodeSlug(slug));

  const photos: GalleryItem[] = entry.photos.map((photo) => ({ url: photo.url, alt: photo.alt, kind: photo.resourceType }));
  const cover: GalleryItem | null = entry.cover ? { url: entry.cover.url, alt: entry.cover.alt, kind: "image" } : null;
  const media = entryMedia(cover, photos);
  const meta = [entry.location, formatMonthYear(entry.visitedOn), entry.category].filter(Boolean);
  const hasAside = entry.highlights.length > 0 || entry.relatedTour !== null;

  return (
    <article className="pb-28 pt-10 lg:pt-14">
      <div className="container-x max-w-5xl">
        <Link href="/journey" className="btn btn-ghost -ml-3 mb-6 rounded-full">
          <ArrowLeft aria-hidden="true" />
          Travel journal
        </Link>

        {media.length > 0 ? <EntryGallery title={entry.title} items={media} /> : null}

        <div className="flex flex-col gap-8 pt-8 sm:pt-10 md:flex-row md:gap-12">
          <div className="min-w-0 flex-1">
            {meta.length > 0 ? (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                {meta.map((item, index) => (
                  <li key={index} className={index > 0 ? "border-l pl-4" : undefined}>
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
            <h1 className="mb-4 mt-2 wrap-break-word font-display text-4xl font-medium text-primary sm:text-5xl">{entry.title}</h1>
            {entry.description ? (
              <Paragraphs text={entry.description} paragraphClassName="text-base leading-relaxed text-foreground/85" />
            ) : entry.teaser ? (
              <p className="text-base leading-relaxed text-foreground/85">{entry.teaser}</p>
            ) : null}
            {entry.destination ? (
              <p className="mt-8">
                <Link href={journeyHref({ destination: entry.destination.slug })} className="btn btn-outline btn-lg rounded-full">
                  More from {entry.destination.name}
                </Link>
              </p>
            ) : null}
          </div>

          {hasAside ? (
            <aside className="md:w-72 md:shrink-0">
              {entry.highlights.length > 0 ? (
                <>
                  <h2 className="eyebrow mb-3">Highlights</h2>
                  <ul className="mb-7 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-foreground/85">
                    {entry.highlights.map((highlight, index) => (
                      <li key={index}>{highlight}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {entry.relatedTour ? (
                <div className="rounded-xl bg-hero p-5 text-hero-foreground">
                  <h2 className="text-xs uppercase tracking-widest text-highlight">Related tour</h2>
                  <p className="mb-3 mt-1 font-display text-2xl">{entry.relatedTour.title}</p>
                  <Link
                    href={`/experiences/${entry.relatedTour.slug}`}
                    className="inline-flex min-h-11 items-center text-sm font-semibold text-highlight underline underline-offset-4"
                  >
                    View this experience
                  </Link>
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
      </div>
    </article>
  );
}
