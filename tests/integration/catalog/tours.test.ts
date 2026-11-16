import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createCategory } from "@/server/catalog/categories";
import { addAvailabilityBlock, listAvailabilityBlocks } from "@/server/catalog/availability";
import { lockTourForCapacityChange } from "@/server/catalog/booking-locks";
import { addDeparture, listDepartures, removeDeparture } from "@/server/catalog/departures";
import { createDestination } from "@/server/catalog/destinations";
import { publishTour } from "@/server/catalog/publishing";
import {
  archiveTour,
  createTour,
  deleteTour,
  duplicateTour,
  getTour,
  getTourCounts,
  listTours,
  replaceItinerary,
  restoreTour,
  setTourMedia,
  updateTour,
} from "@/server/catalog/tours";
import { bookings, inquiries, journeyEntries, reviews, tourItineraryDays, tourMedia, tours } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { FIXTURE_TODAY, completeTourInput, createMediaFixture, createPublishedTourFixture, createTourFixture } from "../../helpers/catalog";
import { createTenant, randomId } from "../../helpers/fixtures";
import {
  as,
  auditActions,
  fieldErrors,
  rejection,
  seedBooking,
  seedDiscountRequest,
  seedPersonalDiscount,
  seedReview,
  seedTourMentions,
} from "./support";

const today = { today: FIXTURE_TODAY };

describe("creating tours", () => {
  it("creates a draft from a title alone, with the schema defaults", async () => {
    const tenant = await createTenant();
    const tour = await as(tenant, (scope) => createTour(scope, { title: "  Silk Road to Sheki  " }));

    expect(tour).toMatchObject({
      tenantId: tenant.tenantId,
      title: "Silk Road to Sheki",
      slug: "silk-road-to-sheki",
      status: "draft",
      publishedAt: null,
      kind: "private",
      durationDays: 1,
      priceAdult: 0,
      childPricePercent: 50,
      minGroupSize: 1,
      maxGroupSize: 8,
      schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [] },
      isFeatured: false,
      isPopular: false,
      category: null,
      destination: null,
      coverUrl: null,
      itinerary: [],
      media: [],
      departures: [],
    });
    expect(await auditActions(tenant, tour.id)).toEqual(["tour.created"]);
  });

  it("stores every field it is given", async () => {
    const tenant = await createTenant();
    const [category, destination, cover] = await Promise.all([
      as(tenant, (scope) => createCategory(scope, { name: "Cultural" })),
      as(tenant, (scope) => createDestination(scope, { name: "Sheki" })),
      createMediaFixture(tenant.tenantId),
    ]);

    const tour = await as(tenant, (scope) =>
      createTour(scope, {
        title: "Icherisheher & Flame Towers",
        summary: "Old city walls and the modern skyline.",
        description: "A walking tour.",
        categoryId: category.id,
        destinationId: destination.id,
        place: "Baku, Absheron",
        kind: "day",
        durationDays: 1,
        durationLabel: "6 hours",
        priceAdult: 12_000,
        childPricePercent: 40,
        childMaxAge: 12,
        minGroupSize: 2,
        maxGroupSize: 99,
        schedule: {
          weekdays: [6, 1, 6, 3],
          slots: [
            { time: "14:00", capacity: 8 },
            { time: "09:00", capacity: 6 },
          ],
        },
        languages: ["EN", "AZ", "", "EN"],
        highlights: ["Maiden Tower", "   ", "Palace of the Shirvanshahs"],
        inclusions: ["Guide"],
        exclusions: ["Lunch"],
        goodToKnow: ["Wear comfortable shoes"],
        faq: [{ question: " Is it suitable for children? ", answer: "Yes." }],
        meetingPoint: "Double Gates",
        meetingLatitude: 40.3667,
        meetingLongitude: 49.8352,
        cancellationPolicy: "Free cancellation up to 48 hours before.",
        coverMediaId: cover.id,
        isFeatured: true,
        isPopular: true,
        sortOrder: 3,
      }),
    );

    expect(tour).toMatchObject({
      summary: "Old city walls and the modern skyline.",
      place: "Baku, Absheron",
      kind: "day",
      durationLabel: "6 hours",
      priceAdult: 12_000,
      childPricePercent: 40,
      childMaxAge: 12,
      minGroupSize: 2,
      maxGroupSize: 99,
      // Weekdays are de-duplicated and sorted; slots are sorted by time.
      schedule: {
        weekdays: [1, 3, 6],
        slots: [
          { time: "09:00", capacity: 6 },
          { time: "14:00", capacity: 8 },
        ],
      },
      languages: ["EN", "AZ"],
      highlights: ["Maiden Tower", "Palace of the Shirvanshahs"],
      inclusions: ["Guide"],
      exclusions: ["Lunch"],
      goodToKnow: ["Wear comfortable shoes"],
      faq: [{ question: "Is it suitable for children?", answer: "Yes." }],
      meetingPoint: "Double Gates",
      meetingLatitude: 40.3667,
      meetingLongitude: 49.8352,
      cancellationPolicy: "Free cancellation up to 48 hours before.",
      coverMediaId: cover.id,
      coverUrl: cover.url,
      isFeatured: true,
      isPopular: true,
      sortOrder: 3,
      status: "draft",
      category: { id: category.id, name: "Cultural", slug: "cultural" },
      destination: { id: destination.id, name: "Sheki", slug: "sheki" },
    });
  });

  it("never lets input choose the status, tenant or publish time", async () => {
    const tenant = await createTenant();
    const other = await createTenant();
    const smuggled = { title: "Smuggled", status: "published", tenantId: other.tenantId, publishedAt: new Date(), id: randomId() };
    const tour = await as(tenant, (scope) => createTour(scope, smuggled as never));

    expect(tour).toMatchObject({ tenantId: tenant.tenantId, status: "draft", publishedAt: null });
    expect(tour.id).not.toBe(smuggled.id);
    expect((await as(other, (scope) => listTours(scope))).total).toBe(0);
  });

  it("rejects out-of-range field values", async () => {
    const tenant = await createTenant();
    const cases: [Record<string, unknown>, string][] = [
      [{ title: "ab" }, "title"],
      [{ title: "x".repeat(161) }, "title"],
      [{ kind: "weekly" }, "kind"],
      [{ durationDays: 0 }, "durationDays"],
      [{ durationDays: 1.5 }, "durationDays"],
      [{ priceAdult: -1 }, "priceAdult"],
      [{ priceAdult: 10.5 }, "priceAdult"],
      [{ childPricePercent: 101 }, "childPricePercent"],
      [{ childMaxAge: 18 }, "childMaxAge"],
      [{ minGroupSize: 0 }, "minGroupSize"],
      [{ maxGroupSize: 100 }, "maxGroupSize"],
      [{ minGroupSize: 6, maxGroupSize: 4 }, "maxGroupSize"],
      [{ schedule: { weekdays: [0], slots: [] } }, "schedule"],
      [{ schedule: { weekdays: [8], slots: [] } }, "schedule"],
      [{ kind: "day", schedule: { weekdays: [1], slots: [{ time: "9:00", capacity: 8 }] } }, "schedule"],
      [{ kind: "day", schedule: { weekdays: [1], slots: [{ time: "24:00", capacity: 8 }] } }, "schedule"],
      [{ kind: "day", schedule: { weekdays: [1], slots: [{ time: "09:00", capacity: 0 }] } }, "schedule"],
      [
        {
          kind: "day",
          schedule: {
            weekdays: [1],
            slots: [
              { time: "09:00", capacity: 8 },
              { time: "09:00", capacity: 4 },
            ],
          },
        },
        "schedule",
      ],
      [{ meetingLatitude: 90.1, meetingLongitude: 10 }, "meetingLatitude"],
      [{ meetingLatitude: 10, meetingLongitude: -180.1 }, "meetingLongitude"],
      [{ meetingLatitude: 10 }, "meetingLongitude"],
      [{ meetingLongitude: 10 }, "meetingLatitude"],
      [{ faq: [{ question: "", answer: "x" }] }, "faq"],
      [{ slug: "Bad Slug!" }, "slug"],
      [{ categoryId: "not-a-uuid" }, "categoryId"],
    ];
    for (const [fields, field] of cases) {
      const errors = await fieldErrors(() => as(tenant, (scope) => createTour(scope, { title: "Valid title", ...fields } as never)));
      expect(errors, JSON.stringify(fields)).toHaveProperty(field);
    }
    expect((await as(tenant, (scope) => listTours(scope))).total).toBe(0);
  });

  it("applies the cross-kind rules", async () => {
    const tenant = await createTenant();
    const slots = [{ time: "09:00", capacity: 8 }];

    // Start times belong to day tours only.
    for (const kind of ["private", "departure"] as const) {
      const errors = await fieldErrors(() => as(tenant, (scope) => createTour(scope, { title: "Mismatch", kind, schedule: { weekdays: [1], slots } })));
      expect(errors, kind).toHaveProperty("schedule");
    }
    // With no kind given the default is `private`, so slots are refused too.
    expect(await fieldErrors(() => as(tenant, (scope) => createTour(scope, { title: "Default kind", schedule: { weekdays: [1], slots } })))).toHaveProperty(
      "schedule",
    );
    // A day tour is one day long.
    expect(await fieldErrors(() => as(tenant, (scope) => createTour(scope, { title: "Long day", kind: "day", durationDays: 2 })))).toHaveProperty(
      "durationDays",
    );

    const day = await as(tenant, (scope) => createTour(scope, { title: "Proper day tour", kind: "day", schedule: { weekdays: [1], slots } }));
    expect(day.schedule.slots).toEqual(slots);
  });

  it("turns a foreign or unknown category, destination or cover into a field error", async () => {
    const tenant = await createTenant();
    const outcome = await as(tenant, async (scope) => ({
      category: await fieldErrors(() => createTour(scope, { title: "Ghost category", categoryId: randomId() })),
      destination: await fieldErrors(() => createTour(scope, { title: "Ghost destination", destinationId: randomId() })),
      cover: await fieldErrors(() => createTour(scope, { title: "Ghost cover", coverMediaId: randomId() })),
      // Each refusal was rolled back to its savepoint; the transaction still works.
      created: await createTour(scope, { title: "After the refusals" }),
    }));

    expect(outcome.category).toEqual({ categoryId: ["Choose one of your categories."] });
    expect(outcome.destination).toEqual({ destinationId: ["Choose one of your destinations."] });
    expect(outcome.cover).toEqual({ coverMediaId: ["Choose a cover image from your media library."] });
    expect((await as(tenant, (scope) => listTours(scope))).items.map((tour) => tour.title)).toEqual(["After the refusals"]);
    expect(outcome.created.slug).toBe("after-the-refusals");
  });
});

describe("tour slugs", () => {
  it("numbers colliding slugs -2, -3 and so on", async () => {
    const tenant = await createTenant();
    const slugs: string[] = [];
    for (let i = 0; i < 4; i += 1) slugs.push((await as(tenant, (scope) => createTour(scope, { title: "Sheki Weekend" }))).slug);
    expect(slugs).toEqual(["sheki-weekend", "sheki-weekend-2", "sheki-weekend-3", "sheki-weekend-4"]);
  });

  it("reuses a number that was freed, and steps around a taken suffix", async () => {
    const tenant = await createTenant();
    await as(tenant, (scope) => createTour(scope, { title: "Quba" }));
    await as(tenant, (scope) => createTour(scope, { title: "Something else", slug: "quba-2" }));
    expect((await as(tenant, (scope) => createTour(scope, { title: "Quba" }))).slug).toBe("quba-3");
  });

  it("gives every tour a distinct slug when identical titles are created at the same time", async () => {
    const tenant = await createTenant();
    const created = await Promise.all(Array.from({ length: 3 }, () => as(tenant, (scope) => createTour(scope, { title: "Same Title" }))));
    expect(created.map((tour) => tour.slug).sort()).toEqual(["same-title", "same-title-2", "same-title-3"]);
  });

  it("falls back to a generic slug for titles without Latin characters", async () => {
    const tenant = await createTenant();
    const first = await as(tenant, (scope) => createTour(scope, { title: "Шеки и Габала" }));
    const second = await as(tenant, (scope) => createTour(scope, { title: "Гянджа" }));
    expect([first.slug, second.slug]).toEqual(["tour", "tour-2"]);
  });

  it("accepts a chosen slug and refuses one already in use", async () => {
    const tenant = await createTenant();
    const chosen = await as(tenant, (scope) => createTour(scope, { title: "Fire & Stone", slug: " Fire-Tour " }));
    expect(chosen.slug).toBe("fire-tour");
    expect(await fieldErrors(() => as(tenant, (scope) => createTour(scope, { title: "Another fire tour", slug: "fire-tour" })))).toEqual({
      slug: ["Another tour already uses that web address."],
    });
  });

  it("keeps the slug on a retitle and changes it only when asked, to a free value", async () => {
    const tenant = await createTenant();
    const [a, b] = await as(tenant, async (scope) => [await createTour(scope, { title: "Alpha Tour" }), await createTour(scope, { title: "Beta Tour" })]);

    const retitled = await as(tenant, (scope) => updateTour(scope, a!.id, { title: "Alpha Tour, Renamed" }));
    expect(retitled).toMatchObject({ title: "Alpha Tour, Renamed", slug: "alpha-tour" });

    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, b!.id, { slug: "alpha-tour" })))).toHaveProperty("slug");
    expect((await as(tenant, (scope) => updateTour(scope, b!.id, { slug: "beta-tour" }))).slug).toBe("beta-tour");
    expect((await as(tenant, (scope) => updateTour(scope, b!.id, { slug: "beta-renamed" }))).slug).toBe("beta-renamed");
    // The old slug is free again.
    expect((await as(tenant, (scope) => createTour(scope, { title: "Beta Tour" }))).slug).toBe("beta-tour");
  });

  it("allows the same slug in two workspaces", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const inA = await as(a, (scope) => createTour(scope, { title: "Old City Walk" }));
    const inB = await as(b, (scope) => createTour(scope, { title: "Old City Walk" }));
    expect([inA.slug, inB.slug]).toEqual(["old-city-walk", "old-city-walk"]);
  });
});

describe("updating tours", () => {
  it("changes only the fields it is given and records which", async () => {
    const tenant = await createTenant();
    const tour = await as(tenant, (scope) => createTour(scope, { title: "Wine Route", priceAdult: 21_000, place: "Shamakhi" }));

    const updated = await as(tenant, (scope) => updateTour(scope, tour.id, { priceAdult: 23_000, isFeatured: true, highlights: ["Cellar visit"] }));
    expect(updated).toMatchObject({ title: "Wine Route", place: "Shamakhi", priceAdult: 23_000, isFeatured: true, highlights: ["Cellar visit"] });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(tour.updatedAt.getTime());
    expect(await auditActions(tenant, tour.id)).toEqual(["tour.created", "tour.updated"]);
  });

  it("refuses an empty change and unknown ids", async () => {
    const tenant = await createTenant();
    const tour = await createTourFixture(tenant.tenantId);
    expect(await rejection(() => as(tenant, (scope) => updateTour(scope, tour.id, {})))).toBeInstanceOf(ValidationError);
    // Unknown keys are stripped, so a payload of only forbidden fields is empty too.
    expect(await rejection(() => as(tenant, (scope) => updateTour(scope, tour.id, { status: "published" } as never)))).toBeInstanceOf(ValidationError);
    for (const id of [randomId(), "nope"]) {
      expect(await rejection(() => as(tenant, (scope) => updateTour(scope, id, { title: "Anything" })))).toBeInstanceOf(NotFoundError);
      expect(await rejection(() => as(tenant, (scope) => getTour(scope, id)))).toBeInstanceOf(NotFoundError);
    }
  });

  it("checks group sizes and coordinates against the stored values", async () => {
    const tenant = await createTenant();
    const tour = await as(tenant, (scope) => createTour(scope, { title: "Group rules", minGroupSize: 2, maxGroupSize: 6, meetingLatitude: 40, meetingLongitude: 49 }));

    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { minGroupSize: 7 })))).toHaveProperty("maxGroupSize");
    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { maxGroupSize: 1 })))).toHaveProperty("maxGroupSize");
    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { maxGroupSize: 100 })))).toHaveProperty("maxGroupSize");
    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { meetingLatitude: null })))).toHaveProperty("meetingLatitude");

    const ok = await as(tenant, (scope) => updateTour(scope, tour.id, { minGroupSize: 6, meetingLatitude: null, meetingLongitude: null }));
    expect(ok).toMatchObject({ minGroupSize: 6, maxGroupSize: 6, meetingLatitude: null, meetingLongitude: null });
  });

  it("turns an unknown reference into a field error on update", async () => {
    const tenant = await createTenant();
    const tour = await createTourFixture(tenant.tenantId);
    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { categoryId: randomId() })))).toHaveProperty("categoryId");
    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { destinationId: randomId() })))).toHaveProperty("destinationId");
    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { coverMediaId: randomId() })))).toHaveProperty("coverMediaId");
  });

  it("clears start times when a day tour becomes another kind", async () => {
    const tenant = await createTenant();
    const tour = await as(tenant, (scope) => createTour(scope, completeTourInput({ kind: "day" })));
    expect(tour.schedule.slots).toHaveLength(1);

    const changed = await as(tenant, (scope) => updateTour(scope, tour.id, { kind: "private", durationDays: 4 }));
    expect(changed).toMatchObject({ kind: "private", durationDays: 4, schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [] } });

    // Adding start times to a tour that is not a day tour is refused.
    const slots = [{ time: "08:00", capacity: 4 }];
    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { schedule: { weekdays: [6], slots } })))).toHaveProperty("schedule");
    // So is sending start times together with a change away from a day tour.
    await as(tenant, (scope) => updateTour(scope, tour.id, { kind: "day", durationDays: 1, schedule: { weekdays: [6], slots } }));
    expect(
      await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { kind: "departure", schedule: { weekdays: [6], slots } }))),
    ).toHaveProperty("schedule");
  });

  it("requires a multi-day tour to become one day before it can be a day tour", async () => {
    const tenant = await createTenant();
    const tour = await as(tenant, (scope) => createTour(scope, { title: "Three days", kind: "private", durationDays: 3 }));
    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { kind: "day" })))).toHaveProperty("durationDays");
    expect((await as(tenant, (scope) => updateTour(scope, tour.id, { kind: "day", durationDays: 1 }))).kind).toBe("day");
  });

  it("will not change how a tour is sold while it has departure dates", async () => {
    const tenant = await createTenant();
    const tour = await as(tenant, (scope) => createTour(scope, { title: "Scheduled", kind: "departure", durationDays: 3 }));
    const departure = await as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: "2031-05-01", capacity: 8 }, today));

    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { kind: "private" })))).toEqual({
      kind: ["Remove this tour’s departure dates before changing how it is sold."],
    });
    // Re-sending the same kind is not a change.
    expect((await as(tenant, (scope) => updateTour(scope, tour.id, { kind: "departure", place: "Sheki" }))).place).toBe("Sheki");

    await as(tenant, (scope) => removeDeparture(scope, departure.id));
    expect((await as(tenant, (scope) => updateTour(scope, tour.id, { kind: "private" }))).kind).toBe("private");
  });

  it("will not change how a tour is sold while it has active bookings", async () => {
    const tenant = await createTenant();
    const tour = await as(tenant, (scope) => createTour(scope, { title: "Booked private", kind: "private", durationDays: 1 }));
    const booking = await seedBooking(tenant, { tourId: tour.id, status: "pending" });

    expect(await rejection(() => as(tenant, (scope) => updateTour(scope, tour.id, { kind: "day" })))).toBeInstanceOf(ConflictError);
    // Other edits are unaffected.
    expect((await as(tenant, (scope) => updateTour(scope, tour.id, { priceAdult: 5000 }))).priceAdult).toBe(5000);

    // Once the booking is history, the kind can change.
    await as(tenant, ({ tx }) => tx.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id)));
    expect((await as(tenant, (scope) => updateTour(scope, tour.id, { kind: "day" }))).kind).toBe("day");
  });

  it("keeps a published tour complete", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "day" });

    const errors = await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { priceAdult: 0, summary: "" })));
    expect(Object.keys(errors).sort()).toEqual(["priceAdult", "summary"]);
    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { schedule: { weekdays: [1], slots: [] } })))).toHaveProperty("schedule");

    const stillLive = await as(tenant, (scope) => getTour(scope, tour.id));
    expect(stillLive).toMatchObject({ status: "published", priceAdult: 69_000 });
    // A draft may be saved incomplete.
    const draft = await as(tenant, (scope) => createTour(scope, completeTourInput()));
    expect((await as(tenant, (scope) => updateTour(scope, draft.id, { priceAdult: 0, summary: "" }))).priceAdult).toBe(0);
  });
});

describe("edits that change what can be booked", () => {
  const schedule = (capacity: number, weekdays = [1, 2, 3, 4, 5, 6, 7], extra: { time: string; capacity: number }[] = []) => ({
    weekdays,
    slots: [{ time: "09:00", capacity }, ...extra],
  });
  // 2031-04-09 is a Wednesday, 2031-04-12 a Saturday.
  async function bookedDayTour() {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "day", schedule: schedule(8, undefined, [{ time: "14:00", capacity: 8 }]) });
    await seedBooking(tenant, { tourId: tour.id, startDate: "2031-04-09", slotTime: "09:00", status: "confirmed", adults: 3 });
    await seedBooking(tenant, { tourId: tour.id, startDate: "2031-04-09", slotTime: "09:00", status: "pending", adults: 1, children: 1 });
    await seedBooking(tenant, { tourId: tour.id, startDate: "2031-04-12", slotTime: "14:00", status: "confirmed", adults: 1 });
    // History and cancellations hold no seats.
    await seedBooking(tenant, { tourId: tour.id, startDate: "2031-04-09", slotTime: "09:00", status: "cancelled", adults: 8 });
    await seedBooking(tenant, { tourId: tour.id, startDate: "2031-04-09", slotTime: "09:00", status: "completed", adults: 8 });
    return { tenant, tour };
  }
  const both = (morning: number, afternoon: number, weekdays?: number[]) => schedule(morning, weekdays, [{ time: "14:00", capacity: afternoon }]);

  it("will not cut a start time below the seats already booked, naming the date and time", async () => {
    const { tenant, tour } = await bookedDayTour();

    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { schedule: both(4, 8) })))).toEqual({
      schedule: ["5 seats are already booked at 09:00 on 2031-04-09."],
    });
    // Exactly enough is fine, and so is any increase.
    expect((await as(tenant, (scope) => updateTour(scope, tour.id, { schedule: both(5, 1) }))).schedule).toEqual(both(5, 1));
    expect((await as(tenant, (scope) => updateTour(scope, tour.id, { schedule: both(12, 8) }))).schedule).toEqual(both(12, 8));
  });

  it("will not drop a start time or a weekday that has bookings", async () => {
    const { tenant, tour } = await bookedDayTour();

    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { schedule: schedule(8) })))).toEqual({
      schedule: ["The 14:00 start time has bookings on 2031-04-12. Keep it, or move those bookings first."],
    });
    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { schedule: both(8, 8, [1, 2, 4, 5, 6, 7]) })))).toEqual({
      schedule: ["There are bookings on 2031-04-09, a Wednesday. Keep that day, or move those bookings first."],
    });
    // Every problem is reported at once, earliest date first.
    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { schedule: schedule(2, [1, 2, 3, 4, 5]) })))).toEqual({
      schedule: [
        "5 seats are already booked at 09:00 on 2031-04-09.",
        "There are bookings on 2031-04-12, a Saturday. Keep that day, or move those bookings first.",
      ],
    });
    // Dropping only the weekdays nobody booked is allowed.
    const trimmed = await as(tenant, (scope) => updateTour(scope, tour.id, { schedule: both(8, 8, [3, 6]) }));
    expect(trimmed.schedule.weekdays).toEqual([3, 6]);
  });

  it("ignores bookings that ended before `today` when one is given", async () => {
    const { tenant, tour } = await bookedDayTour();
    const cut = { schedule: both(4, 8) };

    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, cut, { today: "2031-04-09" })))).toHaveProperty("schedule");
    // By the 10th the five seats on the 9th are in the past; only the booking on the 12th still counts.
    expect((await as(tenant, (scope) => updateTour(scope, tour.id, cut, { today: "2031-04-10" }))).schedule).toEqual(cut.schedule);
    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { schedule: schedule(4) }, { today: "2031-04-10" })))).toHaveProperty("schedule");
    expect(await rejection(() => as(tenant, (scope) => updateTour(scope, tour.id, cut, { today: "soon" })))).toBeInstanceOf(RangeError);
  });

  it("does not let old bookings block an edit that leaves the schedule alone", async () => {
    const { tenant, tour } = await bookedDayTour();
    // Shrink a slot behind the service's back, as a legacy row might look.
    await as(tenant, ({ tx }) => tx.update(tours).set({ schedule: both(2, 8) }).where(eq(tours.id, tour.id)));

    const updated = await as(tenant, (scope) => updateTour(scope, tour.id, { maxGroupSize: 10, summary: "Still editable." }));
    expect(updated).toMatchObject({ maxGroupSize: 10, summary: "Still editable.", schedule: both(2, 8) });
  });

  it("will not lower the party size below a booked party", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "private", maxGroupSize: 8 });
    await seedBooking(tenant, { tourId: tour.id, startDate: "2031-05-01", status: "confirmed", adults: 4, children: 2 });
    await seedBooking(tenant, { tourId: tour.id, startDate: "2031-04-20", status: "pending", adults: 2 });

    expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { maxGroupSize: 5 })))).toEqual({
      maxGroupSize: ["A booking on 2031-05-01 has 6 guests. Move or cancel it before going below 6."],
    });
    expect((await as(tenant, (scope) => updateTour(scope, tour.id, { maxGroupSize: 6 }))).maxGroupSize).toBe(6);
    expect((await as(tenant, (scope) => updateTour(scope, tour.id, { maxGroupSize: 20 }))).maxGroupSize).toBe(20);
  });

  it("leaves party size alone on departure tours, where seats are limited per departure", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "departure" });
    const [departure] = await as(tenant, (scope) => listDepartures(scope, tour.id));
    await seedBooking(tenant, { tourId: tour.id, departureId: departure!.id, startDate: departure!.startDate, status: "confirmed", adults: 7 });

    expect((await as(tenant, (scope) => updateTour(scope, tour.id, { maxGroupSize: 4 }))).maxGroupSize).toBe(4);
  });

  it("will not change the length of a tour that has active bookings", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { kind: "private", durationDays: 3 });
    const booking = await seedBooking(tenant, { tourId: tour.id, startDate: "2031-05-01", status: "pending" });

    for (const durationDays of [2, 5]) {
      expect(await fieldErrors(() => as(tenant, (scope) => updateTour(scope, tour.id, { durationDays }))), String(durationDays)).toEqual({
        durationDays: ["A booking on 2031-05-01 was made for the current length. Move or cancel active bookings first, or duplicate the tour."],
      });
    }
    // Re-sending the current length is not a change.
    expect((await as(tenant, (scope) => updateTour(scope, tour.id, { durationDays: 3, durationLabel: "Three days" }))).durationLabel).toBe("Three days");

    await as(tenant, ({ tx }) => tx.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id)));
    expect((await as(tenant, (scope) => updateTour(scope, tour.id, { durationDays: 5 }))).durationDays).toBe(5);
  });

  it("answers not found when the tour is gone by the time its lock is taken", async () => {
    const tenant = await createTenant();
    const tour = await createTourFixture(tenant.tenantId);
    await as(tenant, (scope) => deleteTour(scope, tour.id));
    // What a capacity edit does after another request deleted the tour underneath it.
    expect(await rejection(() => as(tenant, (scope) => lockTourForCapacityChange(scope, { id: tour.id, kind: tour.kind })))).toBeInstanceOf(NotFoundError);
    expect(await rejection(() => as(tenant, (scope) => updateTour(scope, tour.id, { maxGroupSize: 4 })))).toBeInstanceOf(NotFoundError);
  });
});

describe("values the database also checks", () => {
  it("answers every out-of-range update with a field error, never a database error", async () => {
    const tenant = await createTenant();
    const tour = await as(tenant, (scope) => createTour(scope, { title: "Checked", minGroupSize: 2, maxGroupSize: 6 }));
    const cases: [Record<string, unknown>, string][] = [
      [{ priceAdult: -1 }, "priceAdult"],
      [{ childPricePercent: -1 }, "childPricePercent"],
      [{ childPricePercent: 101 }, "childPricePercent"],
      [{ durationDays: 0 }, "durationDays"],
      [{ durationDays: -2 }, "durationDays"],
      [{ minGroupSize: 0 }, "minGroupSize"],
      [{ maxGroupSize: 0 }, "maxGroupSize"],
      [{ maxGroupSize: 1 }, "maxGroupSize"],
      [{ minGroupSize: 7 }, "maxGroupSize"],
      [{ minGroupSize: 5, maxGroupSize: 4 }, "maxGroupSize"],
    ];
    await as(tenant, async (scope) => {
      for (const [patch, field] of cases) {
        // All in one transaction: a database error would have aborted it at the first case.
        expect(await fieldErrors(() => updateTour(scope, tour.id, patch as never)), JSON.stringify(patch)).toHaveProperty(field);
      }
      const edge = await updateTour(scope, tour.id, { priceAdult: 0, childPricePercent: 0, durationDays: 1, minGroupSize: 1, maxGroupSize: 1 });
      expect(edge).toMatchObject({ priceAdult: 0, childPricePercent: 0, durationDays: 1, minGroupSize: 1, maxGroupSize: 1 });
      expect((await updateTour(scope, tour.id, { childPricePercent: 100, minGroupSize: 99, maxGroupSize: 99 })).childPricePercent).toBe(100);
    });
  });

  it("applies the same limits when creating, and copies only valid rows when duplicating", async () => {
    const tenant = await createTenant();
    await as(tenant, async (scope) => {
      for (const [input, field] of [
        [{ childPricePercent: -1 }, "childPricePercent"],
        [{ durationDays: -1 }, "durationDays"],
        [{ minGroupSize: 9 }, "maxGroupSize"],
        [{ maxGroupSize: 0 }, "maxGroupSize"],
      ] as const) {
        expect(await fieldErrors(() => createTour(scope, { title: "Out of range", ...input })), JSON.stringify(input)).toHaveProperty(field);
      }
      const edge = await createTour(scope, { title: "At the limits", priceAdult: 0, childPricePercent: 100, minGroupSize: 99, maxGroupSize: 99 });
      const copy = await duplicateTour(scope, edge.id);
      expect(copy).toMatchObject({ priceAdult: 0, childPricePercent: 100, minGroupSize: 99, maxGroupSize: 99 });
    });
  });
});

describe("itinerary", () => {
  it("replaces the whole itinerary and returns it in day order", async () => {
    const tenant = await createTenant();
    const tour = await createTourFixture(tenant.tenantId);

    const first = await as(tenant, (scope) =>
      replaceItinerary(scope, tour.id, [
        { dayNumber: 2, title: "Palaces and halva", location: "Sheki", description: "Stained glass.", meta: "Walk 3 h" },
        { dayNumber: 1, title: "  Along the caravan road  " },
        { dayNumber: 3, title: "Coppersmiths of Lahij" },
      ]),
    );
    expect(first).toEqual([
      { dayNumber: 1, title: "Along the caravan road", location: "", description: "", meta: "" },
      { dayNumber: 2, title: "Palaces and halva", location: "Sheki", description: "Stained glass.", meta: "Walk 3 h" },
      { dayNumber: 3, title: "Coppersmiths of Lahij", location: "", description: "", meta: "" },
    ]);

    const second = await as(tenant, (scope) => replaceItinerary(scope, tour.id, [{ dayNumber: 1, title: "Only day" }]));
    expect(second).toHaveLength(1);
    expect((await as(tenant, (scope) => getTour(scope, tour.id))).itinerary).toEqual(second);

    expect(await as(tenant, (scope) => replaceItinerary(scope, tour.id, []))).toEqual([]);
  });

  it("requires day numbers to run 1, 2, 3 with no gaps or repeats", async () => {
    const tenant = await createTenant();
    const tour = await createTourFixture(tenant.tenantId);
    await as(tenant, (scope) => replaceItinerary(scope, tour.id, [{ dayNumber: 1, title: "Kept" }]));

    const day = (dayNumber: number) => ({ dayNumber, title: `Day ${dayNumber}` });
    for (const numbers of [[2, 3], [1, 3], [1, 1], [0, 1], [1, 2, 4], [1.5]]) {
      const errors = await fieldErrors(() => as(tenant, (scope) => replaceItinerary(scope, tour.id, numbers.map(day))));
      expect(errors, JSON.stringify(numbers)).toHaveProperty("days");
    }
    expect(await fieldErrors(() => as(tenant, (scope) => replaceItinerary(scope, tour.id, [{ dayNumber: 1, title: " " }])))).toHaveProperty("days");
    // A refused replacement leaves the previous itinerary in place.
    expect((await as(tenant, (scope) => getTour(scope, tour.id))).itinerary.map((item) => item.title)).toEqual(["Kept"]);
    expect(await rejection(() => as(tenant, (scope) => replaceItinerary(scope, randomId(), [day(1)])))).toBeInstanceOf(NotFoundError);
  });
});

describe("tour media", () => {
  it("keeps the given order and makes the first file the cover", async () => {
    const tenant = await createTenant();
    const tour = await createTourFixture(tenant.tenantId);
    const [a, b, c] = await Promise.all([createMediaFixture(tenant.tenantId), createMediaFixture(tenant.tenantId), createMediaFixture(tenant.tenantId)]);

    const set = await as(tenant, (scope) => setTourMedia(scope, tour.id, [c!.id, a!.id, b!.id]));
    expect(set.map((item) => [item.mediaId, item.sortOrder])).toEqual([
      [c!.id, 0],
      [a!.id, 1],
      [b!.id, 2],
    ]);
    expect(set[0]).toMatchObject({ url: c!.url, alt: "Test image", resourceType: "image" });

    let detail = await as(tenant, (scope) => getTour(scope, tour.id));
    expect(detail).toMatchObject({ coverMediaId: c!.id, coverUrl: c!.url });
    expect(detail.media.map((item) => item.mediaId)).toEqual([c!.id, a!.id, b!.id]);

    // Reordering and dropping a file replaces the set and moves the cover.
    await as(tenant, (scope) => setTourMedia(scope, tour.id, [b!.id, c!.id]));
    detail = await as(tenant, (scope) => getTour(scope, tour.id));
    expect(detail.media.map((item) => item.mediaId)).toEqual([b!.id, c!.id]);
    expect(detail.coverMediaId).toBe(b!.id);
    expect((await as(tenant, (scope) => listTours(scope))).items[0]).toMatchObject({ mediaCount: 2, coverUrl: b!.url });

    expect(await as(tenant, (scope) => setTourMedia(scope, tour.id, []))).toEqual([]);
    expect(await as(tenant, (scope) => getTour(scope, tour.id))).toMatchObject({ coverMediaId: null, coverUrl: null, media: [] });
  });

  it("refuses repeats, malformed ids and files outside the library, changing nothing", async () => {
    const tenant = await createTenant();
    const tour = await createTourFixture(tenant.tenantId);
    const [a, b] = await Promise.all([createMediaFixture(tenant.tenantId), createMediaFixture(tenant.tenantId)]);
    await as(tenant, (scope) => setTourMedia(scope, tour.id, [a!.id, b!.id]));

    expect(await fieldErrors(() => as(tenant, (scope) => setTourMedia(scope, tour.id, [a!.id, a!.id])))).toEqual({
      mediaIds: ["Each file can only be added once."],
    });
    expect(await fieldErrors(() => as(tenant, (scope) => setTourMedia(scope, tour.id, ["nope"])))).toHaveProperty("mediaIds");

    const after = await as(tenant, async (scope) => {
      const errors = await fieldErrors(() => setTourMedia(scope, tour.id, [b!.id, randomId()]));
      return { errors, detail: await getTour(scope, tour.id) };
    });
    expect(after.errors).toEqual({ mediaIds: ["One of the selected files is not in your media library."] });
    // The delete inside the refused call was rolled back with it.
    expect(after.detail.media.map((item) => item.mediaId)).toEqual([a!.id, b!.id]);
    expect(after.detail.coverMediaId).toBe(a!.id);
    expect(await rejection(() => as(tenant, (scope) => setTourMedia(scope, randomId(), [a!.id])))).toBeInstanceOf(NotFoundError);
  });
});

describe("duplicating, archiving and deleting", () => {
  it("copies a tour with its itinerary and gallery into a new draft", async () => {
    const tenant = await createTenant();
    const media = await createMediaFixture(tenant.tenantId);
    const source = await createPublishedTourFixture(tenant.tenantId, { title: "Silk Road", kind: "departure", isFeatured: true, isPopular: true });
    await as(tenant, async (scope) => {
      await replaceItinerary(scope, source.id, [
        { dayNumber: 1, title: "Day one" },
        { dayNumber: 2, title: "Day two" },
      ]);
      await setTourMedia(scope, source.id, [media.id]);
    });

    const copy = await as(tenant, (scope) => duplicateTour(scope, source.id));
    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({
      title: "Silk Road (copy)",
      slug: "silk-road-copy",
      status: "draft",
      publishedAt: null,
      isFeatured: false,
      isPopular: false,
      kind: "departure",
      priceAdult: source.priceAdult,
      summary: source.summary,
      coverMediaId: media.id,
      // Dates belong to the original.
      departures: [],
    });
    expect(copy.itinerary.map((day) => day.title)).toEqual(["Day one", "Day two"]);
    expect(copy.media.map((item) => item.mediaId)).toEqual([media.id]);
    expect(copy.createdAt.getTime()).toBeGreaterThanOrEqual(source.createdAt.getTime());

    const again = await as(tenant, (scope) => duplicateTour(scope, source.id));
    expect(again.slug).toBe("silk-road-copy-2");
    expect(await auditActions(tenant, copy.id)).toEqual(["tour.duplicated"]);

    // The original is untouched.
    expect(await as(tenant, (scope) => getTour(scope, source.id))).toMatchObject({ status: "published", isFeatured: true, title: "Silk Road" });
    expect(await rejection(() => as(tenant, (scope) => duplicateTour(scope, randomId())))).toBeInstanceOf(NotFoundError);
  });

  it("keeps a duplicated title within the length limit", async () => {
    const tenant = await createTenant();
    const source = await as(tenant, (scope) => createTour(scope, { title: "T".repeat(160) }));
    const copy = await as(tenant, (scope) => duplicateTour(scope, source.id));
    expect(copy.title).toHaveLength(160);
    expect(copy.title.endsWith(" (copy)")).toBe(true);
  });

  it("archives a tour off the site and restores it as a draft", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, { isFeatured: true });

    const archived = await as(tenant, (scope) => archiveTour(scope, tour.id));
    expect(archived).toMatchObject({ status: "archived", publishedAt: null, isFeatured: false });
    // Archiving twice is a no-op, and an archived tour cannot be published directly.
    expect((await as(tenant, (scope) => archiveTour(scope, tour.id))).status).toBe("archived");
    expect(await rejection(() => as(tenant, (scope) => publishTour(scope, tour.id, today)))).toBeInstanceOf(ConflictError);

    const restored = await as(tenant, (scope) => restoreTour(scope, tour.id));
    expect(restored.status).toBe("draft");
    expect((await as(tenant, (scope) => restoreTour(scope, tour.id))).status).toBe("draft");
    expect((await as(tenant, (scope) => publishTour(scope, tour.id, today))).status).toBe("published");

    expect(await auditActions(tenant, tour.id)).toEqual(["tour.created", "tour.published", "tour.archived", "tour.restored", "tour.published"]);
    for (const call of [archiveTour, restoreTour]) {
      expect(await rejection(() => as(tenant, (scope) => call(scope, randomId())))).toBeInstanceOf(NotFoundError);
    }
  });

  it("deletes a tour together with everything that hangs off it", async () => {
    const tenant = await createTenant();
    const media = await createMediaFixture(tenant.tenantId);
    const tour = await as(tenant, (scope) => createTour(scope, { title: "To be deleted", kind: "departure", durationDays: 2 }));
    await as(tenant, async (scope) => {
      await replaceItinerary(scope, tour.id, [{ dayNumber: 1, title: "Day one" }]);
      await setTourMedia(scope, tour.id, [media.id]);
      await addDeparture(scope, tour.id, { startDate: "2031-06-01", capacity: 6 }, today);
      await addAvailabilityBlock(scope, { tourId: tour.id, startDate: "2031-07-01", endDate: "2031-07-03" });
      await addAvailabilityBlock(scope, { startDate: "2031-12-31", endDate: "2031-12-31", reason: "New Year" });
    });

    await as(tenant, (scope) => deleteTour(scope, tour.id));

    expect(await rejection(() => as(tenant, (scope) => getTour(scope, tour.id)))).toBeInstanceOf(NotFoundError);
    const left = await as(tenant, async (scope) => ({
      itinerary: await scope.tx.select().from(tourItineraryDays).where(eq(tourItineraryDays.tourId, tour.id)),
      media: await scope.tx.select().from(tourMedia).where(eq(tourMedia.tourId, tour.id)),
      blocks: await listAvailabilityBlocks(scope),
    }));
    expect(left.itinerary).toEqual([]);
    expect(left.media).toEqual([]);
    // The business-wide block is not the tour's and stays.
    expect(left.blocks.map((block) => block.reason)).toEqual(["New Year"]);
    expect(await auditActions(tenant, tour.id)).toEqual(["tour.created", "tour.deleted"]);
    expect(await rejection(() => as(tenant, (scope) => deleteTour(scope, tour.id)))).toBeInstanceOf(NotFoundError);
  });

  it("will not delete a tour that has bookings, in any status, but will archive it", async () => {
    const tenant = await createTenant();
    for (const status of ["pending", "confirmed", "completed", "cancelled"] as const) {
      const tour = await createTourFixture(tenant.tenantId);
      await seedBooking(tenant, { tourId: tour.id, status });

      const error = await rejection(() => as(tenant, (scope) => deleteTour(scope, tour.id)));
      expect(error, status).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).message).toContain("Archive it instead");
      expect((await as(tenant, (scope) => archiveTour(scope, tour.id))).status).toBe("archived");
      expect(await auditActions(tenant, tour.id)).not.toContain("tour.deleted");
    }
  });

  it("will not delete a tour whose departure has bookings", async () => {
    const tenant = await createTenant();
    const tour = await as(tenant, (scope) => createTour(scope, { title: "Booked departure", kind: "departure", durationDays: 2 }));
    const departure = await as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: "2031-06-01", capacity: 6 }, today));
    await seedBooking(tenant, { tourId: tour.id, departureId: departure.id, startDate: "2031-06-01", status: "completed" });

    const outcome = await as(tenant, async (scope) => {
      const error = await rejection(() => deleteTour(scope, tour.id));
      // The refused delete ran in a savepoint: nothing was removed and the transaction still works.
      return { error, detail: await getTour(scope, tour.id) };
    });
    expect(outcome.error).toBeInstanceOf(ConflictError);
    expect((outcome.error as ConflictError).message).toBe("This tour has bookings, so it cannot be deleted. Archive it instead.");
    expect(outcome.detail.departures).toHaveLength(1);
  });

  it("will not delete a tour that has a personal discount or a discount request", async () => {
    const tenant = await createTenant();
    const message = "This tour has personal discounts or discount requests, so it cannot be deleted. Archive it instead.";
    for (const seed of [seedPersonalDiscount, seedDiscountRequest]) {
      const tour = await createTourFixture(tenant.tenantId);
      await seed(tenant, tour.id);

      const error = await rejection(() => as(tenant, (scope) => deleteTour(scope, tour.id)));
      expect(error, seed.name).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).message, seed.name).toBe(message);
      expect((await as(tenant, (scope) => archiveTour(scope, tour.id))).status).toBe("archived");
      expect(await auditActions(tenant, tour.id)).not.toContain("tour.deleted");
    }
  });

  it("deletes a tour that reviews, enquiries and journal entries mention, keeping them without the link", async () => {
    const tenant = await createTenant();
    const tour = await createTourFixture(tenant.tenantId);
    const review = await seedReview(tenant, { tourId: tour.id, rating: 5 });
    const { inquiryId, journeyId } = await seedTourMentions(tenant, tour.id);

    await as(tenant, (scope) => deleteTour(scope, tour.id));

    expect(await rejection(() => as(tenant, (scope) => getTour(scope, tour.id)))).toBeInstanceOf(NotFoundError);
    const kept = await as(tenant, async ({ tx }) => ({
      review: await tx.select({ tourId: reviews.tourId, rating: reviews.rating }).from(reviews).where(eq(reviews.id, review.id)),
      inquiry: await tx.select({ tourId: inquiries.tourId }).from(inquiries).where(eq(inquiries.id, inquiryId)),
      journey: await tx.select({ tourId: journeyEntries.relatedTourId }).from(journeyEntries).where(eq(journeyEntries.id, journeyId)),
    }));
    expect(kept).toEqual({ review: [{ tourId: null, rating: 5 }], inquiry: [{ tourId: null }], journey: [{ tourId: null }] });
    expect(await auditActions(tenant, tour.id)).toEqual(["tour.created", "tour.deleted"]);
  });
});

describe("dashboard list", () => {
  async function seed() {
    const tenant = await createTenant();
    const [cultural, adventure] = await as(tenant, async (scope) => [
      await createCategory(scope, { name: "Cultural" }),
      await createCategory(scope, { name: "Adventure" }),
    ]);
    const destination = await as(tenant, (scope) => createDestination(scope, { name: "Sheki" }));
    const sheki = await createPublishedTourFixture(tenant.tenantId, {
      title: "Silk Road to Sheki",
      place: "Sheki, Greater Caucasus",
      categoryId: cultural!.id,
      destinationId: destination.id,
      isFeatured: true,
    });
    const fire = await createPublishedTourFixture(tenant.tenantId, { title: "Fire & Stone", place: "Absheron", categoryId: adventure!.id });
    const draft = await createTourFixture(tenant.tenantId, { title: "Gabala Mountain Escape", place: "Gabala", categoryId: adventure!.id, isFeatured: true });
    const archived = await createTourFixture(tenant.tenantId, { title: "100% Off_road", place: "Quba" });
    await as(tenant, (scope) => archiveTour(scope, archived.id));
    return { tenant, cultural: cultural!, adventure: adventure!, destination, sheki, fire, draft, archived };
  }

  it("lists every status, newest first, with names resolved", async () => {
    const { tenant, sheki, fire, draft, archived, cultural, destination } = await seed();
    const { items, total } = await as(tenant, (scope) => listTours(scope));

    expect(total).toBe(4);
    expect(items.map((item) => item.id)).toEqual([archived.id, draft.id, fire.id, sheki.id]);
    expect(items.find((item) => item.id === sheki.id)).toMatchObject({
      slug: "silk-road-to-sheki",
      title: "Silk Road to Sheki",
      status: "published",
      kind: "private",
      place: "Sheki, Greater Caucasus",
      categoryId: cultural.id,
      categoryName: "Cultural",
      destinationId: destination.id,
      destinationName: "Sheki",
      durationLabel: "3 days",
      priceAdult: 69_000,
      isFeatured: true,
      coverUrl: null,
      mediaCount: 0,
    });
    expect(items.find((item) => item.id === draft.id)).toMatchObject({ status: "draft", publishedAt: null, categoryName: "Adventure", destinationName: null });
  });

  it("honours the manual sort order before recency", async () => {
    const { tenant, sheki, archived, draft, fire } = await seed();
    await as(tenant, (scope) => updateTour(scope, archived.id, { sortOrder: 5 }));
    const { items } = await as(tenant, (scope) => listTours(scope));
    expect(items.map((item) => item.id)).toEqual([draft.id, fire.id, sheki.id, archived.id]);
  });

  it("filters by status, category and featured flag", async () => {
    const { tenant, sheki, fire, draft, archived, adventure } = await seed();
    const ids = async (filters: Parameters<typeof listTours>[1]) => {
      const result = await as(tenant, (scope) => listTours(scope, filters));
      expect(result.total).toBe(result.items.length);
      return result.items.map((item) => item.id);
    };

    expect(await ids({ status: "published" })).toEqual([fire.id, sheki.id]);
    expect(await ids({ status: "draft" })).toEqual([draft.id]);
    expect(await ids({ status: "archived" })).toEqual([archived.id]);
    expect(await ids({ categoryId: adventure.id })).toEqual([draft.id, fire.id]);
    expect(await ids({ featured: true })).toEqual([draft.id, sheki.id]);
    expect(await ids({ featured: false })).toEqual([archived.id, fire.id]);
    expect(await ids({ status: "published", featured: true, categoryId: adventure.id })).toEqual([]);
    expect(await ids({ categoryId: randomId() })).toEqual([]);
  });

  it("searches title, place and slug without treating % and _ as wildcards", async () => {
    const { tenant, sheki, fire, draft, archived } = await seed();
    const ids = async (search: string) => (await as(tenant, (scope) => listTours(scope, { search }))).items.map((item) => item.id);

    expect(await ids("SHEKI")).toEqual([sheki.id]);
    expect(await ids("absheron")).toEqual([fire.id]);
    expect(await ids("gabala-mountain")).toEqual([draft.id]);
    expect(await ids("  stone ")).toEqual([fire.id]);
    expect(await ids("%")).toEqual([archived.id]);
    expect(await ids("_")).toEqual([archived.id]);
    expect(await ids("100%")).toEqual([archived.id]);
    expect(await ids("off_road")).toEqual([archived.id]);
    expect(await ids("off%road")).toEqual([]);
    expect(await ids("s_lk")).toEqual([]);
    expect(await ids("\\")).toEqual([]);
    expect(await ids("'; drop table tours; --")).toEqual([]);
    expect(await ids("")).toHaveLength(4);
    expect((await as(tenant, (scope) => listTours(scope))).total).toBe(4);
  });

  it("pages through results with a stable total", async () => {
    const { tenant, sheki, fire, draft, archived } = await seed();
    const page = (limit: number, offset: number) => as(tenant, (scope) => listTours(scope, { limit, offset }));

    const first = await page(3, 0);
    const second = await page(3, 3);
    expect(first.total).toBe(4);
    expect(second.total).toBe(4);
    expect(first.items.map((item) => item.id)).toEqual([archived.id, draft.id, fire.id]);
    expect(second.items.map((item) => item.id)).toEqual([sheki.id]);
    expect((await page(3, 10)).items).toEqual([]);

    for (const bad of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { limit: 2.5 }, { status: "live" }, { categoryId: "x" }]) {
      expect(await rejection(() => as(tenant, (scope) => listTours(scope, bad as never))), JSON.stringify(bad)).toBeInstanceOf(ValidationError);
    }
  });

  it("counts tours by status, and featured ones that are live", async () => {
    const { tenant } = await seed();
    expect(await as(tenant, (scope) => getTourCounts(scope))).toEqual({ published: 2, draft: 1, archived: 1, featured: 1 });
    const empty = await createTenant();
    expect(await as(empty, (scope) => getTourCounts(scope))).toEqual({ published: 0, draft: 0, archived: 0, featured: 0 });
  });

  it("shows departures on the tour detail", async () => {
    const tenant = await createTenant();
    const tour = await as(tenant, (scope) => createTour(scope, { title: "Scheduled", kind: "departure", durationDays: 2 }));
    await as(tenant, async (scope) => {
      await addDeparture(scope, tour.id, { startDate: "2031-06-20", capacity: 6 }, today);
      await addDeparture(scope, tour.id, { startDate: "2031-05-02", capacity: 8, startTime: "08:30" }, today);
    });
    const detail = await as(tenant, (scope) => getTour(scope, tour.id));
    expect(detail.departures.map((departure) => [departure.startDate, departure.startTime, departure.capacity])).toEqual([
      ["2031-05-02", "08:30", 8],
      ["2031-06-20", null, 6],
    ]);
    expect(await as(tenant, (scope) => listDepartures(scope, tour.id))).toEqual(detail.departures);
    // Sanity: the row is what the list reads.
    const [row] = await as(tenant, ({ tx }) => tx.select({ kind: tours.kind }).from(tours).where(eq(tours.id, tour.id)));
    expect(row).toEqual({ kind: "departure" });
  });
});
