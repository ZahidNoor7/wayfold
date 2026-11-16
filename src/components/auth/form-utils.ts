import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

/**
 * Puts the server's field errors beside their fields and moves focus to the
 * first one, in the order the fields appear on screen. Returns true when at
 * least one error belonged to a field of this form.
 */
export function applyServerErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  fieldErrors: Record<string, string[]> | undefined,
  order: readonly Path<T>[],
): boolean {
  if (!fieldErrors) return false;
  let first: Path<T> | null = null;
  for (const name of order) {
    const message = fieldErrors[name]?.[0];
    if (!message) continue;
    form.setError(name, { type: "server", message });
    first ??= name;
  }
  if (first) form.setFocus(first);
  return first !== null;
}
