import { useId, type ReactNode } from "react";
import { Spinner } from "@/components/overlays";
import { cn } from "@/lib/utils";

interface FieldProps {
  label: string;
  /** Shown after the label in a quieter weight, e.g. "optional". */
  note?: string;
  hint?: string;
  error?: string | null;
  className?: string;
  /**
   * Render prop so the control receives the ids that tie it to its hint and
   * error message for screen readers.
   */
  children: (control: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined }) => ReactNode;
}

/** Label, control, hint and error, wired together. The error sits by the field. */
export function Field({ label, note, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="label">
        {label}
        {note ? <span className="ml-1.5 font-normal text-muted-foreground">{note}</span> : null}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? (
        <span id={errorId} role="alert" className="field-error">
          {error}
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

/** Form-level error: what went wrong, in the interface's own voice. */
export function FormError({ message, className }: { message?: string | null; className?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className={cn("alert alert-destructive", className)}>
      {message}
    </div>
  );
}

interface SubmitButtonProps {
  pending: boolean;
  children: ReactNode;
  /** Label while working, e.g. "Saving…". Defaults to the normal label. */
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
}

export function SubmitButton({ pending, children, pendingLabel, className, disabled }: SubmitButtonProps) {
  return (
    <button type="submit" className={cn("btn btn-default", className)} disabled={pending || disabled} aria-busy={pending || undefined}>
      {pending ? <Spinner /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

/** First message for a field from an ActionResult's fieldErrors. */
export function firstError(fieldErrors: Record<string, string[]> | undefined, name: string): string | null {
  return fieldErrors?.[name]?.[0] ?? null;
}
