/**
 * Languages offered as one-tap choices during setup, as BCP 47 codes with
 * their English names. Any other language can be added later in settings.
 */
export const COMMON_LANGUAGES: readonly { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "ru", name: "Russian" },
  { code: "tr", name: "Turkish" },
  { code: "ar", name: "Arabic" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "hi", name: "Hindi" },
  { code: "el", name: "Greek" },
  { code: "pl", name: "Polish" },
  { code: "uk", name: "Ukrainian" },
  { code: "az", name: "Azerbaijani" },
  { code: "ka", name: "Georgian" },
  { code: "he", name: "Hebrew" },
];

export const MAX_LANGUAGES = 12;
export const MAX_REGIONS = 30;

/** Chips to show: the common list, plus anything already saved that is not on it. */
export function languageChoices(saved: readonly string[]): { code: string; name: string }[] {
  const known = new Set(COMMON_LANGUAGES.map((language) => language.code));
  const extra = saved.filter((code) => !known.has(code)).map((code) => ({ code, name: code }));
  return [...COMMON_LANGUAGES, ...extra];
}

/** Adds or removes a language; the last one cannot be removed, and the list is capped. */
export function toggleLanguage(selected: readonly string[], code: string): string[] {
  if (selected.includes(code)) return selected.length > 1 ? selected.filter((item) => item !== code) : [...selected];
  return selected.length >= MAX_LANGUAGES ? [...selected] : [...selected, code];
}

/**
 * Adds typed regions to the list. Commas separate several at once; blanks,
 * repeats (ignoring case) and anything past the cap are dropped.
 */
export function addRegions(current: readonly string[], typed: string): string[] {
  const next = [...current];
  const seen = new Set(current.map((region) => region.toLowerCase()));
  for (const part of typed.split(",")) {
    const region = part.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!region || seen.has(region.toLowerCase()) || next.length >= MAX_REGIONS) continue;
    seen.add(region.toLowerCase());
    next.push(region);
  }
  return next;
}
