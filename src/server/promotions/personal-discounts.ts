import "server-only";
import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import { assertFeature } from "../billing/limits";
import type { TenantScope } from "../db/context";
import { bookings, personalDiscounts, tours, users } from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  checkPercentCap,
  discountTypeSchema,
  discountValueSchema,
  emailSchema,
  FOREIGN_KEY_VIOLATION,
  isoDateSchema,
  lockInTenant,
  parse,
  pgError,
  type DiscountType,
} from "./shared";

type Row = typeof personalDiscounts.$inferSelect;

export type PersonalDiscountStatus = "revoked" | "used" | "expired" | "active";

/** Derived, never stored. Revoked wins over used, used over expired. */
export function personalDiscountStatus(
  discount: Pick<Row, "revokedAt" | "usedByBookingId" | "expiresOn">,
  today: string,
): PersonalDiscountStatus {
  if (discount.revokedAt) return "revoked";
  if (discount.usedByBookingId) return "used";
  if (discount.expiresOn && discount.expiresOn < today) return "expired";
  return "active";
}

export const personalDiscountInputSchema = z
  .object({
    customerName: z.string().trim().min(1, "Enter the customer’s name.").max(120),
    email: emailSchema,
    /** Null or absent = valid for any tour. */
    tourId: z
      .uuid()
      .nullish()
      .transform((value) => value ?? null),
    type: discountTypeSchema,
    /** Whole percent for `percent`; minor units for `fixed`. */
    value: discountValueSchema,
    /** Null or absent = never expires. */
    expiresOn: isoDateSchema.nullish().transform((value) => value ?? null),
    /** Internal. Never shown to the customer. */
    note: z.string().trim().max(1000).default(""),
  })
  .superRefine(checkPercentCap);

export type PersonalDiscountInput = z.input<typeof personalDiscountInputSchema>;

export interface PersonalDiscountView {
  id: string;
  customerName: string;
  email: string;
  tourId: string | null;
  /** Null when the discount is valid for any tour. */
  tourTitle: string | null;
  type: DiscountType;
  value: number;
  expiresOn: string | null;
  note: string;
  status: PersonalDiscountStatus;
  usedByBookingId: string | null;
  usedByBookingReference: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}

async function loadViews(scope: TenantScope, today: string, id?: string): Promise<PersonalDiscountView[]> {
  const rows = await scope.tx
    .select({ discount: personalDiscounts, tourTitle: tours.title, bookingReference: bookings.reference, createdByName: users.name })
    .from(personalDiscounts)
    .leftJoin(tours, and(eq(tours.tenantId, personalDiscounts.tenantId), eq(tours.id, personalDiscounts.tourId)))
    .leftJoin(bookings, and(eq(bookings.tenantId, personalDiscounts.tenantId), eq(bookings.id, personalDiscounts.usedByBookingId)))
    .leftJoin(users, eq(users.id, personalDiscounts.createdBy))
    .where(and(eq(personalDiscounts.tenantId, scope.tenantId), id ? eq(personalDiscounts.id, id) : undefined))
    .orderBy(desc(personalDiscounts.createdAt), personalDiscounts.id);

  return rows.map(({ discount, tourTitle, bookingReference, createdByName }) => ({
    id: discount.id,
    customerName: discount.customerName,
    email: discount.email,
    tourId: discount.tourId,
    tourTitle,
    type: discount.type,
    value: discount.value,
    expiresOn: discount.expiresOn,
    note: discount.note,
    status: personalDiscountStatus(discount, today),
    usedByBookingId: discount.usedByBookingId,
    usedByBookingReference: bookingReference,
    createdBy: discount.createdBy,
    createdByName,
    createdAt: discount.createdAt,
    revokedAt: discount.revokedAt,
  }));
}

/** The full record, newest first: revoked, used and expired discounts stay listed. */
export function listPersonalDiscounts(scope: TenantScope, today: string): Promise<PersonalDiscountView[]> {
  return loadViews(scope, today);
}

export async function getPersonalDiscount(scope: TenantScope, id: string, today: string): Promise<PersonalDiscountView> {
  const [view] = await loadViews(scope, today, id);
  // Same answer whether the id is unknown or belongs to another tenant.
  if (!view) throw new NotFoundError("Personal discount");
  return view;
}

export interface AssignedPersonalDiscount {
  discount: PersonalDiscountView;
  /** Active discounts this one replaced; they are now revoked. */
  replacedIds: string[];
}

/**
 * Gives one e-mail address a single-use discount. A customer never holds two
 * that could apply to the same booking: any active discount whose scope
 * overlaps (either side "any tour", or the same tour) is revoked in the same
 * transaction.
 */
export async function assignPersonalDiscount(
  scope: TenantScope,
  input: PersonalDiscountInput,
  today: string,
): Promise<AssignedPersonalDiscount> {
  await assertFeature(scope, "promotions");
  const data = parse(personalDiscountInputSchema, input);
  if (data.expiresOn && data.expiresOn < today) {
    throw new ValidationError(undefined, { expiresOn: ["Expiry date is in the past."] });
  }

  // Two staff assigning to the same customer at once must not both end up active.
  await lockInTenant(scope, "personal-discount", data.email);

  const replaced = await scope.tx
    .update(personalDiscounts)
    .set({ revokedAt: new Date(), revokedBy: scope.userId })
    .where(
      and(
        eq(personalDiscounts.tenantId, scope.tenantId),
        eq(personalDiscounts.email, data.email),
        isNull(personalDiscounts.revokedAt),
        isNull(personalDiscounts.usedByBookingId),
        or(isNull(personalDiscounts.expiresOn), gte(personalDiscounts.expiresOn, today)),
        data.tourId ? or(isNull(personalDiscounts.tourId), eq(personalDiscounts.tourId, data.tourId)) : undefined,
      ),
    )
    .returning({ id: personalDiscounts.id });
  const replacedIds = replaced.map((row) => row.id);

  let created: Row;
  try {
    [created] = (await scope.tx
      .insert(personalDiscounts)
      .values({ tenantId: scope.tenantId, ...data, createdBy: scope.userId })
      .returning()) as [Row];
  } catch (error) {
    // The composite foreign key only accepts this tenant's tours.
    if (pgError(error).code === FOREIGN_KEY_VIOLATION) {
      throw new ValidationError(undefined, { tourId: ["Choose one of your own tours."] });
    }
    throw error;
  }

  for (const id of replacedIds) {
    await recordAudit(scope, {
      action: "promotions.personal_discount_revoked",
      targetType: "personal_discount",
      targetId: id,
      metadata: { reason: "replaced", replacedBy: created.id },
    });
  }
  await recordAudit(scope, {
    action: "promotions.personal_discount_assigned",
    targetType: "personal_discount",
    targetId: created.id,
    metadata: {
      type: created.type,
      value: created.value,
      tourId: created.tourId,
      expiresOn: created.expiresOn,
      replaced: replacedIds.length,
    },
  });
  return { discount: await getPersonalDiscount(scope, created.id, today), replacedIds };
}

/** Soft delete: the discount stops applying and stays on record. */
export async function revokePersonalDiscount(scope: TenantScope, id: string): Promise<void> {
  await assertFeature(scope, "promotions");
  const revoked = await scope.tx
    .update(personalDiscounts)
    .set({ revokedAt: new Date(), revokedBy: scope.userId })
    .where(
      and(
        eq(personalDiscounts.tenantId, scope.tenantId),
        eq(personalDiscounts.id, id),
        isNull(personalDiscounts.revokedAt),
        isNull(personalDiscounts.usedByBookingId),
      ),
    )
    .returning({ id: personalDiscounts.id });

  if (revoked.length === 0) {
    // Nothing changed: find out why, without revealing other tenants' ids.
    const [existing] = await scope.tx
      .select({ revokedAt: personalDiscounts.revokedAt })
      .from(personalDiscounts)
      .where(and(eq(personalDiscounts.tenantId, scope.tenantId), eq(personalDiscounts.id, id)))
      .limit(1);
    if (!existing) throw new NotFoundError("Personal discount");
    throw new ConflictError(
      existing.revokedAt ? "This discount has already been revoked." : "This discount has already been used on a booking.",
    );
  }

  await recordAudit(scope, { action: "promotions.personal_discount_revoked", targetType: "personal_discount", targetId: id });
}
