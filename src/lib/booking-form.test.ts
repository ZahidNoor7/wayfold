import { describe, expect, it } from "vitest";
import {
  bookHref,
  calendarHint,
  cellCaption,
  childNote,
  clampParty,
  contactMethodLabel,
  countries,
  currencyDigits,
  defaultParty,
  dialCodeOf,
  diallingCodes,
  discountAmount,
  discountLabel,
  discountRequestFormSchema,
  discountSourceLabel,
  durationText,
  emptyDraft,
  firstName,
  fromPrice,
  fullPhone,
  guestRange,
  holdText,
  initials,
  isBookable,
  isEmail,
  mapsHref,
  monthSummary,
  nextAvailable,
  offerAudience,
  offerBadge,
  offerCountdown,
  offerValidity,
  offerValue,
  otherMatchesNote,
  parseDiscountValue,
  parseStoredDraft,
  partyLimits,
  partySummary,
  prefillFromQuery,
  priceParty,
  quoteParty,
  reasonText,
  releaseSelection,
  requestTimeline,
  restoreDraft,
  seatLine,
  seatWarning,
  serialiseDraft,
  slotStatus,
  splitDiscountLabel,
  stepOfServerErrors,
  stepParty,
  stepperState,
  toBookingPayload,
  trackerSchema,
  unavailableTitle,
  validateDateStep,
  validateDetails,
  validateReview,
  waitlistSchema,
  whatsappHref,
  withTour,
  type BookingDraft,
  type DayInfo,
} from "./booking-form";

const pricing = { priceAdult: 69000, childPricePercent: 50 };

function day(overrides: Partial<DayInfo> = {}): DayInfo {
  return { date: "2027-04-17", endDate: "2027-04-19", state: "open", reason: null, seatsLeft: 4, capacity: 8, slots: null, ...overrides };
}

function draft(overrides: Partial<BookingDraft> = {}): BookingDraft {
  return { ...emptyDraft("silk-road", { adults: 2, children: 0 }), ...overrides };
}

describe("pricing", () => {
  it("mirrors the server: child unit price rounded once, then multiplied", () => {
    expect(priceParty(pricing, { adults: 2, children: 1 })).toEqual({
      unitPriceAdult: 69000,
      unitPriceChild: 34500,
      adultsTotal: 138000,
      childrenTotal: 34500,
      baseAmount: 172500,
    });
    // 8501 × 50% = 4250.5 → 4251 per child, so three children cost 12753, not 12752.
    expect(priceParty({ priceAdult: 8501, childPricePercent: 50 }, { adults: 0, children: 3 }).childrenTotal).toBe(12753);
  });

  it("prices bad input as zero instead of throwing in a render", () => {
    expect(priceParty({ priceAdult: -5, childPricePercent: Number.NaN }, { adults: Number.NaN, children: -2 }).baseAmount).toBe(0);
    expect(priceParty({ priceAdult: 1000, childPricePercent: 250 }, { adults: 1, children: 1 }).unitPriceChild).toBe(1000);
    expect(priceParty({ priceAdult: 1000, childPricePercent: -10 }, { adults: 1, children: 1 }).unitPriceChild).toBe(0);
  });

  it("rounds percentages and caps fixed amounts at the price", () => {
    expect(discountAmount("percent", 15, 138000)).toBe(20700);
    expect(discountAmount("percent", 15, 333)).toBe(50);
    expect(discountAmount("fixed", 30000, 138000)).toBe(30000);
    expect(discountAmount("fixed", 30000, 12000)).toBe(12000);
    expect(discountAmount("percent", 0, 1000)).toBe(0);
    expect(discountAmount("percent", 10, 0)).toBe(0);
    expect(discountAmount("percent", Number.NaN, 1000)).toBe(0);
  });

  it("quotes a party with and without an offer", () => {
    expect(quoteParty(pricing, { adults: 2, children: 0 }, { type: "percent", value: 15 })).toMatchObject({
      baseAmount: 138000,
      discountAmount: 20700,
      totalAmount: 117300,
    });
    expect(quoteParty(pricing, { adults: 2, children: 0 }, null)).toMatchObject({ discountAmount: 0, totalAmount: 138000 });
  });

  it("words discounts", () => {
    expect(discountLabel("percent", 15, "USD")).toBe("15% off");
    expect(discountLabel("fixed", 30000, "USD")).toBe("$300 off");
    expect(offerBadge("percent", 15, "USD")).toBe("−15%");
    expect(offerBadge("fixed", 30000, "USD")).toBe("$300 off per booking");
    expect(offerValue("percent", 15, "USD")).toBe("15%");
    expect(offerValue("fixed", 30000, "USD")).toBe("$300");
  });

  it("only strikes the list price for a percentage offer", () => {
    expect(fromPrice(69000, { type: "percent", value: 15 })).toEqual({ now: 58650, original: 69000 });
    expect(fromPrice(69000, { type: "fixed", value: 30000 })).toEqual({ now: 69000, original: null });
    expect(fromPrice(69000, null)).toEqual({ now: 69000, original: null });
    expect(fromPrice(0, { type: "percent", value: 15 })).toEqual({ now: 0, original: null });
  });

  it("labels the source and splits the engine's label", () => {
    expect(discountSourceLabel("campaign")).toBe("Offer");
    expect(discountSourceLabel("personal")).toBe("Personal discount");
    expect(discountSourceLabel("request")).toBe("Approved request");
    expect(splitDiscountLabel("Autumn — harvest — 15% off")).toEqual({ name: "Autumn — harvest", value: "15% off" });
    expect(splitDiscountLabel("Plain")).toEqual({ name: "Plain", value: "" });
  });

  it("mentions beaten offers only when there are some", () => {
    expect(otherMatchesNote(0)).toBeNull();
    expect(otherMatchesNote(1)).toContain("1 other offer also matched");
    expect(otherMatchesNote(2)).toContain("2 other offers also matched");
  });
});

describe("party", () => {
  const limits = partyLimits({ minGroupSize: 2, maxGroupSize: 8 });

  it("reads limits and repairs impossible ones", () => {
    expect(limits).toEqual({ minGuests: 2, maxGuests: 8 });
    expect(partyLimits({ minGroupSize: 9, maxGroupSize: 4 })).toEqual({ minGuests: 4, maxGuests: 4 });
    expect(partyLimits({ minGroupSize: 0, maxGroupSize: 0 })).toEqual({ minGuests: 1, maxGuests: 1 });
  });

  it("clamps a party into the limits", () => {
    expect(clampParty({ adults: 0, children: 0 }, limits)).toEqual({ adults: 2, children: 0 });
    expect(clampParty({ adults: 12, children: 3 }, limits)).toEqual({ adults: 8, children: 0 });
    expect(clampParty({ adults: 3, children: 9 }, limits)).toEqual({ adults: 3, children: 5 });
    expect(clampParty({ adults: 1, children: 1 }, limits)).toEqual({ adults: 1, children: 1 });
    expect(defaultParty(limits)).toEqual({ adults: 2, children: 0 });
    expect(defaultParty(partyLimits({ minGroupSize: 1, maxGroupSize: 1 }))).toEqual({ adults: 1, children: 0 });
    expect(defaultParty(partyLimits({ minGroupSize: 4, maxGroupSize: 6 }))).toEqual({ adults: 4, children: 0 });
  });

  it("enables steppers only where a press stays inside the limits", () => {
    expect(stepperState({ adults: 2, children: 0 }, limits)).toEqual({ canAddAdult: true, canRemoveAdult: false, canAddChild: true, canRemoveChild: false });
    expect(stepperState({ adults: 6, children: 2 }, limits)).toEqual({ canAddAdult: false, canRemoveAdult: true, canAddChild: false, canRemoveChild: true });
    expect(stepperState({ adults: 1, children: 2 }, limits).canRemoveAdult).toBe(false);
  });

  it("applies a press, and ignores one that would break a limit", () => {
    expect(stepParty({ adults: 2, children: 0 }, "adults", 1, limits)).toEqual({ adults: 3, children: 0 });
    expect(stepParty({ adults: 2, children: 0 }, "adults", -1, limits)).toEqual({ adults: 2, children: 0 });
    expect(stepParty({ adults: 3, children: 0 }, "adults", -1, limits)).toEqual({ adults: 2, children: 0 });
    expect(stepParty({ adults: 2, children: 0 }, "children", 1, limits)).toEqual({ adults: 2, children: 1 });
    expect(stepParty({ adults: 2, children: 1 }, "children", -1, limits)).toEqual({ adults: 2, children: 0 });
    expect(stepParty({ adults: 8, children: 0 }, "children", 1, limits)).toEqual({ adults: 8, children: 0 });
  });

  it("describes ranges and parties", () => {
    expect(guestRange(limits)).toBe("2 – 8 guests");
    expect(guestRange({ minGuests: 1, maxGuests: 1 })).toBe("1 guest");
    expect(guestRange({ minGuests: 4, maxGuests: 4 })).toBe("4 guests");
    expect(partySummary({ adults: 1, children: 0 })).toBe("1 adult");
    expect(partySummary({ adults: 2, children: 1 })).toBe("2 adults, 1 child");
    expect(partySummary({ adults: 2, children: 3 })).toBe("2 adults, 3 children");
  });

  it("describes the child price", () => {
    expect(childNote(11, 50, 34500, "USD")).toBe("Aged 11 or under · $345");
    expect(childNote(11, 100, 69000, "USD")).toBe("Aged 11 or under · same price");
    expect(childNote(0, 0, 0, "USD")).toBe("Children · free");
  });
});

describe("availability wording", () => {
  it("knows which states can be booked", () => {
    expect(isBookable("open")).toBe(true);
    expect(isBookable("limited")).toBe(true);
    expect(isBookable("full")).toBe(false);
    expect(isBookable(undefined)).toBe(false);
  });

  it("captions calendar cells", () => {
    expect(cellCaption(day())).toBe("4 left");
    expect(cellCaption(day({ capacity: 1, seatsLeft: 1 }))).toBe("Free");
    expect(cellCaption(day({ state: "limited", seatsLeft: 2 }))).toBe("2 left");
    expect(cellCaption(day({ state: "limited", capacity: null }))).toBe("Few left");
    expect(cellCaption(day({ state: "full" }))).toBe("Booked");
    expect(cellCaption(day({ state: "hold" }))).toBe("On hold");
    expect(cellCaption(day({ state: "closed" }))).toBeNull();
    expect(cellCaption(day({ state: "past" }))).toBeNull();
  });

  it("explains every reason a date is unavailable", () => {
    const reasons = ["past", "min_notice", "beyond_horizon", "day_off", "blocked", "not_scheduled", "no_departure", "departure_closed", "booked", "on_hold"];
    for (const reason of reasons) expect(reasonText(day({ state: "closed", reason }), "day").length).toBeGreaterThan(10);
    expect(reasonText(day({ state: "full", reason: "sold_out" }), "day")).toBe("Every start time is fully booked.");
    expect(reasonText(day({ state: "full", reason: "sold_out" }), "departure")).toBe("All 8 seats are booked.");
    expect(reasonText(day({ state: "full", reason: "sold_out", capacity: null }), "departure")).toBe("Every seat is booked.");
    expect(reasonText(day({ state: "full", reason: null }), "private")).toBe("This date is fully booked.");
    expect(reasonText(day({ state: "closed", reason: "something_new" }), "private")).toBe("This date is not available.");
  });

  it("titles the unavailable-date message", () => {
    expect(unavailableTitle("Sat, 17 Apr 2027", "full")).toBe("Sat, 17 Apr 2027 is fully booked");
    expect(unavailableTitle("Sat, 17 Apr 2027", "hold")).toBe("Sat, 17 Apr 2027 is on hold");
    expect(unavailableTitle("Sat, 17 Apr 2027", "closed")).toBe("Sat, 17 Apr 2027 isn’t available");
  });

  it("writes the seat line per tour kind", () => {
    expect(seatLine(day(), "private")).toEqual({ text: "Exclusively yours — no other guests", tone: "good" });
    expect(seatLine(day(), "departure")).toEqual({ text: "4 of 8 seats left", tone: "good" });
    expect(seatLine(day({ state: "limited", seatsLeft: 1 }), "departure")).toEqual({ text: "1 of 8 seat left", tone: "warn" });
    expect(seatLine(day({ capacity: null, seatsLeft: 3 }), "departure").text).toBe("3 seats left");
    const slots = [
      { time: "09:00", capacity: 8, seatsLeft: 5, state: "open" as const },
      { time: "14:00", capacity: 8, seatsLeft: 0, state: "full" as const },
    ];
    expect(seatLine(day({ seatsLeft: 5, slots }), "day")).toEqual({ text: "5 seats left across 1 start time", tone: "good" });
    expect(seatLine(day({ seatsLeft: 5, slots: null, state: "limited" }), "day")).toEqual({ text: "5 seats left across 0 start times", tone: "warn" });
  });

  it("describes a start time for the party", () => {
    expect(slotStatus({ time: "09:00", capacity: 8, seatsLeft: 5, state: "open" }, 2)).toEqual({ text: "5 of 8 seats left", tone: "muted", full: false });
    expect(slotStatus({ time: "09:00", capacity: 8, seatsLeft: 2, state: "limited" }, 2).tone).toBe("warn");
    expect(slotStatus({ time: "09:00", capacity: 8, seatsLeft: 2, state: "limited" }, 3).text).toBe("2 of 8 seats left · too few for your group");
    expect(slotStatus({ time: "09:00", capacity: 8, seatsLeft: 0, state: "full" }, 2)).toEqual({ text: "Fully booked", tone: "bad", full: true });
  });

  it("summarises a month", () => {
    const days = [day(), day({ state: "limited" }), day({ state: "full" }), day({ state: "hold" }), day({ state: "closed" })];
    expect(monthSummary(days, "April 2027")).toBe("2 dates available · 2 booked or on hold in April 2027.");
    expect(monthSummary([day()], "April 2027")).toBe("1 date available in April 2027.");
    expect(monthSummary([day({ state: "closed" })], "April 2027")).toBe("No dates available in April 2027.");
  });

  it("hints by how the tour is sold", () => {
    expect(calendarHint("departure", 3)).toContain("scheduled departures");
    expect(calendarHint("private", 8)).toBe("Each date is the start of your private 8-day tour.");
    expect(calendarHint("private", 1)).toContain("one party per day");
    expect(calendarHint("day", 1)).toContain("start time");
  });

  it("finds the next bookable dates in order", () => {
    const days = [
      day({ date: "2027-04-16" }),
      day({ date: "2027-04-17" }),
      day({ date: "2027-04-18", state: "full" }),
      day({ date: "2027-04-19", state: "limited" }),
      day({ date: "2027-04-20" }),
      day({ date: "2027-04-21" }),
    ];
    expect(nextAvailable(days, "2027-04-17", 2)).toEqual(["2027-04-19", "2027-04-20"]);
    expect(nextAvailable(days, "2027-04-17", 3, "2027-04-20")).toEqual(["2027-04-19", "2027-04-21"]);
    expect(nextAvailable(days, "2027-04-21", 3)).toEqual([]);
  });
});

describe("the draft", () => {
  it("starts empty with the given party", () => {
    expect(emptyDraft("silk-road", { adults: 2, children: 1 })).toMatchObject({ tour: "silk-road", date: "", adults: 2, children: 1, contactMethod: "whatsapp", agree: false });
    expect(contactMethodLabel("phone")).toBe("Phone call");
    expect(contactMethodLabel("nope" as never)).toBe("Email");
  });

  it("reads a valid hand-over from the query string", () => {
    expect(prefillFromQuery({ tour: "Silk-Road", date: "2027-04-17", slot: "09:00", adults: "3", children: "1" })).toEqual({
      tour: "silk-road",
      date: "2027-04-17",
      slot: "09:00",
      adults: 3,
      children: 1,
    });
    expect(prefillFromQuery({ tour: ["a-tour", "ignored"], adults: undefined })).toEqual({ tour: "a-tour" });
    expect(prefillFromQuery({ tour: [] })).toEqual({});
  });

  it("drops anything malformed", () => {
    expect(prefillFromQuery({ tour: "../etc", date: "2027-02-31", slot: "25:00", adults: "0", children: "-1" })).toEqual({});
    // A time without a valid date means nothing.
    expect(prefillFromQuery({ slot: "09:00" })).toEqual({});
    expect(prefillFromQuery({ adults: "1e2", children: "999" })).toEqual({});
    expect(prefillFromQuery({ tour: "a".repeat(201) })).toEqual({});
  });

  it("builds a booking link with no personal data", () => {
    expect(bookHref({ tour: "silk-road", date: "2027-04-17", slot: "09:00", adults: 2, children: 1 })).toBe(
      "/book?tour=silk-road&date=2027-04-17&slot=09%3A00&adults=2&children=1",
    );
    expect(bookHref({ tour: "silk-road", adults: 2, children: 0 })).toBe("/book?tour=silk-road&adults=2");
    expect(bookHref({ tour: "silk-road", slot: "09:00" })).toBe("/book?tour=silk-road");
  });

  it("round-trips through storage", () => {
    const original = draft({ date: "2027-04-17", slot: "09:00", name: "Aiko", agree: true });
    expect(parseStoredDraft(serialiseDraft(original, 2))).toEqual({ draft: original, step: 2 });
    expect(JSON.parse(serialiseDraft(original, 9)).step).toBe(3);
    expect(JSON.parse(serialiseDraft(original, 0)).step).toBe(1);
  });

  it("ignores storage that is not a draft", () => {
    expect(parseStoredDraft(null)).toBeNull();
    expect(parseStoredDraft("")).toBeNull();
    expect(parseStoredDraft("{not json")).toBeNull();
    expect(parseStoredDraft(JSON.stringify({ step: 1, draft: { tour: 5 } }))).toBeNull();
    expect(parseStoredDraft(JSON.stringify({ step: 7, draft: draft() }))).toBeNull();
  });

  it("blanks stored dates and times that are not real", () => {
    const stored = parseStoredDraft(serialiseDraft(draft({ date: "2027-02-31", slot: "9am", alt: "soon" }), 1));
    expect(stored?.draft).toMatchObject({ date: "", slot: "", alt: "" });
  });

  it("restores a stored draft, and lets a hand-over override the selection", () => {
    const base = draft();
    const tours = ["silk-road", "old-city"];
    expect(restoreDraft(base, null, {}, tours)).toEqual({ draft: base, step: 1 });

    const stored = { draft: draft({ date: "2027-04-17", alt: "2027-05-08", name: "Aiko", email: "aiko@example.com" }), step: 3 };
    expect(restoreDraft(base, stored, {}, tours)).toEqual(stored);

    // Same tour, new date: the old back-up date goes, contact details stay.
    const sameTour = restoreDraft(base, stored, { tour: "silk-road", date: "2027-06-12", adults: 4 }, tours);
    expect(sameTour.step).toBe(1);
    expect(sameTour.draft).toMatchObject({ tour: "silk-road", date: "2027-06-12", slot: "", alt: "", adults: 4, name: "Aiko" });

    // Another tour with no date: the selection is cleared.
    const otherTour = restoreDraft(base, stored, { tour: "old-city" }, tours);
    expect(otherTour.draft).toMatchObject({ tour: "old-city", date: "", slot: "", alt: "", email: "aiko@example.com" });

    // Party only: the date survives.
    expect(restoreDraft(base, stored, { children: 2 }, tours).draft).toMatchObject({ date: "2027-04-17", alt: "2027-05-08", children: 2 });

    // A hand-over for a tour that is not published is ignored, but still restarts the steps.
    expect(restoreDraft(base, stored, { tour: "gone" }, tours).draft.tour).toBe("silk-road");
  });

  it("falls back to the default tour when the stored one is gone", () => {
    const stored = { draft: draft({ tour: "retired", date: "2027-04-17", name: "Aiko" }), step: 2 };
    const restored = restoreDraft(draft({ tour: "old-city" }), stored, {}, ["old-city"]);
    expect(restored).toEqual({ step: 1, draft: expect.objectContaining({ tour: "old-city", date: "", name: "Aiko" }) });
  });

  it("resets only the selection when the tour changes or a slot is lost", () => {
    const filled = draft({ date: "2027-04-17", slot: "09:00", alt: "2027-05-08", name: "Aiko", agree: true });
    expect(withTour(filled, "old-city", { adults: 1, children: 0 })).toMatchObject({ tour: "old-city", date: "", slot: "", alt: "", adults: 1, name: "Aiko", agree: true });
    expect(releaseSelection(filled)).toMatchObject({ date: "", slot: "", alt: "2027-05-08", name: "Aiko", agree: true });
  });

  it("builds the request body without a price", () => {
    const filled = draft({ date: "2027-04-17", slot: "09:00", name: " Aiko Tanaka ", email: " aiko@example.com ", phoneCode: "+81", phone: " 90 1234 5678 ", agree: true });
    expect(fullPhone(filled)).toBe("+81 90 1234 5678");
    expect(fullPhone({ phoneCode: "", phone: "5551234" })).toBe("5551234");
    const day = toBookingPayload(filled, "day");
    expect(day).toMatchObject({ tourSlug: "silk-road", slotTime: "09:00", alternativeDate: null, name: "Aiko Tanaka", email: "aiko@example.com", phone: "+81 90 1234 5678", agree: true });
    expect(Object.keys(day)).not.toContain("totalAmount");
    expect(toBookingPayload(filled, "departure").slotTime).toBeNull();
    expect(toBookingPayload({ ...filled, alt: "2027-05-08" }, "departure").alternativeDate).toBe("2027-05-08");
  });
});

describe("validation", () => {
  const limits = { minGuests: 2, maxGuests: 8 };
  const slots = [
    { time: "09:00", capacity: 8, seatsLeft: 3, state: "open" as const },
    { time: "14:00", capacity: 8, seatsLeft: 0, state: "full" as const },
  ];

  it("recognises e-mail addresses", () => {
    expect(isEmail(" name@example.com ")).toBe(true);
    expect(isEmail("name@example")).toBe(false);
    expect(isEmail("name example@x.co")).toBe(false);
    expect(isEmail(`${"a".repeat(250)}@x.co`)).toBe(false);
  });

  it("asks for a date first", () => {
    expect(validateDateStep(draft(), "departure", undefined, limits)).toEqual({ date: "Choose an available date in the calendar." });
  });

  it("rejects a date that is no longer bookable", () => {
    const chosen = draft({ date: "2027-04-17" });
    expect(validateDateStep(chosen, "departure", undefined, limits).date).toBe("That date is no longer available — please choose another.");
    expect(validateDateStep(chosen, "departure", day({ state: "full" }), limits).date).toBe("That date is no longer available — please choose another.");
  });

  it("checks seats on a departure", () => {
    expect(validateDateStep(draft({ date: "2027-04-17" }), "departure", day(), limits)).toEqual({});
    expect(validateDateStep(draft({ date: "2027-04-17", adults: 4, children: 1 }), "departure", day(), limits)).toEqual({
      seats: "Only 4 seats left on this departure — reduce your group or pick another date.",
    });
    expect(validateDateStep(draft({ date: "2027-04-17", adults: 2 }), "departure", day({ seatsLeft: 1 }), limits).seats).toContain("Only 1 seat left");
  });

  it("requires a start time with room on a day tour", () => {
    const chosen = draft({ date: "2027-04-17" });
    expect(validateDateStep(chosen, "day", day({ slots }), limits)).toEqual({ slot: "Choose a start time." });
    expect(validateDateStep({ ...chosen, slot: "18:00" }, "day", day({ slots }), limits)).toEqual({ slot: "Choose a start time." });
    expect(validateDateStep({ ...chosen, slot: "09:00" }, "day", day({ slots: null }), limits)).toEqual({ slot: "Choose a start time." });
    expect(validateDateStep({ ...chosen, slot: "14:00" }, "day", day({ slots }), limits)).toEqual({ slot: "That time is fully booked — choose another." });
    expect(validateDateStep({ ...chosen, slot: "09:00", adults: 4 }, "day", day({ slots }), limits)).toEqual({
      seats: "Only 3 seats left at 09:00 — reduce your group or pick another time.",
    });
    expect(validateDateStep({ ...chosen, slot: "09:00" }, "day", day({ slots }), limits)).toEqual({});
  });

  it("does not count seats on a private tour, but keeps the group limits", () => {
    expect(validateDateStep(draft({ date: "2027-04-17", adults: 6 }), "private", day({ seatsLeft: 1, capacity: 1 }), limits)).toEqual({});
    expect(validateDateStep(draft({ date: "2027-04-17", adults: 9 }), "private", day(), limits).seats).toBe("This tour takes up to 8 guests per booking.");
    expect(validateDateStep(draft({ date: "2027-04-17", adults: 1 }), "private", day(), limits).seats).toBe("This tour needs at least 2 guests.");
    // The group-size message wins over the seat count.
    expect(validateDateStep(draft({ date: "2027-04-17", adults: 9 }), "departure", day(), limits).seats).toBe("This tour takes up to 8 guests per booking.");
    expect(validateDateStep(draft({ date: "2027-04-17", adults: 9, slot: "09:00" }), "day", day({ slots }), limits).seats).toBe(
      "This tour takes up to 8 guests per booking.",
    );
  });

  it("warns softly on the tour page", () => {
    expect(seatWarning("departure", day(), "", { adults: 2, children: 0 })).toBeNull();
    expect(seatWarning("departure", day(), "", { adults: 4, children: 1 })).toBe("Only 4 seats left on this departure — reduce your group or choose another date.");
    expect(seatWarning("day", day({ slots }), "09:00", { adults: 4, children: 0 })).toBe("Only 3 seats left at 09:00 — reduce your group or pick another time.");
    expect(seatWarning("day", day({ slots }), "09:00", { adults: 2, children: 0 })).toBeNull();
    expect(seatWarning("day", day({ slots }), "", { adults: 9, children: 0 })).toBeNull();
    expect(seatWarning("day", day({ slots: null }), "09:00", { adults: 9, children: 0 })).toBeNull();
    expect(seatWarning("private", day(), "", { adults: 9, children: 0 })).toBeNull();
    expect(seatWarning("departure", undefined, "", { adults: 9, children: 0 })).toBeNull();
    expect(seatWarning("departure", day({ state: "full" }), "", { adults: 9, children: 0 })).toBeNull();
  });

  it("validates contact details with the server's wording", () => {
    expect(validateDetails({ name: "A", email: "nope", phoneCode: "+44", phone: "123" })).toEqual({
      name: "Please enter your full name.",
      email: "Enter a valid email, e.g. name@example.com.",
      phone: "Enter a phone number with at least 7 digits.",
    });
    expect(validateDetails({ name: "Aiko Tanaka", email: "aiko@example.com", phoneCode: "+81", phone: "90 1234 5678" })).toEqual({});
    expect(validateDetails({ name: "x".repeat(121), email: "aiko@example.com", phoneCode: "+81", phone: "1".repeat(40) })).toEqual({
      name: "Please shorten your name to 120 characters.",
      phone: "That phone number is too long.",
    });
  });

  it("requires the acknowledgement", () => {
    expect(validateReview({ agree: false })).toEqual({ agree: "Please confirm you understand this is a request." });
    expect(validateReview({ agree: true })).toEqual({});
  });

  it("sends server field errors to the step that owns the field", () => {
    expect(stepOfServerErrors(undefined)).toBeNull();
    expect(stepOfServerErrors({ date: ["x"] })).toBe(1);
    expect(stepOfServerErrors({ slotTime: ["x"], email: ["y"] })).toBe(1);
    expect(stepOfServerErrors({ email: ["y"] })).toBe(2);
    expect(stepOfServerErrors({ agree: ["z"] })).toBe(3);
    expect(stepOfServerErrors({ other: ["?"] })).toBeNull();
  });

  it("validates the waitlist form", () => {
    expect(waitlistSchema.safeParse({ name: "Aiko", email: "aiko@example.com" }).success).toBe(true);
    expect(waitlistSchema.safeParse({ name: "A", email: "aiko" }).success).toBe(false);
  });
});

describe("offers", () => {
  it("says who an offer is for in plain words", () => {
    expect(offerAudience({ minGuests: 0, minChildren: 0, bookAheadDays: 0 })).toBe("Everyone");
    expect(offerAudience({ minGuests: 1, minChildren: 0, bookAheadDays: 0 })).toBe("Everyone");
    expect(offerAudience({ minGuests: 6, minChildren: 0, bookAheadDays: 0 })).toBe("Groups of 6 or more");
    expect(offerAudience({ minGuests: 0, minChildren: 1, bookAheadDays: 0 })).toBe("Travelling with at least 1 child");
    expect(offerAudience({ minGuests: 0, minChildren: 0, bookAheadDays: 90 })).toBe("Booked 90 days or more before the trip");
    expect(offerAudience({ minGuests: 4, minChildren: 2, bookAheadDays: 1 })).toBe(
      "Groups of 4 or more, travelling with at least 2 children, booked 1 day or more before the trip",
    );
  });

  it("prints the validity window, with years when it leaves this year", () => {
    expect(offerValidity("2026-11-01", "2026-12-15", "2026-11-16")).toBe("Valid 1 Nov – 15 Dec");
    expect(offerValidity("2026-11-01", "2027-01-31", "2026-11-16")).toBe("Valid 1 Nov 2026 – 31 Jan 2027");
  });

  it("counts down to the end", () => {
    expect(offerCountdown("2026-12-15", "2026-11-16")).toBe("29 days left · ends 15 Dec");
    expect(offerCountdown("2026-11-17", "2026-11-16")).toBe("1 day left · ends 17 Nov");
    expect(offerCountdown("2026-11-16", "2026-11-16")).toBe("Ends today");
    expect(offerCountdown("nope", "2026-11-16")).toBe("");
  });

  it("knows how many decimals a currency has", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("not a currency")).toBe(2);
  });

  it("turns typed discounts into stored values", () => {
    expect(parseDiscountValue("percent", "10", "USD")).toBe(10);
    expect(parseDiscountValue("percent", "10.5", "USD")).toBeNull();
    expect(parseDiscountValue("percent", "101", "USD")).toBeNull();
    expect(parseDiscountValue("percent", "0", "USD")).toBeNull();
    expect(parseDiscountValue("fixed", "50", "USD")).toBe(5000);
    expect(parseDiscountValue("fixed", "49,99", "USD")).toBe(4999);
    expect(parseDiscountValue("fixed", "5000", "JPY")).toBe(5000);
    expect(parseDiscountValue("fixed", "0.001", "USD")).toBeNull();
    expect(parseDiscountValue("fixed", "99999999", "USD")).toBeNull();
    expect(parseDiscountValue("fixed", "ten", "USD")).toBeNull();
    expect(parseDiscountValue("fixed", "-5", "USD")).toBeNull();
    expect(parseDiscountValue("fixed", "", "USD")).toBeNull();
  });

  it("validates the request form and the tracker", () => {
    const values = { tourId: "t", name: "Aiko", email: "aiko@example.com", phone: "", adults: 2, children: 0, type: "percent" as const, value: "10", reason: "" };
    expect(discountRequestFormSchema.safeParse(values).success).toBe(true);
    expect(discountRequestFormSchema.safeParse({ ...values, tourId: "", email: "x", value: "" }).success).toBe(false);
    expect(trackerSchema.parse({ reference: " dr-1043 ", accessCode: " abc " })).toEqual({ reference: "DR-1043", accessCode: "abc" });
    expect(trackerSchema.safeParse({ reference: "1043", accessCode: "abc" }).success).toBe(false);
    expect(trackerSchema.safeParse({ reference: "DR-1043", accessCode: "" }).success).toBe(false);
  });

  it("builds the timeline for each status without personal data", () => {
    const pending = requestTimeline({ status: "pending", approvedLabel: null, rejectionReason: null, used: false, responseDays: 2 });
    expect(pending.map((step) => step.state)).toEqual(["done", "current", "upcoming"]);
    expect(pending[1]!.detail).toBe("We usually reply within 2 days.");
    expect(requestTimeline({ status: "pending", approvedLabel: null, rejectionReason: null, used: false, responseDays: 1 })[1]!.detail).toContain("1 day.");

    const approved = requestTimeline({ status: "approved", approvedLabel: "8% off", rejectionReason: null, used: false, responseDays: 2 });
    expect(approved.map((step) => step.state)).toEqual(["done", "done", "approved"]);
    expect(approved[2]!.detail).toBe("8% off applies automatically when you book with the same email address.");
    expect(requestTimeline({ status: "approved", approvedLabel: null, rejectionReason: null, used: true, responseDays: 2 })[2]!.detail).toBe(
      "Your discount has been used on a booking.",
    );
    expect(requestTimeline({ status: "approved", approvedLabel: null, rejectionReason: null, used: false, responseDays: 2 })[2]!.detail).toContain("Your discount applies");
    expect(requestTimeline({ status: "approved", approvedLabel: "8% off", rejectionReason: null, used: true, responseDays: 2 })[2]!.detail).toContain("8% off has been used");

    const rejected = requestTimeline({ status: "rejected", approvedLabel: null, rejectionReason: " Fully booked that week. ", used: false, responseDays: 2 });
    expect(rejected[2]).toMatchObject({ title: "Not approved", detail: "Fully booked that week.", state: "rejected" });
    expect(requestTimeline({ status: "rejected", approvedLabel: null, rejectionReason: null, used: false, responseDays: 2 })[2]!.detail).toBe(
      "We could not offer a discount this time.",
    );
    for (const step of [...pending, ...approved, ...rejected]) expect(`${step.title} ${step.detail}`).not.toMatch(/@/);
  });
});

describe("small text", () => {
  it("takes first names and initials", () => {
    expect(firstName("  Aiko Tanaka ")).toBe("Aiko");
    expect(firstName("")).toBe("");
    expect(initials("Aiko Tanaka")).toBe("AT");
    expect(initials("Liam & Grace Walsh")).toBe("LW");
    expect(initials("madonna")).toBe("MA");
    expect(initials("  ")).toBe("");
  });

  it("describes durations", () => {
    expect(durationText(3, "3 days")).toBe("3 days · 2 nights");
    expect(durationText(2, "")).toBe("2 days · 1 night");
    expect(durationText(1, "1 day")).toBe("1 day");
    expect(durationText(1, "6 hours")).toBe("6 hours");
    expect(durationText(0, "")).toBe("1 day");
  });

  it("builds chat and map links only from usable data", () => {
    expect(whatsappHref("+994 50 123 45 67")).toBe("https://wa.me/994501234567");
    expect(whatsappHref("+994 50 123 45 67", " Hello there ")).toBe("https://wa.me/994501234567?text=Hello%20there");
    expect(whatsappHref("")).toBeNull();
    expect(whatsappHref(undefined)).toBeNull();
    expect(whatsappHref("12345")).toBeNull();
    expect(mapsHref(40.3667, 49.8352)).toBe("https://www.google.com/maps/search/?api=1&query=40.3667%2C49.8352");
    expect(mapsHref(null, 49.8)).toBeNull();
    expect(mapsHref(40.3, null)).toBeNull();
    expect(mapsHref(Number.NaN, 49.8)).toBeNull();
    expect(mapsHref(95, 49.8)).toBeNull();
    expect(mapsHref(40, 190)).toBeNull();
  });

  it("words the hold", () => {
    expect(holdText(24)).toBe("24 hours");
    expect(holdText(1)).toBe("1 hour");
    expect(holdText(48)).toBe("2 days");
    expect(holdText(36)).toBe("36 hours");
    expect(holdText(0)).toBe("1 hour");
  });

  it("lists countries by name with their calling codes", () => {
    const list = countries();
    expect(list.length).toBeGreaterThan(80);
    expect(list.map((country) => country.name)).toEqual([...list.map((country) => country.name)].sort((a, b) => a.localeCompare(b, "en")));
    expect(list.find((country) => country.code === "AZ")).toEqual({ code: "AZ", name: "Azerbaijan", dial: "+994" });
    expect(dialCodeOf(list, "United Kingdom")).toBe("+44");
    expect(dialCodeOf(list, "Atlantis")).toBeNull();
    const codes = diallingCodes(list);
    expect(codes[0]).toBe("+1");
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain("+994");
    // An unknown locale must not break the form.
    expect(countries("xx-invalid-locale-tag-!!").length).toBe(list.length);
  });
});
