"use client";

import { X } from "lucide-react";
import { useId, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { splitEmails } from "@/lib/promotion-display";
import { cn } from "@/lib/utils";

interface EmailChipsProps {
  label: string;
  note?: string;
  hint?: string;
  value: string[];
  onChange: (emails: string[]) => void;
  /** Error from the form (for example "Add at least one customer email."). */
  error?: string | null;
  disabled?: boolean;
}

/**
 * E-mail addresses as removable chips. Typing a comma, space or Enter, pasting
 * a list, or leaving the field turns text into chips; anything that is not an
 * address stays in the field with an explanation.
 */
export function EmailChips({ label, note, hint, value, onChange, error, disabled }: EmailChipsProps) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState<string[]>([]);

  function commit(text: string) {
    const { added, invalid: rejected } = splitEmails(text, value);
    if (added.length > 0) onChange([...value, ...added]);
    setInvalid(rejected);
    setDraft(rejected.join(" "));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === " " || event.key === ";") {
      if (draft.trim() === "") {
        if (event.key === "Enter") event.preventDefault();
        return;
      }
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!/[\s,;]/.test(text.trim())) return;
    event.preventDefault();
    commit(`${draft} ${text}`);
  }

  const message =
    invalid.length > 0 ? `${invalid.map((token) => `“${token}”`).join(", ")} ${invalid.length === 1 ? "isn’t a valid e-mail address" : "aren’t valid e-mail addresses"}.` : error;
  const errorId = message ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="label">
        {label}
        {note ? <span className="ml-1.5 font-normal text-muted-foreground">{note}</span> : null}
      </label>
      <div
        className={cn(
          "input flex h-auto min-h-11 flex-wrap items-center gap-1.5 py-1.5",
          "focus-within:border-[var(--ring)] focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_22%,transparent)]",
          disabled && "opacity-55",
          message && "border-destructive focus-within:border-destructive",
        )}
      >
        {value.map((email) => (
          <span key={email} className="badge badge-secondary gap-1 font-mono text-xs">
            {email}
            <button
              type="button"
              onClick={() => onChange(value.filter((item) => item !== email))}
              disabled={disabled}
              aria-label={`Remove ${email}`}
              className="-mr-1 inline-flex size-5 items-center justify-center rounded-full hover:bg-foreground/10"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={draft}
          disabled={disabled}
          placeholder={value.length === 0 ? "name@example.com" : ""}
          onChange={(event) => {
            setDraft(event.target.value);
            if (invalid.length > 0) setInvalid([]);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => {
            if (draft.trim() !== "") commit(draft);
          }}
          aria-invalid={Boolean(message)}
          aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
          className="min-w-[12rem] flex-1 bg-transparent font-mono text-sm outline-none"
        />
      </div>
      {message ? (
        <span id={errorId} role="alert" className="field-error">
          {message}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
