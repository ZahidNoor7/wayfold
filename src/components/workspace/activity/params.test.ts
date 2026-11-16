import { describe, expect, it } from "vitest";
import { activeFilterCount, activityHref, activityQuery, ACTIVITY_PAGE_SIZE, parseActivityParams, zonedDayStart } from "./params";

const USER = "6f1c2a7e-3b4d-4c5e-8f90-1a2b3c4d5e6f";

describe("parseActivityParams", () => {
  it("keeps valid filters", () => {
    expect(parseActivityParams({ area: "booking", person: USER, from: "2027-01-01", to: "2027-01-31", cursor: "abc_DEF-1" })).toEqual({
      area: "booking",
      person: USER,
      from: "2027-01-01",
      to: "2027-01-31",
      cursor: "abc_DEF-1",
    });
    expect(parseActivityParams({ person: "support" }).person).toBe("support");
    expect(parseActivityParams({ person: USER.toUpperCase() }).person).toBe(USER);
  });

  it("drops anything that is not a valid choice", () => {
    expect(parseActivityParams({ area: "bookings", person: "someone", from: "2027-02-30", to: "yesterday", cursor: "a b" })).toEqual({
      area: undefined,
      person: undefined,
      from: undefined,
      to: undefined,
      cursor: undefined,
    });
    expect(parseActivityParams({ person: "constructor" }).person).toBeUndefined();
    expect(parseActivityParams({})).toEqual({ area: undefined, person: undefined, from: undefined, to: undefined, cursor: undefined });
  });

  it("puts a reversed range the right way round", () => {
    expect(parseActivityParams({ from: "2027-05-10", to: "2027-05-01" })).toMatchObject({ from: "2027-05-01", to: "2027-05-10" });
  });

  it("takes the first of repeated parameters", () => {
    expect(parseActivityParams({ area: ["tour", "booking"] }).area).toBe("tour");
  });
});

describe("activityHref and activeFilterCount", () => {
  it("builds clean URLs", () => {
    expect(activityHref({})).toBe("/workspace/activity");
    expect(activityHref({ area: "role", person: "system", cursor: "c1" })).toBe("/workspace/activity?area=role&person=system&cursor=c1");
  });

  it("counts filters but not the cursor", () => {
    expect(activeFilterCount({ cursor: "x" })).toBe(0);
    expect(activeFilterCount({ area: "role", person: USER, from: "2027-01-01", to: "2027-01-02" })).toBe(4);
  });
});

describe("zonedDayStart", () => {
  it("is midnight UTC in UTC", () => {
    expect(zonedDayStart("2027-03-01", "UTC").toISOString()).toBe("2027-03-01T00:00:00.000Z");
  });

  it("is earlier for zones ahead of UTC and later for zones behind", () => {
    expect(zonedDayStart("2027-03-01", "Asia/Baku").toISOString()).toBe("2027-02-28T20:00:00.000Z");
    expect(zonedDayStart("2027-01-15", "America/New_York").toISOString()).toBe("2027-01-15T05:00:00.000Z");
  });

  it("follows daylight-saving changes", () => {
    // Clocks go forward at 01:00 UTC on 28 March 2027 in London.
    expect(zonedDayStart("2027-03-28", "Europe/London").toISOString()).toBe("2027-03-28T00:00:00.000Z");
    expect(zonedDayStart("2027-03-29", "Europe/London").toISOString()).toBe("2027-03-28T23:00:00.000Z");
    // And back on 31 October 2027.
    expect(zonedDayStart("2027-10-31", "Europe/London").toISOString()).toBe("2027-10-30T23:00:00.000Z");
    expect(zonedDayStart("2027-11-01", "Europe/London").toISOString()).toBe("2027-11-01T00:00:00.000Z");
  });
});

describe("activityQuery", () => {
  it("maps a member to an actor id and whole days to instants", () => {
    expect(activityQuery({ area: "booking", person: USER, from: "2027-03-01", to: "2027-03-01", cursor: "c" }, "Asia/Baku")).toEqual({
      action: "booking",
      actorUserId: USER,
      actorType: undefined,
      from: new Date("2027-02-28T20:00:00.000Z"),
      to: new Date("2027-03-01T20:00:00.000Z"),
      cursor: "c",
      limit: ACTIVITY_PAGE_SIZE,
    });
  });

  it("maps the non-member choices to actor types", () => {
    expect(activityQuery({ person: "support" }, "UTC")).toMatchObject({ actorType: "support_session", actorUserId: undefined });
    expect(activityQuery({ person: "wayfold" }, "UTC")).toMatchObject({ actorType: "platform_admin" });
    expect(activityQuery({ person: "system" }, "UTC")).toMatchObject({ actorType: "system" });
    expect(activityQuery({}, "UTC")).toEqual({
      action: undefined,
      actorUserId: undefined,
      actorType: undefined,
      from: undefined,
      to: undefined,
      cursor: undefined,
      limit: ACTIVITY_PAGE_SIZE,
    });
  });
});
