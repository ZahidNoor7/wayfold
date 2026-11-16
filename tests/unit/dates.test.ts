import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  eachDate,
  formatMoney,
  isIsoDate,
  isoWeekday,
  isValidTimezone,
  rangesOverlap,
  todayIn,
} from "@/lib/dates";

describe("isIsoDate", () => {
  it.each(["2025-01-01", "2024-02-29", "1999-12-31", "2025-12-31"])("accepts %s", (value) => {
    expect(isIsoDate(value)).toBe(true);
  });

  it.each([
    "2025-02-30",
    "2025-02-29",
    "2025-13-01",
    "2025-00-10",
    "2025-01-32",
    "2025-1-01",
    "25-01-01",
    "2025/01/01",
    "2025-01-01T00:00:00Z",
    " 2025-01-01",
    "",
    "today",
  ])("rejects %j", (value) => {
    expect(isIsoDate(value)).toBe(false);
  });

  it.each([null, undefined, 20250101, new Date("2025-01-01"), {}, ["2025-01-01"]])("rejects the non-string %j", (value) => {
    expect(isIsoDate(value)).toBe(false);
  });
});

describe("todayIn", () => {
  const lateEvening = new Date("2025-03-09T23:30:00Z");

  it("returns the calendar date in the requested timezone", () => {
    expect(todayIn("UTC", lateEvening)).toBe("2025-03-09");
    expect(todayIn("Asia/Baku", lateEvening)).toBe("2025-03-10");
    expect(todayIn("America/Los_Angeles", lateEvening)).toBe("2025-03-09");
    expect(todayIn("Pacific/Kiritimati", lateEvening)).toBe("2025-03-10");
  });

  it("handles the day boundary west of UTC", () => {
    expect(todayIn("America/New_York", new Date("2025-01-01T03:00:00Z"))).toBe("2024-12-31");
  });

  it("defaults to the current moment", () => {
    expect(isIsoDate(todayIn("UTC"))).toBe(true);
  });

  it("throws for an unknown timezone", () => {
    expect(() => todayIn("Mars/Olympus_Mons")).toThrow(RangeError);
  });
});

describe("isValidTimezone", () => {
  it("recognises IANA names and rejects everything else", () => {
    expect(isValidTimezone("Asia/Baku")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("'; drop table tenants; --")).toBe(false);
  });
});

describe("addDays", () => {
  it("moves forwards and backwards across month, year and leap-day boundaries", () => {
    expect(addDays("2025-01-31", 1)).toBe("2025-02-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
    expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
    expect(addDays("2025-06-15", 0)).toBe("2025-06-15");
    expect(addDays("2025-01-01", 365)).toBe("2026-01-01");
  });

  it("is unaffected by daylight-saving changes", () => {
    expect(addDays("2025-03-08", 2)).toBe("2025-03-10");
    expect(addDays("2025-10-25", 2)).toBe("2025-10-27");
  });

  it("refuses a value that is not a calendar date", () => {
    expect(() => addDays("2025-02-30", 1)).toThrow(RangeError);
    expect(() => addDays("tomorrow", 1)).toThrow("Not a calendar date: tomorrow");
  });
});

describe("diffDays", () => {
  it("counts whole days, signed", () => {
    expect(diffDays("2025-01-01", "2025-01-01")).toBe(0);
    expect(diffDays("2025-01-01", "2025-01-02")).toBe(1);
    expect(diffDays("2025-01-02", "2025-01-01")).toBe(-1);
    expect(diffDays("2024-02-28", "2024-03-01")).toBe(2);
    expect(diffDays("2025-01-01", "2026-01-01")).toBe(365);
    expect(diffDays("2024-01-01", "2025-01-01")).toBe(366);
  });

  it("refuses invalid dates on either side", () => {
    expect(() => diffDays("nope", "2025-01-01")).toThrow(RangeError);
    expect(() => diffDays("2025-01-01", "2025-13-01")).toThrow(RangeError);
  });
});

describe("isoWeekday", () => {
  it("numbers Monday as 1 through Sunday as 7", () => {
    expect(isoWeekday("2025-01-06")).toBe(1);
    expect(isoWeekday("2025-01-07")).toBe(2);
    expect(isoWeekday("2025-01-08")).toBe(3);
    expect(isoWeekday("2025-01-09")).toBe(4);
    expect(isoWeekday("2025-01-10")).toBe(5);
    expect(isoWeekday("2025-01-11")).toBe(6);
    expect(isoWeekday("2025-01-12")).toBe(7);
  });

  it("refuses an invalid date", () => {
    expect(() => isoWeekday("2025-02-31")).toThrow(RangeError);
  });
});

describe("eachDate", () => {
  it("lists every date in an inclusive range", () => {
    expect(eachDate("2025-02-27", "2025-03-02")).toEqual(["2025-02-27", "2025-02-28", "2025-03-01", "2025-03-02"]);
  });

  it("returns a single date when start equals end", () => {
    expect(eachDate("2025-05-05", "2025-05-05")).toEqual(["2025-05-05"]);
  });

  it("returns nothing when the range is reversed", () => {
    expect(eachDate("2025-05-06", "2025-05-05")).toEqual([]);
  });

  it("refuses to walk from an invalid start date", () => {
    expect(() => eachDate("2025-01-32", "2025-02-02")).toThrow(RangeError);
  });
});

describe("rangesOverlap", () => {
  it("treats both ends as inclusive", () => {
    expect(rangesOverlap("2025-01-01", "2025-01-05", "2025-01-05", "2025-01-09")).toBe(true);
    expect(rangesOverlap("2025-01-05", "2025-01-09", "2025-01-01", "2025-01-05")).toBe(true);
  });

  it("detects containment and partial overlap", () => {
    expect(rangesOverlap("2025-01-01", "2025-01-31", "2025-01-10", "2025-01-12")).toBe(true);
    expect(rangesOverlap("2025-01-10", "2025-01-12", "2025-01-01", "2025-01-31")).toBe(true);
    expect(rangesOverlap("2025-01-01", "2025-01-10", "2025-01-08", "2025-01-20")).toBe(true);
  });

  it("is false for adjacent and distant ranges", () => {
    expect(rangesOverlap("2025-01-01", "2025-01-05", "2025-01-06", "2025-01-09")).toBe(false);
    expect(rangesOverlap("2025-01-06", "2025-01-09", "2025-01-01", "2025-01-05")).toBe(false);
    expect(rangesOverlap("2024-01-01", "2024-01-05", "2025-01-01", "2025-01-05")).toBe(false);
  });
});

describe("formatMoney", () => {
  it("drops the fraction for whole amounts", () => {
    expect(formatMoney(69000, "USD")).toBe("$690");
    expect(formatMoney(0, "USD")).toBe("$0");
    expect(formatMoney(123456700, "USD")).toBe("$1,234,567");
  });

  it("keeps the full fraction otherwise", () => {
    expect(formatMoney(69050, "USD")).toBe("$690.50");
    expect(formatMoney(5, "USD")).toBe("$0.05");
    expect(formatMoney(-1999, "USD")).toBe("-$19.99");
  });

  it("uses the currency's own minor unit", () => {
    expect(formatMoney(500, "JPY")).toBe("¥500");
    expect(formatMoney(1500, "KWD")).toMatch(/1\.500$/);
    expect(formatMoney(2000, "KWD")).toMatch(/2$/);
  });

  it("honours the locale", () => {
    expect(formatMoney(123456, "EUR", "de-DE")).toMatch(/^1\.234,56\s€$/);
    expect(formatMoney(69000, "AZN", "en-US")).toMatch(/690$/);
  });
});
