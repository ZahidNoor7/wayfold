import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/server/auth/tokens";
import { discountRequests } from "@/server/db/schema";
import { ConflictError, ForbiddenError, LimitExceededError, NotFoundError, ValidationError } from "@/server/errors";
import { enqueueNotification } from "@/server/notifications";
import { consumeDiscount } from "@/server/promotions/engine";
import {
  approveDiscountRequest,
  countPendingDiscountRequests,
  getDiscountRequest,
  getDiscountRequestStatus,
  listDiscountRequests,
  rejectDiscountRequest,
  submitDiscountRequest,
  type DiscountRequestInput,
} from "@/server/promotions/requests";
import { changePromotionSettings } from "@/server/promotions/settings";
import { createTenant, randomId, type TenantFixture } from "../../helpers/fixtures";
import { asOwner, asVisitor, auditActions, createTour, errorOf, insertBooking, setTenantEmail, TODAY, type TourFixture } from "../../helpers/promotions";

vi.mock("@/server/notifications", () => ({ enqueueNotification: vi.fn(async () => undefined) }));
const notifications = vi.mocked(enqueueNotification);

const GENERIC = "We can’t consider a discount this large for this trip. Please request a smaller amount.";

beforeEach(() => notifications.mockClear());

async function setup(tourOverrides: Parameters<typeof createTour>[1] = {}): Promise<{ tenant: TenantFixture; tour: TourFixture }> {
  const tenant = await createTenant();
  return { tenant, tour: await createTour(tenant, { title: "Sheki", ...tourOverrides }) };
}

/** Two adults on the 690.00 tour (base 1,380.00) asking for 10%. */
const request = (tour: TourFixture, overrides: Partial<DiscountRequestInput> = {}): DiscountRequestInput => ({
  tourId: tour.id,
  name: "Ada Lovelace",
  email: "ada@example.test",
  adults: 2,
  type: "percent",
  value: 10,
  ...overrides,
});

/** Submits as a storefront visitor and returns the stored request's id. */
async function submitted(tenant: TenantFixture, tour: TourFixture, overrides: Partial<DiscountRequestInput> = {}): Promise<string> {
  const { reference } = await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, overrides), TODAY));
  const all = await asOwner(tenant, (scope) => listDiscountRequests(scope));
  return all.find((r) => r.reference === reference)!.id;
}

describe("submitDiscountRequest", () => {
  it("stores the request, returns a reference and a token, and keeps only the token's hash", async () => {
    const { tenant, tour } = await setup();
    const result = await asVisitor(tenant, (scope) =>
      submitDiscountRequest(
        scope,
        request(tour, { email: " Ada@Example.TEST ", phone: " +44 20 7946 0000 ", children: 1, reason: " Honeymoon ", name: " Ada Lovelace " }),
        TODAY,
      ),
    );

    expect(result.reference).toBe("DR-1001");
    expect(result.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [row] = await asOwner(tenant, ({ tx }) => tx.select().from(discountRequests));
    expect(row).toMatchObject({
      reference: "DR-1001",
      name: "Ada Lovelace",
      email: "ada@example.test",
      phone: "+44 20 7946 0000",
      tourId: tour.id,
      guests: 3,
      adults: 2,
      children: 1,
      type: "percent",
      value: 10,
      reason: "Honeymoon",
      status: "pending",
      decidedType: null,
      decidedValue: null,
      usedByBookingId: null,
    });
    expect(row!.accessTokenHash).toBe(hashToken(result.accessToken));
    expect(JSON.stringify(row)).not.toContain(result.accessToken);
    expect(await auditActions(tenant, row!.id)).toEqual(["promotions.request_submitted"]);
  });

  it("numbers references in sequence per tenant", async () => {
    const { tenant, tour } = await setup();
    const other = await setup();
    const references = await asVisitor(tenant, async (scope) => [
      (await submitDiscountRequest(scope, request(tour, { email: "a@example.test" }), TODAY)).reference,
      (await submitDiscountRequest(scope, request(tour, { email: "b@example.test" }), TODAY)).reference,
      (await submitDiscountRequest(scope, request(tour, { email: "c@example.test" }), TODAY)).reference,
    ]);
    const elsewhere = await asVisitor(other.tenant, (scope) => submitDiscountRequest(scope, request(other.tour), TODAY));

    expect(references).toEqual(["DR-1001", "DR-1002", "DR-1003"]);
    // Another tenant has its own sequence.
    expect(elsewhere.reference).toBe("DR-1001");
  });

  it("gives concurrent submissions distinct, gap-free references", async () => {
    const { tenant, tour } = await setup();
    const results = await Promise.all(
      ["a", "b", "c", "d", "e", "f"].map((who) =>
        asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, { email: `${who}@example.test` }), TODAY)),
      ),
    );
    expect(results.map((r) => r.reference).sort()).toEqual(["DR-1001", "DR-1002", "DR-1003", "DR-1004", "DR-1005", "DR-1006"]);
    expect(new Set(results.map((r) => r.accessToken)).size).toBe(6);
  });

  it("tells the customer and alerts the business, without putting the token or the maximum in either message", async () => {
    const { tenant, tour } = await setup();
    await setTenantEmail(tenant, "hello@aurelia.example.test");
    const { reference, accessToken } = await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour), TODAY));

    expect(notifications).toHaveBeenCalledTimes(2);
    const [customer, staff] = notifications.mock.calls.map(([, message]) => message);
    expect(customer).toMatchObject({
      kind: "discount_request.received",
      toEmail: "ada@example.test",
      subject: `We received your discount request ${reference}`,
      relatedType: "discount_request",
    });
    // Promised reply: today plus the default two days.
    expect(customer!.bodyText).toContain("10% off on Sheki");
    expect(customer!.bodyText).toContain("reply by 2026-11-17");
    expect(staff).toMatchObject({ kind: "discount_request.received", toEmail: "hello@aurelia.example.test", subject: `New discount request ${reference}` });
    expect(staff!.relatedId).toBe(customer!.relatedId);

    const everything = JSON.stringify(notifications.mock.calls.map(([, message]) => message));
    expect(everything).not.toContain(accessToken);
    expect(everything).not.toContain("30%");
  });

  it("skips the staff alert when the business has no contact e-mail", async () => {
    const { tenant, tour } = await setup();
    await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour), TODAY));
    expect(notifications.mock.calls.map(([, message]) => message.toEmail)).toEqual(["ada@example.test"]);
  });

  it("refuses when the business has turned requests off", async () => {
    const { tenant, tour } = await setup();
    await asOwner(tenant, (scope) => changePromotionSettings(scope, { requestsEnabled: false }));

    const error = await errorOf(() => asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour), TODAY)));
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).message).toBe("Discount requests aren’t available at the moment.");
    expect(notifications).not.toHaveBeenCalled();
  });

  it("refuses when the plan does not include promotions", async () => {
    const tenant = await createTenant({ plan: { features: { promotions: false } } });
    const tour = await createTour(tenant);
    expect(await errorOf(() => asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour), TODAY)))).toBeInstanceOf(LimitExceededError);
  });

  it.each([
    ["a draft", { status: "draft" as const }],
    ["archived", { status: "archived" as const }],
  ])("refuses a tour that is %s", async (_name, overrides) => {
    const { tenant, tour } = await setup(overrides);
    expect(await errorOf(() => asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour), TODAY)))).toBeInstanceOf(NotFoundError);
  });

  it("refuses a tour that does not exist", async () => {
    const { tenant, tour } = await setup();
    const error = await errorOf(() => asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, { tourId: randomId() }), TODAY)));
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it.each([
    ["a zero value", { value: 0 }, "value"],
    ["a negative value", { value: -5 }, "value"],
    ["a fractional value", { value: 9.5 }, "value"],
    ["a value that is not a number", { value: Number.NaN }, "value"],
    ["an unknown type", { type: "bogof" as never }, "type"],
    ["a malformed e-mail", { email: "ada" }, "email"],
    ["a blank name", { name: " " }, "name"],
    ["no adults", { adults: 0 }, "adults"],
    ["negative children", { children: -1 }, "children"],
    ["a tour id that is not an id", { tourId: "sheki" }, "tourId"],
  ])("rejects %s", async (_name, overrides, field) => {
    const { tenant, tour } = await setup();
    const error = await errorOf(() => asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, overrides), TODAY)));
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors ?? {})).toEqual([field]);
  });

  describe("the private maximum (30% by default)", () => {
    it.each([
      ["30% exactly", { type: "percent" as const, value: 30 }],
      ["a fixed amount worth exactly 30% of the trip", { type: "fixed" as const, value: 41_400 }],
      ["one minor unit", { type: "fixed" as const, value: 1 }],
    ])("accepts %s", async (_name, overrides) => {
      const { tenant, tour } = await setup();
      const result = await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, overrides), TODAY));
      expect(result.reference).toBe("DR-1001");
    });

    it.each([
      ["31%", { type: "percent" as const, value: 31 }],
      ["a forged 50%", { type: "percent" as const, value: 50 }],
      ["more than 100%", { type: "percent" as const, value: 250 }],
      ["a fixed amount one minor unit over 30% of the trip", { type: "fixed" as const, value: 41_401 }],
      ["a fixed amount equal to the trip price", { type: "fixed" as const, value: 138_000 }],
      ["a fixed amount above the trip price", { type: "fixed" as const, value: 500_000 }],
      ["an absurdly large fixed amount", { type: "fixed" as const, value: Number.MAX_SAFE_INTEGER }],
    ])("rejects %s with one generic message that does not reveal the maximum", async (_name, overrides) => {
      const { tenant, tour } = await setup();
      const error = await errorOf(() => asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, overrides), TODAY)));

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe(GENERIC);
      expect((error as ValidationError).fieldErrors).toEqual({ value: [GENERIC] });
      expect(JSON.stringify(error) + (error as Error).message).not.toMatch(/30|maximum|limit/i);
      expect(await asOwner(tenant, (scope) => listDiscountRequests(scope))).toEqual([]);
    });

    it("follows the business's own setting", async () => {
      const { tenant, tour } = await setup();
      await asOwner(tenant, (scope) => changePromotionSettings(scope, { maxRequestPercent: 12 }));
      const tooMuch = await errorOf(() => asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, { value: 13 }), TODAY)));
      expect((tooMuch as ValidationError).message).toBe(GENERIC);
      await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, { value: 12 }), TODAY));
    });

    it("prices children with the tour's own child percentage", async () => {
      // Adult 1000.00, child 25%: one adult and two children cost 1,500.00, so 30% is 450.00.
      const { tenant, tour } = await setup({ priceAdult: 100_000, childPricePercent: 25 });
      const family = { adults: 1, children: 2, type: "fixed" as const };

      const over = await errorOf(() => asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, { ...family, value: 45_001 }), TODAY)));
      expect((over as ValidationError).message).toBe(GENERIC);
      // The same amount would pass if children were wrongly charged the adult price (30% of 3,000.00).
      await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, { ...family, value: 45_000 }), TODAY));
    });

    it("rejects any request on a tour that costs nothing", async () => {
      const { tenant, tour } = await setup({ priceAdult: 0 });
      const error = await errorOf(() => asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, { value: 5 }), TODAY)));
      expect((error as ValidationError).message).toBe(GENERIC);
    });
  });

  describe("one pending request per e-mail and tour", () => {
    it("refuses a second request while the first is pending", async () => {
      const { tenant, tour } = await setup();
      await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour), TODAY));
      const error = await errorOf(() => asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, { email: "ADA@example.test", value: 5 }), TODAY)));

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).message).toBe("You already have a discount request waiting for this tour.");
      expect(await asOwner(tenant, (scope) => countPendingDiscountRequests(scope))).toBe(1);
    });

    it("allows another tour, another e-mail, and a new request once the first was decided", async () => {
      const { tenant, tour } = await setup();
      const second = await createTour(tenant);
      const first = await submitted(tenant, tour);
      await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(second), TODAY));
      await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, { email: "bob@example.test" }), TODAY));
      await asOwner(tenant, (scope) => rejectDiscountRequest(scope, first, { reason: "Peak dates" }));
      await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour), TODAY));

      expect(await asOwner(tenant, (scope) => countPendingDiscountRequests(scope))).toBe(3);
    });

    it("lets only one of several simultaneous identical submissions through", async () => {
      const { tenant, tour } = await setup();
      const outcomes = await Promise.allSettled(
        [1, 2, 3].map(() => asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour), TODAY))),
      );
      const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");

      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      expect(rejected).toHaveLength(2);
      for (const outcome of rejected) expect(outcome.reason).toBeInstanceOf(ConflictError);
    });
  });
});

describe("getDiscountRequestStatus", () => {
  it("shows a pending request to the holder of the token, without any personal details", async () => {
    const { tenant, tour } = await setup();
    const issued = await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour, { phone: "+44 20 7946 0000" }), TODAY));
    const status = await asVisitor(tenant, (scope) =>
      getDiscountRequestStatus(scope, { reference: ` ${issued.reference.toLowerCase()} `, accessToken: issued.accessToken }),
    );

    expect(status).toMatchObject({
      reference: "DR-1001",
      status: "pending",
      tourTitle: "Sheki",
      requested: { type: "percent", value: 10 },
      decidedAt: null,
      approved: null,
      rejectionReason: null,
      used: false,
      responseDays: 2,
    });
    const serialised = JSON.stringify(status);
    for (const secret of ["ada@example.test", "Ada Lovelace", "7946", issued.accessToken, hashToken(issued.accessToken)]) {
      expect(serialised).not.toContain(secret);
    }
    for (const key of ["email", "name", "phone", "id", "accessTokenHash"]) expect(status).not.toHaveProperty(key);
  });

  it("shows what was approved but not the internal note, and later that it was used", async () => {
    const { tenant, tour } = await setup();
    const issued = await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour), TODAY));
    const { approved, used } = await asOwner(tenant, async (scope) => {
      const [pending] = await listDiscountRequests(scope);
      await approveDiscountRequest(scope, pending!.id, { type: "percent", value: 8, note: "Regular guest, keep quiet" });
      const approved = await getDiscountRequestStatus(scope, issued);
      await consumeDiscount(scope, { source: "request", refId: pending!.id, label: "x", amount: 1 }, await insertBooking(scope, tour));
      return { approved, used: await getDiscountRequestStatus(scope, issued) };
    });

    expect(approved).toMatchObject({ status: "approved", approved: { type: "percent", value: 8 }, rejectionReason: null, used: false });
    expect(approved.decidedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(approved)).not.toContain("Regular guest");
    expect(used.used).toBe(true);
  });

  it("shows the reason for a rejection", async () => {
    const { tenant, tour } = await setup();
    const issued = await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour), TODAY));
    const status = await asOwner(tenant, async (scope) => {
      const [pending] = await listDiscountRequests(scope);
      await rejectDiscountRequest(scope, pending!.id, { reason: "We can’t discount peak dates." });
      return getDiscountRequestStatus(scope, issued);
    });
    expect(status).toMatchObject({ status: "rejected", approved: null, rejectionReason: "We can’t discount peak dates." });
  });

  it.each([
    ["the right reference with no token", (issued: { reference: string }) => ({ reference: issued.reference, accessToken: "" })],
    ["the right reference with a wrong token", (issued: { reference: string }) => ({ reference: issued.reference, accessToken: "x".repeat(43) })],
    [
      "the right reference with a token cut short",
      (issued: { reference: string; accessToken: string }) => ({ reference: issued.reference, accessToken: issued.accessToken.slice(0, -1) }),
    ],
    ["a wrong reference with the right token", (issued: { accessToken: string }) => ({ reference: "DR-1002", accessToken: issued.accessToken })],
    ["an empty reference", (issued: { accessToken: string }) => ({ reference: "  ", accessToken: issued.accessToken })],
    ["an oversized reference", (issued: { accessToken: string }) => ({ reference: "DR-".padEnd(500, "1"), accessToken: issued.accessToken })],
  ])("answers not found for %s", async (_name, lookup) => {
    const { tenant, tour } = await setup();
    const issued = await asVisitor(tenant, (scope) => submitDiscountRequest(scope, request(tour), TODAY));
    const error = await errorOf(() => asVisitor(tenant, (scope) => getDiscountRequestStatus(scope, lookup(issued))));

    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).message).toBe("Discount request not found.");
  });

  it("does not accept one request's token for another request", async () => {
    const { tenant, tour } = await setup();
    const [first, second] = await asVisitor(tenant, async (scope) => [
      await submitDiscountRequest(scope, request(tour, { email: "a@example.test" }), TODAY),
      await submitDiscountRequest(scope, request(tour, { email: "b@example.test" }), TODAY),
    ]);
    const error = await errorOf(() =>
      asVisitor(tenant, (scope) => getDiscountRequestStatus(scope, { reference: second!.reference, accessToken: first!.accessToken })),
    );
    expect(error).toBeInstanceOf(NotFoundError);
  });
});

describe("deciding a request", () => {
  it("lists requests for the dashboard without the token hash, filtered by status", async () => {
    const { tenant, tour } = await setup();
    const id = await submitted(tenant, tour, { reason: "Student" });
    await submitted(tenant, tour, { email: "bob@example.test" });
    await asOwner(tenant, (scope) => rejectDiscountRequest(scope, id, { reason: "No" }));

    const { all, pending, rejected, count } = await asOwner(tenant, async (scope) => ({
      all: await listDiscountRequests(scope),
      pending: await listDiscountRequests(scope, { status: "pending" }),
      rejected: await listDiscountRequests(scope, { status: "rejected" }),
      count: await countPendingDiscountRequests(scope),
    }));

    expect(all).toHaveLength(2);
    expect(pending.map((r) => r.email)).toEqual(["bob@example.test"]);
    expect(rejected).toMatchObject([{ id, email: "ada@example.test", tourTitle: "Sheki", guests: 2, adults: 2, children: 0, reason: "Student", status: "rejected", decidedByName: "Test User" }]);
    expect(count).toBe(1);
    expect(JSON.stringify(all)).not.toMatch(/accessTokenHash|access_token/);
  });

  it("describes what may be approved", async () => {
    const { tenant, tour } = await setup();
    const id = await submitted(tenant, tour, { value: 20 });
    const within = await asOwner(tenant, (scope) => getDiscountRequest(scope, id));
    await asOwner(tenant, (scope) => changePromotionSettings(scope, { maxRequestPercent: 15 }));
    const lowered = await asOwner(tenant, (scope) => getDiscountRequest(scope, id));

    // Two adults at 690.00: the limits are worked out on what this party really pays.
    expect(within).toMatchObject({ id, canApproveInFull: true, limits: { base: 138_000, maxPercent: 20, maxFixed: 27_600 } });
    // The request stays, but can now only be approved up to the new maximum.
    expect(lowered).toMatchObject({ status: "pending", canApproveInFull: false, limits: { maxPercent: 15 } });
  });

  it("approves in full, notifies the customer and records who decided", async () => {
    const { tenant, tour } = await setup();
    const id = await submitted(tenant, tour);
    notifications.mockClear();
    const view = await asOwner(tenant, (scope) => approveDiscountRequest(scope, id, { type: "percent", value: 10 }));

    expect(view).toMatchObject({ status: "approved", decidedType: "percent", decidedValue: 10, decisionNote: null, decidedBy: tenant.ownerId });
    expect(view.decidedAt).toBeInstanceOf(Date);
    expect(notifications).toHaveBeenCalledTimes(1);
    expect(notifications.mock.calls[0]![1]).toMatchObject({
      kind: "discount_request.approved",
      toEmail: "ada@example.test",
      subject: "Your discount request DR-1001 was approved",
      relatedType: "discount_request",
      relatedId: id,
    });
    expect(notifications.mock.calls[0]![1].bodyText).toContain("approved 10% off on Sheki");
    expect(await auditActions(tenant, id)).toContain("promotions.request_approved");
  });

  it("approves less than was asked, in either type, and says so to the customer", async () => {
    const { tenant, tour } = await setup();
    const asPercent = await submitted(tenant, tour, { value: 20 });
    const asFixed = await submitted(tenant, tour, { email: "bob@example.test", value: 20 });
    notifications.mockClear();

    const [lower, crossType] = await asOwner(tenant, async (scope) => [
      await approveDiscountRequest(scope, asPercent, { type: "percent", value: 8, note: " Low season only " }),
      // The party pays 1,380.00, so the 20% asked for is worth 276.00: approvable to the last unit.
      await approveDiscountRequest(scope, asFixed, { type: "fixed", value: 27_600 }),
    ]);

    expect(lower).toMatchObject({ status: "approved", decidedType: "percent", decidedValue: 8, decisionNote: "Low season only" });
    expect(crossType).toMatchObject({ status: "approved", decidedType: "fixed", decidedValue: 27_600 });
    const bodies = notifications.mock.calls.map(([, message]) => message.bodyText);
    expect(bodies[0]).toContain("You asked for 20% off on Sheki");
    expect(bodies[0]).toContain("can offer 8% off");
    expect(bodies[0]).not.toContain("Low season only");
    expect(bodies[1]).toContain("can offer $276 off");
  });

  it.each([
    ["more than the percentage asked", { value: 10 }, { type: "percent" as const, value: 11 }, /more than the customer asked/],
    ["a fixed amount worth more than the percentage asked", { value: 10 }, { type: "fixed" as const, value: 13_801 }, /more than the customer asked/],
    ["more than the fixed amount asked", { type: "fixed" as const, value: 10_000 }, { type: "fixed" as const, value: 10_001 }, /more than the customer asked/],
    ["a percentage worth more than the fixed amount asked", { type: "fixed" as const, value: 13_800 }, { type: "percent" as const, value: 11 }, /more than the customer asked/],
    ["nothing", { value: 10 }, { type: "percent" as const, value: 0 }, /check the highlighted/],
  ])("refuses to approve %s", async (_name, asked, decision, message) => {
    const { tenant, tour } = await setup();
    const id = await submitted(tenant, tour, asked);
    const error = await errorOf(() => asOwner(tenant, (scope) => approveDiscountRequest(scope, id, decision)));

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toMatch(message);
    expect(await asOwner(tenant, (scope) => getDiscountRequest(scope, id))).toMatchObject({ status: "pending", decidedType: null });
  });

  it("holds an approval to the current maximum even when it was lowered after the request arrived", async () => {
    const { tenant, tour } = await setup();
    const percentId = await submitted(tenant, tour, { value: 25 });
    const fixedId = await submitted(tenant, tour, { email: "bob@example.test", type: "fixed", value: 30_000 });
    await asOwner(tenant, (scope) => changePromotionSettings(scope, { maxRequestPercent: 10 }));

    const errors = await asOwner(tenant, async (scope) => ({
      inFull: await errorOf(() => approveDiscountRequest(scope, percentId, { type: "percent", value: 25 })),
      justOver: await errorOf(() => approveDiscountRequest(scope, percentId, { type: "percent", value: 11 })),
      // 10% of two adults (1,380.00) is 138.00.
      fixedOver: await errorOf(() => approveDiscountRequest(scope, fixedId, { type: "fixed", value: 13_801 })),
    }));
    for (const error of Object.values(errors)) {
      expect(error).toBeInstanceOf(ValidationError);
      // Staff may see their own maximum.
      expect((error as ValidationError).message).toBe("That’s above your maximum of 10%. Approve 10% or less, or reject.");
    }

    const [atCap, fixedAtCap] = await asOwner(tenant, async (scope) => [
      await approveDiscountRequest(scope, percentId, { type: "percent", value: 10 }),
      await approveDiscountRequest(scope, fixedId, { type: "fixed", value: 13_800 }),
    ]);
    expect(atCap).toMatchObject({ status: "approved", decidedValue: 10 });
    expect(fixedAtCap).toMatchObject({ status: "approved", decidedValue: 13_800 });
  });

  describe("a party with children (one adult, two children at 25%: 1,500.00)", () => {
    const family = { adults: 1, children: 2 };
    const familyTour = { priceAdult: 100_000, childPricePercent: 25 };
    const MORE_THAN_ASKED = "You can’t approve more than the customer asked for.";
    const ABOVE_MAXIMUM = "That’s above your maximum of 10%. Approve 10% or less, or reject.";

    it("stores the split and works the limits out on the real party price", async () => {
      const { tenant, tour } = await setup(familyTour);
      const id = await submitted(tenant, tour, { ...family, value: 20 });
      const detail = await asOwner(tenant, (scope) => getDiscountRequest(scope, id));

      expect(detail).toMatchObject({ guests: 3, adults: 1, children: 2, canApproveInFull: true });
      // Not 3,000.00 (everyone an adult), and not a range: exactly what this party pays.
      expect(detail.limits).toEqual({
        base: 150_000,
        asked: { percent: 20, fixed: 30_000 },
        cap: { percent: 30, fixed: 45_000 },
        maxPercent: 20,
        maxFixed: 30_000,
      });
    });

    it("converts between a percentage and an amount on that price, to the last minor unit", async () => {
      const { tenant, tour } = await setup(familyTour);
      const askedPercent = await submitted(tenant, tour, { ...family, value: 20 });
      const askedFixed = await submitted(tenant, tour, { ...family, email: "bob@example.test", type: "fixed", value: 30_000 });

      const errors = await asOwner(tenant, async (scope) => ({
        // 20% of 1,500.00 is 300.00.
        fixedOver: await errorOf(() => approveDiscountRequest(scope, askedPercent, { type: "fixed", value: 30_001 })),
        // 300.00 of 1,500.00 is 20%.
        percentOver: await errorOf(() => approveDiscountRequest(scope, askedFixed, { type: "percent", value: 21 })),
      }));
      for (const error of Object.values(errors)) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toBe(MORE_THAN_ASKED);
      }

      const [asFixed, asPercent] = await asOwner(tenant, async (scope) => [
        await approveDiscountRequest(scope, askedPercent, { type: "fixed", value: 30_000 }),
        await approveDiscountRequest(scope, askedFixed, { type: "percent", value: 20 }),
      ]);
      expect(asFixed).toMatchObject({ status: "approved", decidedType: "fixed", decidedValue: 30_000 });
      expect(asPercent).toMatchObject({ status: "approved", decidedType: "percent", decidedValue: 20 });
    });

    it("holds every kind of approval to a maximum lowered after the request arrived", async () => {
      const { tenant, tour } = await setup(familyTour);
      // Both were within the 30% maximum (450.00) when they were submitted.
      const askedFixed = await submitted(tenant, tour, { ...family, type: "fixed", value: 45_000 });
      const askedPercent = await submitted(tenant, tour, { ...family, email: "bob@example.test", value: 30 });
      await asOwner(tenant, (scope) => changePromotionSettings(scope, { maxRequestPercent: 10 }));

      const detail = await asOwner(tenant, (scope) => getDiscountRequest(scope, askedFixed));
      expect(detail).toMatchObject({ status: "pending", canApproveInFull: false, limits: { cap: { percent: 10, fixed: 15_000 }, maxPercent: 10, maxFixed: 15_000 } });

      const errors = await asOwner(tenant, async (scope) => ({
        fixedInFull: await errorOf(() => approveDiscountRequest(scope, askedFixed, { type: "fixed", value: 45_000 })),
        // 10% of 1,500.00 is 150.00. Pricing the children as adults would have allowed up to 300.00.
        fixedOneOver: await errorOf(() => approveDiscountRequest(scope, askedFixed, { type: "fixed", value: 15_001 })),
        fixedAsPercentOver: await errorOf(() => approveDiscountRequest(scope, askedFixed, { type: "percent", value: 11 })),
        percentInFull: await errorOf(() => approveDiscountRequest(scope, askedPercent, { type: "percent", value: 30 })),
        percentAsFixedOver: await errorOf(() => approveDiscountRequest(scope, askedPercent, { type: "fixed", value: 15_001 })),
      }));
      for (const [name, error] of Object.entries(errors)) {
        expect(error, name).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message, name).toBe(ABOVE_MAXIMUM);
      }

      const [fixedAtCap, percentAsFixedAtCap] = await asOwner(tenant, async (scope) => [
        await approveDiscountRequest(scope, askedFixed, { type: "fixed", value: 15_000 }),
        await approveDiscountRequest(scope, askedPercent, { type: "fixed", value: 15_000 }),
      ]);
      expect(fixedAtCap).toMatchObject({ status: "approved", decidedType: "fixed", decidedValue: 15_000 });
      expect(percentAsFixedAtCap).toMatchObject({ status: "approved", decidedType: "fixed", decidedValue: 15_000 });
    });
  });

  it("rejects with a reason, notifies the customer and records it", async () => {
    const { tenant, tour } = await setup();
    const id = await submitted(tenant, tour);
    notifications.mockClear();
    const view = await asOwner(tenant, (scope) => rejectDiscountRequest(scope, id, { reason: "  We can’t discount peak dates.  " }));

    expect(view).toMatchObject({
      status: "rejected",
      decidedType: null,
      decidedValue: null,
      decisionNote: "We can’t discount peak dates.",
      decidedBy: tenant.ownerId,
    });
    expect(notifications).toHaveBeenCalledTimes(1);
    expect(notifications.mock.calls[0]![1]).toMatchObject({ kind: "discount_request.rejected", toEmail: "ada@example.test", relatedId: id });
    expect(notifications.mock.calls[0]![1].bodyText).toContain("Reason: We can’t discount peak dates.");
    expect(await auditActions(tenant, id)).toContain("promotions.request_rejected");
  });

  it.each([[""], ["   "]])("requires a reason to reject (%j)", async (reason) => {
    const { tenant, tour } = await setup();
    const id = await submitted(tenant, tour);
    const error = await errorOf(() => asOwner(tenant, (scope) => rejectDiscountRequest(scope, id, { reason })));

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors).toEqual({ reason: ["Add a reason so the customer understands."] });
    expect(await asOwner(tenant, (scope) => getDiscountRequest(scope, id))).toMatchObject({ status: "pending" });
  });

  it("makes both decisions final", async () => {
    const { tenant, tour } = await setup();
    const approved = await submitted(tenant, tour);
    const rejected = await submitted(tenant, tour, { email: "bob@example.test" });
    await asOwner(tenant, async (scope) => {
      await approveDiscountRequest(scope, approved, { type: "percent", value: 5 });
      await rejectDiscountRequest(scope, rejected, { reason: "No" });
    });
    notifications.mockClear();

    for (const run of [
      () => asOwner(tenant, (scope) => approveDiscountRequest(scope, approved, { type: "percent", value: 10 })),
      () => asOwner(tenant, (scope) => rejectDiscountRequest(scope, approved, { reason: "Changed my mind" })),
      () => asOwner(tenant, (scope) => approveDiscountRequest(scope, rejected, { type: "percent", value: 5 })),
      () => asOwner(tenant, (scope) => rejectDiscountRequest(scope, rejected, { reason: "Again" })),
    ]) {
      const error = await errorOf(run);
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).message).toBe("This request has already been decided.");
    }
    expect(notifications).not.toHaveBeenCalled();
    const [a, r] = await asOwner(tenant, async (scope) => [await getDiscountRequest(scope, approved), await getDiscountRequest(scope, rejected)]);
    expect(a).toMatchObject({ status: "approved", decidedValue: 5 });
    expect(r).toMatchObject({ status: "rejected", decisionNote: "No" });
  });

  it("lets only one of two people deciding at once win", async () => {
    const { tenant, tour } = await setup();
    const id = await submitted(tenant, tour);
    const outcomes = await Promise.allSettled([
      asOwner(tenant, (scope) => approveDiscountRequest(scope, id, { type: "percent", value: 10 })),
      asOwner(tenant, (scope) => rejectDiscountRequest(scope, id, { reason: "No" })),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const [lost] = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(lost!.reason).toBeInstanceOf(ConflictError);
  });

  it("still lets staff decide requests after requests were turned off", async () => {
    const { tenant, tour } = await setup();
    const id = await submitted(tenant, tour);
    await asOwner(tenant, (scope) => changePromotionSettings(scope, { requestsEnabled: false }));
    const view = await asOwner(tenant, (scope) => approveDiscountRequest(scope, id, { type: "percent", value: 10 }));
    expect(view.status).toBe("approved");
  });

  it("answers not found for ids that do not exist, and needs the promotions feature", async () => {
    const { tenant } = await setup();
    const missing = randomId();
    expect(await errorOf(() => asOwner(tenant, (scope) => getDiscountRequest(scope, missing)))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(() => asOwner(tenant, (scope) => approveDiscountRequest(scope, missing, { type: "percent", value: 5 })))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(() => asOwner(tenant, (scope) => rejectDiscountRequest(scope, missing, { reason: "No" })))).toBeInstanceOf(NotFoundError);

    const unpaid = await createTenant({ plan: { features: { promotions: false } } });
    expect(await errorOf(() => asOwner(unpaid, (scope) => approveDiscountRequest(scope, missing, { type: "percent", value: 5 })))).toBeInstanceOf(LimitExceededError);
    expect(await errorOf(() => asOwner(unpaid, (scope) => rejectDiscountRequest(scope, missing, { reason: "No" })))).toBeInstanceOf(LimitExceededError);
  });

  it("keeps the stored row's e-mail lower-cased so the engine can match it", async () => {
    const { tenant, tour } = await setup();
    await submitted(tenant, tour, { email: "MiXed@Example.TEST" });
    const [row] = await asOwner(tenant, ({ tx }) => tx.select({ email: discountRequests.email }).from(discountRequests).where(eq(discountRequests.tourId, tour.id)));
    expect(row).toEqual({ email: "mixed@example.test" });
  });
});
