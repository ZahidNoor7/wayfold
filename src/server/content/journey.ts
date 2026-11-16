import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { TenantScope } from "../db/context";
import { destinations, journeyEntries, journeyEntryMedia, mediaAssets, tours } from "../db/schema";
import { NotFoundError } from "../errors";
import { guardedWrite, isoDate, likePattern, pageSchema, parseInput, plainText, requireId, slugify, type ConstraintMap, type Page } from "./shared";

export const MAX_ENTRY_PHOTOS = 40;

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/, "Use lower-case letters, numbers and hyphens.");

const fields = {
  title: plainText(160, { min: 3, minMessage: "Add a name (3+ characters)." }),
  /** Generated from the title when left out. Unique within the workspace. */
  slug,
  destinationId: z.uuid().nullable(),
  location: plainText(120),
  /** Calendar date of the visit; a month picker sends the first of the month. */
  visitedOn: isoDate.nullable(),
  category: plainText(60),
  teaser: plainText(240),
  description: plainText(6000, { multiline: true }),
  highlights: z.array(plainText(200, { min: 1 })).max(12, "Keep to 12 highlights."),
  coverMediaId: z.uuid().nullable(),
  relatedTourId: z.uuid().nullable(),
  /** Photo set in display order. Replaces the stored set when present. */
  mediaIds: z
    .array(z.uuid())
    .max(MAX_ENTRY_PHOTOS, `An entry holds up to ${MAX_ENTRY_PHOTOS} photos.`)
    .refine((ids) => new Set(ids).size === ids.length, "Each photo can be added once."),
  isPublished: z.boolean(),
};

// No Zod defaults: a default would also fire for an absent key and turn a
// partial update into a reset.
export const createJourneyEntrySchema = z.object(fields).partial().required({ title: true });
export const updateJourneyEntrySchema = z.object(fields).partial();
export type CreateJourneyEntryInput = z.input<typeof createJourneyEntrySchema>;
export type UpdateJourneyEntryInput = z.input<typeof updateJourneyEntrySchema>;

const CONSTRAINTS: ConstraintMap = {
  foreignKeys: {
    journey_entries_destination_fk: { field: "destinationId", message: "Choose one of your destinations." },
    journey_entries_cover_fk: { field: "coverMediaId", message: "Choose an image from your media library." },
    journey_entries_tour_fk: { field: "relatedTourId", message: "Choose one of your tours." },
    journey_entry_media_media_fk: { field: "mediaIds", message: "Choose photos from your media library." },
  },
  unique: {
    journey_entries_tenant_slug_key: "Another journal entry already uses that address.",
  },
};

export interface JourneyPhoto {
  id: string;
  url: string;
  alt: string;
  resourceType: "image" | "video";
  width: number | null;
  height: number | null;
}

export interface JourneyEntryView {
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
  photos: JourneyPhoto[];
  createdAt: Date;
  updatedAt: Date;
}

/** Ordered photo sets for a page of entries, in one query. */
async function loadPhotos(scope: TenantScope, entryIds: string[]): Promise<Map<string, JourneyPhoto[]>> {
  const byEntry = new Map<string, JourneyPhoto[]>();
  if (entryIds.length === 0) return byEntry;
  const rows = await scope.tx
    .select({
      entryId: journeyEntryMedia.entryId,
      id: mediaAssets.id,
      url: mediaAssets.url,
      alt: mediaAssets.alt,
      resourceType: mediaAssets.resourceType,
      width: mediaAssets.width,
      height: mediaAssets.height,
    })
    .from(journeyEntryMedia)
    .innerJoin(mediaAssets, and(eq(mediaAssets.tenantId, journeyEntryMedia.tenantId), eq(mediaAssets.id, journeyEntryMedia.mediaId)))
    .where(and(eq(journeyEntryMedia.tenantId, scope.tenantId), inArray(journeyEntryMedia.entryId, entryIds)))
    .orderBy(asc(journeyEntryMedia.sortOrder), asc(journeyEntryMedia.id));
  for (const { entryId, ...photo } of rows) {
    const list = byEntry.get(entryId) ?? [];
    list.push(photo);
    byEntry.set(entryId, list);
  }
  return byEntry;
}

const coverJoin = and(eq(mediaAssets.tenantId, journeyEntries.tenantId), eq(mediaAssets.id, journeyEntries.coverMediaId));

const viewColumns = {
  id: journeyEntries.id,
  title: journeyEntries.title,
  slug: journeyEntries.slug,
  destinationId: journeyEntries.destinationId,
  location: journeyEntries.location,
  visitedOn: journeyEntries.visitedOn,
  category: journeyEntries.category,
  teaser: journeyEntries.teaser,
  description: journeyEntries.description,
  highlights: journeyEntries.highlights,
  coverMediaId: journeyEntries.coverMediaId,
  coverUrl: mediaAssets.url,
  relatedTourId: journeyEntries.relatedTourId,
  isPublished: journeyEntries.isPublished,
  createdAt: journeyEntries.createdAt,
  updatedAt: journeyEntries.updatedAt,
};

export async function getJourneyEntry(scope: TenantScope, id: string): Promise<JourneyEntryView> {
  requireId(id, "Journal entry");
  const [row] = await scope.tx
    .select(viewColumns)
    .from(journeyEntries)
    .leftJoin(mediaAssets, coverJoin)
    .where(and(eq(journeyEntries.tenantId, scope.tenantId), eq(journeyEntries.id, id)))
    .limit(1);
  // Same answer whether the id is unknown or belongs to another workspace.
  if (!row) throw new NotFoundError("Journal entry");
  const photos = await loadPhotos(scope, [row.id]);
  return { ...row, photos: photos.get(row.id) ?? [] };
}

export const listJourneyEntriesSchema = z.object({
  published: z.boolean().optional(),
  destinationId: z.uuid().optional(),
  /** Matches title or location. */
  search: z.string().trim().max(100).optional(),
  ...pageSchema(50, 100),
});
export type ListJourneyEntriesInput = z.input<typeof listJourneyEntriesSchema>;

/** Dashboard list: drafts and published entries of the workspace. */
export async function listJourneyEntries(scope: TenantScope, input: ListJourneyEntriesInput = {}): Promise<Page<JourneyEntryView>> {
  const filters = parseInput(listJourneyEntriesSchema, input);
  const conditions: (SQL | undefined)[] = [eq(journeyEntries.tenantId, scope.tenantId)];
  if (filters.published !== undefined) conditions.push(eq(journeyEntries.isPublished, filters.published));
  if (filters.destinationId) conditions.push(eq(journeyEntries.destinationId, filters.destinationId));
  if (filters.search) {
    const pattern = likePattern(filters.search);
    conditions.push(or(ilike(journeyEntries.title, pattern), ilike(journeyEntries.location, pattern)));
  }
  const where = and(...conditions);

  const rows = await scope.tx
    .select(viewColumns)
    .from(journeyEntries)
    .leftJoin(mediaAssets, coverJoin)
    .where(where)
    .orderBy(sql`${journeyEntries.visitedOn} desc nulls last`, desc(journeyEntries.createdAt), desc(journeyEntries.id))
    .limit(filters.limit)
    .offset(filters.offset);
  const [totals] = await scope.tx.select({ total: count() }).from(journeyEntries).where(where);
  const photos = await loadPhotos(scope, rows.map((row) => row.id));
  return { items: rows.map((row) => ({ ...row, photos: photos.get(row.id) ?? [] })), total: totals?.total ?? 0 };
}

/**
 * A free slug for a new entry: the title's slug, or that with the lowest
 * unused numeric suffix. The unique index still has the last word.
 */
async function freeSlug(scope: TenantScope, title: string): Promise<string> {
  const base = slugify(title, 72) || "entry";
  const taken = await scope.tx
    .select({ slug: journeyEntries.slug })
    .from(journeyEntries)
    .where(and(eq(journeyEntries.tenantId, scope.tenantId), or(eq(journeyEntries.slug, base), like(journeyEntries.slug, `${base}-%`))));
  const used = new Set(taken.map((row) => row.slug));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

async function replaceMedia(tx: TenantScope["tx"], tenantId: string, entryId: string, mediaIds: string[]): Promise<void> {
  await tx.delete(journeyEntryMedia).where(and(eq(journeyEntryMedia.tenantId, tenantId), eq(journeyEntryMedia.entryId, entryId)));
  if (mediaIds.length === 0) return;
  await tx.insert(journeyEntryMedia).values(mediaIds.map((mediaId, index) => ({ tenantId, entryId, mediaId, sortOrder: index })));
}

/** New entries are drafts unless `isPublished` says otherwise. */
export async function createJourneyEntry(scope: TenantScope, input: CreateJourneyEntryInput): Promise<JourneyEntryView> {
  const data = parseInput(createJourneyEntrySchema, input);
  const entrySlug = data.slug ?? (await freeSlug(scope, data.title));

  const id = await guardedWrite(scope, CONSTRAINTS, async (tx) => {
    const [row] = await tx
      .insert(journeyEntries)
      .values({
        tenantId: scope.tenantId,
        title: data.title,
        slug: entrySlug,
        destinationId: data.destinationId ?? null,
        location: data.location ?? "",
        visitedOn: data.visitedOn ?? null,
        category: data.category ?? "",
        teaser: data.teaser ?? "",
        description: data.description ?? "",
        highlights: data.highlights ?? [],
        coverMediaId: data.coverMediaId ?? null,
        relatedTourId: data.relatedTourId ?? null,
        isPublished: data.isPublished ?? false,
      })
      .returning({ id: journeyEntries.id });
    if (data.mediaIds) await replaceMedia(tx, scope.tenantId, row!.id, data.mediaIds);
    return row!.id;
  });

  await recordAudit(scope, { action: "journey_entry.created", targetType: "journey_entry", targetId: id });
  return getJourneyEntry(scope, id);
}

async function assertEntry(scope: TenantScope, id: string): Promise<void> {
  requireId(id, "Journal entry");
  const [row] = await scope.tx
    .select({ id: journeyEntries.id })
    .from(journeyEntries)
    .where(and(eq(journeyEntries.tenantId, scope.tenantId), eq(journeyEntries.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("Journal entry");
}

export async function updateJourneyEntry(scope: TenantScope, id: string, input: UpdateJourneyEntryInput): Promise<JourneyEntryView> {
  const data = parseInput(updateJourneyEntrySchema, input);
  await assertEntry(scope, id);

  const { mediaIds, ...columns } = data;
  // Only keys the caller actually sent; everything else keeps its value.
  const patch = Object.fromEntries(Object.entries(columns).filter(([, value]) => value !== undefined));
  const changed = [...Object.keys(patch), ...(mediaIds ? ["mediaIds"] : [])];
  if (changed.length === 0) return getJourneyEntry(scope, id);

  await guardedWrite(scope, CONSTRAINTS, async (tx) => {
    if (Object.keys(patch).length > 0) {
      await tx
        .update(journeyEntries)
        .set(patch)
        .where(and(eq(journeyEntries.tenantId, scope.tenantId), eq(journeyEntries.id, id)));
    }
    if (mediaIds) await replaceMedia(tx, scope.tenantId, id, mediaIds);
  });

  await recordAudit(scope, { action: "journey_entry.updated", targetType: "journey_entry", targetId: id, metadata: { fields: changed } });
  return getJourneyEntry(scope, id);
}

/** Replaces the entry's photo set; array order is display order. */
export async function setJourneyEntryMedia(scope: TenantScope, id: string, mediaIds: string[]): Promise<JourneyEntryView> {
  return updateJourneyEntry(scope, id, { mediaIds });
}

/** Publishes an entry to the storefront, or moves it back to drafts. */
export async function setJourneyEntryPublished(scope: TenantScope, id: string, published: boolean): Promise<JourneyEntryView> {
  requireId(id, "Journal entry");
  const updated = await scope.tx
    .update(journeyEntries)
    .set({ isPublished: published })
    .where(and(eq(journeyEntries.tenantId, scope.tenantId), eq(journeyEntries.id, id)))
    .returning({ id: journeyEntries.id });
  if (updated.length === 0) throw new NotFoundError("Journal entry");
  await recordAudit(scope, {
    action: published ? "journey_entry.published" : "journey_entry.unpublished",
    targetType: "journey_entry",
    targetId: id,
  });
  return getJourneyEntry(scope, id);
}

/** Deletes the entry and its photo links. The media files stay in the library. */
export async function deleteJourneyEntry(scope: TenantScope, id: string): Promise<void> {
  requireId(id, "Journal entry");
  const deleted = await scope.tx
    .delete(journeyEntries)
    .where(and(eq(journeyEntries.tenantId, scope.tenantId), eq(journeyEntries.id, id)))
    .returning({ id: journeyEntries.id });
  if (deleted.length === 0) throw new NotFoundError("Journal entry");
  await recordAudit(scope, { action: "journey_entry.deleted", targetType: "journey_entry", targetId: id });
}

/** What a storefront may show of a journal entry. */
export interface PublicJourneyEntry {
  id: string;
  slug: string;
  title: string;
  location: string;
  visitedOn: string | null;
  category: string;
  teaser: string;
  description: string;
  highlights: string[];
  /** Present only while the destination is published. */
  destination: { id: string; slug: string; name: string } | null;
  cover: { url: string; alt: string; width: number | null; height: number | null } | null;
  /** Present only while the tour is published. */
  relatedTour: { id: string; slug: string; title: string } | null;
  photos: JourneyPhoto[];
  hasVideo: boolean;
}

const publicColumns = {
  id: journeyEntries.id,
  slug: journeyEntries.slug,
  title: journeyEntries.title,
  location: journeyEntries.location,
  visitedOn: journeyEntries.visitedOn,
  category: journeyEntries.category,
  teaser: journeyEntries.teaser,
  description: journeyEntries.description,
  highlights: journeyEntries.highlights,
  destinationId: destinations.id,
  destinationSlug: destinations.slug,
  destinationName: destinations.name,
  coverUrl: mediaAssets.url,
  coverAlt: mediaAssets.alt,
  coverWidth: mediaAssets.width,
  coverHeight: mediaAssets.height,
  tourId: tours.id,
  tourSlug: tours.slug,
  tourTitle: tours.title,
};

function publicQuery(scope: TenantScope) {
  return (
    scope.tx
      .select(publicColumns)
      .from(journeyEntries)
      .leftJoin(mediaAssets, coverJoin)
      // Unpublished destinations and tours must not surface through an entry.
      .leftJoin(
        destinations,
        and(eq(destinations.tenantId, journeyEntries.tenantId), eq(destinations.id, journeyEntries.destinationId), eq(destinations.isPublished, true)),
      )
      .leftJoin(tours, and(eq(tours.tenantId, journeyEntries.tenantId), eq(tours.id, journeyEntries.relatedTourId), eq(tours.status, "published")))
  );
}

type PublicRow = Awaited<ReturnType<typeof publicQuery>>[number];

function toPublic(row: PublicRow, photos: JourneyPhoto[]): PublicJourneyEntry {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    location: row.location,
    visitedOn: row.visitedOn,
    category: row.category,
    teaser: row.teaser,
    description: row.description,
    highlights: row.highlights,
    destination:
      row.destinationId && row.destinationSlug !== null && row.destinationName !== null
        ? { id: row.destinationId, slug: row.destinationSlug, name: row.destinationName }
        : null,
    cover: row.coverUrl !== null ? { url: row.coverUrl, alt: row.coverAlt ?? "", width: row.coverWidth, height: row.coverHeight } : null,
    relatedTour: row.tourId && row.tourSlug !== null && row.tourTitle !== null ? { id: row.tourId, slug: row.tourSlug, title: row.tourTitle } : null,
    photos,
    hasVideo: photos.some((photo) => photo.resourceType === "video"),
  };
}

export const listPublishedJourneyEntriesSchema = z.object({
  destinationId: z.uuid().optional(),
  category: z.string().trim().min(1).max(60).optional(),
  ...pageSchema(24, 60),
});
export type ListPublishedJourneyEntriesInput = z.input<typeof listPublishedJourneyEntriesSchema>;

/** Storefront list: published entries only, most recent visit first. */
export async function listPublishedJourneyEntries(
  scope: TenantScope,
  input: ListPublishedJourneyEntriesInput = {},
): Promise<Page<PublicJourneyEntry>> {
  const options = parseInput(listPublishedJourneyEntriesSchema, input);
  const conditions: SQL[] = [eq(journeyEntries.tenantId, scope.tenantId), eq(journeyEntries.isPublished, true)];
  if (options.destinationId) conditions.push(eq(journeyEntries.destinationId, options.destinationId));
  if (options.category) conditions.push(eq(journeyEntries.category, options.category));
  const where = and(...conditions);

  const rows = await publicQuery(scope)
    .where(where)
    .orderBy(sql`${journeyEntries.visitedOn} desc nulls last`, desc(journeyEntries.createdAt), desc(journeyEntries.id))
    .limit(options.limit)
    .offset(options.offset);
  const [totals] = await scope.tx.select({ total: count() }).from(journeyEntries).where(where);
  const photos = await loadPhotos(scope, rows.map((row) => row.id));
  return { items: rows.map((row) => toPublic(row, photos.get(row.id) ?? [])), total: totals?.total ?? 0 };
}

/** One published entry by slug. Drafts answer exactly like unknown slugs. */
export async function getPublishedJourneyEntry(scope: TenantScope, entrySlug: string): Promise<PublicJourneyEntry> {
  const [row] = await publicQuery(scope)
    .where(and(eq(journeyEntries.tenantId, scope.tenantId), eq(journeyEntries.slug, entrySlug.trim().toLowerCase()), eq(journeyEntries.isPublished, true)))
    .limit(1);
  if (!row) throw new NotFoundError("Journal entry");
  const photos = await loadPhotos(scope, [row.id]);
  return toPublic(row, photos.get(row.id) ?? []);
}
