import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { TenantScope } from "../db/context";
import { destinations, mediaAssets, tours } from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  assertSameIds,
  invalid,
  lockCatalog,
  nextFreeSlug,
  parse,
  reorderSchema,
  requireId,
  slugSchema,
  slugify,
  text,
  withDeleteCheck,
  withReferenceCheck,
  type ReferenceMessages,
} from "./shared";

const destinationShape = {
  name: z.string().trim().min(2, "Add a destination name (2+ characters).").max(120, "Keep the name under 120 characters."),
  slug: slugSchema,
  region: text(120),
  tagline: text(200),
  description: text(5000),
  coverMediaId: z.uuid().nullable(),
  latitude: z.number().min(-90, "Latitude is between -90 and 90.").max(90, "Latitude is between -90 and 90.").nullable(),
  longitude: z.number().min(-180, "Longitude is between -180 and 180.").max(180, "Longitude is between -180 and 180.").nullable(),
  isPublished: z.boolean(),
  sortOrder: z.int().min(0).max(100_000),
};

export const updateDestinationSchema = z.object(destinationShape).partial();
export const createDestinationSchema = updateDestinationSchema.extend({ name: destinationShape.name });
export type CreateDestinationInput = z.input<typeof createDestinationSchema>;
export type UpdateDestinationInput = z.input<typeof updateDestinationSchema>;

export interface DestinationView {
  id: string;
  name: string;
  slug: string;
  region: string;
  tagline: string;
  description: string;
  coverMediaId: string | null;
  coverUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  isPublished: boolean;
  sortOrder: number;
  /** Tours of any status attached to the destination. */
  tourCount: number;
}

type Row = typeof destinations.$inferSelect;

const REFERENCES: ReferenceMessages = {
  destinations_cover_fk: { field: "coverMediaId", message: "Choose a cover image from your media library." },
};

async function findRow(scope: TenantScope, id: string): Promise<Row> {
  requireId(id, "Destination");
  const [row] = await scope.tx
    .select()
    .from(destinations)
    .where(and(eq(destinations.tenantId, scope.tenantId), eq(destinations.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("Destination");
  return row;
}

function assertCoordinates(latitude: number | null, longitude: number | null): void {
  if ((latitude === null) !== (longitude === null)) {
    throw invalid(latitude === null ? "latitude" : "longitude", "Give both a latitude and a longitude, or neither.");
  }
}

async function takenSlugs(scope: TenantScope, exceptId?: string): Promise<string[]> {
  await lockCatalog(scope);
  const rows = await scope.tx
    .select({ slug: destinations.slug })
    .from(destinations)
    .where(and(eq(destinations.tenantId, scope.tenantId), exceptId ? ne(destinations.id, exceptId) : undefined));
  return rows.map((row) => row.slug);
}

async function views(scope: TenantScope, id?: string): Promise<DestinationView[]> {
  const counts = scope.tx
    .select({ destinationId: tours.destinationId, n: sql<number>`count(*)::int`.as("n") })
    .from(tours)
    .where(eq(tours.tenantId, scope.tenantId))
    .groupBy(tours.destinationId)
    .as("destination_tours");
  return scope.tx
    .select({
      id: destinations.id,
      name: destinations.name,
      slug: destinations.slug,
      region: destinations.region,
      tagline: destinations.tagline,
      description: destinations.description,
      coverMediaId: destinations.coverMediaId,
      coverUrl: mediaAssets.url,
      latitude: destinations.latitude,
      longitude: destinations.longitude,
      isPublished: destinations.isPublished,
      sortOrder: destinations.sortOrder,
      tourCount: sql<number>`coalesce(${counts.n}, 0)`,
    })
    .from(destinations)
    .leftJoin(mediaAssets, and(eq(mediaAssets.tenantId, destinations.tenantId), eq(mediaAssets.id, destinations.coverMediaId)))
    .leftJoin(counts, eq(counts.destinationId, destinations.id))
    .where(and(eq(destinations.tenantId, scope.tenantId), id ? eq(destinations.id, id) : undefined))
    .orderBy(asc(destinations.sortOrder), asc(destinations.name));
}

/** Every destination of the workspace, published or not (dashboard). */
export function listDestinations(scope: TenantScope): Promise<DestinationView[]> {
  return views(scope);
}

export async function getDestination(scope: TenantScope, id: string): Promise<DestinationView> {
  requireId(id, "Destination");
  const [view] = await views(scope, id);
  if (!view) throw new NotFoundError("Destination");
  return view;
}

export async function createDestination(scope: TenantScope, input: CreateDestinationInput): Promise<DestinationView> {
  const data = parse(createDestinationSchema, input);
  assertCoordinates(data.latitude ?? null, data.longitude ?? null);

  const taken = await takenSlugs(scope);
  if (data.slug && taken.includes(data.slug)) throw invalid("slug", "Another destination already uses that web address.");
  const slug = data.slug ?? nextFreeSlug(slugify(data.name, "destination"), taken);

  let sortOrder = data.sortOrder;
  if (sortOrder === undefined) {
    const [last] = await scope.tx
      .select({ max: sql<number>`coalesce(max(${destinations.sortOrder}), -1)::int` })
      .from(destinations)
      .where(eq(destinations.tenantId, scope.tenantId));
    sortOrder = (last?.max ?? -1) + 1;
  }

  const [row] = await withReferenceCheck(scope, REFERENCES, (tx) =>
    tx
      .insert(destinations)
      .values({ ...data, tenantId: scope.tenantId, slug, sortOrder })
      .returning({ id: destinations.id }),
  );
  return getDestination(scope, row!.id);
}

/** Changes any subset of fields, including the publish flag and the cover image. */
export async function updateDestination(scope: TenantScope, id: string, input: UpdateDestinationInput): Promise<DestinationView> {
  const existing = await findRow(scope, id);
  const patch = parse(updateDestinationSchema, input);
  if (Object.keys(patch).length === 0) throw new ValidationError("Nothing to change.");
  assertCoordinates(
    patch.latitude !== undefined ? patch.latitude : existing.latitude,
    patch.longitude !== undefined ? patch.longitude : existing.longitude,
  );

  if (patch.slug !== undefined && patch.slug !== existing.slug) {
    const taken = await takenSlugs(scope, existing.id);
    if (taken.includes(patch.slug)) throw invalid("slug", "Another destination already uses that web address.");
  }

  await withReferenceCheck(scope, REFERENCES, (tx) =>
    tx
      .update(destinations)
      .set(patch)
      .where(and(eq(destinations.tenantId, scope.tenantId), eq(destinations.id, existing.id))),
  );
  return getDestination(scope, existing.id);
}

/** Stores a new order. `orderedIds` must list every destination of the workspace exactly once. */
export async function reorderDestinations(scope: TenantScope, orderedIds: string[]): Promise<DestinationView[]> {
  const parsed = parse(reorderSchema, { orderedIds });
  const existing = await scope.tx.select({ id: destinations.id }).from(destinations).where(eq(destinations.tenantId, scope.tenantId));
  assertSameIds(parsed.orderedIds, existing.map((row) => row.id), "orderedIds");
  for (const [index, destinationId] of parsed.orderedIds.entries()) {
    await scope.tx
      .update(destinations)
      .set({ sortOrder: index })
      .where(and(eq(destinations.tenantId, scope.tenantId), eq(destinations.id, destinationId)));
  }
  return listDestinations(scope);
}

export async function deleteDestination(scope: TenantScope, id: string): Promise<void> {
  const row = await findRow(scope, id);
  const [used] = await scope.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.destinationId, row.id)));
  const count = used?.n ?? 0;
  if (count > 0) {
    throw new ConflictError(`${count === 1 ? "1 tour is" : `${count} tours are`} attached to this destination. Move ${count === 1 ? "it" : "them"} first, or unpublish the destination instead.`);
  }
  // Journal entries can also point at a destination; that table is not ours to edit.
  await withDeleteCheck(
    scope,
    () => new ConflictError("This destination is still used by other content. Unpublish it instead."),
    (tx) => tx.delete(destinations).where(and(eq(destinations.tenantId, scope.tenantId), eq(destinations.id, row.id))),
  );
  await recordAudit(scope, { action: "destination.deleted", targetType: "destination", targetId: row.id, metadata: { name: row.name } });
}
