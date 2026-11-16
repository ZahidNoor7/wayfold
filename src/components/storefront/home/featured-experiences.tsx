"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Reveal } from "@/components/motion";
import { formatCount, pluralize, type CardPriceInput } from "@/lib/storefront-format";
import { TourCard, type TourCardTour } from "../tour-card";

export interface FeaturedTour extends TourCardTour {
  id: string;
  categorySlug: string | null;
}

export interface FeaturedExperiencesProps {
  /** Section title; it says how the tours were chosen. */
  heading: string;
  tours: FeaturedTour[];
  /** `bestPublicPriceFor` result, keyed by tour id. */
  prices: Record<string, CardPriceInput>;
  currency: string;
  /** All published tours, for the "view all" link. */
  total: number;
}

const SHOWN = 3;

/** Featured tours with category chips. The chips filter the tours already on the page, so a tap answers at once. */
export function FeaturedExperiences({ heading, tours, prices, currency, total }: FeaturedExperiencesProps) {
  const [category, setCategory] = useState("");

  const categories: { slug: string; name: string }[] = [];
  for (const tour of tours) {
    if (tour.categorySlug && tour.categoryName && !categories.some((known) => known.slug === tour.categorySlug)) {
      categories.push({ slug: tour.categorySlug, name: tour.categoryName });
    }
  }
  const visible = (category ? tours.filter((tour) => tour.categorySlug === category) : tours).slice(0, SHOWN);

  return (
    <section aria-labelledby="featured" className="py-20 lg:py-32">
      <div className="container-x">
        <Reveal className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="eyebrow mb-4">Featured experiences</p>
            <h2 id="featured" className="font-display text-4xl font-medium leading-tight text-primary sm:text-5xl lg:text-[56px]">
              {heading}
            </h2>
          </div>
          <Link href="/experiences" className="btn btn-link px-0 text-[15px]">
            {total > 1 ? `View all ${formatCount(total)} ${pluralize(total, "experience", "experiences")}` : "View experiences"}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Reveal>

        {categories.length > 1 ? (
          <div role="group" aria-label="Filter by category" className="no-scrollbar -mx-5 mb-8 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0">
            <button type="button" className="chip shrink-0" aria-pressed={category === ""} onClick={() => setCategory("")}>
              All
            </button>
            {categories.map((item) => (
              <button key={item.slug} type="button" className="chip shrink-0" aria-pressed={category === item.slug} onClick={() => setCategory(item.slug)}>
                {item.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-5 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3 lg:gap-7">
          {visible.map((tour) => (
            <TourCard
              key={tour.id}
              tour={tour}
              price={prices[tour.id]}
              currency={currency}
              variant="featured"
              sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 82vw"
              className="w-[82%] shrink-0 snap-start md:w-auto"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
