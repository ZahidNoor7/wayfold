import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { personalDiscounts } from "@/server/db/schema";
import { ConflictError, LimitExceededError, NotFoundError, ValidationError } from "@/server/errors";
import { consumeDiscount } from "@/server/promotions/engine";
import {
  assignPersonalDiscount,
  getPersonalDiscount,
  listPersonalDiscounts,
  revokePersonalDiscount,
  type PersonalDiscountInput,
} from "@/server/promotions/personal-discounts";
import { createTenant, randomId } from "../../helpers/fixtures";
import { asOwner, auditActions, createTour, errorOf, insertBooking, TODAY } from "../../helpers/promotions";

const input = (overrides: Partial<PersonalDiscountInput> = {}): PersonalDiscountInput => ({
  customerName: "Ada Lovelace",
  email: "ada@example.test",
  type: "percent",
  value: 10,
  ...overrides,
});

describe("personal discounts", () => {
  it("assigns a discount for any tour with no expiry", async () => {
    const tenant = await createTenant();
    const { discount, replacedIds } = await asOwner(tenant, (scope) =>
      assignPersonalDiscount(scope, input({ email: "  Ada@Example.TEST ", note: " Returning guest " }), TODAY),
    );

    expect(replacedIds).toEqual([]);
    expect(discount).toMatchObject({
      customerName: "Ada Lovelace",
      email: "ada@example.test",
      tourId: null,
      tourTitle: null,
      type: "percent",
      value: 10,
      expiresOn: null,
      note: "Returning guest",
      status: "active",
      usedByBookingId: null,
      usedByBookingReference: null,
      createdBy: tenant.ownerId,
      createdByName: "Test User",
      revokedAt: null,
    });
    expect(await auditActions(tenant, discount.id)).toEqual(["promotions.personal_discount_assigned"]);
  });

  it("assigns a discount for one tour with an expiry", async () => {
    const tenant = await createTenant();
    const tour = await createTour(tenant, { title: "Sheki" });
    const { discount } = await asOwner(tenant, (scope) =>
      assignPersonalDiscount(scope, input({ tourId: tour.id, type: "fixed", value: 2_000, expiresOn: "2027-05-31" }), TODAY),
    );
    expect(discount).toMatchObject({ tourId: tour.id, tourTitle: "Sheki", type: "fixed", value: 2_000, expiresOn: "2027-05-31", status: "active" });
  });

  it.each([
    ["a blank name", { customerName: "  " }, "customerName"],
    ["a malformed e-mail", { email: "ada@" }, "email"],
    ["a zero value", { value: 0 }, "value"],
    ["a percentage above 90", { value: 91 }, "value"],
    ["a tour id that is not an id", { tourId: "sheki" }, "tourId"],
    ["an expiry that is not a date", { expiresOn: "31/05/2027" }, "expiresOn"],
    ["an expiry in the past", { expiresOn: "2026-11-14" }, "expiresOn"],
  ])("rejects %s", async (_name, overrides, field) => {
    const tenant = await createTenant();
    const error = await errorOf(() => asOwner(tenant, (scope) => assignPersonalDiscount(scope, input(overrides), TODAY)));

    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors ?? {})).toEqual([field]);
    expect(await asOwner(tenant, (scope) => listPersonalDiscounts(scope, TODAY))).toEqual([]);
  });

  it("accepts an expiry of today", async () => {
    const tenant = await createTenant();
    const { discount } = await asOwner(tenant, (scope) => assignPersonalDiscount(scope, input({ expiresOn: TODAY }), TODAY));
    expect(discount.status).toBe("active");
  });

  it("turns an unknown tour id into a validation error and revokes nothing", async () => {
    const tenant = await createTenant();
    const existing = await asOwner(tenant, (scope) => assignPersonalDiscount(scope, input(), TODAY));

    const error = await errorOf(() => asOwner(tenant, (scope) => assignPersonalDiscount(scope, input({ tourId: randomId() }), TODAY)));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors).toEqual({ tourId: ["Choose one of your own tours."] });

    // The replacement of the older discount rolled back with the failed insert.
    const listed = await asOwner(tenant, (scope) => listPersonalDiscounts(scope, TODAY));
    expect(listed.map((d) => [d.id, d.status])).toEqual([[existing.discount.id, "active"]]);
  });

  describe("replacing an overlapping active discount", () => {
    it("same tour replaces the old one", async () => {
      const tenant = await createTenant();
      const tour = await createTour(tenant);
      const { first, second, listed } = await asOwner(tenant, async (scope) => {
        const first = await assignPersonalDiscount(scope, input({ tourId: tour.id, value: 10 }), TODAY);
        const second = await assignPersonalDiscount(scope, input({ tourId: tour.id, value: 20 }), TODAY);
        return { first, second, listed: await listPersonalDiscounts(scope, TODAY) };
      });

      expect(second.replacedIds).toEqual([first.discount.id]);
      expect(Object.fromEntries(listed.map((d) => [d.id, d.status]))).toEqual({
        [first.discount.id]: "revoked",
        [second.discount.id]: "active",
      });
      expect(await auditActions(tenant, first.discount.id)).toContain("promotions.personal_discount_revoked");
    });

    it("a new any-tour discount replaces every active one for that e-mail", async () => {
      const tenant = await createTenant();
      const [one, two] = [await createTour(tenant), await createTour(tenant)];
      const { replaced, statuses } = await asOwner(tenant, async (scope) => {
        const a = await assignPersonalDiscount(scope, input({ tourId: one.id }), TODAY);
        const b = await assignPersonalDiscount(scope, input({ tourId: two.id }), TODAY);
        const any = await assignPersonalDiscount(scope, input({ tourId: null }), TODAY);
        return {
          replaced: { expected: [a.discount.id, b.discount.id].sort(), actual: [...any.replacedIds].sort() },
          statuses: (await listPersonalDiscounts(scope, TODAY)).map((d) => d.status).sort(),
        };
      });

      expect(replaced.actual).toEqual(replaced.expected);
      expect(statuses).toEqual(["active", "revoked", "revoked"]);
    });

    it("a tour-specific discount replaces an existing any-tour one", async () => {
      const tenant = await createTenant();
      const tour = await createTour(tenant);
      const result = await asOwner(tenant, async (scope) => {
        const any = await assignPersonalDiscount(scope, input(), TODAY);
        const specific = await assignPersonalDiscount(scope, input({ tourId: tour.id }), TODAY);
        return { anyId: any.discount.id, replacedIds: specific.replacedIds };
      });
      expect(result.replacedIds).toEqual([result.anyId]);
    });

    it("leaves discounts for a different tour or a different e-mail alone", async () => {
      const tenant = await createTenant();
      const [one, two] = [await createTour(tenant), await createTour(tenant)];
      const { replacedIds, statuses } = await asOwner(tenant, async (scope) => {
        await assignPersonalDiscount(scope, input({ tourId: one.id }), TODAY);
        await assignPersonalDiscount(scope, input({ email: "bob@example.test", tourId: two.id }), TODAY);
        const third = await assignPersonalDiscount(scope, input({ tourId: two.id }), TODAY);
        return { replacedIds: third.replacedIds, statuses: (await listPersonalDiscounts(scope, TODAY)).map((d) => d.status) };
      });

      expect(replacedIds).toEqual([]);
      expect(statuses).toEqual(["active", "active", "active"]);
    });

    it("does not touch discounts that are already used, revoked or expired", async () => {
      const tenant = await createTenant();
      const tour = await createTour(tenant);
      const { replacedIds, statuses } = await asOwner(tenant, async (scope) => {
        const used = await assignPersonalDiscount(scope, input(), TODAY);
        await consumeDiscount(scope, { source: "personal", refId: used.discount.id, label: "x", amount: 1 }, await insertBooking(scope, tour));
        const revoked = await assignPersonalDiscount(scope, input(), TODAY);
        await revokePersonalDiscount(scope, revoked.discount.id);
        // Assigned a month ago with an expiry that has since passed.
        await assignPersonalDiscount(scope, input({ expiresOn: "2026-10-31" }), "2026-10-15");

        const fresh = await assignPersonalDiscount(scope, input(), TODAY);
        return {
          replacedIds: fresh.replacedIds,
          statuses: (await listPersonalDiscounts(scope, TODAY)).map((d) => d.status).sort(),
        };
      });

      expect(replacedIds).toEqual([]);
      expect(statuses).toEqual(["active", "expired", "revoked", "used"]);
    });

    it("never leaves two active discounts when two people assign at once", async () => {
      const tenant = await createTenant();
      await Promise.all([
        asOwner(tenant, (scope) => assignPersonalDiscount(scope, input({ value: 10 }), TODAY)),
        asOwner(tenant, (scope) => assignPersonalDiscount(scope, input({ value: 20 }), TODAY)),
        asOwner(tenant, (scope) => assignPersonalDiscount(scope, input({ value: 30 }), TODAY)),
      ]);

      const statuses = (await asOwner(tenant, (scope) => listPersonalDiscounts(scope, TODAY))).map((d) => d.status).sort();
      expect(statuses).toEqual(["active", "revoked", "revoked"]);
    });
  });

  it("revokes a discount softly and records who did it", async () => {
    const tenant = await createTenant();
    const { id, view, row } = await asOwner(tenant, async (scope) => {
      const { discount } = await assignPersonalDiscount(scope, input(), TODAY);
      await revokePersonalDiscount(scope, discount.id);
      const [row] = await scope.tx.select().from(personalDiscounts).where(eq(personalDiscounts.id, discount.id));
      return { id: discount.id, view: await getPersonalDiscount(scope, discount.id, TODAY), row };
    });

    expect(view.status).toBe("revoked");
    expect(view.revokedAt).toBeInstanceOf(Date);
    expect(row?.revokedBy).toBe(tenant.ownerId);
    expect((await auditActions(tenant, id)).sort()).toEqual(["promotions.personal_discount_assigned", "promotions.personal_discount_revoked"]);
  });

  it("refuses to revoke twice, or to revoke a discount that was already used", async () => {
    const tenant = await createTenant();
    const tour = await createTour(tenant);
    const errors = await asOwner(tenant, async (scope) => {
      const revoked = await assignPersonalDiscount(scope, input(), TODAY);
      await revokePersonalDiscount(scope, revoked.discount.id);
      const used = await assignPersonalDiscount(scope, input({ email: "bob@example.test" }), TODAY);
      await consumeDiscount(scope, { source: "personal", refId: used.discount.id, label: "x", amount: 1 }, await insertBooking(scope, tour));
      return {
        twice: await errorOf(() => revokePersonalDiscount(scope, revoked.discount.id)),
        used: await errorOf(() => revokePersonalDiscount(scope, used.discount.id)),
      };
    });

    expect(errors.twice).toBeInstanceOf(ConflictError);
    expect((errors.twice as ConflictError).message).toMatch(/already been revoked/);
    expect(errors.used).toBeInstanceOf(ConflictError);
    expect((errors.used as ConflictError).message).toMatch(/already been used/);
  });

  it("shows the booking a used discount was spent on", async () => {
    const tenant = await createTenant();
    const tour = await createTour(tenant);
    const { view, bookingId } = await asOwner(tenant, async (scope) => {
      const { discount } = await assignPersonalDiscount(scope, input(), TODAY);
      const bookingId = await insertBooking(scope, tour);
      await consumeDiscount(scope, { source: "personal", refId: discount.id, label: "x", amount: 1 }, bookingId);
      return { view: await getPersonalDiscount(scope, discount.id, TODAY), bookingId };
    });

    expect(view).toMatchObject({ status: "used", usedByBookingId: bookingId });
    expect(view.usedByBookingReference).toMatch(/^WF-/);
  });

  it("answers not found for ids that do not exist", async () => {
    const tenant = await createTenant();
    expect(await errorOf(() => asOwner(tenant, (scope) => getPersonalDiscount(scope, randomId(), TODAY)))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(() => asOwner(tenant, (scope) => revokePersonalDiscount(scope, randomId())))).toBeInstanceOf(NotFoundError);
  });

  it("requires the promotions feature to assign or revoke", async () => {
    const tenant = await createTenant({ plan: { features: { promotions: false } } });
    expect(await errorOf(() => asOwner(tenant, (scope) => assignPersonalDiscount(scope, input(), TODAY)))).toBeInstanceOf(LimitExceededError);
    expect(await errorOf(() => asOwner(tenant, (scope) => revokePersonalDiscount(scope, randomId())))).toBeInstanceOf(LimitExceededError);
    expect(await asOwner(tenant, (scope) => listPersonalDiscounts(scope, TODAY))).toEqual([]);
  });
});
