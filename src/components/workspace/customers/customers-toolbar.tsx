"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Spinner } from "@/components/overlays";
import { CUSTOMER_SORT_LABELS, CUSTOMER_SORTS, customersHref, MAX_SEARCH_LENGTH, type CustomerSort } from "./params";

const SEARCH_DELAY_MS = 300;

interface CustomersToolbarProps {
  /** The search and sort the server rendered the list with. */
  q: string;
  sort: CustomerSort;
}

/**
 * Search and sort for the customers list. Both live in the URL: typing
 * replaces the current history entry (so Back leaves the list rather than
 * undoing one keystroke at a time), choosing a sort adds one.
 */
export function CustomersToolbar({ q, sort }: CustomersToolbarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(q);
  const [appliedQ, setAppliedQ] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The URL changed underneath us (Back, a shared link): show what it says.
  // Our own search arriving back is left alone, so a space typed mid-phrase survives.
  if (q !== appliedQ) {
    setAppliedQ(q);
    if (q !== text.trim()) setText(q);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function cancelTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function applySearch(value: string) {
    cancelTimer();
    const next = value.trim();
    if (next === q) return;
    // A new search starts on its first page.
    startTransition(() => router.replace(customersHref({ q: next, sort }), { scroll: false }));
  }

  function onSearchInput(value: string) {
    setText(value);
    cancelTimer();
    timer.current = setTimeout(() => applySearch(value), SEARCH_DELAY_MS);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applySearch(text);
  }

  function onSort(value: string) {
    cancelTimer();
    const next = CUSTOMER_SORTS.find((option) => option === value) ?? sort;
    startTransition(() => router.push(customersHref({ q: text.trim(), sort: next }), { scroll: false }));
  }

  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" aria-busy={pending || undefined}>
      <form role="search" onSubmit={onSubmit} className="relative flex-1 sm:max-w-sm">
        <label htmlFor="customer-search" className="sr-only">
          Search customers
        </label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
        <input
          id="customer-search"
          className="input pl-9 pr-9"
          type="search"
          name="q"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={MAX_SEARCH_LENGTH}
          placeholder="Search name, email or phone…"
          value={text}
          onChange={(event) => onSearchInput(event.target.value)}
        />
        {pending ? (
          <span className="pointer-events-none absolute right-3 top-3.5 text-muted-foreground">
            <Spinner className="size-4" />
            <span className="sr-only" role="status">
              Updating the list
            </span>
          </span>
        ) : null}
      </form>
      <label className="flex items-center gap-2">
        <span className="shrink-0 text-[13px] font-medium text-muted-foreground">Sort by</span>
        <select className="select sm:w-56" value={sort} onChange={(event) => onSort(event.target.value)}>
          {CUSTOMER_SORTS.map((option) => (
            <option key={option} value={option}>
              {CUSTOMER_SORT_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
