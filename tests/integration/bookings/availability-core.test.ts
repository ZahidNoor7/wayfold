import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  computeCalendar,
  computeDayState,
  isBookable,
  isHoldingSeats,
  spanEnd,
  type ActiveBooking,
  type AvailabilityInput,
  type AvailabilityTour,
} from "@/server/bookings/availability";
import { detectClashes, type LiveBooking } from "@/server/bookings/clashes";
import { csvCell, minorToDecimal, toCsv } from "@/server/bookings/csv";
import { priceBooking } from "@/server/bookings/pricing";
import { assertRequestFits, makeReference, SlotTakenError } from "@/server/bookings/request";
import { BOOKING_TRANSITIONS, canTransition } from "@/server/bookings/service";
import { advisoryKey, assertId, bookableUnit, escapeLike, normaliseTime, parse } from "@/server/bookings/shared";
import { NotFoundError, ValidationError } from "@/server/errors";

const TODAY = "2027-03-01"; // Monday
const TOUR = "11111111-1111-4111-8111-111111111111";
const OTHER_TOUR = "22222222-2222-4222-8222-222222222222";
const DEPARTURE = "33333333-3333-4333-8333-333333333333";

const SETTINGS = { horizonDays: 365, minNoticeDays: 1, weeklyDaysOff: [] as number[] };

const dayTour: AvailabilityTour = {
  id: TOUR,
  kind: "day",
  durationDays: 1,
  schedule: {
    weekdays: [1, 2, 3, 4, 5, 6],
    slots: [
      { time: "14:00", capacity: 8 },
      { time: "09:00", capacity: 8 },
    ],
  },
};
const departureTour: AvailabilityTour = { id: TOUR, kind: "departure", durationDays: 3, schedule: { weekdays: [], slots: [] } };
const privateTour: AvailabilityTour = { id: TOUR, kind: "private", durationDays: 8, schedule: { weekdays: [], slots: [] } };

let seq = 0;
function booking(overrides: Partial<ActiveBooking>): ActiveBooking {
  seq += 1;
  return {
    id: `b${seq}`,
    tourId: TOUR,
    tourKind: "day",
    departureId: null,
    startDate: "2027-03-10",
    endDate: "2027-03-10",
    slotTime: "09:00",
    seats: 1,
    held: false,
    ...overrides,
  };
}

function input(tour: AvailabilityTour, overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return { tour, settings: SETTINGS, departures: [], blocks: [], bookings: [], today: TODAY, ...overrides };
}

describe("availability: rules that apply to every kind of tour", () => {
  it.each([
    ["yesterday", "2027-02-28", {}, "past", "past"],
    ["today, inside the notice period", "2027-03-01", {}, "closed", "min_notice"],
    ["the first day after the notice period", "2027-03-02", {}, "open", null],
    ["today, when no notice is required", "2027-03-01", { minNoticeDays: 0 }, "open", null],
    ["inside a longer notice period", "2027-03-03", { minNoticeDays: 3 }, "closed", "min_notice"],
    ["the last day of the horizon", "2027-03-31", { horizonDays: 30 }, "open", null],
    ["one day beyond the horizon", "2027-04-01", { horizonDays: 30 }, "closed", "beyond_horizon"],
    ["the weekly day off", "2027-03-03", { weeklyDaysOff: [3] }, "closed", "day_off"],
    ["the day after the weekly day off", "2027-03-04", { weeklyDaysOff: [3] }, "open", null],
  ])("%s → %s", (_label, date, settings, state, reason) => {
    const day = computeDayState(input(dayTour, { settings: { ...SETTINGS, ...settings } }), date);
    expect(day.state).toBe(state);
    expect(day.reason).toBe(reason);
    if (state !== "open") expect(day).toMatchObject({ seatsLeft: 0, slots: null, capacity: null });
  });

  it.each([
    ["a business-wide block", { tourId: null, startDate: "2027-03-09", endDate: "2027-03-11" }, "closed"],
    ["a block on this tour", { tourId: TOUR, startDate: "2027-03-10", endDate: "2027-03-10" }, "closed"],
    ["a block on another tour", { tourId: OTHER_TOUR, startDate: "2027-03-10", endDate: "2027-03-10" }, "open"],
    ["a block that ended the day before", { tourId: null, startDate: "2027-03-01", endDate: "2027-03-09" }, "open"],
    ["a block that starts the day after", { tourId: null, startDate: "2027-03-11", endDate: "2027-03-12" }, "open"],
  ])("%s → %s", (_label, block, state) => {
    const day = computeDayState(input(dayTour, { blocks: [block] }), "2027-03-10");
    expect(day.state).toBe(state);
    if (state === "closed") expect(day.reason).toBe("blocked");
  });

  it("closes a multi-day start when a block falls on a later day of the span", () => {
    const blocks = [{ tourId: null, startDate: "2027-03-12", endDate: "2027-03-12" }];
    const departures = [{ id: DEPARTURE, tourId: TOUR, startDate: "2027-03-10", capacity: 8, isOpen: true }];
    expect(computeDayState(input(departureTour, { blocks, departures }), "2027-03-10")).toMatchObject({ state: "closed", reason: "blocked" });
    expect(computeDayState(input(privateTour, { blocks }), "2027-03-05")).toMatchObject({ state: "closed", reason: "blocked", endDate: "2027-03-12" });
    expect(computeDayState(input(privateTour, { blocks }), "2027-03-13").state).toBe("open");
  });

  it("applies the weekly day off to the start day only", () => {
    // An 8-day tour always crosses a Wednesday; only starting on one is closed.
    const settings = { ...SETTINGS, weeklyDaysOff: [3] };
    expect(computeDayState(input(privateTour, { settings }), "2027-03-02").state).toBe("open");
    expect(computeDayState(input(privateTour, { settings }), "2027-03-03").state).toBe("closed");
  });

  it("builds one entry per date, in order", () => {
    const days = computeCalendar(input(dayTour), "2027-02-27", "2027-03-07");
    expect(days.map((day) => day.date)).toEqual(["2027-02-27", "2027-02-28", "2027-03-01", "2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05", "2027-03-06", "2027-03-07"]);
    expect(days.map((day) => day.state)).toEqual(["past", "past", "closed", "open", "open", "open", "open", "open", "closed"]);
    expect(computeCalendar(input(dayTour), "2027-03-05", "2027-03-04")).toEqual([]);
  });
});

describe("availability: day tours", () => {
  const at = (bookings: ActiveBooking[], tour = dayTour) => computeDayState(input(tour, { bookings }), "2027-03-10");

  it("is closed on weekdays the tour does not run and when it has no slots", () => {
    expect(computeDayState(input(dayTour), "2027-03-07")).toMatchObject({ state: "closed", reason: "not_scheduled" }); // Sunday
    expect(at([], { ...dayTour, schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], slots: [] } })).toMatchObject({ state: "closed", reason: "not_scheduled" });
  });

  it("is open with every seat free, slots sorted by time", () => {
    expect(at([])).toEqual({
      date: "2027-03-10",
      endDate: "2027-03-10",
      state: "open",
      reason: null,
      seatsLeft: 16,
      capacity: 16,
      departureId: null,
      slots: [
        { time: "09:00", capacity: 8, seatsLeft: 8, state: "open" },
        { time: "14:00", capacity: 8, seatsLeft: 8, state: "open" },
      ],
    });
  });

  it.each([
    // [seats at 09:00, seats at 14:00, day state, 09:00 state, 14:00 state, seats left]
    [0, 0, "open", "open", "open", 16],
    [5, 0, "open", "open", "open", 11],
    [5, 5, "open", "open", "open", 6],
    [6, 0, "limited", "limited", "open", 10], // a slot with 2 left
    [7, 0, "limited", "limited", "open", 9], // a slot with 1 left
    [8, 0, "open", "full", "open", 8], // a full slot alone does not make the day limited
    [8, 4, "limited", "full", "open", 4], // total of 4 or fewer
    [8, 5, "limited", "full", "open", 3],
    [8, 7, "limited", "full", "limited", 1],
    [8, 8, "full", "full", "full", 0],
  ])("%i + %i seats taken → %s", (morning, afternoon, state, morningState, afternoonState, seatsLeft) => {
    const bookings = [
      ...(morning ? [booking({ slotTime: "09:00", seats: morning })] : []),
      ...(afternoon ? [booking({ slotTime: "14:00", seats: afternoon, held: true })] : []),
    ];
    const day = at(bookings);
    expect(day.state).toBe(state);
    expect(day.seatsLeft).toBe(seatsLeft);
    expect(day.slots!.map((slot) => slot.state)).toEqual([morningState, afternoonState]);
    expect(day.reason).toBe(state === "full" ? "sold_out" : null);
  });

  it("counts held and confirmed seats alike and adds parties up", () => {
    const day = at([booking({ seats: 3, held: true }), booking({ seats: 2 }), booking({ seats: 1, held: true })]);
    expect(day.slots![0]).toEqual({ time: "09:00", capacity: 8, seatsLeft: 2, state: "limited" });
  });

  it("ignores bookings of another tour, date or start time", () => {
    const day = at([
      booking({ tourId: OTHER_TOUR, seats: 8 }),
      booking({ startDate: "2027-03-11", endDate: "2027-03-11", seats: 8 }),
      booking({ slotTime: "18:00", seats: 8 }),
      booking({ slotTime: null, seats: 8 }),
    ]);
    expect(day).toMatchObject({ state: "open", seatsLeft: 16 });
  });

  it("never reports negative seats when a slot was overbooked on purpose", () => {
    const day = at([booking({ seats: 11 })]);
    expect(day.slots![0]).toMatchObject({ seatsLeft: 0, state: "full" });
    expect(day.seatsLeft).toBe(8);
  });

  it("reads slot times stored with seconds", () => {
    const tour = { ...dayTour, schedule: { weekdays: [3], slots: [{ time: "09:00:00", capacity: 4 }] } };
    const day = at([booking({ seats: 4 })], tour);
    expect(day).toMatchObject({ state: "full", slots: [{ time: "09:00", seatsLeft: 0 }] });
  });

  it("is limited when a small single slot has few seats in total", () => {
    const tour = { ...dayTour, schedule: { weekdays: [3], slots: [{ time: "19:00", capacity: 4 }] } };
    expect(at([], tour)).toMatchObject({ state: "limited", seatsLeft: 4, slots: [{ state: "open" }] });
  });
});

describe("availability: scheduled departures", () => {
  const departure = { id: DEPARTURE, tourId: TOUR, startDate: "2027-03-10", capacity: 8, isOpen: true };
  const at = (bookings: ActiveBooking[], departures = [departure]) => computeDayState(input(departureTour, { departures, bookings }), "2027-03-10");
  const seats = (n: number, extra: Partial<ActiveBooking> = {}) => booking({ tourKind: "departure", departureId: DEPARTURE, slotTime: null, endDate: "2027-03-12", seats: n, ...extra });

  it("is closed where there is no departure, or the departure is closed", () => {
    expect(at([], [])).toMatchObject({ state: "closed", reason: "no_departure" });
    expect(computeDayState(input(departureTour, { departures: [departure] }), "2027-03-11")).toMatchObject({ state: "closed", reason: "no_departure" });
    expect(at([], [{ ...departure, isOpen: false }])).toMatchObject({ state: "closed", reason: "departure_closed" });
    expect(at([], [{ ...departure, tourId: OTHER_TOUR }])).toMatchObject({ state: "closed", reason: "no_departure" });
  });

  it.each([
    [0, "open", 8],
    [4, "open", 4],
    [5, "limited", 3],
    [7, "limited", 1],
    [8, "full", 0],
    [9, "full", 0],
  ])("%i seats taken → %s with %i left", (taken, state, seatsLeft) => {
    const day = at(taken ? [seats(taken)] : []);
    expect(day).toMatchObject({ state, seatsLeft, capacity: 8, departureId: DEPARTURE, slots: null, endDate: "2027-03-12" });
    expect(day.reason).toBe(state === "full" ? "sold_out" : null);
  });

  it("adds held and confirmed parties, and bookings that predate departure ids", () => {
    const day = at([seats(2, { held: true }), seats(2), seats(1, { departureId: null })]);
    expect(day).toMatchObject({ state: "limited", seatsLeft: 3 });
  });

  it("ignores bookings on other departures and other tours", () => {
    const day = at([
      seats(8, { departureId: "44444444-4444-4444-8444-444444444444", startDate: "2027-03-17", endDate: "2027-03-19" }),
      seats(8, { departureId: null, tourId: OTHER_TOUR }),
    ]);
    expect(day).toMatchObject({ state: "open", seatsLeft: 8 });
  });
});

describe("availability: private tours", () => {
  // Start 2027-03-10 → the party has the guide from the 10th to the 17th.
  const at = (bookings: ActiveBooking[], date = "2027-03-10") => computeDayState(input(privateTour, { bookings }), date);
  const block = (startDate: string, endDate: string, extra: Partial<ActiveBooking> = {}) =>
    booking({ tourKind: "private", slotTime: null, startDate, endDate, seats: 2, ...extra });

  it("is free when nothing overlaps", () => {
    expect(at([])).toEqual({
      date: "2027-03-10",
      endDate: "2027-03-17",
      state: "open",
      reason: null,
      seatsLeft: 1,
      capacity: 1,
      departureId: null,
      slots: null,
    });
  });

  it.each([
    ["confirmed, same dates", "2027-03-10", "2027-03-17", false, "full", "booked"],
    ["pending, same dates", "2027-03-10", "2027-03-17", true, "hold", "on_hold"],
    ["confirmed, ends on our first day", "2027-03-03", "2027-03-10", false, "full", "booked"],
    ["pending, starts on our last day", "2027-03-17", "2027-03-24", true, "hold", "on_hold"],
    ["confirmed, inside our span", "2027-03-12", "2027-03-13", false, "full", "booked"],
    ["confirmed, ends the day before we start", "2027-03-02", "2027-03-09", false, "open", null],
    ["pending, starts the day after we end", "2027-03-18", "2027-03-25", true, "open", null],
  ])("%s → %s", (_label, startDate, endDate, held, state, reason) => {
    const day = at([block(startDate, endDate, { held })]);
    expect(day.state).toBe(state);
    expect(day.reason).toBe(reason);
    expect(day.seatsLeft).toBe(state === "open" ? 1 : 0);
  });

  it("is blocked by a private booking of a DIFFERENT tour: one guide, one place", () => {
    expect(at([block("2027-03-14", "2027-03-15", { tourId: OTHER_TOUR })])).toMatchObject({ state: "full", reason: "booked" });
    expect(at([block("2027-03-14", "2027-03-15", { tourId: OTHER_TOUR, held: true })])).toMatchObject({ state: "hold", reason: "on_hold" });
  });

  it("shows full rather than on hold when both a confirmed and a pending booking overlap", () => {
    expect(at([block("2027-03-10", "2027-03-11", { held: true }), block("2027-03-15", "2027-03-16")])).toMatchObject({ state: "full" });
  });

  it("is not blocked by seat-based bookings", () => {
    expect(at([booking({ tourKind: "day", seats: 8 }), booking({ tourKind: "departure", slotTime: null, endDate: "2027-03-12" })]).state).toBe("open");
  });
});

describe("availability helpers", () => {
  const now = new Date("2027-03-01T09:00:00Z");
  it.each([
    ["confirmed", null, true],
    ["confirmed", new Date("2020-01-01T00:00:00Z"), true],
    ["pending", new Date("2027-03-01T09:00:01Z"), true],
    ["pending", new Date("2027-03-01T09:00:00Z"), false],
    ["pending", new Date("2027-03-01T08:59:59Z"), false],
    ["pending", null, false],
    ["cancelled", new Date("2027-04-01T00:00:00Z"), false],
    ["completed", null, false],
  ])("a %s booking with hold %s holds seats: %s", (status, holdExpiresAt, expected) => {
    expect(isHoldingSeats({ status, holdExpiresAt }, now)).toBe(expected);
  });

  it("computes the inclusive last day of a tour", () => {
    expect(spanEnd("2027-03-10", 1)).toBe("2027-03-10");
    expect(spanEnd("2027-03-10", 8)).toBe("2027-03-17");
    expect(spanEnd("2027-02-27", 3)).toBe("2027-03-01");
    expect(spanEnd("2027-03-10", 0)).toBe("2027-03-10");
  });

  it("treats only open and limited dates as bookable", () => {
    expect((["open", "limited", "full", "hold", "closed", "past"] as const).map(isBookable)).toEqual([true, true, false, false, false, false]);
  });
});

describe("request fit", () => {
  const openDay = computeDayState(input(dayTour, { bookings: [booking({ seats: 6 })] }), "2027-03-10");

  it("accepts a party that fits its slot and rejects one that does not", () => {
    expect(() => assertRequestFits(openDay, "day", "09:00", 2)).not.toThrow();
    expect(() => assertRequestFits(openDay, "day", "14:00", 8)).not.toThrow();
    const error = (() => {
      try {
        assertRequestFits(openDay, "day", "09:00", 3);
      } catch (e) {
        return e as SlotTakenError;
      }
    })()!;
    expect(error).toBeInstanceOf(SlotTakenError);
    expect(error).toMatchObject({ code: "slot_taken", status: 409, seatsLeft: 2 });
    expect(error.message).toContain("Only 2 seats left");
  });

  it("uses the singular for one seat and a different message when nothing is left", () => {
    expect(new SlotTakenError(1).message).toContain("Only 1 seat left");
    expect(new SlotTakenError(0).message).toContain("just booked by someone else");
  });

  it("rejects an unknown or missing start time as a validation error", () => {
    expect(() => assertRequestFits(openDay, "day", "18:00", 1)).toThrow(ValidationError);
    expect(() => assertRequestFits(openDay, "day", null, 1)).toThrow(ValidationError);
  });

  it("rejects closed and past dates as a validation error on the date", () => {
    for (const date of ["2027-02-20", "2027-03-01"]) {
      const day = computeDayState(input(dayTour), date);
      try {
        assertRequestFits(day, "day", "09:00", 1);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).fieldErrors).toHaveProperty("date");
      }
    }
  });

  it("checks departure seats and private exclusivity", () => {
    const departures = [{ id: DEPARTURE, tourId: TOUR, startDate: "2027-03-10", capacity: 8, isOpen: true }];
    const dep = computeDayState(
      input(departureTour, { departures, bookings: [booking({ tourKind: "departure", departureId: DEPARTURE, slotTime: null, seats: 6 })] }),
      "2027-03-10",
    );
    expect(() => assertRequestFits(dep, "departure", null, 2)).not.toThrow();
    expect(() => assertRequestFits(dep, "departure", null, 3)).toThrow(SlotTakenError);

    const free = computeDayState(input(privateTour), "2027-03-10");
    // A private party is one unit, however many people travel.
    expect(() => assertRequestFits(free, "private", null, 6)).not.toThrow();
    const held = computeDayState(input(privateTour, { bookings: [booking({ tourKind: "private", endDate: "2027-03-12", held: true })] }), "2027-03-10");
    expect(() => assertRequestFits(held, "private", null, 1)).toThrow(SlotTakenError);
    const full = computeDayState(input(privateTour, { bookings: [booking({ tourKind: "private", endDate: "2027-03-12" })] }), "2027-03-10");
    expect(() => assertRequestFits(full, "private", null, 1)).toThrow(SlotTakenError);
  });
});

describe("pricing", () => {
  it.each([
    [{ priceAdult: 69_000, childPricePercent: 50, adults: 2, children: 0 }, { unitPriceAdult: 69_000, unitPriceChild: 34_500, baseAmount: 138_000 }],
    [{ priceAdult: 69_000, childPricePercent: 50, adults: 2, children: 3 }, { unitPriceAdult: 69_000, unitPriceChild: 34_500, baseAmount: 241_500 }],
    // 16 500 × 33% = 5 445 exactly; 165.01 × 50% = 82.505 → rounds half up to 82.51
    [{ priceAdult: 16_500, childPricePercent: 33, adults: 1, children: 2 }, { unitPriceAdult: 16_500, unitPriceChild: 5_445, baseAmount: 27_390 }],
    [{ priceAdult: 16_501, childPricePercent: 50, adults: 1, children: 1 }, { unitPriceAdult: 16_501, unitPriceChild: 8_251, baseAmount: 24_752 }],
    [{ priceAdult: 999, childPricePercent: 0, adults: 1, children: 4 }, { unitPriceAdult: 999, unitPriceChild: 0, baseAmount: 999 }],
    [{ priceAdult: 999, childPricePercent: 100, adults: 1, children: 1 }, { unitPriceAdult: 999, unitPriceChild: 999, baseAmount: 1_998 }],
    [{ priceAdult: 0, childPricePercent: 50, adults: 3, children: 1 }, { unitPriceAdult: 0, unitPriceChild: 0, baseAmount: 0 }],
  ])("%o → %o", (given, expected) => {
    const price = priceBooking(given);
    expect(price).toEqual(expected);
    expect(Object.values(price).every(Number.isInteger)).toBe(true);
  });

  it.each([
    { priceAdult: 10.5, childPricePercent: 50, adults: 1, children: 0 },
    { priceAdult: -1, childPricePercent: 50, adults: 1, children: 0 },
    { priceAdult: 100, childPricePercent: 50, adults: 1.5, children: 0 },
    { priceAdult: 100, childPricePercent: 50, adults: 1, children: -1 },
    { priceAdult: 100, childPricePercent: 101, adults: 1, children: 0 },
    { priceAdult: 100, childPricePercent: -1, adults: 1, children: 0 },
    { priceAdult: 100, childPricePercent: Number.NaN, adults: 1, children: 0 },
  ])("rejects %o", (given) => {
    expect(() => priceBooking(given)).toThrow(RangeError);
  });
});

describe("csv", () => {
  it.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+44 7700 900821", "'+44 7700 900821"],
    ["-2+3", "'-2+3"],
    ["@handle", "'@handle"],
    ["\tcmd", "'\tcmd"],
    ["＝full-width", "'＝full-width"],
    ['=HYPERLINK("http://evil.test","x")', `"'=HYPERLINK(""http://evil.test"",""x"")"`],
    ["plain", "plain"],
    ["a = b", "a = b"],
    ["Smith, John", '"Smith, John"'],
    ['say "hi"', '"say ""hi"""'],
    ["line one\nline two", '"line one\nline two"'],
    ["\rcarriage", `"'\rcarriage"`],
    ["", ""],
  ])("escapes %j as %j", (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it("formats non-text values", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(true)).toBe("yes");
    expect(csvCell(false)).toBe("no");
    expect(csvCell(new Date("2027-03-01T09:00:00Z"))).toBe("2027-03-01T09:00:00.000Z");
  });

  it("writes a header row and CRLF line ends", () => {
    expect(toCsv(["Name", "Total"], [["Ann", 5], ["=1+1", null]])).toBe("Name,Total\r\nAnn,5\r\n'=1+1,\r\n");
    expect(toCsv(["Only"], [])).toBe("Only\r\n");
  });

  it("turns minor units into a decimal for the currency", () => {
    expect(minorToDecimal(69_000, "USD")).toBe("690.00");
    expect(minorToDecimal(5, "USD")).toBe("0.05");
    expect(minorToDecimal(1_200, "JPY")).toBe("1200");
    expect(minorToDecimal(1_250, "not-a-currency")).toBe("12.50");
  });
});

describe("clash detection", () => {
  let n = 0;
  const live = (overrides: Partial<LiveBooking>): LiveBooking => {
    n += 1;
    return {
      id: `l${n}`,
      reference: `WF-OLD-${1000 + n}`,
      contactName: `Guest ${n}`,
      tourId: TOUR,
      tourKind: "day",
      departureId: null,
      startDate: "2027-03-10",
      endDate: "2027-03-10",
      slotTime: "14:00",
      seats: 4,
      status: "pending",
      ...overrides,
    };
  };

  it("flags a day slot whose parties exceed its capacity, naming the others", () => {
    const target = live({ seats: 5, contactName: "Marco Rossi" });
    const other = live({ seats: 4, contactName: "Claire Dubois", status: "confirmed" });
    const [clash] = detectClashes(target, [target, other], 8);
    expect(clash).toMatchObject({ type: "over_capacity", seats: 9, capacity: 8 });
    expect(clash!.message).toBe("Over capacity: 9 of 8 seats on 2027-03-10 at 14:00 with Claire Dubois (confirmed, 4)");
    expect(clash!.with).toEqual([expect.objectContaining({ id: other.id, name: "Claire Dubois", status: "confirmed", seats: 4 })]);
  });

  it("does not flag parties that fit exactly, or other slots, dates and tours", () => {
    const target = live({ seats: 4 });
    expect(detectClashes(target, [live({ seats: 4 })], 8)).toEqual([]);
    expect(detectClashes(target, [live({ seats: 8, slotTime: "09:00" })], 8)).toEqual([]);
    expect(detectClashes(target, [live({ seats: 8, startDate: "2027-03-11", endDate: "2027-03-11" })], 8)).toEqual([]);
    expect(detectClashes(target, [live({ seats: 8, tourId: OTHER_TOUR })], 8)).toEqual([]);
  });

  it("flags a single party larger than the unit, and nothing when the unit no longer exists", () => {
    const target = live({ seats: 9 });
    expect(detectClashes(target, [], 8)[0]!.message).toBe("Over capacity: 9 of 8 seats on 2027-03-10 at 14:00");
    expect(detectClashes(target, [live({ seats: 8 })], null)).toEqual([]);
  });

  it("compares departures by departure id, or by start date when ids are missing", () => {
    const target = live({ tourKind: "departure", departureId: DEPARTURE, slotTime: null, seats: 5, endDate: "2027-03-12" });
    const same = live({ tourKind: "departure", departureId: DEPARTURE, slotTime: null, seats: 4, endDate: "2027-03-12" });
    const otherDeparture = live({ tourKind: "departure", departureId: "55555555-5555-4555-8555-555555555555", slotTime: null, seats: 8 });
    const legacy = live({ tourKind: "departure", departureId: null, slotTime: null, seats: 4 });
    expect(detectClashes(target, [same, otherDeparture], 8)[0]).toMatchObject({ seats: 9, message: expect.stringContaining("on 2027-03-10 with") });
    expect(detectClashes(target, [otherDeparture], 8)).toEqual([]);
    expect(detectClashes(target, [legacy], 8)[0]).toMatchObject({ seats: 9 });
  });

  it("flags every overlapping private booking, across tours, one message each", () => {
    const target = live({ tourKind: "private", slotTime: null, startDate: "2027-06-14", endDate: "2027-06-21", contactName: "Thomas Becker" });
    const sameTour = live({ tourKind: "private", slotTime: null, startDate: "2027-06-16", endDate: "2027-06-23", contactName: "Rachel Green" });
    const otherTour = live({ tourKind: "private", slotTime: null, tourId: OTHER_TOUR, startDate: "2027-06-21", endDate: "2027-06-22", status: "confirmed" });
    const later = live({ tourKind: "private", slotTime: null, startDate: "2027-06-22", endDate: "2027-06-29" });
    const dayBooking = live({ startDate: "2027-06-15", endDate: "2027-06-15" });
    const clashes = detectClashes(target, [target, sameTour, otherTour, later, dayBooking], null);
    expect(clashes).toHaveLength(2);
    expect(clashes[0]).toMatchObject({ type: "overlap", message: "Overlaps Rachel Green’s private tour (2027-06-16 – 2027-06-23, pending)" });
    expect(clashes[1]!.with[0]).toMatchObject({ id: otherTour.id, status: "confirmed" });
  });
});

describe("status machine table", () => {
  const statuses = ["pending", "confirmed", "completed", "cancelled"] as const;
  const allowed = new Set(["pending>confirmed", "pending>cancelled", "confirmed>completed", "confirmed>cancelled", "cancelled>pending"]);

  it.each(statuses.flatMap((from) => statuses.map((to) => [from, to] as const)))("%s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
  });

  it("has no way out of completed", () => {
    expect(BOOKING_TRANSITIONS.completed).toEqual([]);
  });
});

describe("references, locks and small helpers", () => {
  it("builds PREFIX-TOUR-digits from the tour slug", () => {
    const fixed = (min: number) => min + 3821;
    expect(makeReference("AJ", "sheki-silk-road", 4, fixed)).toBe("AJ-SHE-4821");
    expect(makeReference("WF", "7-wonders", 4, fixed)).toBe("WF-WON-4821");
    expect(makeReference("WF", "a1", 4, fixed)).toBe("WF-AXX-4821");
    expect(makeReference("WF", "2027", 4, fixed)).toBe("WF-XXX-4821");
    expect(makeReference("WF", "old-city", 6, (min, max) => max - 1)).toBe("WF-OLD-999999");
    expect(makeReference("WF", "old-city", 4, (min) => min)).toBe("WF-OLD-1000");
  });

  it("derives a stable lock key per tenant and unit", () => {
    const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(advisoryKey(tenantA, "private")).toBe(advisoryKey(tenantA, "private"));
    expect(advisoryKey(tenantA, "private")).not.toBe(advisoryKey(tenantB, "private"));
    expect(advisoryKey(tenantA, "private")).not.toBe(advisoryKey(tenantA, "quota"));
    const key = advisoryKey(tenantA, "private");
    // Fits PostgreSQL's signed 64-bit lock key.
    expect(typeof key).toBe("bigint");
    expect(BigInt.asIntN(64, key)).toBe(key);
  });

  it("names the unit a booking takes seats from", () => {
    const at = { startDate: "2027-03-10", slotTime: "09:00:00", departureId: null };
    expect(bookableUnit({ id: TOUR, kind: "day" }, at)).toBe(`day:${TOUR}:2027-03-10:09:00`);
    expect(bookableUnit({ id: TOUR, kind: "day" }, { ...at, slotTime: "09:00" })).toBe(`day:${TOUR}:2027-03-10:09:00`);
    expect(bookableUnit({ id: TOUR, kind: "day" }, { ...at, slotTime: null })).toBe(`day:${TOUR}:2027-03-10:`);
    expect(bookableUnit({ id: TOUR, kind: "departure" }, { ...at, departureId: DEPARTURE })).toBe(`departure:${TOUR}:${DEPARTURE}`);
    expect(bookableUnit({ id: TOUR, kind: "departure" }, at)).toBe(`departure:${TOUR}:2027-03-10`);
    // Every private tour of a tenant shares the guide, so they share one unit.
    expect(bookableUnit({ id: TOUR, kind: "private" }, at)).toBe("private");
    expect(bookableUnit({ id: OTHER_TOUR, kind: "private" }, at)).toBe("private");
  });

  it("escapes LIKE wildcards, trims times and rejects malformed ids", () => {
    expect(escapeLike("100%_done\\")).toBe("100\\%\\_done\\\\");
    expect(normaliseTime("09:00:00")).toBe("09:00");
    expect(() => assertId("not-an-id", "Booking")).toThrow(NotFoundError);
    expect(() => assertId(undefined, "Booking")).toThrow(NotFoundError);
    expect(() => assertId(TOUR, "Booking")).not.toThrow();
  });

  it("turns schema failures into field errors, with whole-input problems under `form`", () => {
    const schema = z.object({ name: z.string().min(2, "Too short."), age: z.number().optional() });
    expect(parse(schema, { name: "Ann", extra: 1 })).toEqual({ name: "Ann" });
    const errorOf = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error as ValidationError;
      }
      throw new Error("expected a validation error");
    };
    const field = errorOf(() => parse(schema, { name: "A" }));
    expect(field).toBeInstanceOf(ValidationError);
    expect(field.fieldErrors).toEqual({ name: ["Too short."] });
    const whole = errorOf(() => parse(schema, "not an object"));
    expect(whole.fieldErrors).toEqual({ form: [expect.any(String)] });
  });
});
