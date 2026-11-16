"use client";

import { slotStatus, type SlotInfo } from "@/lib/booking-form";
import { cn } from "@/lib/utils";
import { TONE_CLASS } from "./types";

/** Shared look of a selectable row. Native radios underneath give arrow-key selection for free. */
export const CHOICE_ROW =
  "flex items-center justify-between gap-3 rounded-lg border-2 text-left transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring";
export const CHOICE_SELECTED = "cursor-pointer border-primary bg-accent";
export const CHOICE_IDLE = "cursor-pointer border-border hover:border-ring";
export const CHOICE_UNAVAILABLE = "cursor-not-allowed border-dashed border-border bg-muted/50 text-muted-foreground";

interface SlotPickerProps {
  /** Unique per form: groups the radios. */
  name: string;
  slots: SlotInfo[];
  selected: string;
  /** Party size, to flag a time with too few seats. */
  guests: number;
  onSelect: (time: string) => void;
  /** A fully booked time was chosen: the parent explains and offers the waitlist. */
  onFull: (slot: SlotInfo) => void;
  error?: string | null;
  className?: string;
}

/** Start times of a day tour, with the seats left at each. */
export function SlotPicker({ name, slots, selected, guests, onSelect, onFull, error, className }: SlotPickerProps) {
  const errorId = `${name}-error`;
  return (
    <fieldset className={className} aria-describedby={error ? errorId : undefined}>
      <legend className="label mb-2">Start time</legend>
      <div className="flex flex-col gap-2">
        {slots.map((slot) => {
          const status = slotStatus(slot, guests);
          const checked = !status.full && slot.time === selected;
          return (
            <label key={slot.time} className={cn(CHOICE_ROW, "min-h-12 px-4 py-2", status.full ? CHOICE_UNAVAILABLE : checked ? CHOICE_SELECTED : CHOICE_IDLE)}>
              <input
                type="radio"
                name={name}
                value={slot.time}
                className="sr-only"
                checked={checked}
                aria-disabled={status.full || undefined}
                onChange={() => (status.full ? onFull(slot) : onSelect(slot.time))}
                onClick={() => {
                  // A click on the time that is already "current" fires no change event.
                  if (status.full) onFull(slot);
                }}
              />
              <span className={cn("font-bold tabular-nums", status.full && "line-through decoration-destructive/60")}>{slot.time}</span>
              <span className={cn("text-right text-xs", status.tone === "muted" ? "" : "font-semibold", TONE_CLASS[status.tone])}>{status.text}</span>
            </label>
          );
        })}
      </div>
      {error ? (
        <span id={errorId} role="alert" className="field-error mt-2 block">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}
