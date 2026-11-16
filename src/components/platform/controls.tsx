"use client";

import { useId } from "react";
import type { LimitDraft } from "@/lib/platform-display";

interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** A labelled on/off switch. The whole row is the label, so it is easy to hit. */
export function Toggle({ label, hint, checked, disabled, onChange }: ToggleProps) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <span className="min-w-0">
        <span id={`${id}-label`} className="label block">
          {label}
        </span>
        {hint ? (
          <span id={`${id}-hint`} className="field-hint mt-1 block">
            {hint}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

interface LimitFieldProps {
  label: string;
  hint: string;
  /** Shown in the empty field, e.g. "Plan default: 5". */
  placeholder?: string;
  draft: LimitDraft;
  error?: string;
  onChange: (draft: LimitDraft) => void;
}

/** One limit: a whole number, or the Unlimited switch that replaces it. */
export function LimitField({ label, hint, placeholder, draft, error, onChange }: LimitFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <label htmlFor={id} id={`${id}-name`} className="label">
          {label}
        </label>
        <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <span id={`${id}-unlimited`}>Unlimited</span>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={draft.unlimited}
            aria-labelledby={`${id}-name ${id}-unlimited`}
            onClick={() => onChange({ ...draft, unlimited: !draft.unlimited })}
          >
            <span className="switch-thumb" />
          </button>
        </span>
      </div>
      <input
        id={id}
        className="input"
        inputMode="numeric"
        autoComplete="off"
        disabled={draft.unlimited}
        value={draft.unlimited ? "" : draft.value}
        placeholder={draft.unlimited ? "Unlimited" : placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        onChange={(event) => onChange({ ...draft, value: event.target.value })}
      />
      {error ? (
        <span id={`${id}-error`} role="alert" className="field-error">
          {error}
        </span>
      ) : (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}
