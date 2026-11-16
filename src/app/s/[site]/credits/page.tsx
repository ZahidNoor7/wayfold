import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { buildMetadata, loadSite } from "@/components/storefront-content/data";
import { ContentSkeleton } from "@/components/storefront-content/prose";
import { isCloudinaryUrl } from "@/lib/storefront-format";
import { listMediaCredits } from "@/server/media";
import { inSite } from "@/server/storefront/context";

interface Props {
  params: Promise<{ site: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { site } = await params;
  const data = await loadSite(site);
  return buildMetadata(data, {
    title: "Photo credits",
    description: `The photographers and licences behind the images on ${data.tenant.name}'s website.`,
    path: "/credits",
  });
}

export default function CreditsPage(props: Props) {
  return (
    <Suspense fallback={<ContentSkeleton variant="narrow" />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: Props) {
  const { site } = await params;
  const { tenant } = await loadSite(site);
  const credits = await inSite(tenant, listMediaCredits);

  return (
    <article className="container-x max-w-4xl py-20 lg:py-28">
      <h1 className="font-display text-5xl font-medium leading-none text-primary sm:text-6xl">Photo credits</h1>
      <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-foreground/85">
        {credits.length > 0
          ? "Some photos on this website are by other photographers, used under the licences named below. Follow a link to see the original and its full licence."
          : "Every photo on this website belongs to us."}
      </p>
      {credits.length > 0 ? (
        <ul className="mt-12 grid gap-6 sm:grid-cols-2">
          {credits.map((item) => (
            <li key={item.id} className="card flex gap-4 overflow-hidden p-3">
              {isCloudinaryUrl(item.url) ? (
                <Image src={item.url} alt={item.alt} width={128} height={96} sizes="128px" className="h-24 w-32 shrink-0 rounded-md object-cover" />
              ) : null}
              <div className="min-w-0 py-1 text-sm leading-relaxed">
                <p className="font-semibold text-foreground">{item.alt || "Photo"}</p>
                <p className="mt-1 text-muted-foreground">{item.credit}</p>
                {item.creditUrl ? (
                  <a href={item.creditUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-eyebrow underline-offset-4 hover:underline">
                    Original and licence<span className="sr-only"> (opens in a new tab)</span> ↗
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
