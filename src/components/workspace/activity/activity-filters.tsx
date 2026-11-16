"use client";

import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet, Spinner } from "@/components/overlays";
import { AUDIT_AREAS } from "@/lib/audit-labels";
import { activeFilterCount, activityHref, type ActivityView } from "./params";

export interface PersonOption {
  value: string;
  label: string;
}

interface ActivityFiltersProps {
  /** The filters the server rendered the list with. */
  view: ActivityView;
  people: PersonOption[];
  /** Today in the workspace's timezone: the latest date worth choosing. */
  today: string;
}

type Filters = Pick<ActivityView, "area" | "person" | "from" | "to">;

interface FilterFieldsProps {
  idPrefix: string;
  value: Filters;
  onChange: (next: Filters) => void;
  /** Called when a date field loses focus, so a date is applied once it is complete rather than per keystroke. */
  onDateCommit?: () => void;
  people: PersonOption[];
  today: string;
}

function FilterFields({ idPrefix, value, onChange, onDateCommit, people, today }: FilterFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${idPrefix}-area`} className="label">
          Area
        </label>
        <select id={`${idPrefix}-area`} className="select" value={value.area ?? ""} onChange={(event) => onChange({ ...value, area: event.target.value || undefined })}>
          <option value="">Everything</option>
          {AUDIT_AREAS.map((area) => (
            <option key={area.value} value={area.value}>
              {area.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${idPrefix}-person`} className="label">
          Person
        </label>
        <select id={`${idPrefix}-person`} className="select" value={value.person ?? ""} onChange={(event) => onChange({ ...value, person: event.target.value || undefined })}>
          <option value="">Anyone</option>
          {people.map((person) => (
            <option key={person.value} value={person.value}>
              {person.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${idPrefix}-from`} className="label">
          From
        </label>
        <input
          id={`${idPrefix}-from`}
          type="date"
          className="input"
          value={value.from ?? ""}
          max={value.to ?? today}
          onChange={(event) => onChange({ ...value, from: event.target.value || undefined })}
          onBlur={onDateCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter") onDateCommit?.();
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${idPrefix}-to`} className="label">
          To
        </label>
        <input
          id={`${idPrefix}-to`}
          type="date"
          className="input"
          value={value.to ?? ""}
          min={value.from}
          max={today}
          onChange={(event) => onChange({ ...value, to: event.target.value || undefined })}
          onBlur={onDateCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter") onDateCommit?.();
          }}
        />
      </div>
    </>
  );
}

/**
 * Area, person and date filters for the activity log. They live in the URL,
 * so a filtered view can be bookmarked or shared with a colleague. On wide
 * screens each change applies at once; on phones the filters sit in a
 * bottom sheet and apply together.
 */
export function ActivityFilters({ view, people, today }: ActivityFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const current: Filters = { area: view.area, person: view.person, from: view.from, to: view.to };
  const [draft, setDraft] = useState<Filters>(current);
  const [inline, setInline] = useState<Filters>(current);
  const [shownKey, setShownKey] = useState(activityHref(current));
  const count = activeFilterCount(view);

  // The URL changed underneath us (Back, a shared link): show what it says.
  const currentKey = activityHref(current);
  if (currentKey !== shownKey) {
    setShownKey(currentKey);
    setInline(current);
  }

  function onInlineChange(next: Filters) {
    setInline(next);
    // Lists apply at once; dates wait until the field is left.
    if (next.area !== inline.area || next.person !== inline.person) apply(next);
  }

  function commitInlineDates() {
    if (inline.from !== current.from || inline.to !== current.to) apply(inline);
  }

  function apply(next: Filters) {
    // A new filter starts from the newest entries.
    startTransition(() => router.push(activityHref(next), { scroll: false }));
  }

  function openSheet() {
    setDraft(current);
    setSheetOpen(true);
  }

  return (
    <div className="mb-4 print:hidden" aria-busy={pending || undefined}>
      <div className="flex items-center justify-between gap-3 sm:hidden">
        <button type="button" className="btn btn-outline" onClick={openSheet} aria-expanded={sheetOpen}>
          <SlidersHorizontal aria-hidden="true" />
          Filters
          {count > 0 ? <span className="badge badge-default">{count}</span> : null}
        </button>
        {pending ? (
          <span className="text-muted-foreground" role="status">
            <Spinner className="size-4" />
            <span className="sr-only">Updating the list</span>
          </span>
        ) : count > 0 ? (
          <Link href={activityHref({})} className="btn btn-ghost btn-sm">
            Clear filters
          </Link>
        ) : null}
      </div>

      <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
        <FilterFields idPrefix="activity" value={inline} onChange={onInlineChange} onDateCommit={commitInlineDates} people={people} today={today} />
        <div className="flex h-11 items-center gap-2 sm:col-span-2 lg:col-span-1">
          {pending ? (
            <span className="text-muted-foreground" role="status">
              <Spinner className="size-4" />
              <span className="sr-only">Updating the list</span>
            </span>
          ) : null}
          {count > 0 ? (
            <Link href={activityHref({})} className="btn btn-ghost btn-sm">
              Clear filters
            </Link>
          ) : null}
        </div>
      </div>

      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Filter activity"
        footer={
          <div className="flex gap-2 pb-3">
            <button type="button" className="btn btn-outline flex-1" onClick={() => setDraft({})}>
              Clear
            </button>
            <button
              type="button"
              className="btn btn-default flex-1"
              onClick={() => {
                setSheetOpen(false);
                apply(draft);
              }}
            >
              Show results
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <FilterFields idPrefix="activity-sheet" value={draft} onChange={setDraft} people={people} today={today} />
        </div>
      </BottomSheet>
    </div>
  );
}
