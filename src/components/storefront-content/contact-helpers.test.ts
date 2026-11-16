import { describe, expect, it } from "vitest";
import {
  contactFormSchema,
  EMPTY_CONTACT_FORM,
  firstInvalidField,
  firstName,
  latestPreferredDate,
  mapsHref,
  MESSAGE_MAX,
  socialLinks,
  telHref,
} from "./contact-helpers";

describe("socialLinks", () => {
  it("returns nothing when no profile is stored", () => {
    expect(socialLinks({})).toEqual([]);
    expect(socialLinks(null)).toEqual([]);
    expect(socialLinks(undefined)).toEqual([]);
    expect(socialLinks({ instagram: "   " })).toEqual([]);
  });

  it("turns profile names into profile addresses, in a fixed order", () => {
    expect(socialLinks({ tiktok: "@wander", facebook: "wander.tours", youtube: "wander", instagram: "@wander_tours" })).toEqual([
      { network: "instagram", label: "Instagram", href: "https://www.instagram.com/wander_tours" },
      { network: "youtube", label: "YouTube", href: "https://www.youtube.com/@wander" },
      { network: "facebook", label: "Facebook", href: "https://www.facebook.com/wander.tours" },
      { network: "tiktok", label: "TikTok", href: "https://www.tiktok.com/@wander" },
    ]);
  });

  it("keeps full addresses and completes bare ones", () => {
    expect(socialLinks({ instagram: "https://instagram.com/wander", youtube: "youtube.com/@wander", facebook: "www.facebook.com" })).toEqual([
      { network: "instagram", label: "Instagram", href: "https://instagram.com/wander" },
      { network: "youtube", label: "YouTube", href: "https://youtube.com/@wander" },
      { network: "facebook", label: "Facebook", href: "https://www.facebook.com" },
    ]);
  });

  it("drops anything that would not be an http(s) link", () => {
    expect(socialLinks({ instagram: "javascript:alert(1)", facebook: "not a profile", tiktok: "https://" })).toEqual([]);
  });
});

describe("telHref", () => {
  it("keeps the leading plus and the digits", () => {
    expect(telHref("+994 50 123 45 67")).toBe("tel:+994501234567");
    expect(telHref("(020) 7946-0018")).toBe("tel:02079460018");
  });

  it("is null without a usable number", () => {
    expect(telHref("")).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(telHref(undefined)).toBeNull();
    expect(telHref("call us")).toBeNull();
    expect(telHref("123")).toBeNull();
  });
});

describe("mapsHref", () => {
  it("builds a Maps search link with the comma encoded", () => {
    expect(mapsHref(40.3667, 49.8352)).toBe("https://www.google.com/maps/search/?api=1&query=40.3667%2C49.8352");
    expect(mapsHref(-33.86, -151.2)).toBe("https://www.google.com/maps/search/?api=1&query=-33.86%2C-151.2");
    expect(mapsHref(0, 0)).toBe("https://www.google.com/maps/search/?api=1&query=0%2C0");
  });

  it("is null without both coordinates or with impossible ones", () => {
    expect(mapsHref(null, 49.8)).toBeNull();
    expect(mapsHref(40.3, null)).toBeNull();
    expect(mapsHref(undefined, undefined)).toBeNull();
    expect(mapsHref(Number.NaN, 10)).toBeNull();
    expect(mapsHref(10, Number.POSITIVE_INFINITY)).toBeNull();
    expect(mapsHref(91, 10)).toBeNull();
    expect(mapsHref(10, -181)).toBeNull();
  });
});

describe("firstName", () => {
  it("is the first word of the name", () => {
    expect(firstName("  Daniel   Okafor ")).toBe("Daniel");
    expect(firstName("Leyla")).toBe("Leyla");
    expect(firstName("")).toBe("");
  });
});

describe("latestPreferredDate", () => {
  it("moves the year and keeps the day", () => {
    expect(latestPreferredDate("2026-11-16")).toBe("2029-11-16");
    expect(latestPreferredDate("2028-02-29", 1)).toBe("2029-02-29");
  });
});

describe("contactFormSchema", () => {
  const schema = contactFormSchema("2026-11-16");
  const valid = { ...EMPTY_CONTACT_FORM, name: "Daniel Okafor", email: "daniel@example.com", message: "We are two adults visiting in May." };
  const messagesFor = (input: Record<string, unknown>) => {
    const result = schema.safeParse(input);
    return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [String(issue.path[0]), issue.message]));
  };

  it("accepts a minimal message and tidies whitespace", () => {
    const result = schema.parse({ ...valid, name: "  Daniel   Okafor ", email: " daniel@example.com ", phone: " +44  7700 900123 ", message: "  Line one\r\nline two  " });
    expect(result).toMatchObject({ name: "Daniel Okafor", email: "daniel@example.com", phone: "+44 7700 900123", message: "Line one\nline two", preferredDate: "", tourId: "", trap: "" });
  });

  it("starts empty and reports the three required fields", () => {
    expect(Object.keys(messagesFor(EMPTY_CONTACT_FORM)).sort()).toEqual(["email", "message", "name"]);
  });

  it("explains each problem in plain language", () => {
    expect(messagesFor({ ...valid, name: "D" }).name).toBe("Enter your name (at least 2 characters).");
    expect(messagesFor({ ...valid, name: "x".repeat(201) }).name).toBe("Keep your name under 200 characters.");
    expect(messagesFor({ ...valid, email: "daniel@example" }).email).toBe("Enter a valid email address, like name@example.com.");
    expect(messagesFor({ ...valid, email: `${"a".repeat(200)}@example.com` }).email).toBe("Enter a valid email address.");
    expect(messagesFor({ ...valid, phone: "1".repeat(51) }).phone).toBe("Keep the phone number under 50 characters.");
    expect(messagesFor({ ...valid, message: "Too short" }).message).toBe("Write a short message (at least 10 characters).");
    expect(messagesFor({ ...valid, message: "x".repeat(MESSAGE_MAX + 1) }).message).toBe("Keep your message under 1000 characters.");
  });

  it("counts the message after trimming", () => {
    expect(schema.safeParse({ ...valid, message: `${"x".repeat(MESSAGE_MAX)}   ` }).success).toBe(true);
    expect(schema.safeParse({ ...valid, message: "   short   " }).success).toBe(false);
  });

  it("allows today up to three years ahead for the preferred date", () => {
    expect(schema.safeParse({ ...valid, preferredDate: "2026-11-16" }).success).toBe(true);
    expect(schema.safeParse({ ...valid, preferredDate: "2029-11-16" }).success).toBe(true);
    expect(messagesFor({ ...valid, preferredDate: "2026-11-15" }).preferredDate).toBe("Choose today or a later date.");
    expect(messagesFor({ ...valid, preferredDate: "2029-11-17" }).preferredDate).toBe("Choose a date within the next 3 years.");
    expect(messagesFor({ ...valid, preferredDate: "next May" }).preferredDate).toBe("Choose a date from the calendar.");
  });

  it("passes the tour choice and the trap field through untouched", () => {
    expect(schema.parse({ ...valid, tourId: "abc", trap: "spam" })).toMatchObject({ tourId: "abc", trap: "spam" });
  });
});

describe("firstInvalidField", () => {
  it("is null when there is nothing to point at", () => {
    expect(firstInvalidField(undefined)).toBeNull();
    expect(firstInvalidField({})).toBeNull();
    expect(firstInvalidField({ form: ["Something else"], name: [] })).toBeNull();
  });

  it("follows the order of the form, not of the error object", () => {
    expect(firstInvalidField({ message: ["Too short"], tourId: ["Choose one of the listed tours."] })).toBe("tourId");
    expect(firstInvalidField({ preferredDate: ["Too far"], email: ["Invalid"] })).toBe("email");
  });
});
