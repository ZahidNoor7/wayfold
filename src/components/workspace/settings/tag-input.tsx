"use client";

import { X } from "lucide-react";
import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { addTags } from "./tags";

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Ids from `Field`, so the inner input is labelled and described. */
  control: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined };
  /** How a tag reads on its chip, e.g. "de" → "German". */
  display?: (tag: string) => string;
  normalise?: (tag: string) => string;
  max?: number;
  placeholder?: string;
}

/**
 * A list typed as tags: Enter or a comma adds what was typed, pasting a list
 * adds every item, Backspace in the empty input removes the last tag.
 */
export function TagInput({ value, onChange, control, display = (tag) => tag, normalise, max, placeholder }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const full = max !== undefined && value.length >= max;

  const commit = (raw: string) => {
    if (!raw.trim()) return;
    const next = addTags(value, raw, { max, normalise });
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      if (!draft.trim()) {
        if (event.key === ",") event.preventDefault();
        return;
      }
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!/[,;\n]/.test(text)) return;
    event.preventDefault();
    commit(`${draft},${text}`);
  };

  return (
    <div
      className={cn(
        "input flex h-auto min-h-11 flex-wrap items-center gap-1.5 py-1.5 focus-within:border-ring focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_22%,transparent)]",
        control["aria-invalid"] && "border-destructive",
      )}
    >
      {value.map((tag) => (
        <span key={tag} className="chip h-8 gap-1 pr-1.5">
          {display(tag)}
          <button
            type="button"
            aria-label={`Remove ${display(tag)}`}
            onClick={() => onChange(value.filter((item) => item !== tag))}
            className="relative grid size-6 place-items-center rounded-full text-muted-foreground transition-colors after:absolute after:-inset-2 hover:bg-accent hover:text-foreground"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      ))}
      <input
        {...control}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => commit(draft)}
        disabled={full}
        placeholder={full ? `Up to ${max}` : placeholder}
        className="min-w-[8rem] flex-1 bg-transparent py-1 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
