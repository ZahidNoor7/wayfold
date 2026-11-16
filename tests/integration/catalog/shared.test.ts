import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bookingConflictErrors, completenessErrors, consistencyErrors, hasErrors, scheduleConflicts, type PublishableTour } from "@/server/catalog/rules";
import {
  assertSameIds,
  containsPattern,
  escapeLike,
  nextFreeSlug,
  parse,
  pgError,
  requireId,
  requireToday,
  slugSchema,
  slugify,
  toHourMinute,
  withDeleteCheck,
  withReferenceCheck,
} from "@/server/catalog/shared";
import { NotFoundError, ValidationError } from "@/server/errors";
import { createTenant, randomId } from "../../helpers/fixtures";
import { as, fieldErrors, rejection } from "./support";

const complete: PublishableTour = {
  title: "Silk Road to Sheki",
  summary: "Three days along the caravan road.",
  priceAdult: 69_000,
  durationDays: 3,
  durationLabel: "3 days",
  kind: "private",
  minGroupSize: 1,
  maxGroupSize: 8,
  schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [] },
  meetingLatitude: null,
  meetingLongitude: null,
};

describe("slugs", () => {
  it("turns a title into a lower-case, accent-free, hyphenated slug", () => {
    expect(slugify("Silk Road to Sheki", "tour")).toBe("silk-road-to-sheki");
    expect(slugify("  Fire & Stone: Gobustan — Yanar Dağ!  ", "tour")).toBe("fire-stone-gobustan-yanar-dag");
    expect(slugify("Crème Brûlée Évening", "tour")).toBe("creme-brulee-evening");
  });

  it("falls back when a title has no Latin letters or digits", () => {
    expect(slugify("Шеки", "tour")).toBe("tour");
    expect(slugify("!!!", "destination")).toBe("destination");
  });

  it("caps the length without leaving a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(79)} b c`, "tour");
    expect(slug).toBe("a".repeat(79));
    expect(slug.length).toBeLessThanOrEqual(80);
  });

  it("appends -2, -3, ... on collision", () => {
    expect(nextFreeSlug("sheki", [])).toBe("sheki");
    expect(nextFreeSlug("sheki", ["sheki"])).toBe("sheki-2");
    expect(nextFreeSlug("sheki", ["sheki", "sheki-2", "sheki-3"])).toBe("sheki-4");
    expect(nextFreeSlug("sheki", ["sheki", "sheki-3"])).toBe("sheki-2");
  });

  it("keeps a suffixed slug inside the length limit", () => {
    const base = "a".repeat(80);
    const next = nextFreeSlug(base, [base]);
    expect(next).toBe(`${"a".repeat(78)}-2`);
    expect(next).toHaveLength(80);
  });

  it("accepts only clean slugs from a form, lower-casing them", () => {
    expect(slugSchema.parse(" Old-City-2 ")).toBe("old-city-2");
    for (const bad of ["", "two  words", "trailing-", "-leading", "double--hyphen", "ünïcode", "a/b", "a".repeat(81)]) {
      expect(slugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("search patterns", () => {
  it("escapes LIKE wildcards and the escape character itself", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
    expect(containsPattern("50%_off")).toBe("%50\\%\\_off%");
  });
});

describe("input helpers", () => {
  it("groups validation issues by top-level field, with form-level issues under `form`", async () => {
    const schema = z
      .object({ name: z.string().min(2, "too short"), tags: z.array(z.string().min(1, "empty tag")) })
      .refine((value) => value.name !== "xx", { error: "form problem" });
    expect(parse(schema, { name: "ok", tags: ["a"] })).toEqual({ name: "ok", tags: ["a"] });

    const nested = await fieldErrors(async () => parse(schema, { name: "a", tags: ["", ""] }));
    expect(nested).toEqual({ name: ["too short"], tags: ["empty tag", "empty tag"] });

    expect(await fieldErrors(async () => parse(schema, { name: "xx", tags: [] }))).toEqual({ form: ["form problem"] });
    expect(await fieldErrors(async () => parse(z.string().min(3, "too short"), "a"))).toEqual({ form: ["too short"] });
  });

  it("treats a malformed id as not found rather than a database error", () => {
    const id = randomId();
    expect(requireId(id, "Tour")).toBe(id);
    for (const bad of ["", "abc", "1; drop table tours", 42, null, undefined, `${id}x`]) {
      expect(() => requireId(bad, "Tour"), String(bad)).toThrow(NotFoundError);
    }
  });

  it("rejects a `today` that is not a real calendar date", () => {
    expect(requireToday("2031-03-10")).toBe("2031-03-10");
    for (const bad of ["2031-02-30", "10/03/2031", "", undefined, 20310310]) {
      expect(() => requireToday(bad), String(bad)).toThrow(RangeError);
    }
  });

  it("shortens database times to HH:MM", () => {
    expect(toHourMinute("09:30:00")).toBe("09:30");
    expect(toHourMinute(null)).toBeNull();
  });

  it("requires a reorder list to name every existing id exactly once", () => {
    const [a, b, c] = [randomId(), randomId(), randomId()];
    expect(() => assertSameIds([b, a], [a, b], "orderedIds")).not.toThrow();
    expect(() => assertSameIds([a], [a, b], "orderedIds")).toThrow(ValidationError);
    expect(() => assertSameIds([a, a], [a, b], "orderedIds")).toThrow(ValidationError);
    expect(() => assertSameIds([a, c], [a, b], "orderedIds")).toThrow(ValidationError);
    expect(() => assertSameIds([a, b, c], [a, b], "orderedIds")).toThrow(ValidationError);
  });
});

describe("database error handling", () => {
  it("finds the PostgreSQL code on the error or its cause", () => {
    expect(pgError({ code: "23503", constraint: "tours_cover_fk" })).toEqual({ code: "23503", constraint: "tours_cover_fk" });
    expect(pgError({ message: "wrapped", cause: { code: "23505" } })).toEqual({ code: "23505", constraint: undefined });
    // Node system errors also carry `code`; only SQLSTATE values count.
    expect(pgError({ code: "ECONNREFUSED" })).toEqual({});
    expect(pgError(new Error("plain"))).toEqual({});
    expect(pgError(null)).toEqual({});
    expect(pgError("boom")).toEqual({});
  });

  it("passes through errors that are not foreign-key violations", async () => {
    const tenant = await createTenant();
    const boom = new Error("boom");
    expect(await rejection(() => as(tenant, (scope) => withReferenceCheck(scope, {}, async () => Promise.reject(boom))))).toBe(boom);
    expect(
      await rejection(() => as(tenant, (scope) => withDeleteCheck(scope, () => new Error("blocked"), async () => Promise.reject(boom)))),
    ).toBe(boom);
  });
});

describe("tour rules", () => {
  it("accepts a consistent, complete tour", () => {
    expect(consistencyErrors(complete)).toEqual({});
    expect(completenessErrors(complete)).toEqual({});
    expect(hasErrors({})).toBe(false);
  });

  it("requires the smallest group not to exceed the largest", () => {
    expect(consistencyErrors({ ...complete, minGroupSize: 9, maxGroupSize: 8 })).toHaveProperty("maxGroupSize");
    expect(consistencyErrors({ ...complete, minGroupSize: 8, maxGroupSize: 8 })).toEqual({});
  });

  it("requires latitude and longitude together", () => {
    expect(consistencyErrors({ ...complete, meetingLatitude: 40.4, meetingLongitude: null })).toHaveProperty("meetingLongitude");
    expect(consistencyErrors({ ...complete, meetingLatitude: null, meetingLongitude: 49.8 })).toHaveProperty("meetingLatitude");
    expect(consistencyErrors({ ...complete, meetingLatitude: 40.4, meetingLongitude: 49.8 })).toEqual({});
  });

  it("allows start times on day tours only, and keeps day tours to one day", () => {
    const slots = [{ time: "09:00", capacity: 8 }];
    expect(consistencyErrors({ ...complete, kind: "private", schedule: { weekdays: [1], slots } })).toHaveProperty("schedule");
    expect(consistencyErrors({ ...complete, kind: "departure", schedule: { weekdays: [1], slots } })).toHaveProperty("schedule");
    expect(consistencyErrors({ ...complete, kind: "day", durationDays: 1, schedule: { weekdays: [1], slots } })).toEqual({});
    expect(consistencyErrors({ ...complete, kind: "day", durationDays: 2, schedule: { weekdays: [1], slots } })).toHaveProperty("durationDays");
  });

  it("lists every missing piece before publishing", () => {
    const errors = completenessErrors({ ...complete, title: " a ", summary: "  ", priceAdult: 0, durationDays: 0, durationLabel: " " });
    expect(Object.keys(errors).sort()).toEqual(["durationLabel", "priceAdult", "summary", "title"]);
    expect(hasErrors(errors)).toBe(true);
    // Either form of duration is enough.
    expect(completenessErrors({ ...complete, durationDays: 0, durationLabel: "Half a day" })).toEqual({});
    expect(completenessErrors({ ...complete, durationDays: 2, durationLabel: "" })).toEqual({});
  });

  it("requires a start time and a weekday for day tours", () => {
    const day = { ...complete, kind: "day" as const, durationDays: 1 };
    expect(completenessErrors({ ...day, schedule: { weekdays: [], slots: [] } }).schedule).toHaveLength(2);
    expect(completenessErrors({ ...day, schedule: { weekdays: [6], slots: [] } }).schedule).toEqual(["Add at least one start time."]);
    expect(completenessErrors({ ...day, schedule: { weekdays: [6], slots: [{ time: "09:00", capacity: 8 }] } })).toEqual({});
  });

  it("requires an upcoming departure for departure tours, when the count is known", () => {
    const departure = { ...complete, kind: "departure" as const };
    expect(completenessErrors(departure, { futureDepartures: 0 })).toHaveProperty("departures");
    expect(completenessErrors(departure, { futureDepartures: 1 })).toEqual({});
    expect(completenessErrors(departure)).toEqual({});
    expect(completenessErrors(complete, { futureDepartures: 0 })).toEqual({});
  });
});

describe("booked seats against a new schedule", () => {
  const everyDay = [1, 2, 3, 4, 5, 6, 7];
  const morning = (capacity: number, weekdays = everyDay) => ({ weekdays, slots: [{ time: "09:00", capacity }] });
  const seat = (startDate: string, slotTime: string | null, seats: number) => ({ startDate, slotTime, seats });

  it("adds up the seats per date and start time", () => {
    const active = [seat("2031-04-09", "09:00", 3), seat("2031-04-09", "09:00", 2), seat("2031-04-10", "09:00", 1)];
    expect(scheduleConflicts(morning(5), active)).toEqual([]);
    expect(scheduleConflicts(morning(4), active)).toEqual(["5 seats are already booked at 09:00 on 2031-04-09."]);
    expect(scheduleConflicts(morning(0), [seat("2031-04-10", "09:00", 1)])).toEqual(["1 seat is already booked at 09:00 on 2031-04-10."]);
    // The caller's list is not modified while adding up.
    expect(active.map((booking) => booking.seats)).toEqual([3, 2, 1]);
  });

  it("reports a missing weekday before a missing start time, and skips bookings without a time", () => {
    const active = [seat("2031-04-09", "14:00", 2), seat("2031-04-12", "09:00", 2), seat("2031-04-13", null, 9)];
    expect(scheduleConflicts(morning(8, [3]), active)).toEqual([
      "The 14:00 start time has bookings on 2031-04-09. Keep it, or move those bookings first.",
      "There are bookings on 2031-04-12, a Saturday. Keep that day, or move those bookings first.",
    ]);
    expect(scheduleConflicts(morning(8), [])).toEqual([]);
  });

  it("shows the first five problems and counts the rest", () => {
    const active = Array.from({ length: 8 }, (_, index) => seat(`2031-04-${String(index + 10).padStart(2, "0")}`, "09:00", 4));
    const conflicts = scheduleConflicts(morning(2), active);
    expect(conflicts).toHaveLength(6);
    expect(conflicts[0]).toBe("4 seats are already booked at 09:00 on 2031-04-10.");
    expect(conflicts[5]).toBe("…and 3 more.");
  });

  it("checks length, schedule and party size only where bookings make them matter", () => {
    const active = [seat("2031-04-09", "09:00", 6), seat("2031-04-08", "09:00", 2)];
    const day = { ...complete, kind: "day" as const, durationDays: 1, schedule: morning(8) };

    expect(bookingConflictErrors(day, { ...day, schedule: morning(4) }, [], true)).toEqual({});
    expect(bookingConflictErrors(day, day, active, false)).toEqual({});
    expect(bookingConflictErrors(day, { ...day, schedule: morning(4) }, active, true)).toEqual({
      schedule: ["6 seats are already booked at 09:00 on 2031-04-09."],
    });
    // An edit that does not mention the schedule is not held to it.
    expect(bookingConflictErrors(day, { ...day, schedule: morning(4) }, active, false)).toEqual({});
    // Start times only exist on day tours.
    expect(bookingConflictErrors(complete, { ...complete, schedule: morning(1) }, active, true)).toEqual({});

    expect(bookingConflictErrors(day, { ...day, maxGroupSize: 5 }, active, false)).toEqual({
      maxGroupSize: ["A booking on 2031-04-09 has 6 guests. Move or cancel it before going below 6."],
    });
    expect(bookingConflictErrors(day, { ...day, maxGroupSize: 6 }, active, false)).toEqual({});
    expect(bookingConflictErrors(day, { ...day, maxGroupSize: 12 }, active, false)).toEqual({});
    const departure = { ...complete, kind: "departure" as const };
    expect(bookingConflictErrors(departure, { ...departure, maxGroupSize: 1 }, active, false)).toEqual({});

    expect(bookingConflictErrors(complete, { ...complete, durationDays: 4 }, active, false)).toHaveProperty("durationDays");
    expect(bookingConflictErrors(complete, { ...complete, durationDays: 4 }, [], false)).toEqual({});
  });
});
