"use client";

import { useRouter } from "next/navigation";
import { useRef, useTransition, type KeyboardEvent } from "react";
import { buildHref } from "@/lib/platform-display";

interface StatusTabsProps {
  path: string;
  /** Query parameter the tabs set. */
  name: string;
  /** Accessible name of the tab list, e.g. "Status". */
  label: string;
  /** Selected value; "" is the unfiltered tab. */
  value: string;
  tabs: { value: string; label: string; count: number }[];
}

/** The design's status tabs, with the selection kept in the URL. */
export function StatusTabs({ path, name, label, value, tabs }: StatusTabsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const list = useRef<HTMLDivElement>(null);

  function select(next: string) {
    startTransition(() => router.push(buildHref(path, { [name]: next })));
  }

  // Arrow keys move between tabs, as the tab pattern expects.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const target = buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
    target?.focus();
  }

  return (
    <div ref={list} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="tabs-list no-scrollbar mb-4 max-w-full justify-start overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          tabIndex={tab.value === value ? 0 : -1}
          className="tabs-trigger"
          onClick={() => select(tab.value)}
        >
          {tab.label} <span className="rounded-full bg-muted-foreground/15 px-1.5 text-xs">{tab.count}</span>
        </button>
      ))}
    </div>
  );
}
