"use client";

import { FILTER_LABELS } from "@/lib/promotion-display";

interface FilterChipsProps<F extends keyof typeof FILTER_LABELS> {
  label: string;
  filters: readonly F[];
  counts: Record<F, number>;
  value: F;
  onChange: (filter: F) => void;
}

/** The design's single-select filter chips: `Active · 5`. */
export function FilterChips<F extends keyof typeof FILTER_LABELS>({ label, filters, counts, value, onChange }: FilterChipsProps<F>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {filters.map((filter) => (
        <button
          key={filter}
          type="button"
          className="chip h-9 px-3.5 text-[13px]"
          aria-pressed={filter === value}
          onClick={() => onChange(filter)}
        >
          {FILTER_LABELS[filter]} · {counts[filter]}
        </button>
      ))}
    </div>
  );
}

/** One quiet line under a disabled control saying why it is disabled. */
export function AccessNote({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
