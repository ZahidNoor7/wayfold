/**
 * First server message for a field. Services report nested problems with
 * dotted keys ("social.instagram", "languages.2"), so a list field also picks
 * up the errors of its items.
 */
export function errorFor(fieldErrors: Record<string, string[]> | undefined, name: string): string | null {
  if (!fieldErrors) return null;
  if (fieldErrors[name]?.[0]) return fieldErrors[name][0];
  const nested = Object.keys(fieldErrors).find((key) => key.startsWith(`${name}.`));
  return nested ? (fieldErrors[nested]?.[0] ?? null) : null;
}

/** True when the server named at least one of `names`, so the form-level message can stay quiet. */
export function hasFieldError(fieldErrors: Record<string, string[]> | undefined, names: readonly string[]): boolean {
  return names.some((name) => errorFor(fieldErrors, name) !== null);
}
