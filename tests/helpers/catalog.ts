import { addDays } from "@/lib/dates";
import { createCategory, type CategoryView } from "@/server/catalog/categories";
import { addDeparture, type AddDepartureInput, type DepartureView } from "@/server/catalog/departures";
import { createDestination, type CreateDestinationInput, type DestinationView } from "@/server/catalog/destinations";
import { publishTour } from "@/server/catalog/publishing";
import { createTour, getTour, type CreateTourInput, type TourDetail } from "@/server/catalog/tours";
import { withTenant } from "@/server/db/context";
import { mediaAssets } from "@/server/db/schema";
import { unique } from "./fixtures";

/**
 * Catalogue factories. Everything is created through the catalogue services
 * inside `withTenant`, so fixtures obey the same rules as real data. The one
 * exception is media: uploads belong to the media module, so a library row is
 * inserted directly (still as the tenant, still under row-level security).
 */

/** A fixed "today in the tenant's timezone" so date rules are deterministic. */
export const FIXTURE_TODAY = "2031-03-10";

export interface FixtureOptions {
  /** Acting user recorded in the audit log. */
  userId?: string | null;
  today?: string;
}

export async function createMediaFixture(
  tenantId: string,
  overrides: Partial<typeof mediaAssets.$inferInsert> = {},
): Promise<{ id: string; url: string }> {
  const publicId = unique("media");
  return withTenant(tenantId, async ({ tx }) => {
    const [row] = await tx
      .insert(mediaAssets)
      .values({
        storageOwner: "platform",
        provider: "test",
        publicId,
        resourceType: "image",
        format: "jpg",
        url: `https://media.example.test/${publicId}.jpg`,
        alt: "Test image",
        ...overrides,
      })
      .returning({ id: mediaAssets.id, url: mediaAssets.url });
    return row!;
  });
}

export function createCategoryFixture(tenantId: string, name: string = unique("Category"), options: FixtureOptions = {}): Promise<CategoryView> {
  return withTenant(tenantId, (scope) => createCategory(scope, { name }), { userId: options.userId });
}

export function createDestinationFixture(
  tenantId: string,
  overrides: Partial<CreateDestinationInput> = {},
  options: FixtureOptions = {},
): Promise<DestinationView> {
  return withTenant(tenantId, (scope) => createDestination(scope, { name: unique("Destination"), ...overrides }), { userId: options.userId });
}

/** A draft tour. Only the title is filled in unless `overrides` say otherwise. */
export function createTourFixture(tenantId: string, overrides: Partial<CreateTourInput> = {}, options: FixtureOptions = {}): Promise<TourDetail> {
  return withTenant(tenantId, (scope) => createTour(scope, { title: `Tour ${unique("t")}`, ...overrides }), { userId: options.userId });
}

/** Field values that satisfy the publish checks for the given kind. */
export function completeTourInput(overrides: Partial<CreateTourInput> = {}): CreateTourInput {
  const kind = overrides.kind ?? "private";
  return {
    title: `Tour ${unique("t")}`,
    summary: "A small-group journey with a local guide.",
    kind,
    durationDays: kind === "day" ? 1 : 3,
    durationLabel: kind === "day" ? "6 hours" : "3 days",
    priceAdult: 69_000,
    ...(kind === "day" ? { schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [{ time: "09:00", capacity: 8 }] } } : {}),
    ...overrides,
  };
}

export function createDepartureFixture(
  tenantId: string,
  tourId: string,
  overrides: Partial<AddDepartureInput> = {},
  options: FixtureOptions = {},
): Promise<DepartureView> {
  const today = options.today ?? FIXTURE_TODAY;
  return withTenant(tenantId, (scope) => addDeparture(scope, tourId, { startDate: addDays(today, 30), capacity: 8, ...overrides }, { today }), {
    userId: options.userId,
  });
}

/**
 * A complete tour, published. `departure` tours get one upcoming departure
 * first, because publishing requires it.
 */
export function createPublishedTourFixture(tenantId: string, overrides: Partial<CreateTourInput> = {}, options: FixtureOptions = {}): Promise<TourDetail> {
  const today = options.today ?? FIXTURE_TODAY;
  return withTenant(
    tenantId,
    async (scope) => {
      const tour = await createTour(scope, completeTourInput(overrides));
      if (tour.kind === "departure") await addDeparture(scope, tour.id, { startDate: addDays(today, 30), capacity: 8 }, { today });
      await publishTour(scope, tour.id, { today });
      return getTour(scope, tour.id);
    },
    { userId: options.userId },
  );
}
