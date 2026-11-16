import { describe, expect, it } from "vitest";
import {
  addMonths,
  clampMonth,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatMonth,
  isMonth,
  MAX_WINDOW_DAYS,
  monthEnd,
  monthGrid,
  monthOf,
  monthsBetween,
  monthStart,
  moveFocus,
  quarterWindow,
  shiftMonth,
} from "./calendar";
import { diffDays } from "./dates";

describe("months", () => {
  it("recognises YYYY-MM only", () => {
    expect(isMonth("2026-11")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-00")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
    expect(isMonth(202611)).toBe(false);
  });

  it("takes the month of a date and rejects anything else", () => {
    expect(monthOf("2027-04-17")).toBe("2027-04");
    expect(() => monthOf("2027-02-30")).toThrow(RangeError);
  });

  it("adds months across year boundaries in both directions", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2027-03", -15)).toBe("2025-12");
    expect(addMonths("2026-11", 0)).toBe("2026-11");
    expect(() => addMonths("nope", 1)).toThrow(RangeError);
  });

  it("finds the first and last day, including leap Februaries", () => {
    expect(monthStart("2027-02")).toBe("2027-02-01");
    expect(monthEnd("2027-02")).toBe("2027-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
    expect(() => monthStart("2027-2")).toThrow(RangeError);
  });

  it("clamps into an inclusive range", () => {
    expect(clampMonth("2026-10", "2026-11", "2027-12")).toBe("2026-11");
    expect(clampMonth("2028-01", "2026-11", "2027-12")).toBe("2027-12");
    expect(clampMonth("2027-05", "2026-11", "2027-12")).toBe("2027-05");
  });

  it("counts whole months between two months", () => {
    expect(monthsBetween("2026-11", "2027-12")).toBe(13);
    expect(monthsBetween("2027-03", "2026-11")).toBe(-4);
    expect(monthsBetween("2027-03", "2027-03")).toBe(0);
    expect(() => monthsBetween("x", "2027-03")).toThrow(RangeError);
  });
});

describe("monthGrid", () => {
  it("pads to a Monday start", () => {
    // 1 November 2026 is a Sunday: six blanks before it.
    const cells = monthGrid("2026-11");
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toBe("2026-11-01");
    expect(cells.at(-1)).toBe("2026-11-30");
    expect(cells.filter(Boolean)).toHaveLength(30);
  });

  it("has no padding when the month starts on a Monday", () => {
    // 1 February 2027 is a Monday.
    const cells = monthGrid("2027-02");
    expect(cells[0]).toBe("2027-02-01");
    expect(cells).toHaveLength(28);
  });
});

describe("quarterWindow", () => {
  it("covers three whole months", () => {
    expect(quarterWindow("2026-12")).toEqual({ from: "2026-12-01", to: "2027-02-28", months: ["2026-12", "2027-01", "2027-02"] });
  });

  it("never exceeds the endpoint's window, whichever month it starts in", () => {
    for (let i = 0; i < 48; i += 1) {
      const { from, to } = quarterWindow(addMonths("2026-01", i));
      expect(diffDays(from, to) + 1).toBeLessThanOrEqual(MAX_WINDOW_DAYS);
    }
  });
});

describe("shiftMonth", () => {
  it("keeps the day when the target month has it", () => {
    expect(shiftMonth("2027-04-17", 1)).toBe("2027-05-17");
    expect(shiftMonth("2027-01-17", -1)).toBe("2026-12-17");
  });

  it("falls back to the last day of a shorter month", () => {
    expect(shiftMonth("2027-01-31", 1)).toBe("2027-02-28");
    expect(shiftMonth("2027-03-31", -1)).toBe("2027-02-28");
  });
});

describe("moveFocus", () => {
  const bounds = { min: "2026-11-16", max: "2027-12-31" };

  it("moves by a day or a week with the arrow keys", () => {
    expect(moveFocus("2027-04-17", "ArrowLeft", bounds)).toBe("2027-04-16");
    expect(moveFocus("2027-04-17", "ArrowRight", bounds)).toBe("2027-04-18");
    expect(moveFocus("2027-04-17", "ArrowUp", bounds)).toBe("2027-04-10");
    expect(moveFocus("2027-04-17", "ArrowDown", bounds)).toBe("2027-04-24");
  });

  it("crosses month boundaries", () => {
    expect(moveFocus("2027-04-30", "ArrowRight", bounds)).toBe("2027-05-01");
    expect(moveFocus("2027-05-01", "ArrowUp", bounds)).toBe("2027-04-24");
  });

  it("goes to the ends of the week with Home and End", () => {
    // 17 April 2027 is a Saturday.
    expect(moveFocus("2027-04-17", "Home", bounds)).toBe("2027-04-12");
    expect(moveFocus("2027-04-17", "End", bounds)).toBe("2027-04-18");
  });

  it("changes month with Page Up and Page Down", () => {
    expect(moveFocus("2027-04-17", "PageDown", bounds)).toBe("2027-05-17");
    expect(moveFocus("2027-04-17", "PageUp", bounds)).toBe("2027-03-17");
  });

  it("stops at the bounds", () => {
    expect(moveFocus("2026-11-16", "ArrowLeft", bounds)).toBe("2026-11-16");
    expect(moveFocus("2026-11-18", "ArrowUp", bounds)).toBe("2026-11-16");
    expect(moveFocus("2027-12-31", "ArrowRight", bounds)).toBe("2027-12-31");
    expect(moveFocus("2027-12-20", "PageDown", bounds)).toBe("2027-12-31");
  });

  it("ignores keys the grid does not own", () => {
    expect(moveFocus("2027-04-17", "Enter", bounds)).toBeNull();
    expect(moveFocus("2027-04-17", "a", bounds)).toBeNull();
  });
});

describe("formatting", () => {
  it("prints the stored day whatever the local timezone", () => {
    expect(formatDate("2027-04-17")).toBe("17 Apr 2027");
    expect(formatDate("2027-04-17", "long")).toBe("Sat, 17 Apr 2027");
    expect(formatDate("2026-12-15", "dayMonth")).toBe("15 Dec");
    expect(formatDate("2027-04-17", "weekday")).toBe("Saturday, 17 April 2027");
  });

  it("returns an empty string for something that is not a date", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("2027-02-31")).toBe("");
  });

  it("names months", () => {
    expect(formatMonth("2026-11")).toBe("November 2026");
    expect(formatMonth("2026-1")).toBe("");
  });

  it("joins a range and collapses a single day", () => {
    expect(formatDateRange("2027-04-17", "2027-04-19")).toBe("17 Apr 2027 – 19 Apr 2027");
    expect(formatDateRange("2027-04-17", "2027-04-17")).toBe("17 Apr 2027");
  });

  it("prints timestamps in the business timezone", () => {
    // 20:30 UTC is already the next day in Baku (UTC+4).
    const instant = new Date("2027-04-16T20:30:00Z");
    expect(formatDateTime(instant, "Asia/Baku")).toBe("Sat, 17 Apr 2027, 00:30");
    expect(formatDateTime("2027-04-16T20:30:00Z", "UTC")).toBe("Fri, 16 Apr 2027, 20:30");
  });

  it("falls back to UTC for an unknown timezone and to nothing for a bad date", () => {
    expect(formatDateTime(new Date("2027-04-16T20:30:00Z"), "Not/AZone")).toBe("Fri, 16 Apr 2027, 20:30");
    expect(formatDateTime("not a date", "UTC")).toBe("");
  });
});
