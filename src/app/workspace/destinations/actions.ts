"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import {
  createDestination,
  deleteDestination,
  reorderDestinations,
  updateDestination,
  type CreateDestinationInput,
  type UpdateDestinationInput,
} from "@/server/catalog/destinations";

/*
 * As with tours, these schemas only check the envelope. The catalogue service
 * validates each field and answers with one message per field for the form.
 */
const id = z.string().min(1).max(64);
const fields = z.record(z.string(), z.unknown());

/** Destinations are listed here, named in the tours list and offered in every tour editor. */
function revalidateDestinations(): void {
  revalidatePath("/workspace/destinations");
  revalidatePath("/workspace/tours");
  revalidatePath("/workspace/tours/new");
  revalidatePath("/workspace/tours/[id]", "page");
}

/** Field errors: `name`, `slug`, `region`, `tagline`, `description`, `coverMediaId`, `latitude`, `longitude`. */
export const createDestinationAction = workspaceAction("tours.manage", z.object({ destination: fields }), async ({ scope, input }) => {
  const destination = await createDestination(scope, input.destination as CreateDestinationInput);
  revalidateDestinations();
  return { id: destination.id, name: destination.name };
});

export const updateDestinationAction = workspaceAction("tours.manage", z.object({ id, destination: fields }), async ({ scope, input }) => {
  const destination = await updateDestination(scope, input.id, input.destination as UpdateDestinationInput);
  revalidateDestinations();
  return { id: destination.id, name: destination.name, isPublished: destination.isPublished };
});

export const reorderDestinationsAction = workspaceAction("tours.manage", z.object({ orderedIds: z.array(z.string()).max(500) }), async ({ scope, input }) => {
  const destinations = await reorderDestinations(scope, input.orderedIds);
  revalidateDestinations();
  return destinations.map((destination) => destination.id);
});

/** Refused with a "conflict" message while tours or other content still use the destination. */
export const deleteDestinationAction = workspaceAction("tours.manage", z.object({ id }), async ({ scope, input }) => {
  await deleteDestination(scope, input.id);
  revalidateDestinations();
  return { id: input.id };
});
