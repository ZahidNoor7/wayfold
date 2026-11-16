"use client";

import { createContext, useContext, useEffect } from "react";
import { Spinner } from "@/components/overlays";
import { cn } from "@/lib/utils";

interface SaveBarProps {
  dirty: boolean;
  pending: boolean;
  onDiscard: () => void;
  saveLabel?: string;
  /** What is saved, for the quiet state: "Your appearance is saved." */
  savedMessage?: string;
  /** Disables saving (the member may look but not change). */
  readOnly?: boolean;
}

/**
 * Pinned to the bottom of the page while a form is open, so saving is always
 * in reach. Says plainly whether there is anything left to save.
 */
export function SaveBar({ dirty, pending, onDiscard, saveLabel = "Save changes", savedMessage = "All changes are saved.", readOnly }: SaveBarProps) {
  return (
    <div className="safe-b sticky bottom-0 z-30 -mx-5 mt-2 border-t bg-background/95 px-5 pt-3 backdrop-blur sm:-mx-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-sm" role="status" aria-live="polite">
          <span
            aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-full transition-colors duration-200", dirty ? "bg-warning" : "bg-success")}
          />
          <span className={cn(dirty ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {readOnly ? "You can view these settings but not change them." : dirty ? "You have unsaved changes." : savedMessage}
          </span>
        </p>
        {readOnly ? null : (
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-ghost" onClick={onDiscard} disabled={!dirty || pending}>
              Discard
            </button>
            <button type="submit" className="btn btn-default" disabled={!dirty || pending} aria-busy={pending || undefined}>
              {pending ? <Spinner /> : null}
              {pending ? "Saving…" : saveLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Lets a section report unsaved changes to the tab bar above it. */
export const DirtyContext = createContext<((dirty: boolean) => void) | null>(null);

/**
 * Reports `dirty` to the enclosing settings tabs (for the dot on the tab) and
 * asks before the browser leaves the page with unsaved changes.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const report = useContext(DirtyContext);
  useEffect(() => {
    report?.(dirty);
  }, [dirty, report]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
