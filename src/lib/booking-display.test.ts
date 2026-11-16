import { describe, expect, it } from "vitest";
import {
  availableActions,
  barHeight,
  bookingHref,
  bookingStatusLabel,
  chartMax,
  chartSummary,
  clashHeadline,
  currencyDigits,
  dateParam,
  dateTileParts,
  enumParam,
  exportFileName,
  firstName,
  firstParam,
  formatCompactMoney,
  formatCount,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatGuestCount,
  formatGuests,
  formatLongDate,
  formatRelative,
  formatStorage,
  fromMinorUnits,
  greeting,
  hourIn,
  hrefWith,
  initials,
  lastMonths,
  mailtoLink,
  monthBucket,
  monthGrid,
  monthTitle,
  pageCount,
  pageSummary,
  parsePage,
  shiftMonth,
  toMinorUnits,
  trend,
  uuidParam,
  type ChartPoint,
} from "./booking-display";

describe("status labels and actions", () => {
  it("names a cancelled booking by how it ended", () => {
    expect(bookingStatusLabel({ status: "pending" })).toBe("Pending");
    expect(bookingStatusLabel({ status: "confirmed", cancelKind: null })).toBe("Confirmed");
    expect(bookingStatusLabel({ status: "completed" })).toBe("Completed");
    expect(bookingStatusLabel({ status: "cancelled", cancelKind: "declined" })).toBe("Declined");
    expect(bookingStatusLabel({ status: "cancelled", cancelKind: "expired" })).toBe("Expired");
    expect(bookingStatusLabel({ status: "cancelled", cancelKind: "by_customer" })).toBe("Cancelled by guest");
    expect(bookingStatusLabel({ status: "cancelled", cancelKind: "by_business" })).toBe("Cancelled by you");
    expect(bookingStatusLabel({ status: "cancelled", cancelKind: null })).toBe("Cancelled");
    expect(bookingStatusLabel({ status: "cancelled" })).toBe("Cancelled");
  });

  it("follows the status machine", () => {
    expect(availableActions("pending")).toEqual({ confirm: true, decline: true, cancel: false, complete: false, reopen: false, reschedule: true });
    expect(availableActions("confirmed")).toEqual({ confirm: false, decline: false, cancel: true, complete: true, reopen: false, reschedule: true });
    expect(availableActions("cancelled")).toEqual({ confirm: false, decline: false, cancel: false, complete: false, reopen: true, reschedule: true });
    expect(availableActions("completed")).toEqual({ confirm: false, decline: false, cancel: false, complete: false, reopen: false, reschedule: false });
  });
});

describe("people", () => {
  it("writes the party the way the bookings table does", () => {
    expect(formatGuests(1)).toBe("1 adult");
    expect(formatGuests(2, 0)).toBe("2 adults");
    expect(formatGuests(2, 1)).toBe("2 adults, 1 child");
    expect(formatGuests(2, 3)).toBe("2 adults, 3 children");
    expect(formatGuestCount(1)).toBe("1 guest");
    expect(formatGuestCount(4)).toBe("4 guests");
  });

  it("takes first names and initials", () => {
    expect(firstName("  Eleanor   Whitfield ")).toBe("Eleanor");
    expect(firstName("")).toBe("");
    expect(initials("Eleanor Whitfield")).toBe("EW");
    expect(initials("ana maria santos")).toBe("AS");
    expect(initials("Cher")).toBe("C");
    expect(initials("   ")).toBe("?");
  });
});

describe("dates", () => {
  it("formats calendar dates day-first without timezone drift", () => {
    expect(formatDate("2027-04-18")).toBe("18 Apr 2027");
    expect(formatDate("2027-04-18", "short")).toBe("18 Apr");
    expect(formatDate("2027-04-18", "long")).toBe("Sun, 18 Apr 2027");
    expect(formatDate("2027-01-01")).toBe("1 Jan 2027");
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("18/04/2027")).toBe("—");
  });

  it("formats date ranges compactly", () => {
    expect(formatDateRange("2027-06-14", "2027-06-21")).toBe("14 – 21 Jun 2027");
    expect(formatDateRange("2027-06-28", "2027-07-02")).toBe("28 Jun – 2 Jul 2027");
    expect(formatDateRange("2026-12-30", "2027-01-02")).toBe("30 Dec 2026 – 2 Jan 2027");
    expect(formatDateRange("2027-06-14", "2027-06-14")).toBe("14 Jun 2027");
    expect(formatDateRange("2027-06-14", null)).toBe("14 Jun 2027");
    expect(formatDateRange("2027-06-14", "nope")).toBe("14 Jun 2027");
  });

  it("splits a date into its tile parts", () => {
    expect(dateTileParts("2026-11-08")).toEqual({ month: "Nov", day: "08" });
    expect(dateTileParts("bad")).toEqual({ month: "", day: "" });
  });

  it("formats instants in the workspace timezone", () => {
    const instant = new Date("2026-11-03T06:12:00Z");
    expect(formatDateTime(instant, "Asia/Baku")).toBe("3 Nov 2026, 10:12");
    expect(formatDateTime("2026-11-03T06:12:00Z", "UTC")).toBe("3 Nov 2026, 06:12");
    expect(formatDateTime("not a date", "UTC")).toBe("—");
  });

  it("writes the overview's date line", () => {
    expect(formatLongDate("2026-11-14")).toBe("Saturday 14 November 2026".replace("Saturday ", "Saturday, "));
    expect(formatLongDate("x")).toBe("");
  });

  it("describes how long ago something happened", () => {
    const now = new Date("2026-11-14T12:00:00Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(formatRelative(ago(20_000), now, "UTC")).toBe("Just now");
    expect(formatRelative(ago(12 * 60_000), now, "UTC")).toBe("12 min ago");
    expect(formatRelative(ago(2 * 3_600_000), now, "UTC")).toBe("2 h ago");
    expect(formatRelative(ago(23 * 3_600_000), now, "UTC")).toBe("23 h ago");
    // A day or more ago: counted on the calendar.
    expect(formatRelative(ago(26 * 3_600_000), now, "UTC")).toBe("Yesterday");
    expect(formatRelative("2026-11-13T00:10:00Z", new Date("2026-11-14T23:59:00Z"), "UTC")).toBe("Yesterday");
    expect(formatRelative("2026-11-12T20:00:00Z", new Date("2026-11-14T02:00:00Z"), "UTC")).toBe("12 Nov");
    expect(formatRelative("2026-11-10T09:00:00Z", now, "UTC")).toBe("10 Nov");
    expect(formatRelative("2025-11-10T09:00:00Z", now, "UTC")).toBe("10 Nov 2025");
    expect(formatRelative("garbage", now, "UTC")).toBe("—");
    // 21:00 UTC on the 12th is already the 13th in Baku, so it is "yesterday" there on the 14th.
    expect(formatRelative("2026-11-12T21:00:00Z", new Date("2026-11-14T06:00:00Z"), "Asia/Baku")).toBe("Yesterday");
    expect(formatRelative("2026-11-12T21:00:00Z", new Date("2026-11-14T06:00:00Z"), "UTC")).toBe("12 Nov");
  });

  it("greets by the hour in the workspace timezone", () => {
    const now = new Date("2026-11-14T15:30:00Z");
    expect(hourIn("UTC", now)).toBe(15);
    expect(hourIn("Asia/Baku", now)).toBe(19);
    expect(hourIn("UTC", new Date("2026-11-14T00:05:00Z"))).toBe(0);
    expect(greeting(3)).toBe("Good evening");
    expect(greeting(8)).toBe("Good morning");
    expect(greeting(13)).toBe("Good afternoon");
    expect(greeting(19)).toBe("Good evening");
  });
});

describe("months", () => {
  it("shifts months across years", () => {
    expect(shiftMonth("2026-11", 1)).toBe("2026-12");
    expect(shiftMonth("2026-11", 2)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-06", -5)).toBe("2026-01");
    expect(shiftMonth("2026-06", 0)).toBe("2026-06");
  });

  it("describes a month", () => {
    expect(monthBucket("2026-11")).toEqual({ key: "2026-11", from: "2026-11-01", to: "2026-11-30", short: "Nov", long: "November" });
    expect(monthBucket("2028-02").to).toBe("2028-02-29");
    expect(monthBucket("2026-12").to).toBe("2026-12-31");
    expect(monthTitle("2026-11")).toBe("November 2026");
  });

  it("lists the months that end with today's", () => {
    expect(lastMonths("2026-11-14", 6).map((month) => month.key)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(lastMonths("2026-02-01", 3).map((month) => month.short)).toEqual(["Dec", "Jan", "Feb"]);
    expect(lastMonths("2026-02-01", 1)).toHaveLength(1);
  });

  it("lays a month out Monday-first", () => {
    const november = monthGrid("2026-11"); // 1 Nov 2026 is a Sunday
    expect(november.cells.slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(november.cells).toHaveLength(6 + 30);
    expect(november.from).toBe("2026-11-01");
    expect(november.to).toBe("2026-11-30");
    const june = monthGrid("2026-06"); // 1 Jun 2026 is a Monday
    expect(june.cells[0]).toBe("2026-06-01");
    expect(june.cells.at(-1)).toBe("2026-06-30");
  });
});

describe("money", () => {
  it("knows each currency's decimal places", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("KWD")).toBe(3);
    expect(currencyDigits("not-a-currency")).toBe(2);
  });

  it("reads typed amounts as minor units", () => {
    expect(toMinorUnits("120", "USD")).toBe(12000);
    expect(toMinorUnits("120.5", "USD")).toBe(12050);
    expect(toMinorUnits(" 1,200.50 ", "USD")).toBe(120050);
    expect(toMinorUnits("0", "USD")).toBe(0);
    expect(toMinorUnits("500", "JPY")).toBe(500);
    expect(toMinorUnits("1.234", "KWD")).toBe(1234);
    expect(toMinorUnits("1.234", "USD")).toBeNull();
    expect(toMinorUnits("5.5", "JPY")).toBeNull();
    expect(toMinorUnits("-5", "USD")).toBeNull();
    expect(toMinorUnits("abc", "USD")).toBeNull();
    expect(toMinorUnits("", "USD")).toBeNull();
    expect(toMinorUnits("99999999999999999999", "USD")).toBeNull();
  });

  it("writes minor units back for an input", () => {
    expect(fromMinorUnits(12050, "USD")).toBe("120.50");
    expect(fromMinorUnits(500, "JPY")).toBe("500");
    expect(fromMinorUnits(0, "USD")).toBe("0.00");
  });

  it("shortens large amounts", () => {
    expect(formatCompactMoney(4_160_000, "USD")).toBe("$41.6K");
    expect(formatCompactMoney(95_000, "USD")).toBe("$950");
    expect(formatCompactMoney(0, "USD")).toBe("$0");
    expect(formatCompactMoney(123_400, "bogus")).toBe("1234");
  });

  it("formats counts and storage", () => {
    expect(formatCount(1284)).toBe("1,284");
    expect(formatStorage(0)).toBe("0 MB");
    expect(formatStorage(500_000)).toBe("<1 MB");
    expect(formatStorage(120 * 1024 * 1024)).toBe("120 MB");
    expect(formatStorage(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });
});

describe("trends and chart", () => {
  it("compares with the previous period", () => {
    expect(trend(118, 100, "October")).toEqual({ text: "↑ 18% vs October", tone: "up" });
    expect(trend(80, 100, "October")).toEqual({ text: "↓ 20% vs October", tone: "warn" });
    expect(trend(100, 100, "October")).toEqual({ text: "Same as October", tone: "neutral" });
    expect(trend(5, 0, "October")).toEqual({ text: "↑ from none in October", tone: "up" });
    expect(trend(0, 0, "October")).toEqual({ text: "None yet, as in October", tone: "neutral" });
  });

  const points: ChartPoint[] = [
    { label: "Jun", longLabel: "June", requests: 21, confirmed: 16 },
    { label: "Nov", longLabel: "November", requests: 44, confirmed: 31 },
  ];

  it("scales bars with headroom and keeps small values visible", () => {
    expect(chartMax(points)).toBe(44);
    expect(chartMax([])).toBe(0);
    expect(barHeight(44, 44)).toBeCloseTo(92.6, 1);
    expect(barHeight(22, 44)).toBeCloseTo(46.3, 1);
    expect(barHeight(0, 44)).toBe(0);
    expect(barHeight(5, 0)).toBe(0);
    expect(barHeight(1, 1000)).toBe(2);
  });

  it("summarises the chart in words", () => {
    expect(chartSummary(points)).toBe("Booking requests went from 21 in June to 44 in November; confirmed bookings from 16 to 31.");
    expect(chartSummary([])).toBe("No bookings to chart yet.");
    expect(chartSummary(points.map((point) => ({ ...point, requests: 0, confirmed: 0 })))).toBe("No bookings for tours between June and November.");
  });
});

describe("lists", () => {
  it("words the conflict banner", () => {
    expect(clashHeadline(1)).toBe("1 scheduling conflict needs your attention");
    expect(clashHeadline(4)).toBe("4 scheduling conflicts need your attention");
  });

  it("pages", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
    expect(pageSummary(1, 25, 0)).toBe("0 of 0");
    expect(pageSummary(1, 25, 80)).toBe("1–25 of 80");
    expect(pageSummary(4, 25, 80)).toBe("76–80 of 80");
    expect(pageSummary(1, 25, 1284)).toBe("1–25 of 1,284");
  });
});

describe("URL parameters", () => {
  it("reads the first non-blank value", () => {
    expect(firstParam("  a ")).toBe("a");
    expect(firstParam(["b", "c"])).toBe("b");
    expect(firstParam("   ")).toBeUndefined();
    expect(firstParam(undefined)).toBeUndefined();
    expect(firstParam([])).toBeUndefined();
  });

  it("accepts only sane page numbers", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("12345678")).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });

  it("accepts only known enum values, dates and ids", () => {
    expect(enumParam("pending", ["pending", "confirmed"] as const)).toBe("pending");
    expect(enumParam("bogus", ["pending", "confirmed"] as const)).toBeUndefined();
    expect(enumParam(undefined, ["pending"] as const)).toBeUndefined();
    expect(dateParam("2026-11-14")).toBe("2026-11-14");
    expect(dateParam("2026-02-30")).toBeUndefined();
    expect(dateParam(undefined)).toBeUndefined();
    expect(uuidParam("0191e7c2-8f6a-7c3b-9d2e-5a4b3c2d1e0f")).toBe("0191e7c2-8f6a-7c3b-9d2e-5a4b3c2d1e0f");
    expect(uuidParam("not-an-id")).toBeUndefined();
    expect(uuidParam(undefined)).toBeUndefined();
  });

  it("builds clean links", () => {
    expect(hrefWith("/workspace/bookings", {})).toBe("/workspace/bookings");
    expect(hrefWith("/workspace/bookings", { status: "pending", q: "", page: undefined, tour: null, clash: false })).toBe("/workspace/bookings?status=pending");
    expect(hrefWith("/workspace/bookings", { q: "a b&c", clash: true, page: 2 })).toBe("/workspace/bookings?q=a+b%26c&clash=1&page=2");
    expect(bookingHref("abc")).toBe("/workspace/bookings?booking=abc");
  });

  it("builds mail links and export names", () => {
    expect(mailtoLink("eleanor@example.com")).toBe("mailto:eleanor@example.com");
    expect(mailtoLink("a+b@example.com", "Your request AJ-1 & more")).toBe("mailto:a%2Bb@example.com?subject=Your%20request%20AJ-1%20%26%20more");
    expect(exportFileName("bookings", "2026-11-14")).toBe("bookings-2026-11-14.csv");
  });
});
