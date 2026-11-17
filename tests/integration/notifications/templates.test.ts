import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_KINDS,
  bookingCancelled,
  bookingConfirmed,
  bookingReceived,
  bookingRescheduled,
  bookingStaffAlert,
  discountRequestApproved,
  discountRequestReceived,
  discountRequestRejected,
  inquiryStaffAlert,
  notificationTemplates,
  renderNotification,
  type BookingDetails,
  type DiscountRequestDetails,
  type NotificationKind,
  type NotificationTemplateData,
} from "@/server/notifications";

const booking: BookingDetails = {
  businessName: "Caspian Trails",
  contactEmail: "hello@caspian-trails.example",
  contactPhone: "+994 50 123 45 67",
  customerName: "Leyla Mammadova",
  reference: "CT-SHE-4821",
  tourTitle: "Sheki Silk Road Weekend",
  startDate: "2026-03-14",
  endDate: "2026-03-15",
  adults: 2,
  children: 1,
  totalAmount: 69000,
  currency: "USD",
  pickup: "Baku, Hilton lobby",
  statusUrl: "https://caspian.wayfold.test/booking/CT-SHE-4821",
};

const request: DiscountRequestDetails = {
  businessName: "Caspian Trails",
  customerName: "Leyla Mammadova",
  reference: "DR-1042",
  tourTitle: "Sheki Silk Road Weekend",
  guests: 6,
  currency: "USD",
};

/** One realistic payload per kind, used to check every template at once. */
const samples: { [K in NotificationKind]: NotificationTemplateData[K] } = {
  "booking.received": { ...booking, holdHours: 24 },
  "booking.confirmed": booking,
  "booking.cancelled": { ...booking, cancelKind: "by_business", reason: "The road is closed by snow." },
  "booking.rescheduled": { ...booking, previousStartDate: "2026-03-07", previousEndDate: "2026-03-08" },
  "booking.staff_alert": { ...booking, customerEmail: "leyla@example.test", customerPhone: "+994 55 000 11 22", customerNotes: "Vegetarian meals please." },
  "discount_request.received": { ...request, requested: { type: "percent", value: 15 } },
  "discount_request.approved": { ...request, approved: { type: "fixed", value: 5000 }, note: "Happy to help a group this size." },
  "discount_request.rejected": { ...request, note: "March is our busiest month." },
  "inquiry.staff_alert": {
    businessName: "Caspian Trails",
    customerName: "Leyla Mammadova",
    customerEmail: "leyla@example.test",
    message: "Do you run this tour in winter?",
  },
  "review.requested": {
    businessName: "Caspian Trails",
    contactEmail: "hello@caspian-trails.example",
    customerName: "Leyla Mammadova",
    tourTitle: "Sheki Silk Road Weekend",
    startDate: "2026-03-14",
    reviewUrl: "https://caspian.wayfold.test/review/abc123",
    expiresOn: "2026-05-13",
  },
  "review.staff_alert": {
    businessName: "Caspian Trails",
    customerName: "Leyla Mammadova",
    bookingReference: "CT-SHE-4821",
    tourTitle: "Sheki Silk Road Weekend",
    rating: 4,
    title: "Lovely weekend",
    body: "The caravanserai was the highlight.",
    attachments: 2,
    dashboardUrl: "https://app.wayfold.test/workspace/reviews",
  },
};

describe("notification templates", () => {
  it("has a template for every notification kind, and each renders clean plain text", () => {
    expect(Object.keys(notificationTemplates).sort()).toEqual([...NOTIFICATION_KINDS].sort());

    for (const kind of NOTIFICATION_KINDS) {
      const rendered = renderNotification(kind, samples[kind] as never);
      expect(rendered.subject.length, kind).toBeGreaterThan(5);
      expect(rendered.subject, kind).not.toMatch(/[\r\n]/);
      expect(rendered.bodyText.length, kind).toBeGreaterThan(40);
      for (const text of [rendered.subject, rendered.bodyText]) {
        expect(text, kind).not.toMatch(/undefined|null|NaN|\[object|<[a-z/]/);
      }
      // Paragraphs are separated by exactly one blank line.
      expect(rendered.bodyText, kind).not.toMatch(/\n{3,}/);
      expect(rendered.bodyText, kind).toBe(rendered.bodyText.trim());
    }
  });

  it("tells a traveller their request arrived, with the facts of the booking", () => {
    const { subject, bodyText } = bookingReceived({ ...booking, holdHours: 24 });
    expect(subject).toBe("We received your booking request CT-SHE-4821");
    expect(bodyText).toContain("Hi Leyla,");
    expect(bodyText).toContain("Your seats are held for 24 hours");
    expect(bodyText).toContain("Booking reference: CT-SHE-4821");
    expect(bodyText).toContain("Tour: Sheki Silk Road Weekend");
    expect(bodyText).toContain("When: Sat, 14 Mar 2026 to Sun, 15 Mar 2026");
    expect(bodyText).toContain("Guests: 2 adults, 1 child");
    expect(bodyText).toContain("Total: $690");
    expect(bodyText).toContain("Pick-up: Baku, Hilton lobby");
    expect(bodyText).toContain("Follow your booking here: https://caspian.wayfold.test/booking/CT-SHE-4821");
    expect(bodyText).toContain("Questions? Reach us at hello@caspian-trails.example or +994 50 123 45 67.");
    expect(bodyText.endsWith("Warm regards,\nCaspian Trails")).toBe(true);
  });

  it("leaves out everything that was not provided", () => {
    const { bodyText } = bookingReceived({
      businessName: "Caspian Trails",
      customerName: "  ",
      reference: "CT-1",
      tourTitle: "Old City Walk",
      startDate: "2026-03-14",
      slotTime: "09:30:00",
      adults: 1,
      totalAmount: 4550,
      currency: "EUR",
    });
    expect(bodyText).toContain("Hi there,");
    expect(bodyText).toContain("When: Sat, 14 Mar 2026 at 09:30");
    expect(bodyText).toContain("Guests: 1 adult");
    expect(bodyText).toContain("Total: €45.50");
    expect(bodyText).not.toMatch(/held for|Pick-up|Follow your booking|Questions\?/);

    expect(bookingReceived({ ...booking, holdHours: 1 }).bodyText).toContain("held for 1 hour while");
    expect(bookingReceived({ ...booking, children: 2 }).bodyText).toContain("2 adults, 2 children");
  });

  it("never fails on a date or currency it cannot format", () => {
    const { bodyText } = bookingConfirmed({ ...booking, startDate: "next Saturday", endDate: undefined, currency: "??" });
    expect(bodyText).toContain("When: next Saturday");
    expect(bodyText).toContain("Total: 69000 ?? (minor units)");
  });

  it("confirms a booking", () => {
    const { subject, bodyText } = bookingConfirmed(booking);
    expect(subject).toBe("Your booking CT-SHE-4821 is confirmed");
    expect(bodyText).toContain("your booking with Caspian Trails is confirmed");
    expect(bodyText).toContain("View your booking here:");
  });

  it("words a cancellation according to who cancelled", () => {
    const declined = bookingCancelled({ ...booking, cancelKind: "declined", reason: " Fully booked. " });
    expect(declined.subject).toBe("About your booking request CT-SHE-4821");
    expect(declined.bodyText).toContain("we are not able to accept it this time");
    expect(declined.bodyText).toContain("Reason: Fully booked.");
    expect(declined.bodyText).toContain("find another date");

    const expired = bookingCancelled({ ...booking, cancelKind: "expired" });
    expect(expired.subject).toBe("About your booking request CT-SHE-4821");
    expect(expired.bodyText).toContain("hold on your seats has been released");
    expect(expired.bodyText).not.toContain("Reason:");

    const byBusiness = bookingCancelled({ ...booking, cancelKind: "by_business", reason: null });
    expect(byBusiness.subject).toBe("Your booking CT-SHE-4821 has been cancelled");
    expect(byBusiness.bodyText).toContain("We are sorry");

    const byCustomer = bookingCancelled({ ...booking, cancelKind: "by_customer" });
    expect(byCustomer.bodyText).toContain("as you asked");
    expect(byCustomer.bodyText).not.toContain("find another date");
  });

  it("shows the old and the new date of a rescheduled booking", () => {
    const { subject, bodyText } = bookingRescheduled({ ...booking, previousStartDate: "2026-03-07", previousEndDate: "2026-03-08", previousSlotTime: "08:00" });
    expect(subject).toBe("New date for your booking CT-SHE-4821");
    expect(bodyText).toContain("Was: Sat, 7 Mar 2026 to Sun, 8 Mar 2026 at 08:00\nNow: Sat, 14 Mar 2026 to Sun, 15 Mar 2026");
  });

  it("alerts staff to a new booking with the traveller's contact details", () => {
    const withLink = bookingStaffAlert({
      ...booking,
      customerEmail: "leyla@example.test",
      customerPhone: "+994 55 000 11 22",
      customerNotes: "Vegetarian meals please.",
      dashboardUrl: "https://app.wayfold.test/bookings/1",
    });
    expect(withLink.subject).toBe("New booking request CT-SHE-4821: Sheki Silk Road Weekend");
    expect(withLink.bodyText).toContain("Leyla Mammadova has asked to book Sheki Silk Road Weekend.");
    expect(withLink.bodyText).toContain("E-mail: leyla@example.test\nPhone: +994 55 000 11 22");
    expect(withLink.bodyText).toContain("Their note: Vegetarian meals please.");
    expect(withLink.bodyText).toContain("Review and confirm it here: https://app.wayfold.test/bookings/1");
    // Staff alerts are not signed off like a letter to a customer.
    expect(withLink.bodyText).not.toContain("Warm regards");

    const bare = bookingStaffAlert({ ...booking, customerEmail: "leyla@example.test" });
    expect(bare.bodyText).not.toMatch(/Phone:|Their note:/);
    expect(bare.bodyText).toContain("Review and confirm it in your Wayfold dashboard.");
  });

  it("acknowledges, approves and declines a discount request", () => {
    const received = discountRequestReceived({ ...request, requested: { type: "percent", value: 15 }, statusUrl: "https://caspian.wayfold.test/r/DR-1042" });
    expect(received.subject).toBe("We received your discount request DR-1042");
    expect(received.bodyText).toContain("Request reference: DR-1042\nTour: Sheki Silk Road Weekend\nGuests: 6\nRequested: 15% off");
    expect(received.bodyText).toContain("Check the status any time here: https://caspian.wayfold.test/r/DR-1042");

    const approved = discountRequestApproved({ ...request, approved: { type: "fixed", value: 5000 }, note: " Enjoy! ", bookingUrl: "https://caspian.wayfold.test/book" });
    expect(approved.subject).toBe("Your discount request DR-1042 is approved");
    expect(approved.bodyText).toContain("Your discount: $50 off");
    expect(approved.bodyText).toContain("A note from us: Enjoy!");
    expect(approved.bodyText).toContain("Book with your discount here: https://caspian.wayfold.test/book");

    const approvedNoLink = discountRequestApproved({ ...request, approved: { type: "percent", value: 10 } });
    expect(approvedNoLink.bodyText).toContain("Quote the reference DR-1042 when you book");
    expect(approvedNoLink.bodyText).not.toContain("A note from us");

    const rejected = discountRequestRejected({ ...request, note: "March is our busiest month." });
    expect(rejected.subject).toBe("About your discount request DR-1042");
    expect(rejected.bodyText).toContain("not able to offer a discount");
    expect(rejected.bodyText).toContain("A note from us: March is our busiest month.");
    expect(rejected.bodyText).toContain("welcome to book at the listed price");
    expect(discountRequestRejected(request).bodyText).not.toContain("A note from us");
  });

  it("alerts staff to a website inquiry", () => {
    const full = inquiryStaffAlert({
      businessName: "Caspian Trails",
      customerName: "Leyla Mammadova",
      customerEmail: "leyla@example.test",
      customerPhone: "+994 55 000 11 22",
      tourTitle: "Sheki Silk Road Weekend",
      message: "  Do you run this tour in winter?\nWe are four people.  ",
      dashboardUrl: "https://app.wayfold.test/inquiries/1",
    });
    expect(full.subject).toBe("New inquiry from Leyla Mammadova");
    expect(full.bodyText).toContain("Name: Leyla Mammadova\nE-mail: leyla@example.test\nPhone: +994 55 000 11 22\nAbout: Sheki Silk Road Weekend");
    expect(full.bodyText).toContain("Message:\nDo you run this tour in winter?\nWe are four people.");
    expect(full.bodyText).toContain("Reply from your dashboard: https://app.wayfold.test/inquiries/1");

    const bare = inquiryStaffAlert({ businessName: "Caspian Trails", customerName: "Leyla", customerEmail: "leyla@example.test", tourTitle: null, message: "Hello" });
    expect(bare.bodyText).not.toMatch(/Phone:|About:/);
    expect(bare.bodyText).toContain("Reply from your Wayfold dashboard, or write to them directly.");
  });

  it("asks a traveller for a review with their private link and its expiry", () => {
    const { subject, bodyText } = renderNotification("review.requested", samples["review.requested"]);
    expect(subject).toBe("How was Sheki Silk Road Weekend?");
    expect(bodyText).toContain("Hi Leyla,");
    expect(bodyText).toContain("on Sheki Silk Road Weekend (Sat, 14 Mar 2026)");
    expect(bodyText).toContain("https://caspian.wayfold.test/review/abc123");
    expect(bodyText).toContain("works until Wed, 13 May 2026");
    expect(bodyText).toContain("Questions? Reach us at hello@caspian-trails.example.");
  });

  it("tells the business a review is waiting, with stars, attachments and a link", () => {
    const { subject, bodyText } = renderNotification("review.staff_alert", samples["review.staff_alert"]);
    expect(subject).toBe("New 4-star review from Leyla Mammadova");
    expect(bodyText).toContain("reviewed Sheki Silk Road Weekend (booking CT-SHE-4821)");
    expect(bodyText).toContain("Rating: ★★★★☆ (4 of 5)");
    expect(bodyText).toContain("Title: Lovely weekend");
    expect(bodyText).toContain("Photos and videos: 2");
    expect(bodyText).toContain("Read and publish it from your dashboard: https://app.wayfold.test/workspace/reviews");

    const bare = renderNotification("review.staff_alert", { ...samples["review.staff_alert"], title: "", attachments: 0, dashboardUrl: undefined, rating: 9 });
    expect(bare.subject).toBe("New 5-star review from Leyla Mammadova");
    expect(bare.bodyText).not.toMatch(/Title:|Photos and videos:/);
    expect(bare.bodyText).toContain("Read and publish it from your Wayfold dashboard.");
  });
});
