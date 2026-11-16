"use client";

import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DirtyContext } from "./save-bar";

export interface SettingsSection {
  id: string;
  label: string;
  content: ReactNode;
}

interface SettingsSectionsProps {
  sections: SettingsSection[];
  initial: string;
}

/**
 * The settings tabs. Every section stays mounted, so switching tabs never
 * throws away an edit in progress; a dot marks tabs with unsaved changes.
 * The open tab is kept in the address (`?tab=`) so it can be linked to.
 */
export function SettingsSections({ sections, initial }: SettingsSectionsProps) {
  const baseId = useId();
  const [active, setActive] = useState(() => (sections.some((s) => s.id === initial) ? initial : sections[0]?.id));
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = useCallback((id: string) => {
    setActive(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  }, []);

  const report = useCallback((id: string, value: boolean) => {
    setDirty((current) => (Boolean(current[id]) === value ? current : { ...current, [id]: value }));
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = sections.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    select(sections[next]!.id);
    tabs.current[next]?.focus();
  };

  return (
    <>
      <div role="tablist" aria-label="Settings sections" className="tabs-list no-scrollbar mb-6 max-w-full justify-start overflow-x-auto">
        {sections.map((section, index) => {
          const selected = section.id === active;
          return (
            <button
              key={section.id}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${section.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${section.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(section.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className="tabs-trigger"
            >
              {section.label}
              {dirty[section.id] ? (
                <>
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                  <span className="sr-only">(unsaved changes)</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
      {sections.map((section) => (
        <SectionPanel key={section.id} id={section.id} baseId={baseId} active={section.id === active} report={report}>
          {section.content}
        </SectionPanel>
      ))}
    </>
  );
}

interface SectionPanelProps {
  id: string;
  baseId: string;
  active: boolean;
  report: (id: string, dirty: boolean) => void;
  children: ReactNode;
}

function SectionPanel({ id, baseId, active, report, children }: SectionPanelProps) {
  const reportThis = useCallback((dirty: boolean) => report(id, dirty), [id, report]);
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${id}`}
      aria-labelledby={`${baseId}-tab-${id}`}
      hidden={!active}
      className={cn(active && "animate-fade-in")}
    >
      <DirtyContext.Provider value={reportThis}>{children}</DirtyContext.Provider>
    </div>
  );
}
