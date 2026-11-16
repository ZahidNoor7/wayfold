import { z } from "zod";

/*
 * Pure helpers shared by the content editors (reviews, journal, site
 * content). No React and no server imports, so they run in the browser and
 * in unit tests alike.
 */

/** Help text for fields where people tend to paste formatted text. */
export const PLAIN_TEXT_HINT = "Plain text only: HTML tags such as <b> are refused. Line breaks are kept.";
export const PLAIN_LINE_HINT = "Plain text only: HTML tags are refused.";

const HTML_TAG = /<\/?[a-z!][^>]*>/i;

/** Mirrors the server's check: anything that looks like markup is refused. */
export function hasHtmlTag(value: string): boolean {
  return HTML_TAG.test(value);
}

export interface PlainTextRule {
  min?: number;
  minMessage?: string;
}

/**
 * Client copy of the server's plain-text rule, for immediate feedback. The
 * server validates again and its message is shown if it disagrees.
 */
export function plainTextField(max: number, rule: PlainTextRule = {}) {
  const min = rule.min ?? 0;
  return z
    .string()
    .refine((value) => value.trim().length >= min, rule.minMessage ?? (min === 1 ? "Fill this in or remove the row." : `Use at least ${min} characters.`))
    .refine((value) => value.trim().length <= max, `Keep this under ${max} characters.`)
    .refine((value) => !hasHtmlTag(value), "Plain text only: HTML tags are not allowed.");
}

/** "12 / 60": the length the server will count (trimmed). */
export function countLabel(value: string | null | undefined, max: number): string {
  return `${(value ?? "").trim().length} / ${max}`;
}

export function isOverLimit(value: string | null | undefined, max: number): boolean {
  return (value ?? "").trim().length > max;
}

/** A new array with the item at `from` moved to `to`. Out-of-range moves return an unchanged copy. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** A new array without the item at `index`. */
export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, position) => position !== index);
}

/** `2026-10-01` → `2026-10` for a month input; empty for anything else. */
export function dateToMonth(date: string | null | undefined): string {
  const match = /^(\d{4}-\d{2})-\d{2}$/.exec(date ?? "");
  return match ? match[1]! : "";
}

/** `2026-10` → `2026-10-01`; `null` for an empty or malformed month. */
export function monthToDate(month: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec((month ?? "").trim());
  if (!match) return null;
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;
  return `${match[1]}-${match[2]}-01`;
}

/**
 * Parses an optional number typed into a text box. Empty → `null` (cleared);
 * not a number → `undefined` (invalid, let validation say so).
 */
export function parseOptionalNumber(value: string | null | undefined): number | null | undefined {
  const text = (value ?? "").trim().replace(",", ".");
  if (text === "") return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(text)) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

/** A form value for a number that may be missing. */
export function numberToText(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : String(value);
}

/**
 * Where a server field error belongs in a list form whose rows live under
 * `items`. The server reports `3.label` (or `3` for a list of plain strings);
 * the form holds `items.3.label` (or `items.3.value`). A bare message for the
 * whole list (empty key or `form`) goes to `root`.
 */
export function listErrorPath(key: string, scalarKey?: string): string {
  if (key === "" || key === "form") return "root";
  const [index, ...rest] = key.split(".");
  if (!/^\d+$/.test(index ?? "")) return key;
  if (rest.length === 0) return scalarKey ? `items.${index}.${scalarKey}` : `items.${index}`;
  return `items.${index}.${rest.join(".")}`;
}

/** Every server field error as `[path, message]`, with each key mapped by `toPath`. */
export function serverErrorEntries(fieldErrors: Record<string, string[]> | undefined, toPath: (key: string) => string = (key) => key): [string, string][] {
  if (!fieldErrors) return [];
  return Object.entries(fieldErrors)
    .filter(([, messages]) => messages.length > 0)
    .map(([key, messages]) => [toPath(key), messages[0]!]);
}

/** Search-result style truncation: whole words, with an ellipsis. */
export function previewText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Host shown in a search preview: `https://acme.example.com` → `acme.example.com`. */
export function displayHost(origin: string): string {
  return origin.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/** Absolute storefront URL for a plain path. */
export function storefrontUrl(origin: string, path: string): string {
  const base = origin.replace(/\/+$/, "");
  return path === "/" ? `${base}/` : `${base}/${path.replace(/^\/+/, "")}`;
}
