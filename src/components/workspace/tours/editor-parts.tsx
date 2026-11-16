"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { useFieldArray, type Control, type UseFormRegister } from "react-hook-form";
import { cn } from "@/lib/utils";
import type { SectionId, TourFormValues } from "./tour-form-model";

interface SectionProps {
  id: SectionId;
  title: string;
  description?: ReactNode;
  /** A problem that concerns the whole section rather than one field. */
  error?: string | null;
  children: ReactNode;
}

/** One card of the editor. `scroll-mt` keeps its heading clear of the sticky bars when jumped to. */
export function Section({ id, title, description, error, children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="card scroll-mt-32 p-5 sm:p-6 lg:scroll-mt-8">
      <header className="mb-5">
        <h2 id={`${id}-title`} className="font-display text-2xl font-semibold text-primary">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </header>
      {error ? (
        <p role="alert" className="alert alert-destructive mb-5">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

interface MoveButtonsProps {
  /** What is being moved, for the button labels: "Day 2", "Photo 3". */
  label: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
  /** "up/down" for stacked lists, "earlier/later" for grids that wrap. */
  wording?: "vertical" | "sequence";
  className?: string;
}

/** Reordering without dragging: two buttons that work with a keyboard, a switch device or a thumb. */
export function MoveButtons({ label, index, count, onMove, wording = "vertical", className }: MoveButtonsProps) {
  const before = wording === "vertical" ? "up" : "earlier";
  const after = wording === "vertical" ? "down" : "later";
  return (
    <span className={cn("inline-flex", className)}>
      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${label} ${before}`} disabled={index === 0} onClick={() => onMove(index - 1)}>
        <ArrowUp aria-hidden="true" className={wording === "sequence" ? "-rotate-90" : undefined} />
      </button>
      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${label} ${after}`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
        <ArrowDown aria-hidden="true" className={wording === "sequence" ? "-rotate-90" : undefined} />
      </button>
    </span>
  );
}

export type TextListName = "highlights" | "inclusions" | "exclusions" | "goodToKnow" | "languages";

interface TextListProps {
  control: Control<TourFormValues>;
  register: UseFormRegister<TourFormValues>;
  name: TextListName;
  label: string;
  hint?: string;
  /** Singular name of one row: "highlight", "language". */
  item: string;
  placeholder?: string;
  /** Row-level messages by index, and a message for the list as a whole. */
  rowError?: (index: number) => string | null;
  error?: string | null;
}

/** A list of one-line entries: add a row, remove a row. Enter adds the next one. */
export function TextList({ control, register, name, label, hint, item, placeholder, rowError, error }: TextListProps) {
  const { fields, append, remove } = useFieldArray({ control, name });
  const labelId = `${name}-label`;

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
      <p id={labelId} className="label">
        {label}
      </p>
      {hint ? <p className="field-hint -mt-1">{hint}</p> : null}
      {fields.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {fields.map((field, index) => {
            const message = rowError?.(index) ?? null;
            return (
              <li key={field.id} className="flex flex-col gap-1">
                <div className="flex gap-2">
                  <input
                    {...register(`${name}.${index}.value` as const)}
                    className="input min-w-0 flex-1"
                    placeholder={placeholder}
                    aria-label={`${label} ${index + 1}`}
                    aria-invalid={Boolean(message)}
                    onKeyDown={(event) => {
                      // Enter would otherwise save the whole tour mid-list.
                      if (event.key === "Enter") {
                        event.preventDefault();
                        append({ value: "" });
                      }
                    }}
                  />
                  <button type="button" className="btn btn-ghost btn-icon h-11 shrink-0" aria-label={`Remove ${item} ${index + 1}`} onClick={() => remove(index)}>
                    <X aria-hidden="true" />
                  </button>
                </div>
                {message ? (
                  <span role="alert" className="field-error">
                    {message}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? (
        <span role="alert" className="field-error">
          {error}
        </span>
      ) : null}
      <div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => append({ value: "" })}>
          <Plus aria-hidden="true" />
          Add {item}
        </button>
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** A labelled switch row, as in the design's toggle group. */
export function ToggleRow({ label, hint, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
        <span className="switch-thumb" />
      </button>
    </div>
  );
}
