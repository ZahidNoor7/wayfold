import "server-only";
import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { TenantScope } from "../db/context";
import { availabilityBlocks, tours } from "../db/schema";
import { NotFoundError } from "../errors";
import { findTourRow, isoDateSchema, parse, requireId, text } from "./shared";

export const availabilityBlockSchema = z
  .object({
    /** Null or absent blocks the whole business; an id blocks that tour only. */
    tourId: z.uuid().nullable().optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    reason: text(200).optional(),
  })
  .refine((block) => block.startDate <= block.endDate, { error: "The last day cannot be before the first day.", path: ["endDate"] });
export type AvailabilityBlockInput = z.input<typeof availabilityBlockSchema>;

export const listAvailabilityBlocksSchema = z.object({
  /** With a tour id: blocks that affect that tour (its own plus business-wide ones). */
  tourId: z.uuid().optional(),
  /** Keep only blocks that overlap `[from, to]`; either end may be open. */
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type ListAvailabilityBlocksInput = z.input<typeof listAvailabilityBlocksSchema>;

export interface AvailabilityBlockView {
  id: string;
  /** Null for a business-wide block. */
  tourId: string | null;
  tourTitle: string | null;
  startDate: string;
  endDate: string;
  reason: string;
}

async function view(scope: TenantScope, id: string): Promise<AvailabilityBlockView> {
  const [row] = await scope.tx
    .select({
      id: availabilityBlocks.id,
      tourId: availabilityBlocks.tourId,
      tourTitle: tours.title,
      startDate: availabilityBlocks.startDate,
      endDate: availabilityBlocks.endDate,
      reason: availabilityBlocks.reason,
    })
    .from(availabilityBlocks)
    .leftJoin(tours, and(eq(tours.tenantId, availabilityBlocks.tenantId), eq(tours.id, availabilityBlocks.tourId)))
    .where(and(eq(availabilityBlocks.tenantId, scope.tenantId), eq(availabilityBlocks.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("Availability block");
  return row;
}

/** Closes a date range (inclusive) for one tour, or for every tour when no tour is given. */
export async function addAvailabilityBlock(scope: TenantScope, input: AvailabilityBlockInput): Promise<AvailabilityBlockView> {
  const data = parse(availabilityBlockSchema, input);
  const tour = data.tourId ? await findTourRow(scope, data.tourId) : null;
  const [row] = await scope.tx
    .insert(availabilityBlocks)
    .values({
      tenantId: scope.tenantId,
      tourId: tour?.id ?? null,
      startDate: data.startDate,
      endDate: data.endDate,
      reason: data.reason ?? "",
    })
    .returning({ id: availabilityBlocks.id });
  return view(scope, row!.id);
}

export async function removeAvailabilityBlock(scope: TenantScope, id: string): Promise<void> {
  requireId(id, "Availability block");
  const removed = await scope.tx
    .delete(availabilityBlocks)
    .where(and(eq(availabilityBlocks.tenantId, scope.tenantId), eq(availabilityBlocks.id, id)))
    .returning({ id: availabilityBlocks.id });
  if (removed.length === 0) throw new NotFoundError("Availability block");
}

export async function listAvailabilityBlocks(scope: TenantScope, input: ListAvailabilityBlocksInput = {}): Promise<AvailabilityBlockView[]> {
  const filters = parse(listAvailabilityBlocksSchema, input);
  const tour = filters.tourId ? await findTourRow(scope, filters.tourId) : null;
  return scope.tx
    .select({
      id: availabilityBlocks.id,
      tourId: availabilityBlocks.tourId,
      tourTitle: tours.title,
      startDate: availabilityBlocks.startDate,
      endDate: availabilityBlocks.endDate,
      reason: availabilityBlocks.reason,
    })
    .from(availabilityBlocks)
    .leftJoin(tours, and(eq(tours.tenantId, availabilityBlocks.tenantId), eq(tours.id, availabilityBlocks.tourId)))
    .where(
      and(
        eq(availabilityBlocks.tenantId, scope.tenantId),
        tour ? or(eq(availabilityBlocks.tourId, tour.id), isNull(availabilityBlocks.tourId)) : undefined,
        filters.from ? gte(availabilityBlocks.endDate, filters.from) : undefined,
        filters.to ? lte(availabilityBlocks.startDate, filters.to) : undefined,
      ),
    )
    .orderBy(asc(availabilityBlocks.startDate), asc(availabilityBlocks.endDate), asc(availabilityBlocks.id));
}
