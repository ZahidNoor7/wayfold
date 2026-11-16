import { describe, expect, it } from "vitest";
import { effectiveStatus, emptyTabMessage, INQUIRY_TABS, inquiryActions, nextTabIndex, statusToast } from "./status";

describe("INQUIRY_TABS", () => {
  it("lists every status once, after the unfiltered view", () => {
    expect(INQUIRY_TABS.map((tab) => tab.status)).toEqual([null, "new", "read", "archived"]);
    expect(INQUIRY_TABS.map((tab) => tab.label)).toEqual(["All", "New", "Read", "Archived"]);
  });
});

describe("effectiveStatus", () => {
  it("uses the stored status when nothing changed in this session", () => {
    expect(effectiveStatus("a", "new", {})).toBe("new");
    expect(effectiveStatus("a", "read", { b: "archived" })).toBe("read");
  });

  it("prefers a change made in this session", () => {
    expect(effectiveStatus("a", "new", { a: "read" })).toBe("read");
    expect(effectiveStatus("a", "read", { a: "archived" })).toBe("archived");
  });
});

describe("inquiryActions", () => {
  it("lets a new enquiry be archived only", () => {
    expect(inquiryActions("new")).toEqual({ archive: true, restore: false, markUnread: false });
  });

  it("lets a read enquiry be archived or marked unread", () => {
    expect(inquiryActions("read")).toEqual({ archive: true, restore: false, markUnread: true });
  });

  it("lets an archived enquiry be moved back to the inbox only", () => {
    expect(inquiryActions("archived")).toEqual({ archive: false, restore: true, markUnread: false });
  });
});

describe("statusToast", () => {
  it("names what happened", () => {
    expect(statusToast("archived")).toBe("Enquiry archived");
    expect(statusToast("new")).toBe("Enquiry marked as unread");
    expect(statusToast("read")).toBe("Enquiry moved to inbox");
  });
});

describe("emptyTabMessage", () => {
  it("has copy for every tab", () => {
    expect(emptyTabMessage("new")).toBe("You have read every enquiry.");
    expect(emptyTabMessage("read")).toBe("No read enquiries are waiting in the inbox.");
    expect(emptyTabMessage("archived")).toBe("Enquiries you archive are kept here.");
    expect(emptyTabMessage(null)).toBe("There are no enquiries on this page.");
  });
});

describe("nextTabIndex", () => {
  it("moves right and wraps to the first tab", () => {
    expect(nextTabIndex("ArrowRight", 0, 4)).toBe(1);
    expect(nextTabIndex("ArrowRight", 3, 4)).toBe(0);
  });

  it("moves left and wraps to the last tab", () => {
    expect(nextTabIndex("ArrowLeft", 2, 4)).toBe(1);
    expect(nextTabIndex("ArrowLeft", 0, 4)).toBe(3);
  });

  it("jumps to either end", () => {
    expect(nextTabIndex("Home", 2, 4)).toBe(0);
    expect(nextTabIndex("End", 1, 4)).toBe(3);
  });

  it("ignores other keys and an empty tab list", () => {
    expect(nextTabIndex("Enter", 1, 4)).toBeNull();
    expect(nextTabIndex("ArrowRight", 0, 0)).toBeNull();
  });
});
