import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addDeparture, updateDeparture } from "@/server/catalog/departures";
import { publishTour, unpublishTour } from "@/server/catalog/publishing";
import { archiveTour, createTour, getTour, getTourCounts, updateTour } from "@/server/catalog/tours";
import { auditLogs, tenants, tours } from "@/server/db/schema";
import { LimitExceededError, NotFoundError, ValidationError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { FIXTURE_TODAY, completeTourInput, createPublishedTourFixture } from "../../helpers/catalog";
import { createTenant, randomId, type TenantFixture } from "../../helpers/fixtures";
import { as, auditActions, fieldErrors, rejection } from "./support";

const today = { today: FIXTURE_TODAY };

function draft(tenant: TenantFixture, overrides: Parameters<typeof completeTourInput>[0] = {}) {
  return as(tenant, (scope) => createTour(scope, completeTourInput(overrides)));
}

describe("publishing a tour", () => {
  it("publishes a complete tour, stamps the time and writes the audit log", async () => {
    const tenant = await createTenant();
    const tour = await draft(tenant);
    const before = Date.now();

    const published = await as(tenant, (scope) => publishTour(scope, tour.id, today));
    expect(published.status).toBe("published");
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect(published.publishedAt!.getTime()).toBeGreaterThanOrEqual(before - 5_000);

    const [entry] = await as(tenant, ({ tx }) => tx.select().from(auditLogs).where(eq(auditLogs.action, "tour.published")));
    expect(entry).toMatchObject({ targetType: "tour", targetId: tour.id, actorType: "user", actorUserId: tenant.ownerId, tenantId: tenant.tenantId });
  });

  it("is idempotent: publishing a live tour changes nothing and logs nothing", async () => {
    const tenant = await createTenant({ plan: { maxPublishedTours: 1 } });
    const tour = await draft(tenant);
    const first = await as(tenant, (scope) => publishTour(scope, tour.id, today));
    // At the limit already, yet re-publishing the same tour is not "one more".
    const second = await as(tenant, (scope) => publishTour(scope, tour.id, today));

    expect(second.publishedAt).toEqual(first.publishedAt);
    expect(await auditActions(tenant, tour.id)).toEqual(["tour.created", "tour.published"]);
  });

  it("returns every missing field at once and leaves the tour a draft", async () => {
    const tenant = await createTenant();
    const tour = await as(tenant, (scope) => createTour(scope, { title: "Bare draft" }));

    const error = await rejection(() => as(tenant, (scope) => publishTour(scope, tour.id, today)));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("This tour is not ready to publish yet.");
    expect((error as ValidationError).fieldErrors).toEqual({
      summary: ["Add a short summary for tour cards."],
      priceAdult: ["Enter a price above 0."],
    });

    expect((await as(tenant, (scope) => getTour(scope, tour.id))).status).toBe("draft");
    expect(await auditActions(tenant, tour.id)).toEqual(["tour.created"]);
  });

  it("checks each completeness rule on its own", async () => {
    const tenant = await createTenant();
    for (const [missing, field] of [
      [{ summary: "" }, "summary"],
      [{ summary: "   " }, "summary"],
      [{ priceAdult: 0 }, "priceAdult"],
    ] as const) {
      const tour = await draft(tenant, missing);
      const errors = await fieldErrors(() => as(tenant, (scope) => publishTour(scope, tour.id, today)));
      expect(Object.keys(errors), JSON.stringify(missing)).toEqual([field]);
    }
  });

  it("accepts a day count without a duration label, and re-checks the title", async () => {
    const tenant = await createTenant();
    const tour = await draft(tenant, { durationLabel: "" });
    // The length in days is always present (the database requires at least 1), so the label is optional.
    expect((await as(tenant, (scope) => publishTour(scope, tour.id, today))).status).toBe("published");

    // A row whose title was shortened behind the service's back cannot go live.
    const legacy = await draft(tenant);
    await as(tenant, ({ tx }) => tx.update(tours).set({ title: "ab" }).where(eq(tours.id, legacy.id)));
    expect(await fieldErrors(() => as(tenant, (scope) => publishTour(scope, legacy.id, today)))).toEqual({ title: ["Add a title (3+ characters)."] });
  });

  it("needs a start time and a weekday for a day tour", async () => {
    const tenant = await createTenant();
    const noSlots = await draft(tenant, { kind: "day", schedule: { weekdays: [1, 2], slots: [] } });
    expect(await fieldErrors(() => as(tenant, (scope) => publishTour(scope, noSlots.id, today)))).toEqual({ schedule: ["Add at least one start time."] });

    const noDays = await draft(tenant, { kind: "day", schedule: { weekdays: [], slots: [{ time: "09:00", capacity: 8 }] } });
    expect(await fieldErrors(() => as(tenant, (scope) => publishTour(scope, noDays.id, today)))).toEqual({
      schedule: ["Choose at least one day of the week."],
    });

    await as(tenant, (scope) => updateTour(scope, noSlots.id, { schedule: { weekdays: [1, 2], slots: [{ time: "09:00", capacity: 8 }] } }));
    expect((await as(tenant, (scope) => publishTour(scope, noSlots.id, today))).status).toBe("published");
  });

  it("does not ask private tours for start times or departures", async () => {
    const tenant = await createTenant();
    const tour = await draft(tenant, { kind: "private" });
    expect((await as(tenant, (scope) => publishTour(scope, tour.id, today))).status).toBe("published");
  });

  it("needs an open departure today or later for a departure tour", async () => {
    const tenant = await createTenant();
    const tour = await draft(tenant, { kind: "departure" });
    const publish = (day = FIXTURE_TODAY) => as(tenant, (scope) => publishTour(scope, tour.id, { today: day }));
    const departuresError = { departures: ["Add at least one upcoming departure date."] };

    expect(await fieldErrors(() => publish())).toEqual(departuresError);

    const departure = await as(tenant, (scope) => addDeparture(scope, tour.id, { startDate: "2031-03-20", capacity: 8, isOpen: false }, today));
    // A closed departure does not count.
    expect(await fieldErrors(() => publish())).toEqual(departuresError);

    await as(tenant, (scope) => updateDeparture(scope, departure.id, { isOpen: true }, today));
    // Nor does one that has already left by the tenant's calendar.
    expect(await fieldErrors(() => publish("2031-03-21"))).toEqual(departuresError);
    // A departure leaving today still counts.
    expect((await publish("2031-03-20")).status).toBe("published");
  });

  it("requires a real `today`", async () => {
    const tenant = await createTenant();
    const tour = await draft(tenant);
    expect(await rejection(() => as(tenant, (scope) => publishTour(scope, tour.id, { today: "tomorrow" })))).toBeInstanceOf(RangeError);
    expect(await rejection(() => as(tenant, (scope) => publishTour(scope, tour.id, {} as never)))).toBeInstanceOf(RangeError);
  });

  it("answers not found for unknown ids", async () => {
    const tenant = await createTenant();
    for (const id of [randomId(), "nope"]) {
      expect(await rejection(() => as(tenant, (scope) => publishTour(scope, id, today)))).toBeInstanceOf(NotFoundError);
      expect(await rejection(() => as(tenant, (scope) => unpublishTour(scope, id)))).toBeInstanceOf(NotFoundError);
    }
  });
});

describe("unpublishing", () => {
  it("returns a live tour to draft, clears the time and writes the audit log", async () => {
    const tenant = await createTenant();
    const tour = await createPublishedTourFixture(tenant.tenantId, {}, { userId: tenant.ownerId });

    const unpublished = await as(tenant, (scope) => unpublishTour(scope, tour.id));
    expect(unpublished).toMatchObject({ status: "draft", publishedAt: null });
    // Unpublishing a draft is a no-op.
    expect((await as(tenant, (scope) => unpublishTour(scope, tour.id))).status).toBe("draft");
    expect(await auditActions(tenant, tour.id)).toEqual(["tour.created", "tour.published", "tour.unpublished"]);
  });

  it("leaves an archived tour archived", async () => {
    const tenant = await createTenant();
    const tour = await draft(tenant);
    await as(tenant, (scope) => archiveTour(scope, tour.id));
    expect((await as(tenant, (scope) => unpublishTour(scope, tour.id))).status).toBe("archived");
  });
});

describe("plan limit on published tours", () => {
  it("allows publishing up to the limit and refuses the next one", async () => {
    const tenant = await createTenant({ plan: { maxPublishedTours: 2 } });
    const [a, b, c] = await Promise.all([draft(tenant), draft(tenant), draft(tenant)]);

    await as(tenant, (scope) => publishTour(scope, a!.id, today));
    await as(tenant, (scope) => publishTour(scope, b!.id, today));
    const error = await rejection(() => as(tenant, (scope) => publishTour(scope, c!.id, today)));

    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error).toMatchObject({ code: "plan_limit", limit: "maxPublishedTours", status: 402 });
    expect((error as LimitExceededError).message).toContain("includes 2 published tours");
    expect(await as(tenant, (scope) => getTourCounts(scope))).toMatchObject({ published: 2, draft: 1 });
    expect(await auditActions(tenant, c!.id)).toEqual(["tour.created"]);
  });

  it("frees a place when a tour is unpublished or archived", async () => {
    const tenant = await createTenant({ plan: { maxPublishedTours: 1 } });
    const [a, b, c] = await Promise.all([draft(tenant), draft(tenant), draft(tenant)]);
    await as(tenant, (scope) => publishTour(scope, a!.id, today));
    expect(await rejection(() => as(tenant, (scope) => publishTour(scope, b!.id, today)))).toBeInstanceOf(LimitExceededError);

    await as(tenant, (scope) => unpublishTour(scope, a!.id));
    await as(tenant, (scope) => publishTour(scope, b!.id, today));
    expect(await rejection(() => as(tenant, (scope) => publishTour(scope, c!.id, today)))).toBeInstanceOf(LimitExceededError);

    await as(tenant, (scope) => archiveTour(scope, b!.id));
    expect((await as(tenant, (scope) => publishTour(scope, c!.id, today))).status).toBe("published");
  });

  it("checks completeness before the limit, so the owner sees what to fix first", async () => {
    const tenant = await createTenant({ plan: { maxPublishedTours: 0 } });
    const incomplete = await as(tenant, (scope) => createTour(scope, { title: "Not ready" }));
    expect(await rejection(() => as(tenant, (scope) => publishTour(scope, incomplete.id, today)))).toBeInstanceOf(ValidationError);
    const ready = await draft(tenant);
    expect(await rejection(() => as(tenant, (scope) => publishTour(scope, ready.id, today)))).toBeInstanceOf(LimitExceededError);
  });

  it("has no ceiling on an unlimited plan", async () => {
    const tenant = await createTenant({ plan: { maxPublishedTours: null } });
    for (let i = 0; i < 4; i += 1) {
      const tour = await draft(tenant);
      await as(tenant, (scope) => publishTour(scope, tour.id, today));
    }
    expect((await as(tenant, (scope) => getTourCounts(scope))).published).toBe(4);
  });

  it("honours a limit override set by the platform for this workspace", async () => {
    const tenant = await createTenant({ plan: { maxPublishedTours: 1 } });
    await withPlatform((tx) => tx.update(tenants).set({ limitOverrides: { maxPublishedTours: 2 } }).where(eq(tenants.id, tenant.tenantId)));
    const [a, b, c] = await Promise.all([draft(tenant), draft(tenant), draft(tenant)]);
    await as(tenant, (scope) => publishTour(scope, a!.id, today));
    await as(tenant, (scope) => publishTour(scope, b!.id, today));
    expect(await rejection(() => as(tenant, (scope) => publishTour(scope, c!.id, today)))).toBeInstanceOf(LimitExceededError);
  });

  it("lets exactly one of two concurrent publishes take the last place", async () => {
    // Repeated so that a lucky interleaving cannot hide a race.
    for (let round = 0; round < 5; round += 1) {
      const tenant = await createTenant({ plan: { maxPublishedTours: 2 } });
      const [live, x, y] = await Promise.all([draft(tenant), draft(tenant), draft(tenant)]);
      await as(tenant, (scope) => publishTour(scope, live!.id, today));

      const results = await Promise.allSettled([
        as(tenant, (scope) => publishTour(scope, x!.id, today)),
        as(tenant, (scope) => publishTour(scope, y!.id, today)),
      ]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled, `round ${round}`).toHaveLength(1);
      expect(rejected, `round ${round}`).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(LimitExceededError);
      expect(await as(tenant, (scope) => getTourCounts(scope))).toMatchObject({ published: 2, draft: 1 });
    }
  });

  it("holds the limit under a burst of concurrent publishes", async () => {
    const tenant = await createTenant({ plan: { maxPublishedTours: 3 } });
    const drafts = await Promise.all(Array.from({ length: 6 }, () => draft(tenant)));

    const results = await Promise.allSettled(drafts.map((tour) => as(tenant, (scope) => publishTour(scope, tour.id, today))));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(LimitExceededError);
    }
    expect((await as(tenant, (scope) => getTourCounts(scope))).published).toBe(3);
  });

  it("publishes the same tour once when two requests race", async () => {
    const tenant = await createTenant({ plan: { maxPublishedTours: 1 } });
    const tour = await draft(tenant);
    const results = await Promise.all([
      as(tenant, (scope) => publishTour(scope, tour.id, today)),
      as(tenant, (scope) => publishTour(scope, tour.id, today)),
    ]);
    expect(results.map((row) => row.status)).toEqual(["published", "published"]);
    expect(await auditActions(tenant, tour.id)).toEqual(["tour.created", "tour.published"]);
  });

  it("keeps one workspace's published tours out of another's count", async () => {
    const full = await createTenant({ plan: { maxPublishedTours: 1 } });
    const other = await createTenant({ plan: { maxPublishedTours: 1 } });
    await createPublishedTourFixture(full.tenantId);
    const tour = await draft(other);
    expect((await as(other, (scope) => publishTour(scope, tour.id, today))).status).toBe("published");
  });
});
