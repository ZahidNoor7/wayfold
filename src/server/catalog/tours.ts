import "server-only";
import { and, asc, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { TenantScope } from "../db/context";
import {
  destinations,
  mediaAssets,
  tourCategories,
  tourDepartures,
  tourItineraryDays,
  tourMedia,
  tours,
  type TourSchedule,
} from "../db/schema";
import { ConflictError, ValidationError } from "../errors";
import { lockTourForCapacityChange, type ActiveBooking } from "./booking-locks";
import { listDepartures, type DepartureView } from "./departures";
import { bookingConflictErrors, completenessErrors, consistencyErrors, hasErrors } from "./rules";
import {
  containsPattern,
  findTourRow,
  invalid,
  lockCatalog,
  nextFreeSlug,
  parse,
  requireToday,
  slugSchema,
  slugify,
  text,
  timeSchema,
  withDeleteCheck,
  withReferenceCheck,
  type ReferenceMessages,
  type TourRow,
} from "./shared";

const TITLE_MAX = 160;

/** A list of short lines (highlights, inclusions, ...). Blank lines from a form are dropped. */
const lines = z
  .array(text(300))
  .max(60, "Keep this list to 60 lines.")
  .transform((items) => items.filter((item) => item.length > 0));

export const tourScheduleSchema = z
  .object({
    weekdays: z.array(z.int().min(1, "Weekdays run from 1 (Monday) to 7 (Sunday).").max(7, "Weekdays run from 1 (Monday) to 7 (Sunday).")).max(14),
    slots: z
      .array(
        z.object({
          time: timeSchema,
          capacity: z.int("Use a whole number of seats.").min(1, "Each start time needs at least 1 seat.").max(999, "Keep the seat count under 1,000."),
        }),
      )
      .max(24, "Keep this to 24 start times."),
  })
  .refine((schedule) => new Set(schedule.slots.map((slot) => slot.time)).size === schedule.slots.length, {
    error: "Each start time can only be listed once.",
    path: ["slots"],
  })
  .transform(
    (schedule): TourSchedule => ({
      weekdays: [...new Set(schedule.weekdays)].sort((a, b) => a - b),
      slots: [...schedule.slots].sort((a, b) => a.time.localeCompare(b.time)),
    }),
  );

const tourShape = {
  title: z.string().trim().min(3, "Add a title (3+ characters).").max(TITLE_MAX, `Keep the title under ${TITLE_MAX} characters.`),
  slug: slugSchema,
  summary: text(300),
  description: text(20_000),
  categoryId: z.uuid().nullable(),
  destinationId: z.uuid().nullable(),
  place: text(160),
  kind: z.enum(["day", "departure", "private"]),
  durationDays: z.int("Use a whole number of days.").min(1, "A tour lasts at least 1 day.").max(365, "Keep the length under a year."),
  durationLabel: text(60),
  /** Minor units of the tenant currency. */
  priceAdult: z.int("Enter the price in minor units (for example cents).").min(0, "The price cannot be negative.").max(100_000_000, "That price is too high."),
  childPricePercent: z.int().min(0, "Use a percentage from 0 to 100.").max(100, "Use a percentage from 0 to 100."),
  childMaxAge: z.int().min(0, "Use an age from 0 to 17.").max(17, "Use an age from 0 to 17."),
  minGroupSize: z.int().min(1, "A group has at least 1 guest.").max(99, "Groups are limited to 99 guests."),
  maxGroupSize: z.int().min(1, "A group has at least 1 guest.").max(99, "Groups are limited to 99 guests."),
  schedule: tourScheduleSchema,
  languages: z
    .array(text(40))
    .max(20, "Keep this to 20 languages.")
    .transform((items) => [...new Set(items.filter((item) => item.length > 0))]),
  highlights: lines,
  inclusions: lines,
  exclusions: lines,
  goodToKnow: lines,
  faq: z
    .array(
      z.object({
        question: z.string().trim().min(1, "Add the question.").max(300, "Keep the question under 300 characters."),
        answer: z.string().trim().min(1, "Add the answer.").max(2000, "Keep the answer under 2,000 characters."),
      }),
    )
    .max(40, "Keep this to 40 questions."),
  meetingPoint: text(300),
  meetingLatitude: z.number().min(-90, "Latitude is between -90 and 90.").max(90, "Latitude is between -90 and 90.").nullable(),
  meetingLongitude: z.number().min(-180, "Longitude is between -180 and 180.").max(180, "Longitude is between -180 and 180.").nullable(),
  cancellationPolicy: text(5000),
  coverMediaId: z.uuid().nullable(),
  isFeatured: z.boolean(),
  isPopular: z.boolean(),
  sortOrder: z.int().min(0).max(100_000),
};

export const updateTourSchema = z.object(tourShape).partial();
export const createTourSchema = updateTourSchema.extend({ title: tourShape.title });
export type CreateTourInput = z.input<typeof createTourSchema>;
export type UpdateTourInput = z.input<typeof updateTourSchema>;

export const itinerarySchema = z.object({
  days: z
    .array(
      z.object({
        dayNumber: z.int().min(1).max(365),
        title: z.string().trim().min(1, "Give each day a title.").max(160, "Keep day titles under 160 characters."),
        location: text(160).default(""),
        description: text(5000).default(""),
        meta: text(200).default(""),
      }),
    )
    .max(60, "Keep the itinerary to 60 days."),
});
export type ItineraryDayInput = z.input<typeof itinerarySchema>["days"][number];

export const tourMediaSchema = z.object({
  mediaIds: z
    .array(z.uuid())
    .max(60, "A tour can show up to 60 files.")
    .refine((ids) => new Set(ids).size === ids.length, { error: "Each file can only be added once." }),
});

export const listToursSchema = z.object({
  status: z.enum(["draft", "published", "archived"]).optional(),
  categoryId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  featured: z.boolean().optional(),
  limit: z.int().min(1).max(100).default(25),
  offset: z.int().min(0).default(0),
});
export type ListToursInput = z.input<typeof listToursSchema>;

export interface ItineraryDay {
  dayNumber: number;
  title: string;
  location: string;
  description: string;
  meta: string;
}

export interface TourMediaItem {
  mediaId: string;
  url: string;
  alt: string;
  resourceType: "image" | "video";
  width: number | null;
  height: number | null;
  sortOrder: number;
}

export interface NamedRef {
  id: string;
  name: string;
  slug: string;
}

/** Everything the dashboard editor needs about one tour. */
export interface TourDetail extends TourRow {
  category: NamedRef | null;
  destination: NamedRef | null;
  coverUrl: string | null;
  itinerary: ItineraryDay[];
  /** Gallery in display order; the first item is the cover. */
  media: TourMediaItem[];
  departures: DepartureView[];
}

export interface TourListItem {
  id: string;
  slug: string;
  title: string;
  status: TourRow["status"];
  kind: TourRow["kind"];
  place: string;
  categoryId: string | null;
  categoryName: string | null;
  destinationId: string | null;
  destinationName: string | null;
  durationDays: number;
  durationLabel: string;
  priceAdult: number;
  maxGroupSize: number;
  isFeatured: boolean;
  isPopular: boolean;
  coverUrl: string | null;
  mediaCount: number;
  publishedAt: Date | null;
  updatedAt: Date;
}

export interface TourCounts {
  published: number;
  draft: number;
  archived: number;
  /** Published tours shown in the featured section. */
  featured: number;
}

const REFERENCES: ReferenceMessages = {
  tours_category_fk: { field: "categoryId", message: "Choose one of your categories." },
  tours_destination_fk: { field: "destinationId", message: "Choose one of your destinations." },
  tours_cover_fk: { field: "coverMediaId", message: "Choose a cover image from your media library." },
  tour_media_media_fk: { field: "mediaIds", message: "One of the selected files is not in your media library." },
};

const tourFilter = (scope: TenantScope, id: string) => and(eq(tours.tenantId, scope.tenantId), eq(tours.id, id));

function assertValid(errors: Record<string, string[]>, message?: string): void {
  if (hasErrors(errors)) throw new ValidationError(message, errors);
}

/** Slugs of the tenant's other tours. Takes the catalogue lock so two writers cannot pick the same one. */
async function takenSlugs(scope: TenantScope, exceptId?: string): Promise<string[]> {
  await lockCatalog(scope);
  const rows = await scope.tx
    .select({ slug: tours.slug })
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), exceptId ? ne(tours.id, exceptId) : undefined));
  return rows.map((row) => row.slug);
}

/** Itinerary rows of one tour in day order. Tenant-filtered; does not check the tour exists. */
export async function readItinerary(scope: TenantScope, tourId: string): Promise<ItineraryDay[]> {
  return scope.tx
    .select({
      dayNumber: tourItineraryDays.dayNumber,
      title: tourItineraryDays.title,
      location: tourItineraryDays.location,
      description: tourItineraryDays.description,
      meta: tourItineraryDays.meta,
    })
    .from(tourItineraryDays)
    .where(and(eq(tourItineraryDays.tenantId, scope.tenantId), eq(tourItineraryDays.tourId, tourId)))
    .orderBy(asc(tourItineraryDays.dayNumber));
}

/** Gallery of one tour in display order. Tenant-filtered; does not check the tour exists. */
export async function readMedia(scope: TenantScope, tourId: string): Promise<TourMediaItem[]> {
  return scope.tx
    .select({
      mediaId: tourMedia.mediaId,
      url: mediaAssets.url,
      alt: mediaAssets.alt,
      resourceType: mediaAssets.resourceType,
      width: mediaAssets.width,
      height: mediaAssets.height,
      sortOrder: tourMedia.sortOrder,
    })
    .from(tourMedia)
    .innerJoin(mediaAssets, and(eq(mediaAssets.tenantId, tourMedia.tenantId), eq(mediaAssets.id, tourMedia.mediaId)))
    .where(and(eq(tourMedia.tenantId, scope.tenantId), eq(tourMedia.tourId, tourId)))
    .orderBy(asc(tourMedia.sortOrder));
}

/** Full editor view of one tour: fields, itinerary, ordered gallery and departures. */
export async function getTour(scope: TenantScope, id: string): Promise<TourDetail> {
  const row = await findTourRow(scope, id);
  const [refs] = await scope.tx
    .select({
      categoryName: tourCategories.name,
      categorySlug: tourCategories.slug,
      destinationName: destinations.name,
      destinationSlug: destinations.slug,
      coverUrl: mediaAssets.url,
    })
    .from(tours)
    .leftJoin(tourCategories, and(eq(tourCategories.tenantId, tours.tenantId), eq(tourCategories.id, tours.categoryId)))
    .leftJoin(destinations, and(eq(destinations.tenantId, tours.tenantId), eq(destinations.id, tours.destinationId)))
    .leftJoin(mediaAssets, and(eq(mediaAssets.tenantId, tours.tenantId), eq(mediaAssets.id, tours.coverMediaId)))
    .where(tourFilter(scope, row.id))
    .limit(1);

  return {
    ...row,
    category: row.categoryId && refs?.categoryName != null ? { id: row.categoryId, name: refs.categoryName, slug: refs.categorySlug! } : null,
    destination: row.destinationId && refs?.destinationName != null ? { id: row.destinationId, name: refs.destinationName, slug: refs.destinationSlug! } : null,
    coverUrl: refs?.coverUrl ?? null,
    itinerary: await readItinerary(scope, row.id),
    media: await readMedia(scope, row.id),
    departures: await listDepartures(scope, row.id),
  };
}

/** Creates a draft. Only a title is required; everything else can be filled in before publishing. */
export async function createTour(scope: TenantScope, input: CreateTourInput): Promise<TourDetail> {
  const data = parse(createTourSchema, input);
  assertValid(
    consistencyErrors({
      kind: data.kind ?? "private",
      durationDays: data.durationDays ?? 1,
      minGroupSize: data.minGroupSize ?? 1,
      maxGroupSize: data.maxGroupSize ?? 8,
      schedule: data.schedule ?? { weekdays: [], slots: [] },
      meetingLatitude: data.meetingLatitude ?? null,
      meetingLongitude: data.meetingLongitude ?? null,
    }),
  );

  const taken = await takenSlugs(scope);
  if (data.slug && taken.includes(data.slug)) throw invalid("slug", "Another tour already uses that web address.");
  const slug = data.slug ?? nextFreeSlug(slugify(data.title, "tour"), taken);

  const [row] = await withReferenceCheck(scope, REFERENCES, (tx) =>
    tx
      .insert(tours)
      .values({ ...data, tenantId: scope.tenantId, slug, status: "draft" })
      .returning({ id: tours.id }),
  );
  await recordAudit(scope, { action: "tour.created", targetType: "tour", targetId: row!.id, metadata: { title: data.title } });
  return getTour(scope, row!.id);
}

async function countDepartures(scope: TenantScope, tourId: string): Promise<number> {
  const [row] = await scope.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tourDepartures)
    .where(and(eq(tourDepartures.tenantId, scope.tenantId), eq(tourDepartures.tourId, tourId)));
  return row?.n ?? 0;
}

export interface UpdateTourOptions {
  /**
   * Today in the tenant's timezone. When given, bookings that ended before it
   * no longer restrict edits; without it every active booking counts.
   */
  today?: string;
}

/**
 * Changes any subset of fields. Rules that span fields are checked against
 * the merged result, and a published tour must stay complete. The slug only
 * changes when asked to, so links keep working after a retitle.
 *
 * An edit to the kind, schedule, length or party size changes what can be
 * booked, so it runs under the booking locks and is checked against the
 * tour's active bookings: it never leaves a booking the new values could not
 * hold.
 */
export async function updateTour(scope: TenantScope, id: string, input: UpdateTourInput, options: UpdateTourOptions = {}): Promise<TourDetail> {
  let existing = await findTourRow(scope, id);
  const patch = parse(updateTourSchema, input);
  if (Object.keys(patch).length === 0) throw new ValidationError("Nothing to change.");
  const from = options.today === undefined ? undefined : requireToday(options.today);

  let active: ActiveBooking[] = [];
  if (patch.kind !== undefined || patch.schedule !== undefined || patch.maxGroupSize !== undefined || patch.durationDays !== undefined) {
    // Catalogue lock first, so two such edits never take unit locks in opposite orders.
    await lockCatalog(scope);
    ({ tour: existing, active } = await lockTourForCapacityChange(scope, existing, from));
  }
  const changes: Partial<typeof tours.$inferInsert> = { ...patch };

  if (patch.kind !== undefined && patch.kind !== existing.kind) {
    // A booking's shape (time slot, departure, private range) follows the kind it was made under.
    if (active.length > 0) {
      throw new ConflictError("This tour has active bookings, so the way it is sold cannot change. Duplicate the tour instead.");
    }
    if (existing.kind === "departure" && (await countDepartures(scope, existing.id)) > 0) {
      throw invalid("kind", "Remove this tour’s departure dates before changing how it is sold.");
    }
    if (existing.kind === "day" && patch.schedule === undefined) {
      changes.schedule = { ...existing.schedule, slots: [] };
    }
  }

  const merged = { ...existing, ...changes } as TourRow;
  assertValid(consistencyErrors(merged));
  assertValid(bookingConflictErrors(existing, merged, active, changes.schedule !== undefined));
  if (existing.status === "published") {
    assertValid(completenessErrors(merged), "A published tour must stay complete. Unpublish it to save an unfinished version.");
  }

  if (patch.slug !== undefined && patch.slug !== existing.slug) {
    const taken = await takenSlugs(scope, existing.id);
    if (taken.includes(patch.slug)) throw invalid("slug", "Another tour already uses that web address.");
  }

  const tourId = existing.id;
  await withReferenceCheck(scope, REFERENCES, (tx) => tx.update(tours).set(changes).where(tourFilter(scope, tourId)));
  await recordAudit(scope, { action: "tour.updated", targetType: "tour", targetId: tourId, metadata: { fields: Object.keys(changes) } });
  return getTour(scope, tourId);
}

/**
 * Copies a tour with its itinerary and gallery into a new draft. Departures
 * and bookings belong to the original and are not copied.
 */
export async function duplicateTour(scope: TenantScope, id: string): Promise<TourDetail> {
  const source = await findTourRow(scope, id);
  const suffix = " (copy)";
  const title = `${source.title.slice(0, TITLE_MAX - suffix.length)}${suffix}`;
  const slug = nextFreeSlug(slugify(title, "tour"), await takenSlugs(scope));

  // `undefined` makes the database fill in a fresh id and timestamps.
  const [row] = await scope.tx
    .insert(tours)
    .values({
      ...source,
      id: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      title,
      slug,
      status: "draft",
      publishedAt: null,
      isFeatured: false,
      isPopular: false,
    })
    .returning({ id: tours.id });
  const copyId = row!.id;

  const days = await readItinerary(scope, source.id);
  if (days.length > 0) {
    await scope.tx.insert(tourItineraryDays).values(days.map((day) => ({ ...day, tenantId: scope.tenantId, tourId: copyId })));
  }
  const media = await readMedia(scope, source.id);
  if (media.length > 0) {
    await scope.tx
      .insert(tourMedia)
      .values(media.map((item) => ({ tenantId: scope.tenantId, tourId: copyId, mediaId: item.mediaId, sortOrder: item.sortOrder })));
  }

  await recordAudit(scope, { action: "tour.duplicated", targetType: "tour", targetId: copyId, metadata: { sourceId: source.id } });
  return getTour(scope, copyId);
}

/** Takes a tour off the website and out of the active list, keeping its bookings and history. */
export async function archiveTour(scope: TenantScope, id: string): Promise<TourRow> {
  const existing = await findTourRow(scope, id);
  if (existing.status === "archived") return existing;
  const [row] = (await scope.tx
    .update(tours)
    .set({ status: "archived", publishedAt: null, isFeatured: false })
    .where(tourFilter(scope, existing.id))
    .returning()) as [TourRow];
  await recordAudit(scope, { action: "tour.archived", targetType: "tour", targetId: existing.id, metadata: { wasPublished: existing.status === "published" } });
  return row;
}

/** Brings an archived tour back as a draft; publishing again is a separate, checked step. */
export async function restoreTour(scope: TenantScope, id: string): Promise<TourRow> {
  const existing = await findTourRow(scope, id);
  if (existing.status !== "archived") return existing;
  const [row] = (await scope.tx.update(tours).set({ status: "draft" }).where(tourFilter(scope, existing.id)).returning()) as [TourRow];
  await recordAudit(scope, { action: "tour.restored", targetType: "tour", targetId: existing.id });
  return row;
}

const HAS_BOOKINGS = "This tour has bookings, so it cannot be deleted. Archive it instead.";
const HAS_DISCOUNTS = "This tour has personal discounts or discount requests, so it cannot be deleted. Archive it instead.";

/** Foreign keys that keep a tour from being deleted, and what to tell the owner. */
const DELETE_BLOCKERS: Record<string, string> = {
  bookings_tour_fk: HAS_BOOKINGS,
  bookings_departure_fk: HAS_BOOKINGS,
  personal_discounts_tour_fk: HAS_DISCOUNTS,
  discount_requests_tour_fk: HAS_DISCOUNTS,
};

/**
 * Deletes a tour for good, with its itinerary, gallery links, departures and
 * availability blocks. Reviews, enquiries and journal entries that mention it
 * simply lose the link. Bookings and discounts carry money, so a tour that
 * has any is refused by its foreign keys and must be archived instead; the
 * database deciding means a booking placed at the same moment still counts.
 */
export async function deleteTour(scope: TenantScope, id: string): Promise<void> {
  const existing = await findTourRow(scope, id);
  await withDeleteCheck(
    scope,
    (constraint) => new ConflictError(DELETE_BLOCKERS[constraint ?? ""] ?? "This tour is still in use, so it cannot be deleted. Archive it instead."),
    (tx) => tx.delete(tours).where(tourFilter(scope, existing.id)),
  );
  await recordAudit(scope, { action: "tour.deleted", targetType: "tour", targetId: existing.id, metadata: { title: existing.title, status: existing.status } });
}

/** Replaces the whole itinerary. Days must be numbered 1, 2, 3, ... with no gaps or repeats. */
export async function replaceItinerary(scope: TenantScope, tourId: string, days: ItineraryDayInput[]): Promise<ItineraryDay[]> {
  const tour = await findTourRow(scope, tourId);
  const parsed = parse(itinerarySchema, { days }).days.sort((a, b) => a.dayNumber - b.dayNumber);
  if (parsed.some((day, index) => day.dayNumber !== index + 1)) {
    throw invalid("days", "Number the days 1, 2, 3 and so on, with no gaps or repeats.");
  }

  await scope.tx.delete(tourItineraryDays).where(and(eq(tourItineraryDays.tenantId, scope.tenantId), eq(tourItineraryDays.tourId, tour.id)));
  if (parsed.length > 0) {
    await scope.tx.insert(tourItineraryDays).values(parsed.map((day) => ({ ...day, tenantId: scope.tenantId, tourId: tour.id })));
  }
  return readItinerary(scope, tour.id);
}

/**
 * Sets the gallery to exactly `mediaIds`, in that order. The first file
 * becomes the cover; an empty list clears both gallery and cover.
 */
export async function setTourMedia(scope: TenantScope, tourId: string, mediaIds: string[]): Promise<TourMediaItem[]> {
  const tour = await findTourRow(scope, tourId);
  const parsed = parse(tourMediaSchema, { mediaIds }).mediaIds;

  await withReferenceCheck(scope, REFERENCES, async (tx) => {
    await tx.delete(tourMedia).where(and(eq(tourMedia.tenantId, scope.tenantId), eq(tourMedia.tourId, tour.id)));
    if (parsed.length > 0) {
      await tx.insert(tourMedia).values(parsed.map((mediaId, index) => ({ tenantId: scope.tenantId, tourId: tour.id, mediaId, sortOrder: index })));
    }
    await tx
      .update(tours)
      .set({ coverMediaId: parsed[0] ?? null })
      .where(tourFilter(scope, tour.id));
  });
  return readMedia(scope, tour.id);
}

/** Dashboard list: every status unless filtered, newest first within the manual order. */
export async function listTours(scope: TenantScope, input: ListToursInput = {}): Promise<{ items: TourListItem[]; total: number }> {
  const filters = parse(listToursSchema, input);
  const pattern = filters.search ? containsPattern(filters.search) : null;
  const where = and(
    eq(tours.tenantId, scope.tenantId),
    filters.status ? eq(tours.status, filters.status) : undefined,
    filters.categoryId ? eq(tours.categoryId, filters.categoryId) : undefined,
    filters.featured === undefined ? undefined : eq(tours.isFeatured, filters.featured),
    pattern ? or(ilike(tours.title, pattern), ilike(tours.place, pattern), ilike(tours.slug, pattern)) : undefined,
  );

  const mediaCounts = scope.tx
    .select({ tourId: tourMedia.tourId, n: sql<number>`count(*)::int`.as("n") })
    .from(tourMedia)
    .where(eq(tourMedia.tenantId, scope.tenantId))
    .groupBy(tourMedia.tourId)
    .as("tour_media_counts");

  const items = await scope.tx
    .select({
      id: tours.id,
      slug: tours.slug,
      title: tours.title,
      status: tours.status,
      kind: tours.kind,
      place: tours.place,
      categoryId: tours.categoryId,
      categoryName: tourCategories.name,
      destinationId: tours.destinationId,
      destinationName: destinations.name,
      durationDays: tours.durationDays,
      durationLabel: tours.durationLabel,
      priceAdult: tours.priceAdult,
      maxGroupSize: tours.maxGroupSize,
      isFeatured: tours.isFeatured,
      isPopular: tours.isPopular,
      coverUrl: mediaAssets.url,
      mediaCount: sql<number>`coalesce(${mediaCounts.n}, 0)`,
      publishedAt: tours.publishedAt,
      updatedAt: tours.updatedAt,
    })
    .from(tours)
    .leftJoin(tourCategories, and(eq(tourCategories.tenantId, tours.tenantId), eq(tourCategories.id, tours.categoryId)))
    .leftJoin(destinations, and(eq(destinations.tenantId, tours.tenantId), eq(destinations.id, tours.destinationId)))
    .leftJoin(mediaAssets, and(eq(mediaAssets.tenantId, tours.tenantId), eq(mediaAssets.id, tours.coverMediaId)))
    .leftJoin(mediaCounts, eq(mediaCounts.tourId, tours.id))
    .where(where)
    .orderBy(asc(tours.sortOrder), desc(tours.createdAt), asc(tours.id))
    .limit(filters.limit)
    .offset(filters.offset);

  const [count] = await scope.tx.select({ n: sql<number>`count(*)::int` }).from(tours).where(where);
  return { items, total: count?.n ?? 0 };
}

/** The numbers in the dashboard toolbar: "8 published · 1 draft · 4 featured". */
export async function getTourCounts(scope: TenantScope): Promise<TourCounts> {
  const rows = await scope.tx
    .select({ status: tours.status, isFeatured: tours.isFeatured, n: sql<number>`count(*)::int` })
    .from(tours)
    .where(eq(tours.tenantId, scope.tenantId))
    .groupBy(tours.status, tours.isFeatured);
  const counts: TourCounts = { published: 0, draft: 0, archived: 0, featured: 0 };
  for (const row of rows) {
    counts[row.status] += row.n;
    if (row.isFeatured && row.status === "published") counts.featured += row.n;
  }
  return counts;
}
