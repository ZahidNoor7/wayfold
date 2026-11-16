import type { MediaKind } from "@/lib/media-upload";

/** Most photos and videos one review can carry; the reviews service enforces the same limit. */
export const REVIEW_MEDIA_LIMIT = 12;

/** A photo or video attached to a review, as the review form holds it. */
export interface ReviewMediaChoice {
  id: string;
  url: string;
  alt: string;
  resourceType: MediaKind;
}

/**
 * The attachments after the picker closes. The picker reports the full
 * selection with files already attached first, in their existing order, so
 * this only drops duplicates, keeps the fields the form needs and stays
 * within the limit.
 */
export function pickedReviewMedia(picked: readonly ReviewMediaChoice[]): ReviewMediaChoice[] {
  const seen = new Set<string>();
  const out: ReviewMediaChoice[] = [];
  for (const { id, url, alt, resourceType } of picked) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, url, alt, resourceType });
  }
  return out.slice(0, REVIEW_MEDIA_LIMIT);
}

/** Moves one attachment to a new position; out-of-range moves leave the list unchanged. */
export function moveReviewMedia<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Short summary for the field's counter, e.g. "2 photos, 1 video". */
export function describeReviewMedia(list: readonly { resourceType: MediaKind }[]): string {
  const videos = list.filter((item) => item.resourceType === "video").length;
  const photos = list.length - videos;
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} ${photos === 1 ? "photo" : "photos"}`);
  if (videos > 0) parts.push(`${videos} ${videos === 1 ? "video" : "videos"}`);
  return parts.length > 0 ? parts.join(", ") : "None attached";
}
