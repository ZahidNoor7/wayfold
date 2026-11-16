import { ExternalLink } from "lucide-react";
import { Suspense } from "react";
import type { MediaChoice } from "@/components/workspace/content/media-field";
import { SiteEditor } from "@/components/workspace/content/site/site-editor";
import { parseTab } from "@/components/workspace/content/site/site-model";
import { storefrontOrigin } from "@/components/workspace/content/storefront-origin";
import { PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import type { SearchParams } from "@/lib/booking-display";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import type { TenantScope } from "@/server/db/context";
import { AppError } from "@/server/errors";
import { getMedia } from "@/server/media";
import { getSiteContent, SEO_PAGES, VALUE_PROP_ICONS } from "@/server/settings/site-content";

export const metadata = { title: "Pages & content" };

export default function SiteContentPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Content {...props} />
    </Suspense>
  );
}

/** A stored image reference as a thumbnail, or nothing if the file is gone. */
async function mediaChoice(scope: TenantScope, id: string | null): Promise<MediaChoice | null> {
  if (!id) return null;
  try {
    const asset = await getMedia(scope, id);
    return { id: asset.id, url: asset.url, alt: asset.alt };
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") return null;
    throw error;
  }
}

async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const workspace = await requireWorkspace("content.manage");
  const { tab } = await searchParams;
  const { content, heroImage, portrait } = await inWorkspace(workspace, async (scope) => {
    const content = await getSiteContent(scope);
    // One transaction: queries run one after the other.
    const heroImage = await mediaChoice(scope, content.hero.imageMediaId);
    const portrait = await mediaChoice(scope, content.about.portraitMediaId);
    return { content, heroImage, portrait };
  });
  const origin = storefrontOrigin(workspace);

  return (
    <>
      <PageHeader
        title="Pages & content"
        description="The words and photos on your website, page by page. Each part saves on its own and is live as soon as you save."
        actions={
          <a href={`${origin}/`} target="_blank" rel="noreferrer" className="btn btn-outline">
            <ExternalLink aria-hidden="true" />
            Open website
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        }
      />
      <SiteEditor
        content={content}
        heroImage={heroImage}
        portrait={portrait}
        origin={origin}
        canUpload={can(workspace, "media.manage")}
        icons={VALUE_PROP_ICONS}
        seoPages={SEO_PAGES}
        initialTab={parseTab(tab)}
      />
    </>
  );
}
