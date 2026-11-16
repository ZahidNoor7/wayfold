"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { BottomSheet, Spinner } from "@/components/overlays";
import { buildHref } from "@/lib/platform-display";

export interface SelectFilter {
  /** Query parameter name. */
  name: string;
  label: string;
  /** Current value from the URL; "" means no filter. */
  value: string;
  /** The first option is the unfiltered one and has the value "". */
  options: { value: string; label: string }[];
  /** A choice that always applies (sorting), so it is not counted as a filter. */
  alwaysOn?: boolean;
}

interface FilterBarProps {
  path: string;
  search?: { name: string; label: string; placeholder: string; value: string };
  selects: SelectFilter[];
}

/**
 * Filters that live in the URL, so a filtered list can be bookmarked and the
 * back button works. From `md` the selects sit beside the search; on phones
 * they move into a bottom sheet. Any change returns to the first page.
 */
export function FilterBar({ path, search, selects }: FilterBarProps) {
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const current: Record<string, string> = Object.fromEntries(selects.map((select) => [select.name, select.value]));
  if (search) current[search.name] = search.value;
  const activeCount = selects.filter((select) => !select.alwaysOn && select.value !== "").length;

  function go(next: Record<string, string>) {
    startTransition(() => router.push(buildHref(path, next)));
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!search) return;
    const value = String(new FormData(event.currentTarget).get(search.name) ?? "").trim();
    go({ ...current, [search.name]: value });
  }

  function openSheet() {
    setDraft(Object.fromEntries(selects.map((select) => [select.name, select.value])));
    setSheetOpen(true);
  }

  return (
    <div className="mb-4 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <div className="flex gap-2 md:contents">
        {search ? (
          // Keyed by the URL value, so "Clear" and the back button reset the box.
          <form key={search.value} role="search" onSubmit={submitSearch} className="relative min-w-0 flex-1 md:w-72 md:flex-none">
            <label htmlFor={`${id}-q`} className="sr-only">
              {search.label}
            </label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id={`${id}-q`}
              name={search.name}
              type="search"
              className="input pl-9"
              placeholder={search.placeholder}
              defaultValue={search.value}
              enterKeyHint="search"
              autoComplete="off"
            />
          </form>
        ) : null}
        {selects.length > 0 ? (
          <button type="button" className="btn btn-outline shrink-0 md:hidden" aria-haspopup="dialog" onClick={openSheet}>
            <SlidersHorizontal aria-hidden="true" />
            Filters
            {activeCount > 0 ? (
              <span className="badge badge-default">
                {activeCount}
                <span className="sr-only"> active</span>
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {selects.map((select) => (
        <div key={select.name} className="hidden md:block">
          <label htmlFor={`${id}-${select.name}`} className="sr-only">
            {select.label}
          </label>
          <select
            id={`${id}-${select.name}`}
            className="select md:w-48"
            value={select.value}
            onChange={(event) => go({ ...current, [select.name]: event.target.value })}
          >
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ))}

      {activeCount > 0 || (search && search.value !== "") ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm self-start md:self-auto"
          onClick={() => go(Object.fromEntries(selects.filter((select) => select.alwaysOn).map((select) => [select.name, select.value])))}
        >
          Clear filters
        </button>
      ) : null}
      {pending ? (
        <span role="status" className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner className="size-4" />
          Updating
        </span>
      ) : null}

      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Filters"
        footer={
          <button
            type="button"
            className="btn btn-default w-full"
            onClick={() => {
              setSheetOpen(false);
              go({ ...current, ...draft });
            }}
          >
            Show results
          </button>
        }
      >
        <div className="flex flex-col gap-4">
          {selects.map((select) => (
            <div key={select.name} className="flex flex-col gap-2">
              <label htmlFor={`${id}-sheet-${select.name}`} className="label">
                {select.label}
              </label>
              <select
                id={`${id}-sheet-${select.name}`}
                className="select"
                value={draft[select.name] ?? ""}
                onChange={(event) => setDraft((previous) => ({ ...previous, [select.name]: event.target.value }))}
              >
                {select.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}
