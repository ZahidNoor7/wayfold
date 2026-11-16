"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { BottomSheet, Spinner } from "@/components/overlays";
import type { CategoryOption } from "./category-manager";
import { activeFilterCount, tourListHref, type TourListParams } from "./tour-list-params";

interface ToursFiltersProps {
  params: TourListParams;
  categories: CategoryOption[];
}

/** Search, category and featured filters. Every change is written to the URL. */
export function ToursFilters({ params, categories }: ToursFiltersProps) {
  const router = useRouter();
  const [navigating, startTransition] = useTransition();
  const [search, setSearch] = useState(params.search);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The sheet edits a copy and applies it with one button, as the design's filter sheets do.
  const [draft, setDraft] = useState({ category: params.category, featured: params.featured });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function go(patch: Partial<TourListParams>) {
    if (timer.current) clearTimeout(timer.current);
    startTransition(() => router.replace(tourListHref(params, patch), { scroll: false }));
  }

  function onSearch(value: string) {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ search: value.trim() }), 350);
  }

  const active = activeFilterCount(params);
  const sheetCount = [params.category !== "", params.featured].filter(Boolean).length;

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <form
        role="search"
        className="relative flex-1 sm:max-w-xs"
        onSubmit={(event) => {
          event.preventDefault();
          go({ search: search.trim() });
        }}
      >
        <label htmlFor="tour-search" className="sr-only">
          Search tours
        </label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
        <input id="tour-search" type="search" className="input pl-9 pr-9" placeholder="Search title, place or web address" value={search} onChange={(event) => onSearch(event.target.value)} />
        {navigating ? <Spinner className="absolute right-3 top-3.5 size-4 text-muted-foreground" /> : null}
      </form>

      {/* Tablet and up: filters inline. */}
      <div className="hidden items-center gap-2 sm:flex">
        <label htmlFor="tour-category" className="sr-only">
          Category
        </label>
        <select id="tour-category" className="select w-48" value={params.category} onChange={(event) => go({ category: event.target.value })}>
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <button type="button" className="chip h-11 px-4" aria-pressed={params.featured} onClick={() => go({ featured: !params.featured })}>
          Featured only
        </button>
        {active > 0 ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setSearch("");
              go({ category: "", search: "", featured: false });
            }}
          >
            <X aria-hidden="true" />
            Clear
          </button>
        ) : null}
      </div>

      {/* Phones: the same filters in a bottom sheet. */}
      <button
        type="button"
        className="btn btn-outline h-11 sm:hidden"
        onClick={() => {
          setDraft({ category: params.category, featured: params.featured });
          setSheetOpen(true);
        }}
      >
        <SlidersHorizontal aria-hidden="true" />
        Filters
        {sheetCount > 0 ? <span className="badge badge-default">{sheetCount}</span> : null}
      </button>
      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Filter tours"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-outline btn-lg flex-1"
              onClick={() => {
                setSheetOpen(false);
                go({ category: "", featured: false });
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="btn btn-default btn-lg flex-1"
              onClick={() => {
                setSheetOpen(false);
                go(draft);
              }}
            >
              Show tours
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-5 pt-1">
          <label className="flex flex-col gap-2">
            <span className="label">Category</span>
            <select className="select" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between gap-4">
            <span id="featured-filter-label">
              <span className="block text-sm font-semibold">Featured only</span>
              <span className="text-xs text-muted-foreground">Tours shown in the featured section of your homepage</span>
            </span>
            <button type="button" role="switch" className="switch" aria-checked={draft.featured} aria-labelledby="featured-filter-label" onClick={() => setDraft({ ...draft, featured: !draft.featured })}>
              <span className="switch-thumb" />
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
