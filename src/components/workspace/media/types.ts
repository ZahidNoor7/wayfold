import type { MediaKind } from "@/lib/media-upload";

/**
 * A library file as the browser sees it: what is needed to show, pick and
 * describe it, and nothing about where or under which credentials it is stored.
 */
export interface MediaItem {
  id: string;
  url: string;
  alt: string;
  resourceType: MediaKind;
  format: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  originalFilename: string;
  folderId: string | null;
  /** Attribution required by the photo's licence; empty when none. */
  credit: string;
  creditUrl: string;
  /** ISO timestamp. */
  createdAt: string;
}

export interface MediaFolderItem {
  id: string;
  name: string;
  assetCount: number;
}

export interface MediaPageResult {
  items: MediaItem[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

export interface StorageUsageView {
  usedBytes: number;
  /** `null` = unlimited. */
  limitMb: number | null;
  assetCount: number;
}

interface AssetRow {
  id: string;
  url: string;
  alt: string;
  credit: string;
  creditUrl: string;
  resourceType: MediaKind;
  format: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  originalFilename: string;
  folderId: string | null;
  createdAt: Date;
}

/** Strips a stored row down to the fields the browser may have. */
export function toMediaItem(row: AssetRow): MediaItem {
  return {
    id: row.id,
    url: row.url,
    alt: row.alt,
    resourceType: row.resourceType,
    format: row.format,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    originalFilename: row.originalFilename,
    folderId: row.folderId,
    credit: row.credit,
    creditUrl: row.creditUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

/** What to call a file in lists: its name, else its description, else its kind. */
export function mediaLabel(item: Pick<MediaItem, "originalFilename" | "alt" | "resourceType">): string {
  return item.originalFilename || item.alt || (item.resourceType === "video" ? "Untitled video" : "Untitled image");
}
