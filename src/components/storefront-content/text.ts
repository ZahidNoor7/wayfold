/**
 * Plain text written in the dashboard, prepared for display. Everything here
 * returns strings for React to render as text, so stored content can never
 * become markup.
 */

/**
 * Splits plain text into paragraphs (blank line between them), each a list of
 * lines (single line breaks are kept). Empty input gives no paragraphs.
 */
export function toParagraphs(text: string | null | undefined): string[][] {
  if (!text) return [];
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .filter((lines) => lines.length > 0);
}

const OPENING_QUOTES = /^["'“”‘’«‹„]/;

/** Wraps a quotation in typographic quote marks unless the author already added their own. */
export function quoted(text: string): string {
  const value = text.trim();
  if (!value) return "";
  return OPENING_QUOTES.test(value) ? value : `“${value}”`;
}

/** First non-empty string of the candidates, trimmed; empty when there is none. */
export function firstText(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
  return "";
}

/** Cuts text to a length that suits a meta description, on a word boundary. */
export function excerpt(text: string, max = 160): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** Tailwind needs whole class names, so the column count is looked up, never built. */
const LG_COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
};

/** Large-screen grid columns for a row of `count` items, capped at `max` per row. */
export function lgColumns(count: number, max = 5): string {
  const columns = Math.min(Math.max(Math.trunc(count) || 1, 1), Math.min(Math.max(max, 1), 5));
  return LG_COLUMNS[columns]!;
}

/**
 * How many journal covers the About mosaic shows. The design's mosaic is laid
 * out for six photos; with fewer, a single even row is used instead.
 */
export function mosaicPlan(available: number): { take: number; mosaic: boolean } {
  if (available >= 6) return { take: 6, mosaic: true };
  if (available >= 4) return { take: 4, mosaic: false };
  return { take: Math.max(available, 0), mosaic: false };
}
