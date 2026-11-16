"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

interface RowControlsProps {
  index: number;
  count: number;
  /** Names the row for screen readers, e.g. "highlight 2" or "Languages: English". */
  label: string;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

/**
 * Move up, move down and remove for one row of a repeatable list. Buttons,
 * not drag handles, so the order can be changed from the keyboard and with a
 * screen reader.
 */
export function RowControls({ index, count, label, onMove, onRemove, disabled }: RowControlsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        data-row-action="up"
        aria-label={`Move ${label} up`}
        disabled={disabled || index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        <ArrowUp aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        data-row-action="down"
        aria-label={`Move ${label} down`}
        disabled={disabled || index >= count - 1}
        onClick={() => onMove(index, index + 1)}
      >
        <ArrowDown aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm text-destructive hover:text-destructive"
        data-row-action="remove"
        aria-label={`Remove ${label}`}
        disabled={disabled}
        onClick={() => onRemove(index)}
      >
        <Trash2 aria-hidden="true" />
      </button>
    </div>
  );
}
