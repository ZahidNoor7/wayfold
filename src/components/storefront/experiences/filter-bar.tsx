"use client";

import { ListFilter, Search, Tag } from "lucide-react";
import { useEffect, useEffectEvent, useId, useState, type FormEvent } from "react";
import { BottomSheet } from "@/components/overlays";
import {
  DURATION_OPTIONS,
  SORT_OPTIONS,
  formatCount,
  hasActiveFilters,
  normaliseSearch,
  pluralize,
  sheetFilterCount,
  type DurationFilter,
  type PriceFilter,
  type SortFilter,
} from "@/lib/storefront-format";
import { cn } from "@/lib/utils";
import { useExperienceFilters } from "./filter-state";

export interface ExperienceFilterBarProps {
  /** Categories that have published tours. */
  categories: { slug: string; name: string }[];
  /** Destinations that have published tours. */
  destinations: { slug: string; name: string }[];
  /** Budget band labels in the tenant's currency; null when the catalogue has no bands. */
  priceLabels: Record<Exclude<PriceFilter, "any">, string> | null;
  /** Show the "On offer" toggle (there is at least one live public offer). */
  showOffers: boolean;
  /** Results for the filters currently applied on the server. */
  total: number;
}

/** Search waits this long after the last keystroke before it asks the server. */
const SEARCH_DELAY_MS = 300;

// The desktop row holds the search field plus two to four selects.
const DESKTOP_GRID: Record<number, string> = {
  2: "lg:grid-cols-[2fr_1fr_1fr]",
  3: "lg:grid-cols-[2fr_1fr_1fr_1fr]",
  4: "lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]",
};

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}

function SelectField({ label, value, onChange, options }: SelectFieldProps) {
  return (
    <label className="flex flex-col gap-2">
      <span className="label">{label}</span>
      <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Search and filters for the Experiences page: an inline bar from `md`, and
 * below it a search field with a "Filters" button that opens a bottom sheet.
 * Every control writes to the URL, so a filtered view can be shared and the
 * back button works.
 */
export function ExperienceFilterBar({ categories, destinations, priceLabels, showOffers, total }: ExperienceFilterBarProps) {
  const { filters, pending, update, clear } = useExperienceFilters();
  const [sheetOpen, setSheetOpen] = useState(false);
  const mobileSearchId = useId();

  // The field shows what is typed at once; the URL follows after a pause.
  // When the search in the URL changes to something other than what is typed
  // (Clear all, the back button), the field follows the URL.
  const [text, setText] = useState(filters.q);
  const [seen, setSeen] = useState(filters.q);
  if (filters.q !== seen) {
    setSeen(filters.q);
    if (normaliseSearch(text) !== filters.q) setText(filters.q);
  }

  // An effect event always sees the latest filters, so a search that lands
  // after another filter was changed does not undo that change.
  const commit = useEffectEvent((value: string) => {
    const q = normaliseSearch(value);
    if (q !== filters.q) update({ q });
  });
  useEffect(() => {
    const timer = setTimeout(() => commit(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const q = normaliseSearch(text);
    if (q !== filters.q) update({ q });
  };
  const clearAll = () => {
    setText("");
    clear();
  };

  const destinationOptions = [{ value: "", label: "Anywhere" }, ...destinations.map((item) => ({ value: item.slug, label: item.name }))];
  const priceOptions = priceLabels
    ? [
        { value: "any", label: "Any budget" },
        { value: "low", label: priceLabels.low },
        { value: "mid", label: priceLabels.mid },
        { value: "high", label: priceLabels.high },
      ]
    : null;

  const selects = (
    <>
      {destinations.length > 0 ? (
        <SelectField label="Destination" value={filters.destination} onChange={(destination) => update({ destination })} options={destinationOptions} />
      ) : null}
      <SelectField label="Duration" value={filters.duration} onChange={(duration) => update({ duration: duration as DurationFilter })} options={DURATION_OPTIONS} />
      {priceOptions ? (
        <SelectField label="Price" value={filters.price} onChange={(price) => update({ price: price as PriceFilter })} options={priceOptions} />
      ) : null}
      <SelectField label="Sort by" value={filters.sort} onChange={(sort) => update({ sort: sort as SortFilter })} options={SORT_OPTIONS} />
    </>
  );
  const selectCount = 2 + Number(destinations.length > 0) + Number(priceOptions !== null);
  const inSheet = sheetFilterCount(filters);
  const offerToggle = showOffers || filters.onOffer;

  return (
    <div className="card p-4 shadow-xl sm:p-6">
      <form role="search" onSubmit={onSubmit}>
        <div className="flex gap-2 md:hidden">
          <label htmlFor={mobileSearchId} className="relative flex-1">
            <span className="sr-only">Search experiences</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
            <input
              id={mobileSearchId}
              className="input pl-9"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Tour or destination"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <button type="button" onClick={() => setSheetOpen(true)} aria-haspopup="dialog" className="btn btn-outline h-11 shrink-0">
            <ListFilter aria-hidden="true" />
            Filters
            {inSheet > 0 ? (
              <span className="badge badge-default">
                {inSheet}
                <span className="sr-only"> active</span>
              </span>
            ) : null}
          </button>
        </div>

        <div className={cn("hidden gap-4 md:grid md:grid-cols-2", DESKTOP_GRID[selectCount])}>
          <label className="flex flex-col gap-2">
            <span className="label">Search</span>
            <span className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
              <input
                className="input pl-9"
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                placeholder="Tour name or destination"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </span>
          </label>
          {selects}
        </div>
      </form>

      {offerToggle || categories.length > 0 ? (
        <div role="group" aria-label="Category" className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {offerToggle ? (
            <button type="button" className="chip shrink-0" aria-pressed={filters.onOffer} onClick={() => update({ onOffer: !filters.onOffer })}>
              <Tag aria-hidden="true" className="size-4" />
              On offer
            </button>
          ) : null}
          {categories.length > 0 ? (
            <>
              <button type="button" className="chip shrink-0" aria-pressed={filters.category === ""} onClick={() => update({ category: "" })}>
                All
              </button>
              {categories.map((category) => (
                <button
                  key={category.slug}
                  type="button"
                  className="chip shrink-0"
                  aria-pressed={filters.category === category.slug}
                  onClick={() => update({ category: category.slug })}
                >
                  {category.name}
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Filters"
        description={inSheet > 0 ? `${inSheet} ${pluralize(inSheet, "filter", "filters")} applied` : "Changes apply as you choose."}
        footer={
          <div className="flex gap-2">
            <button type="button" onClick={clearAll} disabled={!hasActiveFilters(filters) && text === ""} className="btn btn-outline btn-xl rounded-full px-5">
              Clear all
            </button>
            <button type="button" onClick={() => setSheetOpen(false)} aria-busy={pending || undefined} className="btn btn-default btn-xl min-w-0 flex-1 rounded-full px-4">
              <span className="truncate">
                Show {formatCount(total)} {pluralize(total, "experience", "experiences")}
              </span>
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-5 pt-1">{selects}</div>
      </BottomSheet>
    </div>
  );
}
