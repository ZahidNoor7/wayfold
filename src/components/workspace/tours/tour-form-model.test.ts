import { describe, expect, it } from "vitest";
import {
  KIND_OPTIONS,
  WEEKDAYS,
  currencyDigits,
  departureSeats,
  emptyTourValues,
  flattenFormErrors,
  formatCalendarDate,
  formatDateRange,
  locateErrors,
  locateField,
  minorToInput,
  moveItem,
  parseCoordinate,
  parseMoney,
  parseWhole,
  sectionsFor,
  slugFromTitle,
  tourFormSchema,
  tourToValues,
  valuesToPayload,
  type StoredTour,
  type TourFormValues,
} from "./tour-form-model";

describe("money", () => {
  it("knows how many decimals a currency has", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("KWD")).toBe(3);
    expect(currencyDigits("not-a-currency")).toBe(2);
  });

  it("shows minor units as a typed amount", () => {
    expect(minorToInput(69000, "USD")).toBe("690");
    expect(minorToInput(69050, "USD")).toBe("690.50");
    expect(minorToInput(5, "USD")).toBe("0.05");
    expect(minorToInput(1200, "JPY")).toBe("1200");
    expect(minorToInput(1500, "KWD")).toBe("1.500");
  });

  it("reads a typed amount into minor units", () => {
    expect(parseMoney("690", "USD")).toEqual({ ok: true, minor: 69000 });
    expect(parseMoney(" 1,250.5 ", "USD")).toEqual({ ok: true, minor: 125050 });
    expect(parseMoney("0.07", "USD")).toEqual({ ok: true, minor: 7 });
    expect(parseMoney("19.99", "USD")).toEqual({ ok: true, minor: 1999 });
    expect(parseMoney("12.", "USD")).toEqual({ ok: true, minor: 1200 });
    expect(parseMoney("", "USD")).toEqual({ ok: true, minor: 0 });
    expect(parseMoney("1200", "JPY")).toEqual({ ok: true, minor: 1200 });
    expect(parseMoney("1.5", "KWD")).toEqual({ ok: true, minor: 1500 });
  });

  it("explains amounts it cannot read", () => {
    expect(parseMoney("-5", "USD")).toEqual({ ok: false, message: "The price cannot be negative." });
    expect(parseMoney("abc", "USD")).toEqual({ ok: false, message: "Enter the price as a number, for example 120 or 120.50." });
    expect(parseMoney("1.2.3", "USD").ok).toBe(false);
    expect(parseMoney("1.999", "USD")).toEqual({ ok: false, message: "Use at most 2 decimal places." });
    expect(parseMoney("12.5", "JPY")).toEqual({ ok: false, message: "JPY prices have no decimals." });
    expect(parseMoney("1000000.01", "USD")).toEqual({ ok: false, message: "That price is too high." });
    expect(parseMoney("1000000", "USD")).toEqual({ ok: true, minor: 100_000_000 });
  });
});

describe("small readers", () => {
  it("reads whole numbers", () => {
    expect(parseWhole(" 12 ")).toBe(12);
    expect(parseWhole("0")).toBe(0);
    expect(parseWhole("1.5")).toBeNull();
    expect(parseWhole("-1")).toBeNull();
    expect(parseWhole("")).toBeNull();
  });

  it("reads coordinates", () => {
    expect(parseCoordinate("")).toBeNull();
    expect(parseCoordinate(" 40.4093 ")).toBe(40.4093);
    expect(parseCoordinate("-49,85")).toBe(-49.85);
    expect(parseCoordinate("north")).toBeNaN();
  });

  it("derives a web address the way the server does", () => {
    expect(slugFromTitle("Silk Road to Şəki!")).toBe("silk-road-to-s-ki");
    expect(slugFromTitle("  Café & Crème  ")).toBe("cafe-creme");
    expect(slugFromTitle("日本")).toBe("");
    expect(slugFromTitle(`${"a".repeat(79)} b c`)).toBe("a".repeat(79));
  });

  it("moves an item without touching the original list", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(list, 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(list, 1, 1)).toEqual(list);
    expect(moveItem(list, -1, 1)).toEqual(list);
    expect(moveItem(list, 0, 3)).toEqual(list);
    expect(moveItem(list, 5, 0)).toEqual(list);
    expect(list).toEqual(["a", "b", "c"]);
  });

  it("lists the weekdays Monday first and explains each way of selling", () => {
    expect(WEEKDAYS.map((day) => day.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(KIND_OPTIONS.map((option) => option.value)).toEqual(["day", "departure", "private"]);
    expect(KIND_OPTIONS.every((option) => option.explanation.length > 20)).toBe(true);
  });
});

const stored: StoredTour = {
  title: "Old city walk",
  slug: "old-city-walk",
  summary: "Two hours inside the walls.",
  description: "Long text",
  categoryId: "c1",
  destinationId: null,
  place: "Old city",
  kind: "day",
  durationDays: 1,
  durationLabel: "2 hours",
  priceAdult: 4550,
  childPricePercent: 40,
  childMaxAge: 12,
  minGroupSize: 2,
  maxGroupSize: 10,
  schedule: { weekdays: [6, 2], slots: [{ time: "09:00:00", capacity: 8 }] },
  languages: ["English", "Turkish"],
  highlights: ["Maiden tower"],
  inclusions: ["Guide"],
  exclusions: [],
  goodToKnow: ["Wear flat shoes"],
  faq: [{ question: "Is it step-free?", answer: "Mostly." }],
  meetingPoint: "The double gate",
  meetingLatitude: 40.3661,
  meetingLongitude: 49.8372,
  cancellationPolicy: "Free up to 24 hours before.",
  isFeatured: true,
  isPopular: false,
  itinerary: [{ title: "The walls", location: "Gate", description: "Start here.", meta: "30 min" }],
  media: [{ mediaId: "m1", url: "https://res.cloudinary.com/x/image/upload/a.jpg", alt: "Gate", resourceType: "image" }],
};

describe("stored tour → form", () => {
  it("starts a new tour from the database defaults", () => {
    const blank = emptyTourValues();
    expect(blank).toMatchObject({ title: "", slug: "", kind: "private", durationDays: "1", priceAdult: "", childPricePercent: "50", childMaxAge: "11", minGroupSize: "1", maxGroupSize: "8" });
    expect(blank.weekdays).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(blank.media).toEqual([]);
  });

  it("fills the form from a stored tour", () => {
    const values = tourToValues(stored, "USD");
    expect(values).toMatchObject({
      title: "Old city walk",
      slug: "old-city-walk",
      categoryId: "c1",
      destinationId: "",
      priceAdult: "45.50",
      childPricePercent: "40",
      weekdays: [2, 6],
      slots: [{ time: "09:00", capacity: "8" }],
      languages: [{ value: "English" }, { value: "Turkish" }],
      highlights: [{ value: "Maiden tower" }],
      meetingLatitude: "40.3661",
      meetingLongitude: "49.8372",
      isFeatured: true,
    });
    expect(values.itinerary).toEqual(stored.itinerary);
    expect(values.media).toEqual(stored.media);
  });

  it("leaves the price and coordinates empty when there are none", () => {
    const values = tourToValues({ ...stored, priceAdult: 0, meetingLatitude: null, meetingLongitude: null }, "USD");
    expect(values.priceAdult).toBe("");
    expect(values.meetingLatitude).toBe("");
    expect(values.meetingLongitude).toBe("");
  });
});

describe("form → payload", () => {
  it("round-trips a stored tour", () => {
    const payload = valuesToPayload(tourToValues(stored, "USD"), "USD");
    expect(payload.tour).toEqual({
      title: "Old city walk",
      slug: "old-city-walk",
      summary: "Two hours inside the walls.",
      description: "Long text",
      categoryId: "c1",
      destinationId: null,
      place: "Old city",
      kind: "day",
      durationDays: 1,
      durationLabel: "2 hours",
      priceAdult: 4550,
      childPricePercent: 40,
      childMaxAge: 12,
      minGroupSize: 2,
      maxGroupSize: 10,
      schedule: { weekdays: [2, 6], slots: [{ time: "09:00", capacity: 8 }] },
      languages: ["English", "Turkish"],
      highlights: ["Maiden tower"],
      inclusions: ["Guide"],
      exclusions: [],
      goodToKnow: ["Wear flat shoes"],
      faq: [{ question: "Is it step-free?", answer: "Mostly." }],
      meetingPoint: "The double gate",
      meetingLatitude: 40.3661,
      meetingLongitude: 49.8372,
      cancellationPolicy: "Free up to 24 hours before.",
      isFeatured: true,
      isPopular: false,
    });
    expect(payload.itinerary).toEqual([{ dayNumber: 1, title: "The walls", location: "Gate", description: "Start here.", meta: "30 min" }]);
    expect(payload.mediaIds).toEqual(["m1"]);
  });

  it("converts what was typed: price to minor units, blank rows dropped, days numbered", () => {
    const values: TourFormValues = {
      ...emptyTourValues(),
      title: "  Mountain week  ",
      kind: "departure",
      durationDays: "7",
      priceAdult: "1,250.5",
      weekdays: [5, 1, 5],
      slots: [{ time: "08:00", capacity: "6" }],
      highlights: [{ value: " Peaks " }, { value: "  " }],
      languages: [{ value: "English" }, { value: "english" }, { value: "English" }, { value: "" }],
      itinerary: [
        { title: " Arrive ", location: "", description: "", meta: "" },
        { title: "Climb", location: " Ridge ", description: " Up. ", meta: " 6 h " },
      ],
      media: [
        { mediaId: "b", url: "u", alt: "", resourceType: "video" },
        { mediaId: "a", url: "u", alt: "", resourceType: "image" },
      ],
    };
    const payload = valuesToPayload(values, "USD");
    expect(payload.tour).toMatchObject({
      title: "Mountain week",
      durationDays: 7,
      priceAdult: 125050,
      // Only day tours have start times.
      schedule: { weekdays: [1, 5], slots: [] },
      highlights: ["Peaks"],
      languages: ["English", "english"],
      meetingLatitude: null,
      meetingLongitude: null,
      categoryId: null,
    });
    // No web address typed: the server chooses one from the title.
    expect(payload.tour).not.toHaveProperty("slug");
    expect(payload.itinerary).toEqual([
      { dayNumber: 1, title: "Arrive", location: "", description: "", meta: "" },
      { dayNumber: 2, title: "Climb", location: "Ridge", description: "Up.", meta: "6 h" },
    ]);
    expect(payload.mediaIds).toEqual(["b", "a"]);
  });

  it("keeps a day tour one day long and falls back to safe numbers for unreadable boxes", () => {
    const payload = valuesToPayload(
      { ...emptyTourValues(), title: "Walk", kind: "day", durationDays: "3", priceAdult: "oops", childPricePercent: "x", childMaxAge: "", minGroupSize: "?", maxGroupSize: "", slots: [{ time: "10:00", capacity: "" }] },
      "USD",
    );
    expect(payload.tour).toMatchObject({ durationDays: 1, priceAdult: 0, childPricePercent: 50, childMaxAge: 11, minGroupSize: 1, maxGroupSize: 8, schedule: { slots: [{ time: "10:00", capacity: 1 }] } });
    const multiDay = valuesToPayload({ ...emptyTourValues(), title: "Trek", kind: "private", durationDays: "" }, "USD");
    expect(multiDay.tour.durationDays).toBe(1);
  });
});

describe("client checks", () => {
  const schema = tourFormSchema("USD", { requireSlug: true });
  const valid: TourFormValues = { ...tourToValues(stored, "USD") };
  const messages = (values: TourFormValues, options = { requireSlug: true }) => {
    const result = tourFormSchema("USD", options).safeParse(values);
    return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
  };

  it("accepts a complete tour and an unfinished draft", () => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(messages({ ...emptyTourValues(), title: "New tour" }, { requireSlug: false })).toEqual({});
  });

  it("needs a title, and a web address once the tour exists", () => {
    expect(messages({ ...valid, title: " a " })).toEqual({ title: "Add a title (3+ characters)." });
    expect(messages({ ...valid, slug: "" })).toEqual({ slug: "Add a web address using lowercase letters, numbers and single hyphens." });
    expect(messages({ ...valid, slug: "Old City" }, { requireSlug: false })).toEqual({ slug: "Use lowercase letters, numbers and single hyphens only." });
    expect(messages({ ...valid, slug: " old-city " })).toEqual({});
  });

  it("checks numbers where they are typed", () => {
    expect(messages({ ...valid, priceAdult: "12.345" })).toEqual({ priceAdult: "Use at most 2 decimal places." });
    expect(messages({ ...valid, childPricePercent: "150" })).toEqual({ childPricePercent: "Use a percentage from 0 to 100." });
    expect(messages({ ...valid, childMaxAge: "18" })).toEqual({ childMaxAge: "Use an age from 0 to 17." });
    expect(messages({ ...valid, kind: "private", durationDays: "0" })).toEqual({ durationDays: "Use a whole number of days from 1 to 365." });
    expect(messages({ ...valid, kind: "departure", durationDays: "400" })).toEqual({ durationDays: "Use a whole number of days from 1 to 365." });
    // A day tour is always one day, so whatever is left in the hidden box does not matter.
    expect(messages({ ...valid, kind: "day", durationDays: "0" })).toEqual({});
    expect(messages({ ...valid, minGroupSize: "9", maxGroupSize: "4" })).toEqual({ maxGroupSize: "The largest group cannot be smaller than the smallest group." });
    expect(messages({ ...valid, minGroupSize: "many" })).toEqual({ minGroupSize: "Use a group size from 1 to 99." });
  });

  it("checks coordinates as a pair", () => {
    expect(messages({ ...valid, meetingLatitude: "95" })).toEqual({ meetingLatitude: "Latitude is a number between -90 and 90." });
    expect(messages({ ...valid, meetingLongitude: "east" })).toEqual({ meetingLongitude: "Longitude is a number between -180 and 180." });
    expect(messages({ ...valid, meetingLatitude: "" })).toEqual({ meetingLatitude: "Give both a latitude and a longitude, or neither." });
    expect(messages({ ...valid, meetingLongitude: "" })).toEqual({ meetingLongitude: "Give both a latitude and a longitude, or neither." });
    expect(messages({ ...valid, meetingLatitude: "", meetingLongitude: "" })).toEqual({});
  });

  it("checks repeatable rows", () => {
    expect(messages({ ...valid, slots: [{ time: "", capacity: "0" }] })).toEqual({ "slots.0.time": "Choose a start time.", "slots.0.capacity": "Use 1 to 999 seats." });
    expect(
      messages({
        ...valid,
        slots: [
          { time: "09:00", capacity: "8" },
          { time: "09:00", capacity: "8" },
        ],
      }),
    ).toEqual({ "slots.1.time": "Each start time can only be listed once." });
    // Start times only matter for day tours.
    expect(messages({ ...valid, kind: "private", slots: [{ time: "09:00", capacity: "8" }, { time: "", capacity: "0" }] })).toEqual({});
    expect(messages({ ...valid, slots: Array.from({ length: 25 }, (_, index) => ({ time: `${String(index % 24).padStart(2, "0")}:${index === 24 ? "30" : "00"}`, capacity: "8" })) })).toEqual({
      slots: "Keep this to 24 start times.",
    });
    expect(messages({ ...valid, itinerary: [{ title: " ", location: "", description: "", meta: "" }] })).toEqual({ "itinerary.0.title": "Give each day a title." });
    expect(messages({ ...valid, faq: [{ question: "", answer: "" }] })).toEqual({ "faq.0.question": "Add the question.", "faq.0.answer": "Add the answer." });
    expect(messages({ ...valid, highlights: [{ value: "x".repeat(301) }] })).toEqual({ "highlights.0.value": "Keep this under 300 characters." });
  });
});

describe("where an error belongs", () => {
  it("finds the section and label of a field or path", () => {
    expect(locateField("priceAdult")).toEqual({ section: "pricing", label: "Adult price" });
    expect(locateField("slots.0.time")).toEqual({ section: "schedule", label: "Start times" });
    expect(locateField("days")).toEqual({ section: "itinerary", label: "Itinerary" });
    expect(locateField("mediaIds")).toEqual({ section: "media", label: "Photos and videos" });
    expect(locateField("form")).toEqual({ section: "basics", label: "This tour" });
  });

  it("lists server errors in page order", () => {
    expect(locateErrors(undefined)).toEqual([]);
    expect(
      locateErrors({
        departures: ["Add at least one upcoming departure date."],
        schedule: ["Add at least one start time.", "Choose at least one day of the week."],
        summary: ["Add a short summary for tour cards."],
        priceAdult: ["Enter a price above 0."],
        ignored: undefined,
      }),
    ).toEqual([
      { field: "summary", section: "basics", label: "Summary", message: "Add a short summary for tour cards." },
      { field: "priceAdult", section: "pricing", label: "Adult price", message: "Enter a price above 0." },
      { field: "schedule", section: "schedule", label: "Schedule", message: "Add at least one start time." },
      { field: "schedule", section: "schedule", label: "Schedule", message: "Choose at least one day of the week." },
      { field: "departures", section: "departures", label: "Departure dates", message: "Add at least one upcoming departure date." },
    ]);
  });

  it("shows the sections that apply to a tour", () => {
    expect(sectionsFor("day", { saved: true })).toEqual(["basics", "pricing", "schedule", "blocks", "itinerary", "details", "media", "visibility"]);
    expect(sectionsFor("departure", { saved: true })).toContain("departures");
    expect(sectionsFor("departure", { saved: false })).toEqual(["basics", "pricing", "schedule", "departures", "itinerary", "details", "media", "visibility"]);
  });

  it("flattens form errors to paths", () => {
    expect(flattenFormErrors(undefined)).toEqual({});
    expect(
      flattenFormErrors({
        title: { type: "too_small", message: "Add a title (3+ characters)." },
        slots: [undefined, { time: { message: "Choose a start time." }, capacity: { message: "Use 1 to 999 seats." } }],
        faq: { root: { message: "Keep this to 40 questions." } },
        media: { message: "A tour can show up to 60 files." },
        weekdays: { ref: {} },
        kind: null,
      }),
    ).toEqual({
      title: "Add a title (3+ characters).",
      "slots.1.time": "Choose a start time.",
      "slots.1.capacity": "Use 1 to 999 seats.",
      faq: "Keep this to 40 questions.",
      media: "A tour can show up to 60 files.",
    });
  });
});

describe("departure seats", () => {
  const departure = { startDate: "2027-05-10", capacity: 12, isOpen: true, seatsBooked: 5 };
  const today = "2027-04-01";

  it("uses the live calendar when it covers the date", () => {
    expect(departureSeats(departure, { state: "open", reason: null, seatsLeft: 9, capacity: 12 }, today)).toEqual({ taken: 3, left: 9, status: "open", label: "Open" });
    expect(departureSeats(departure, { state: "limited", reason: null, seatsLeft: 1, capacity: 12 }, today)).toEqual({ taken: 11, left: 1, status: "limited", label: "1 seat left" });
    expect(departureSeats(departure, { state: "limited", reason: null, seatsLeft: 3, capacity: 12 }, today).label).toBe("3 seats left");
    expect(departureSeats(departure, { state: "full", reason: "sold_out", seatsLeft: 0, capacity: 12 }, today)).toEqual({ taken: 12, left: 0, status: "full", label: "Full" });
  });

  it("falls back to the departure's own count", () => {
    expect(departureSeats(departure, undefined, today)).toEqual({ taken: 5, left: 7, status: "open", label: "Open" });
    expect(departureSeats({ ...departure, seatsBooked: 14 }, undefined, today)).toMatchObject({ taken: 14, left: 0, status: "full" });
  });

  it("says why a departure cannot be booked", () => {
    const closedDay = (reason: string) => ({ state: "closed" as const, reason, seatsLeft: 0, capacity: null });
    expect(departureSeats({ ...departure, startDate: "2027-03-01" }, undefined, today)).toMatchObject({ status: "past", label: "Departed", taken: 5 });
    expect(departureSeats({ ...departure, isOpen: false }, closedDay("departure_closed"), today)).toMatchObject({ status: "closed", label: "Closed to new bookings" });
    expect(departureSeats(departure, closedDay("blocked"), today)).toMatchObject({ status: "blocked", label: "Blocked by a closure", taken: 5 });
    expect(departureSeats(departure, closedDay("day_off"), today)).toMatchObject({ status: "blocked", label: "Falls on a weekly day off" });
    expect(departureSeats(departure, closedDay("min_notice"), today)).toMatchObject({ status: "outside", label: "Too soon to book online" });
    expect(departureSeats(departure, closedDay("beyond_horizon"), today)).toMatchObject({ status: "outside", label: "Not open for booking yet" });
  });
});

describe("calendar dates", () => {
  it("formats a date without shifting it across timezones", () => {
    expect(formatCalendarDate("2027-05-10")).toBe("Mon, 10 May 2027");
    expect(formatCalendarDate("2027-01-01", { weekday: false })).toBe("1 Jan 2027");
    expect(formatCalendarDate("soon")).toBe("soon");
  });

  it("formats a range, collapsing a single day", () => {
    expect(formatDateRange("2027-05-10", "2027-05-10")).toBe("10 May 2027");
    expect(formatDateRange("2027-05-10", "2027-05-14")).toBe("10 May 2027 – 14 May 2027");
  });
});
