import "server-only";
import type { TenantScope } from "@/server/db/context";
import { listDestinations } from "@/server/catalog/destinations";
import { listTours } from "@/server/catalog/tours";

export interface JournalOptions {
  destinations: { id: string; name: string }[];
  tours: { id: string; title: string }[];
}

/** Choices for the editor's destination and related-tour selects. */
export async function loadJournalOptions(scope: TenantScope): Promise<JournalOptions> {
  const destinations = await listDestinations(scope);
  const tours = await listTours(scope, { limit: 100 });
  return {
    destinations: destinations.map(({ id, name }) => ({ id, name })),
    tours: tours.items.filter((tour) => tour.status !== "archived").map(({ id, title }) => ({ id, title })),
  };
}
