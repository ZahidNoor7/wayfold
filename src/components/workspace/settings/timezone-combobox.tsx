"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { searchTimezones, timezoneLabel, utcOffset } from "./timezones";

interface TimezoneComboboxProps {
  zones: readonly string[];
  value: string;
  onChange: (zone: string) => void;
  control: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined };
}

/**
 * Searchable time zone picker (ARIA combobox with a list box). Type part of a
 * city or region; arrows move, Enter chooses, Escape puts the old value back.
 */
export function TimezoneCombobox({ zones, value, onChange, control }: TimezoneComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => (open ? searchTimezones(zones, query) : []), [open, zones, query]);
  const [now] = useState(() => new Date());

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const choose = (zone: string) => {
    onChange(zone);
    close();
  };

  const move = (index: number) => {
    setActive(index);
    list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      if (results.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      move((active + delta + results.length) % results.length);
    } else if (event.key === "Enter") {
      if (open && results[active]) {
        event.preventDefault();
        choose(results[active]);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  };

  const activeId = open && results[active] ? `${listId}-${active}` : undefined;

  return (
    <div className="relative">
      <input
        {...control}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        className="input pr-9"
        value={open ? query : timezoneLabel(value)}
        placeholder={open ? `Search, e.g. ${timezoneLabel(value).split(" / ").at(-1)}` : undefined}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
        autoComplete="off"
        spellCheck={false}
      />
      <ChevronsUpDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      {open ? (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Time zones"
          className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg animate-fade-in"
        >
          {results.length === 0 ? (
            <li role="presentation" className="px-3 py-2.5 text-sm text-muted-foreground">
              No time zone matches “{query}”. Try a city or country name.
            </li>
          ) : (
            results.map((zone, index) => (
              <li
                key={zone}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={zone === value}
                // Keep focus in the input so the list does not close before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(zone)}
                onMouseMove={() => active !== index && setActive(index)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 text-sm",
                  index === active && "bg-accent text-accent-foreground",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Check aria-hidden="true" className={cn("size-4 shrink-0", zone === value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{timezoneLabel(zone)}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{utcOffset(zone, now)}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
