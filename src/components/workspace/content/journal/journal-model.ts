import { z } from "zod";
import { firstParam, hrefWith, parsePage, enumParam, type SearchParams } from "@/lib/booking-display";
import { formatMonthYear } from "@/lib/review-display";
import type { MediaKind } from "@/lib/media-upload";
import { dateToMonth, monthToDate, plainTextField, storefrontUrl } from "../helpers";

/*
 * Pure logic for the journal editor: list URL parameters, form values and
 * the conversion to what the journey service accepts. No React, no server.
 */

export const JOURNAL_PATH = "/workspace/journal";
export const JOURNAL_PAGE_SIZE = 24;
export const MAX_HIGHLIGHTS = 12;
export const MAX_PHOTOS = 40;
export const MAX_SEARCH_LENGTH = 100;

export const JOURNAL_STATUSES = ["all", "published", "draft"] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];
export const JOURNAL_STATUS_LABELS: Record<JournalStatus, string> = { all: "All", published: "Published", draft: "Drafts" };

export interface JournalView {
  status: JournalStatus;
  q: string;
  page: number;
}

export function parseJournalParams(params: SearchParams): JournalView {
  return {
    status: enumParam(params.status, JOURNAL_STATUSES) ?? "all",
    q: (firstParam(params.q) ?? "").slice(0, MAX_SEARCH_LENGTH),
    page: parsePage(params.page),
  };
}

export function journalHref(view: Partial<JournalView> = {}): string {
  return hrefWith(JOURNAL_PATH, {
    status: view.status && view.status !== "all" ? view.status : undefined,
    q: view.q?.trim() || undefined,
    page: view.page && view.page > 1 ? view.page : undefined,
  });
}

export function entryHref(id: string): string {
  return `${JOURNAL_PATH}/${id}`;
}

/** Arguments for `listJourneyEntries`. */
export function journalListInput(view: JournalView): { published?: boolean; search?: string; limit: number; offset: number } {
  return {
    ...(view.status === "all" ? {} : { published: view.status === "published" }),
    ...(view.q.trim() ? { search: view.q.trim() } : {}),
    limit: JOURNAL_PAGE_SIZE,
    offset: (view.page - 1) * JOURNAL_PAGE_SIZE,
  };
}

/** Public address of an entry on the storefront. */
export function entryLiveUrl(origin: string, slug: string): string {
  return storefrontUrl(origin, `/journey/${slug}`);
}

/** "Sheki · Oct 2026 · 12 photos" (place and date fall back to "Undated" etc.). */
export function entryMeta(entry: { location: string; visitedOn: string | null; photoCount: number }): string {
  const parts: string[] = [];
  if (entry.location.trim()) parts.push(entry.location.trim());
  parts.push(formatMonthYear(entry.visitedOn) || "Undated");
  parts.push(`${entry.photoCount} ${entry.photoCount === 1 ? "photo" : "photos"}`);
  return parts.join(" · ");
}

/** Mirrors the server's slugify, to preview the address a blank slug will get. */
export function slugFromTitle(title: string, maxLength = 72): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/* ----------------------------------------------------------------- form */

export interface PhotoChoice {
  id: string;
  url: string;
  alt: string;
  resourceType: MediaKind;
}

export interface CoverChoice {
  id: string;
  url: string;
  alt?: string | null;
}

export interface JournalFormValues {
  title: string;
  slug: string;
  destinationId: string;
  location: string;
  visitedMonth: string;
  category: string;
  teaser: string;
  description: string;
  highlights: { value: string }[];
  cover: CoverChoice | null;
  photos: PhotoChoice[];
  relatedTourId: string;
  isPublished: boolean;
}

/** What the editor needs of a stored entry (a subset of the service's view). */
export interface JournalEntryData {
  id: string;
  title: string;
  slug: string;
  destinationId: string | null;
  location: string;
  visitedOn: string | null;
  category: string;
  teaser: string;
  description: string;
  highlights: string[];
  coverMediaId: string | null;
  coverUrl: string | null;
  relatedTourId: string | null;
  isPublished: boolean;
  photos: PhotoChoice[];
}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export const journalFormSchema = z.object({
  title: plainTextField(160, { min: 3, minMessage: "Add a name (3+ characters)." }),
  slug: z
    .string()
    .refine((value) => value.trim() === "" || SLUG_PATTERN.test(value.trim().toLowerCase()), "Use lower-case letters, numbers and hyphens (up to 80)."),
  destinationId: z.string(),
  location: plainTextField(120),
  visitedMonth: z.string().refine((value) => value.trim() === "" || monthToDate(value) !== null, "Choose a month, or leave it empty."),
  category: plainTextField(60),
  teaser: plainTextField(240),
  description: plainTextField(6000),
  highlights: z.array(z.object({ value: plainTextField(200, { min: 1 }) })).max(MAX_HIGHLIGHTS, `Keep to ${MAX_HIGHLIGHTS} highlights.`),
  cover: z.object({ id: z.string(), url: z.string(), alt: z.string().nullish() }).nullable(),
  photos: z
    .array(z.object({ id: z.string(), url: z.string(), alt: z.string(), resourceType: z.enum(["image", "video"]) }))
    .max(MAX_PHOTOS, `An entry holds up to ${MAX_PHOTOS} photos.`),
  relatedTourId: z.string(),
  isPublished: z.boolean(),
});

export function journalDefaults(entry: JournalEntryData | null): JournalFormValues {
  if (!entry) {
    return {
      title: "",
      slug: "",
      destinationId: "",
      location: "",
      visitedMonth: "",
      category: "",
      teaser: "",
      description: "",
      highlights: [],
      cover: null,
      photos: [],
      relatedTourId: "",
      isPublished: false,
    };
  }
  return {
    title: entry.title,
    slug: entry.slug,
    destinationId: entry.destinationId ?? "",
    location: entry.location,
    visitedMonth: dateToMonth(entry.visitedOn),
    category: entry.category,
    teaser: entry.teaser,
    description: entry.description,
    highlights: entry.highlights.map((value) => ({ value })),
    cover: entry.coverMediaId && entry.coverUrl ? { id: entry.coverMediaId, url: entry.coverUrl } : null,
    photos: entry.photos.map(({ id, url, alt, resourceType }) => ({ id, url, alt, resourceType })),
    relatedTourId: entry.relatedTourId ?? "",
    isPublished: entry.isPublished,
  };
}

/** Service input for create or update. A blank slug is left out: the server generates (or keeps) one. */
export function toJourneyInput(values: JournalFormValues): Record<string, unknown> {
  const slug = values.slug.trim().toLowerCase();
  return {
    title: values.title.trim(),
    ...(slug ? { slug } : {}),
    destinationId: values.destinationId || null,
    location: values.location.trim(),
    visitedOn: monthToDate(values.visitedMonth),
    category: values.category.trim(),
    teaser: values.teaser.trim(),
    description: values.description.trim(),
    highlights: values.highlights.map((row) => row.value.trim()),
    coverMediaId: values.cover?.id ?? null,
    relatedTourId: values.relatedTourId || null,
    mediaIds: values.photos.map((photo) => photo.id),
    isPublished: values.isPublished,
  };
}

const FIELD_MAP: Record<string, keyof JournalFormValues> = {
  visitedOn: "visitedMonth",
  coverMediaId: "cover",
  mediaIds: "photos",
};

/** Where a service field error belongs in the form (`highlights.3` → `highlights.3.value`). */
export function journalErrorPath(key: string): string {
  if (key === "" || key === "form") return "root";
  const [head, index] = key.split(".");
  if (head === "highlights" && index !== undefined && /^\d+$/.test(index)) return `highlights.${index}.value`;
  return FIELD_MAP[head ?? ""] ?? head ?? key;
}

/**
 * The photo set after the picker closes. The picker reports the full
 * selection with photos already in the set first, in their existing order,
 * so this only removes duplicates and keeps within the limit.
 */
export function pickedPhotos(picked: readonly PhotoChoice[]): PhotoChoice[] {
  const seen = new Set<string>();
  const out: PhotoChoice[] = [];
  for (const { id, url, alt, resourceType } of picked) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, url, alt, resourceType });
  }
  return out.slice(0, MAX_PHOTOS);
}
