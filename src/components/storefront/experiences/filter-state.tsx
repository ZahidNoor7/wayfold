"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, use, useOptimistic, useTransition, type ReactNode } from "react";
import { DEFAULT_EXPERIENCE_FILTERS, experiencesHref, type ExperienceFilters } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";

interface FilterState {
  /** The filters as the visitor last set them: ahead of the server while a change loads. */
  filters: ExperienceFilters;
  /** True while results for the latest change are loading. */
  pending: boolean;
  /** Applies a change. Every change returns to the first page. */
  update: (patch: Partial<ExperienceFilters>) => void;
  /** Back to the full catalogue: no search, no filters, default order. */
  clear: () => void;
}

const FilterContext = createContext<FilterState | null>(null);

/**
 * Holds the Experiences filter state. The URL is the source of truth: a
 * change navigates (replacing history, keeping scroll), the server re-renders
 * the results, and until it answers the controls already show the new choice.
 */
export function ExperienceFilterProvider({ filters, children }: { filters: ExperienceFilters; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(filters, (_current, next: ExperienceFilters) => next);

  const go = (next: ExperienceFilters) =>
    startTransition(() => {
      setOptimistic(next);
      router.replace(experiencesHref(next), { scroll: false });
    });

  const state: FilterState = {
    filters: optimistic,
    pending,
    update: (patch) => go({ ...optimistic, ...patch, page: 1 }),
    clear: () => go(DEFAULT_EXPERIENCE_FILTERS),
  };
  return <FilterContext value={state}>{children}</FilterContext>;
}

export function useExperienceFilters(): FilterState {
  const state = use(FilterContext);
  if (!state) throw new Error("useExperienceFilters must be used inside ExperienceFilterProvider");
  return state;
}

/** Wraps the results; dims them and marks them busy while a change loads. */
export function ResultsRegion({ children, className }: { children: ReactNode; className?: string }) {
  const { pending } = useExperienceFilters();
  return (
    <div aria-busy={pending} className={cn("transition-opacity duration-200", pending && "opacity-60", className)}>
      {children}
    </div>
  );
}

/** "Clear all filters" for the results bar and the empty state. */
export function ClearFiltersButton({ className, children, showIcon }: { className?: string; children: ReactNode; showIcon?: boolean }) {
  const { clear } = useExperienceFilters();
  return (
    <button type="button" onClick={clear} className={className}>
      {children}
      {showIcon ? <X aria-hidden="true" /> : null}
    </button>
  );
}
