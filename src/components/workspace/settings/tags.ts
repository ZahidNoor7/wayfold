/**
 * Helpers for list fields typed as tags (languages, regions): people paste
 * "en, de" or type one at a time, and duplicates are dropped quietly.
 */

/** Splits pasted or typed text on commas, semicolons and line breaks. */
export function splitTags(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Adds the tags in `raw` to `existing`, skipping ones already present
 * (ignoring case) and stopping at `max`. `normalise` canonicalises each one
 * first, e.g. language codes to `pt-BR`.
 */
export function addTags(existing: readonly string[], raw: string, options: { max?: number; normalise?: (tag: string) => string } = {}): string[] {
  const { max = Number.POSITIVE_INFINITY, normalise = (tag: string) => tag } = options;
  const next = [...existing];
  const seen = new Set(existing.map((tag) => tag.toLowerCase()));
  for (const part of splitTags(raw)) {
    if (next.length >= max) break;
    const tag = normalise(part);
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    next.push(tag);
  }
  return next;
}

/** `pt-br` → `pt-BR` when it is a language tag; otherwise the input, trimmed. */
export function canonicalLanguage(tag: string): string {
  try {
    return Intl.getCanonicalLocales(tag.trim())[0] ?? tag.trim();
  } catch {
    return tag.trim();
  }
}

/** "de" → "German", "pt-BR" → "Brazilian Portuguese". Falls back to the code itself. */
export function languageName(tag: string, locale = "en"): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** "EUR" → "Euro". Falls back to the code itself. */
export function currencyName(code: string, locale = "en"): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}
