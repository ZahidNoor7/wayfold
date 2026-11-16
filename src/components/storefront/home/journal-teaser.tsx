import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Reveal } from "@/components/motion";
import { formatMonthYear, pluralize } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";
import { SiteImage } from "../site-image";

export interface JournalTeaserEntry {
  id: string;
  slug: string;
  title: string;
  teaser: string;
  visitedOn: string | null;
  cover: { url: string; alt: string } | null;
  photoCount: number;
  relatedTourTitle: string | null;
}

interface Tile {
  cell: string;
  ratio: string;
  sizes: string;
}

const WIDE: Tile = { cell: "md:col-span-7", ratio: "aspect-[16/10]", sizes: "(min-width: 768px) 58vw, 100vw" };
const TALL: Tile = { cell: "md:col-span-5", ratio: "aspect-[4/5]", sizes: "(min-width: 768px) 42vw, 100vw" };
const THIRD: Tile = { cell: "md:col-span-4", ratio: "aspect-[4/5]", sizes: "(min-width: 768px) 33vw, 100vw" };
const FULL: Tile = { cell: "md:col-span-12", ratio: "aspect-[16/10] md:aspect-[21/9]", sizes: "100vw" };

// The design's editorial 7/5 then 5/7 rhythm needs four entries; fewer get
// the nearest layout that still fills every row.
const LAYOUTS: Record<number, Tile[]> = {
  1: [FULL],
  2: [WIDE, TALL],
  3: [THIRD, THIRD, THIRD],
  4: [WIDE, TALL, TALL, WIDE],
};

/** The latest journal entries. */
export function JournalTeaser({ entries }: { entries: JournalTeaserEntry[] }) {
  const shown = entries.slice(0, 4);
  const layout = LAYOUTS[shown.length] ?? [];

  return (
    <section aria-labelledby="journal" className="py-20 lg:py-32">
      <div className="container-x">
        <Reveal className="mb-12 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="eyebrow mb-4">Recent adventures</p>
            <h2 id="journal" className="font-display text-4xl font-medium text-primary sm:text-5xl lg:text-[56px]">
              From the travel journal
            </h2>
          </div>
          <Link href="/journey" className="btn btn-link px-0 text-[15px]">
            Open the journal
            <ArrowRight aria-hidden="true" />
          </Link>
        </Reveal>
        <div className="grid gap-10 md:grid-cols-12 md:gap-6">
          {shown.map((entry, index) => {
            const tile = layout[index] ?? THIRD;
            const date = formatMonthYear(entry.visitedOn);
            return (
              <Reveal key={entry.id} className={tile.cell}>
                <Link href={`/journey/${entry.slug}`} className="group flex flex-col gap-4">
                  <div className={cn("relative overflow-hidden rounded-xl", tile.ratio)}>
                    <SiteImage src={entry.cover?.url} alt={entry.cover?.alt || entry.title} sizes={tile.sizes} className="img-zoom" />
                    {entry.photoCount > 0 ? (
                      <span className="badge absolute bottom-4 right-4 border-transparent bg-hero/85 text-hero-foreground">
                        {entry.photoCount} {pluralize(entry.photoCount, "photo", "photos")}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="font-display text-[28px] font-semibold text-primary">{entry.title}</h3>
                    {date ? <span className="whitespace-nowrap text-[13px] text-muted-foreground">{date}</span> : null}
                  </div>
                  {entry.teaser ? <p className="-mt-2 text-[15px] leading-relaxed text-muted-foreground">{entry.teaser}</p> : null}
                  {entry.relatedTourTitle ? <span className="text-[13px] font-semibold text-eyebrow">Related: {entry.relatedTourTitle}</span> : null}
                </Link>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
