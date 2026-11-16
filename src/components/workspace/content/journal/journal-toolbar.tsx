"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Spinner } from "@/components/overlays";
import { JOURNAL_STATUS_LABELS, JOURNAL_STATUSES, journalHref, MAX_SEARCH_LENGTH, type JournalStatus } from "./journal-model";

const SEARCH_DELAY_MS = 300;

interface JournalToolbarProps {
  status: JournalStatus;
  q: string;
}

/** Status chips and search for the journal list. Both live in the URL. */
export function JournalToolbar({ status, q }: JournalToolbarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(q);
  const [appliedQ, setAppliedQ] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The URL changed underneath us (Back, a shared link): show what it says.
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

  function go(next: { status: JournalStatus; q: string }, replace: boolean) {
    const href = journalHref(next);
    startTransition(() => (replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false })));
  }

  function onSearch(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (value.trim() !== q) go({ status, q: value.trim() }, true);
    }, SEARCH_DELAY_MS);
  }

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div role="group" aria-label="Show entries" className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        {JOURNAL_STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            className="chip h-9 shrink-0 px-3.5 text-[13px]"
            aria-pressed={status === value}
            onClick={() => status !== value && go({ status: value, q: text.trim() }, false)}
          >
            {JOURNAL_STATUS_LABELS[value]}
          </button>
        ))}
      </div>
      <form
        role="search"
        className="relative w-full sm:w-80"
        onSubmit={(event) => {
          event.preventDefault();
          if (timer.current) clearTimeout(timer.current);
          go({ status, q: text.trim() }, true);
        }}
      >
        <label htmlFor="journal-search" className="sr-only">
          Search journal entries
        </label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="journal-search"
          type="search"
          className="input pl-9 pr-9"
          placeholder="Search title or place…"
          maxLength={MAX_SEARCH_LENGTH}
          value={text}
          onChange={(event) => onSearch(event.target.value)}
        />
        {pending ? <Spinner className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /> : null}
      </form>
    </div>
  );
}
