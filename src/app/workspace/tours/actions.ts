"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { todayIn } from "@/lib/dates";
import { workspaceAction } from "@/server/actions";
import { NotFoundError } from "@/server/errors";
import { addAvailabilityBlock, listAvailabilityBlocks, removeAvailabilityBlock, type AvailabilityBlockInput } from "@/server/catalog/availability";
import { createCategory, deleteCategory, renameCategory, reorderCategories } from "@/server/catalog/categories";
import { addDeparture, removeDeparture, updateDeparture, type AddDepartureInput, type UpdateDepartureInput } from "@/server/catalog/departures";
import { publishTour, unpublishTour } from "@/server/catalog/publishing";
import {
  archiveTour,
  createTour,
  deleteTour,
  duplicateTour,
  replaceItinerary,
  restoreTour,
  setTourMedia,
  updateTour,
  type CreateTourInput,
  type ItineraryDayInput,
  type UpdateTourInput,
} from "@/server/catalog/tours";

/*
 * The schemas here only check the envelope (ids, and that the payload is an
 * object or a list). The catalogue services validate every field themselves
 * and answer with one message per field, which is what the forms show; a
 * strict schema at this layer would collapse those into a single "tour" error.
 */
const id = z.string().min(1).max(64);
const fields = z.record(z.string(), z.unknown());

const LIST = "/workspace/tours";

function revalidateTour(tourId: string): void {
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${tourId}`);
}

/** Categories appear in the list's filter and in every tour editor. */
function revalidateCategories(): void {
  revalidatePath(LIST);
  revalidatePath(`${LIST}/new`);
  revalidatePath(`${LIST}/[id]`, "page");
}

/* ------------------------------------------------------------------ tours */

/**
 * Saves the whole editor in one transaction: the tour's own fields, its
 * itinerary and its gallery. Without `id` a new draft is created. If any part
 * is refused nothing is stored, so the form can simply be corrected and sent
 * again.
 *
 * Field errors use the service's names: tour fields (`title`, `slug`,
 * `priceAdult`, `schedule`, ...), `days` for the itinerary, `mediaIds` for
 * the gallery.
 */
export const saveTourAction = workspaceAction(
  "tours.manage",
  z.object({ id: id.optional(), tour: fields, itinerary: z.array(fields).max(60), mediaIds: z.array(z.string()).max(60) }),
  async ({ scope, input }) => {
    const tour = input.id ? await updateTour(scope, input.id, input.tour as UpdateTourInput) : await createTour(scope, input.tour as CreateTourInput);
    await replaceItinerary(scope, tour.id, input.itinerary as ItineraryDayInput[]);
    await setTourMedia(scope, tour.id, input.mediaIds);
    revalidateTour(tour.id);
    return { id: tour.id, slug: tour.slug, status: tour.status, created: !input.id };
  },
);

/** Completeness problems come back as field errors (`title`, `summary`, `priceAdult`, `durationLabel`, `schedule`, `departures`); a full plan as code `plan_limit`. */
export const publishTourAction = workspaceAction("tours.publish", z.object({ id }), async ({ scope, input, workspace }) => {
  const tour = await publishTour(scope, input.id, { today: todayIn(workspace.tenant.timezone) });
  revalidateTour(tour.id);
  return { id: tour.id, title: tour.title, status: tour.status };
});

export const unpublishTourAction = workspaceAction("tours.publish", z.object({ id }), async ({ scope, input }) => {
  const tour = await unpublishTour(scope, input.id);
  revalidateTour(tour.id);
  return { id: tour.id, title: tour.title, status: tour.status };
});

export const setTourFeaturedAction = workspaceAction("tours.manage", z.object({ id, featured: z.boolean() }), async ({ scope, input }) => {
  const tour = await updateTour(scope, input.id, { isFeatured: input.featured });
  revalidateTour(tour.id);
  return { id: tour.id, isFeatured: tour.isFeatured };
});

export const duplicateTourAction = workspaceAction("tours.manage", z.object({ id }), async ({ scope, input }) => {
  const copy = await duplicateTour(scope, input.id);
  revalidatePath(LIST);
  return { id: copy.id, title: copy.title };
});

export const archiveTourAction = workspaceAction("tours.manage", z.object({ id }), async ({ scope, input }) => {
  const tour = await archiveTour(scope, input.id);
  revalidateTour(tour.id);
  return { id: tour.id, title: tour.title };
});

export const restoreTourAction = workspaceAction("tours.manage", z.object({ id }), async ({ scope, input }) => {
  const tour = await restoreTour(scope, input.id);
  revalidateTour(tour.id);
  return { id: tour.id, title: tour.title };
});

/** Refused with a "conflict" message ("Archive it instead.") when the tour has bookings or is referenced elsewhere. */
export const deleteTourAction = workspaceAction("tours.manage", z.object({ id }), async ({ scope, input }) => {
  await deleteTour(scope, input.id);
  revalidateTour(input.id);
  return { id: input.id };
});

/* ------------------------------------------------------------- categories */

export const createCategoryAction = workspaceAction("tours.manage", z.object({ name: z.string() }), async ({ scope, input }) => {
  const category = await createCategory(scope, { name: input.name });
  revalidateCategories();
  return category;
});

export const renameCategoryAction = workspaceAction("tours.manage", z.object({ id, name: z.string() }), async ({ scope, input }) => {
  const category = await renameCategory(scope, input.id, { name: input.name });
  revalidateCategories();
  return category;
});

export const reorderCategoriesAction = workspaceAction("tours.manage", z.object({ orderedIds: z.array(z.string()).max(500) }), async ({ scope, input }) => {
  const categories = await reorderCategories(scope, input.orderedIds);
  revalidateCategories();
  return categories;
});

/** Refused with a "conflict" message while tours still use the category. */
export const deleteCategoryAction = workspaceAction("tours.manage", z.object({ id }), async ({ scope, input }) => {
  await deleteCategory(scope, input.id);
  revalidateCategories();
  return { id: input.id };
});

/* ------------------------------------------------------------- departures */

/** Field errors: `startDate`, `startTime`, `capacity`, `kind`. */
export const addDepartureAction = workspaceAction("tours.manage", z.object({ tourId: id, departure: fields }), async ({ scope, input, workspace }) => {
  const departure = await addDeparture(scope, input.tourId, input.departure as AddDepartureInput, { today: todayIn(workspace.tenant.timezone) });
  revalidateTour(input.tourId);
  return departure;
});

export const updateDepartureAction = workspaceAction("tours.manage", z.object({ id, tourId: id, departure: fields }), async ({ scope, input, workspace }) => {
  const departure = await updateDeparture(scope, input.id, input.departure as UpdateDepartureInput, { today: todayIn(workspace.tenant.timezone) });
  revalidateTour(input.tourId);
  return departure;
});

/** Refused with a "conflict" message when the departure has bookings. */
export const removeDepartureAction = workspaceAction("tours.manage", z.object({ id, tourId: id }), async ({ scope, input }) => {
  await removeDeparture(scope, input.id);
  revalidateTour(input.tourId);
  return { id: input.id };
});

/* ---------------------------------------------------- availability blocks */

/** Closes a date range for one tour. Field errors: `startDate`, `endDate`, `reason`. */
export const addAvailabilityBlockAction = workspaceAction("tours.manage", z.object({ tourId: id, block: fields }), async ({ scope, input }) => {
  // The tour comes from the envelope, never from the free-form fields.
  const block = await addAvailabilityBlock(scope, { ...(input.block as AvailabilityBlockInput), tourId: input.tourId });
  revalidateTour(input.tourId);
  return block;
});

/** Removes one of this tour's own blocks. Business-wide closures are not removable from a tour. */
export const removeAvailabilityBlockAction = workspaceAction("tours.manage", z.object({ id, tourId: id }), async ({ scope, input }) => {
  const blocks = await listAvailabilityBlocks(scope, { tourId: input.tourId });
  if (!blocks.some((block) => block.id === input.id && block.tourId === input.tourId)) throw new NotFoundError("Availability block");
  await removeAvailabilityBlock(scope, input.id);
  revalidateTour(input.tourId);
  return { id: input.id };
});
