import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveInquiry,
  countInquiriesByStatus,
  countNewInquiries,
  deleteInquiry,
  getInquiry,
  listInquiries,
  markInquiryRead,
  setInquiryStatus,
  submitInquiry,
} from "@/server/content/inquiries";
import { withTenant } from "@/server/db/context";
import { inquiries, tenants } from "@/server/db/schema";
import { enqueueNotification } from "@/server/notifications";
import { addDays, todayIn } from "@/lib/dates";
import { createTenant, randomId, type TenantFixture } from "../../helpers/fixtures";
import { asOwner, asVisitor, auditActions, failure, seedTour } from "./seed";

// Delivery belongs to the notifications module; only the hand-off is under test here.
vi.mock("@/server/notifications", () => ({ enqueueNotification: vi.fn(async () => undefined) }));
const enqueue = vi.mocked(enqueueNotification);

const valid = { name: "Daniel Okafor", email: "Daniel@Example.com", message: "We are four adults visiting in May." };

async function setBusinessEmail(tenant: TenantFixture, email: string): Promise<void> {
  await withTenant(tenant.tenantId, ({ tx }) => tx.update(tenants).set({ email }).where(eq(tenants.id, tenant.tenantId)));
}

beforeEach(() => {
  enqueue.mockClear();
});

describe("inquiries: storefront contact form", () => {
  it("stores the message and alerts the business address", async () => {
    const tenant = await createTenant({ name: "Aurelia Journeys" });
    await setBusinessEmail(tenant, "hello@aurelia.example");
    const tour = await seedTour(tenant, { title: "Silk Road to Sheki" });

    const { id } = await asVisitor(tenant)((scope) =>
      submitInquiry(scope, { ...valid, name: "  Daniel   Okafor ", phone: " +44 7700 900123 ", tourId: tour.id, message: "  We are four adults\r\nvisiting in May.  " }),
    );

    const stored = await asOwner(tenant)((scope) => getInquiry(scope, id));
    expect(stored).toMatchObject({
      preferredDate: null,
      name: "Daniel Okafor",
      // Emails are stored lower-cased.
      email: "daniel@example.com",
      phone: "+44 7700 900123",
      message: "We are four adults\nvisiting in May.",
      status: "new",
      tour: { id: tour.id, title: "Silk Road to Sheki" },
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    const [scope, notification] = enqueue.mock.calls[0]!;
    expect(scope.tenantId).toBe(tenant.tenantId);
    expect(notification).toMatchObject({
      kind: "inquiry.staff_alert",
      toEmail: "hello@aurelia.example",
      subject: "New inquiry from Daniel Okafor",
      relatedType: "inquiry",
      relatedId: id,
    });
    expect(notification.bodyText).toContain("Aurelia Journeys website");
    expect(notification.bodyText).toContain("Email: daniel@example.com");
    expect(notification.bodyText).toContain("Phone: +44 7700 900123");
    expect(notification.bodyText).toContain("Tour: Silk Road to Sheki");
    expect(notification.bodyText).toContain("We are four adults\nvisiting in May.");
  });

  it("stores the preferred travel date, shows it in the inbox and puts it in the alert", async () => {
    const tenant = await createTenant();
    await setBusinessEmail(tenant, "owner@example.test");
    const date = addDays(todayIn("UTC"), 120);

    const { id } = await asVisitor(tenant)((scope) => submitInquiry(scope, { ...valid, preferredDate: ` ${date} ` }));

    expect((await asOwner(tenant)((scope) => getInquiry(scope, id))).preferredDate).toBe(date);
    expect((await asOwner(tenant)((scope) => listInquiries(scope))).items[0]).toMatchObject({ id, preferredDate: date });
    expect(enqueue.mock.calls[0]![1].bodyText).toContain(`Preferred date: ${date}`);
  });

  it("treats a missing or empty preferred date as none, and allows past dates", async () => {
    const tenant = await createTenant();
    await setBusinessEmail(tenant, "owner@example.test");

    for (const preferredDate of [undefined, null, ""]) {
      const { id } = await asVisitor(tenant)((scope) => submitInquiry(scope, { ...valid, preferredDate }));
      expect((await asOwner(tenant)((scope) => getInquiry(scope, id))).preferredDate, String(preferredDate)).toBeNull();
    }
    for (const [, notification] of enqueue.mock.calls) expect(notification.bodyText).not.toContain("Preferred date");

    // The design puts no lower bound on the date field.
    const past = await asVisitor(tenant)((scope) => submitInquiry(scope, { ...valid, preferredDate: "2020-02-29" }));
    expect((await asOwner(tenant)((scope) => getInquiry(scope, past.id))).preferredDate).toBe("2020-02-29");
  });

  it("rejects a preferred date that is not a calendar date or lies more than three years ahead", async () => {
    const tenant = await createTenant();
    const run = (preferredDate: unknown) => failure(() => asVisitor(tenant)((scope) => submitInquiry(scope, { ...valid, preferredDate } as never)));

    for (const preferredDate of ["18/04/2027", "2027-4-18", "2027-02-30", "2027-13-01", "next spring", "2027-04-18T10:00:00Z", 20270418]) {
      expect((await run(preferredDate)).fieldErrors, String(preferredDate)).toHaveProperty("preferredDate");
    }

    // The workspace is on UTC, so "today" here is the UTC date.
    const today = todayIn("UTC");
    const limit = `${Number(today.slice(0, 4)) + 3}${today.slice(4)}`;
    const dayAfter = (date: string) => {
      const next = new Date(`${date.slice(0, 8)}01T00:00:00Z`);
      next.setUTCDate(Number(date.slice(8)) + 1);
      return next.toISOString().slice(0, 10);
    };
    expect(await run(dayAfter(limit))).toMatchObject({
      name: "ValidationError",
      fieldErrors: { preferredDate: ["Choose a date within the next 3 years."] },
    });
    expect((await run("9999-12-31")).fieldErrors).toHaveProperty("preferredDate");
    expect((await asOwner(tenant)((scope) => listInquiries(scope))).total).toBe(0);

    // Exactly three years out is still fine (unless today is 29 February,
    // whose anniversary does not exist as a date).
    if (!today.endsWith("-02-29")) {
      const { id } = await asVisitor(tenant)((scope) => submitInquiry(scope, { ...valid, preferredDate: limit }));
      expect((await asOwner(tenant)((scope) => getInquiry(scope, id))).preferredDate).toBe(limit);
    }
  });

  it("measures the three years from today in the workspace's own time zone", async () => {
    const tenant = await createTenant();
    // Kiritimati is 14 hours ahead of UTC: for most of the day its date is already tomorrow.
    await withTenant(tenant.tenantId, ({ tx }) => tx.update(tenants).set({ timezone: "Pacific/Kiritimati" }).where(eq(tenants.id, tenant.tenantId)));
    const local = todayIn("Pacific/Kiritimati");
    if (local.endsWith("-02-29")) return;
    const limit = `${Number(local.slice(0, 4)) + 3}${local.slice(4)}`;

    const { id } = await asVisitor(tenant)((scope) => submitInquiry(scope, { ...valid, preferredDate: limit }));
    expect((await asOwner(tenant)((scope) => getInquiry(scope, id))).preferredDate).toBe(limit);
  });

  it("saves without alerting when the business has no contact address", async () => {
    const tenant = await createTenant();
    const { id } = await asVisitor(tenant)((scope) => submitInquiry(scope, { ...valid, tourId: "" }));

    expect(enqueue).not.toHaveBeenCalled();
    expect(await asOwner(tenant)((scope) => getInquiry(scope, id))).toMatchObject({ phone: "", tour: null, status: "new" });
  });

  it("leaves optional lines out of the alert", async () => {
    const tenant = await createTenant();
    await setBusinessEmail(tenant, "owner@example.test");
    await asVisitor(tenant)((scope) => submitInquiry(scope, { ...valid, tourId: null }));

    const body = enqueue.mock.calls[0]![1].bodyText;
    expect(body).not.toContain("Phone:");
    expect(body).not.toContain("Tour:");
  });

  it("validates with the contact form's own messages", async () => {
    const tenant = await createTenant();
    const run = (input: unknown) => failure(() => asVisitor(tenant)((scope) => submitInquiry(scope, input as never)));

    expect(await run({ ...valid, name: " D " })).toMatchObject({ name: "ValidationError", fieldErrors: { name: ["Please tell me your name."] } });
    for (const email of ["", "daniel", "daniel@", "daniel@example", "a b@example.com", `${"a".repeat(200)}@example.com`]) {
      expect((await run({ ...valid, email })).fieldErrors?.email?.[0], email).toBe("Enter a valid email address.");
    }
    expect((await run({ ...valid, message: "Too short" })).fieldErrors).toEqual({
      message: ["A short message (10+ characters) helps me prepare."],
    });
    expect((await run({ ...valid, message: "x".repeat(1001) })).fieldErrors).toEqual({ message: ["Keep your message under 1000 characters."] });
    expect((await run({ ...valid, name: "x".repeat(201) })).fieldErrors).toHaveProperty("name");
    expect((await run({ ...valid, phone: "1".repeat(51) })).fieldErrors).toHaveProperty("phone");
    expect((await run({ ...valid, tourId: "sheki" })).fieldErrors).toHaveProperty("tourId");
    expect(Object.keys((await run({})).fieldErrors ?? {}).sort()).toEqual(["email", "message", "name"]);

    expect((await asOwner(tenant)((scope) => listInquiries(scope))).total).toBe(0);

    // Exactly at the limits is fine.
    await asVisitor(tenant)((scope) => submitInquiry(scope, { name: "Al", email: "a@b.co", message: "x".repeat(1000) }));
    expect((await asOwner(tenant)((scope) => listInquiries(scope))).total).toBe(1);
  });

  it("accepts only a published tour of this site", async () => {
    const tenant = await createTenant();
    const draft = await seedTour(tenant, { status: "draft" });
    const archived = await seedTour(tenant, { status: "archived" });

    for (const tourId of [draft.id, archived.id, randomId()]) {
      expect(await failure(() => asVisitor(tenant)((scope) => submitInquiry(scope, { ...valid, tourId })))).toMatchObject({
        name: "ValidationError",
        fieldErrors: { tourId: ["Choose one of the listed tours."] },
      });
    }
    expect((await asOwner(tenant)((scope) => listInquiries(scope))).total).toBe(0);
  });

  it("keeps a visitor's angle brackets as text and drops control characters", async () => {
    const tenant = await createTenant();
    const { id } = await asVisitor(tenant)((scope) =>
      submitInquiry(scope, { ...valid, message: "Budget <b>under</b> $2000\u0000\u0007, thanks" }),
    );
    expect((await asOwner(tenant)((scope) => getInquiry(scope, id))).message).toBe("Budget <b>under</b> $2000, thanks");
  });

  it("does not save the inquiry when the alert cannot be queued", async () => {
    const tenant = await createTenant();
    await setBusinessEmail(tenant, "owner@example.test");
    enqueue.mockRejectedValueOnce(new Error("outbox unavailable"));

    await expect(asVisitor(tenant)((scope) => submitInquiry(scope, valid))).rejects.toThrow("outbox unavailable");
    expect((await asOwner(tenant)((scope) => listInquiries(scope))).total).toBe(0);
  });
});

describe("inquiries: dashboard inbox", () => {
  async function inbox() {
    const tenant = await createTenant();
    const ids: string[] = [];
    for (const name of ["First Guest", "Second Guest", "Third Guest"]) {
      ids.push((await asVisitor(tenant)((scope) => submitInquiry(scope, { ...valid, name }))).id);
    }
    return { tenant, ids };
  }

  it("lists newest first with a status filter and paging", async () => {
    const { tenant, ids } = await inbox();
    // Distinct, known timestamps so the order does not depend on insert speed.
    await withTenant(tenant.tenantId, async ({ tx }) => {
      for (const [index, id] of ids.entries()) {
        await tx
          .update(inquiries)
          .set({ createdAt: new Date(Date.UTC(2026, 10, 1, 9, index)) })
          .where(eq(inquiries.id, id));
      }
    });
    await asOwner(tenant)((scope) => markInquiryRead(scope, ids[0]!));
    await asOwner(tenant)((scope) => archiveInquiry(scope, ids[1]!));
    const list = (input: Parameters<typeof listInquiries>[1]) => asOwner(tenant)((scope) => listInquiries(scope, input));

    const all = await list({});
    expect(all.total).toBe(3);
    expect(all.items.map((inquiry) => inquiry.name)).toEqual(["Third Guest", "Second Guest", "First Guest"]);

    expect((await list({ status: "new" })).items.map((inquiry) => inquiry.name)).toEqual(["Third Guest"]);
    expect((await list({ status: "read" })).items.map((inquiry) => inquiry.name)).toEqual(["First Guest"]);
    expect((await list({ status: "archived" })).items.map((inquiry) => inquiry.name)).toEqual(["Second Guest"]);

    const page = await list({ limit: 2, offset: 1 });
    expect(page.items.map((inquiry) => inquiry.name)).toEqual(["Second Guest", "First Guest"]);
    expect(page.total).toBe(3);

    expect(await failure(() => list({ status: "spam" as never }))).toMatchObject({ name: "ValidationError" });
    expect(await asOwner(tenant)((scope) => countNewInquiries(scope))).toBe(1);
  });

  it("counts the inbox per status, with zeros for empty statuses", async () => {
    const empty = await createTenant();
    expect(await asOwner(empty)((scope) => countInquiriesByStatus(scope))).toEqual({ new: 0, read: 0, archived: 0 });

    const { tenant, ids } = await inbox();
    expect(await asOwner(tenant)((scope) => countInquiriesByStatus(scope))).toEqual({ new: 3, read: 0, archived: 0 });

    await asOwner(tenant)((scope) => markInquiryRead(scope, ids[0]!));
    await asOwner(tenant)((scope) => archiveInquiry(scope, ids[1]!));
    expect(await asOwner(tenant)((scope) => countInquiriesByStatus(scope))).toEqual({ new: 1, read: 1, archived: 1 });

    await asOwner(tenant)((scope) => deleteInquiry(scope, ids[2]!));
    expect(await asOwner(tenant)((scope) => countInquiriesByStatus(scope))).toEqual({ new: 0, read: 1, archived: 1 });
  });

  it("marks read, archives and reopens", async () => {
    const { tenant, ids } = await inbox();
    expect(await asOwner(tenant)((scope) => countNewInquiries(scope))).toBe(3);

    expect((await asOwner(tenant)((scope) => markInquiryRead(scope, ids[0]!))).status).toBe("read");
    expect((await asOwner(tenant)((scope) => archiveInquiry(scope, ids[0]!))).status).toBe("archived");
    expect((await asOwner(tenant)((scope) => setInquiryStatus(scope, ids[0]!, "new"))).status).toBe("new");
    expect(await failure(() => asOwner(tenant)((scope) => setInquiryStatus(scope, ids[0]!, "deleted" as never)))).toMatchObject({
      name: "ValidationError",
    });
  });

  it("deletes a message and audits the deletion without its content", async () => {
    const { tenant, ids } = await inbox();
    await asOwner(tenant)((scope) => deleteInquiry(scope, ids[2]!));

    expect((await asOwner(tenant)((scope) => listInquiries(scope))).total).toBe(2);
    expect(await auditActions(tenant)).toContain("inquiry.deleted");
    const rows = await withTenant(tenant.tenantId, ({ tx }) => tx.select().from(inquiries).where(eq(inquiries.id, ids[2]!)));
    expect(rows).toEqual([]);
  });

  it("reports unknown inquiries as not found", async () => {
    const tenant = await createTenant();
    const missing = randomId();
    for (const call of [
      () => asOwner(tenant)((scope) => getInquiry(scope, missing)),
      () => asOwner(tenant)((scope) => markInquiryRead(scope, missing)),
      () => asOwner(tenant)((scope) => archiveInquiry(scope, missing)),
      () => asOwner(tenant)((scope) => deleteInquiry(scope, missing)),
      // Ids that are not even UUIDs: not found, not a database error.
      () => asOwner(tenant)((scope) => getInquiry(scope, "42")),
      () => asOwner(tenant)((scope) => markInquiryRead(scope, "")),
      () => asOwner(tenant)((scope) => deleteInquiry(scope, "' or 1=1 --")),
    ]) {
      expect(await failure(call)).toMatchObject({ name: "NotFoundError", code: "not_found" });
    }
  });
});
