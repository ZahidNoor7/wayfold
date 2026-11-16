"use server";

import { siteAction } from "@/server/actions";
import { ForbiddenError, LimitExceededError } from "@/server/errors";
import {
  discountRequestInputSchema,
  discountRequestLookupSchema,
  getDiscountRequestStatus,
  submitDiscountRequest,
  type DiscountRequestStatus,
} from "@/server/promotions/requests";
import { formatDiscount } from "@/server/promotions/shared";
import { RATE_LIMITS } from "@/server/rate-limit";
import { siteToday } from "@/server/storefront/context";

/**
 * A visitor asks for a personal discount. Every rule (including the private
 * maximum) is enforced by the service. The access code in the result is shown
 * once on screen and is never e-mailed.
 */
export const submitDiscountRequestAction = siteAction(RATE_LIMITS.discountRequest, discountRequestInputSchema, async ({ tenant, scope, input }) => {
  try {
    return await submitDiscountRequest(scope, input, siteToday(tenant));
  } catch (error) {
    // A business whose plan has no promotions simply does not take requests;
    // its plan is not the visitor's concern.
    if (error instanceof LimitExceededError) throw new ForbiddenError("Discount requests aren’t available at the moment.");
    throw error;
  }
});

/** What the tracker shows. Nothing here identifies the requester. */
export interface DiscountRequestTracking {
  reference: string;
  status: DiscountRequestStatus;
  tourTitle: string;
  /** "10% off" */
  requestedLabel: string;
  /** ISO timestamps. */
  createdAt: string;
  decidedAt: string | null;
  approvedLabel: string | null;
  rejectionReason: string | null;
  used: boolean;
  responseDays: number;
}

/**
 * Status of a discount request, unlocked by its reference and access code
 * together. A wrong reference and a wrong code are the same "not found".
 */
export const trackDiscountRequestAction = siteAction(
  RATE_LIMITS.discountStatus,
  discountRequestLookupSchema,
  async ({ tenant, scope, input }): Promise<DiscountRequestTracking> => {
    const status = await getDiscountRequestStatus(scope, input);
    return {
      reference: status.reference,
      status: status.status,
      tourTitle: status.tourTitle,
      requestedLabel: formatDiscount(status.requested.type, status.requested.value, tenant.currency),
      createdAt: status.createdAt.toISOString(),
      decidedAt: status.decidedAt ? status.decidedAt.toISOString() : null,
      approvedLabel: status.approved ? formatDiscount(status.approved.type, status.approved.value, tenant.currency) : null,
      rejectionReason: status.rejectionReason,
      used: status.used,
      responseDays: status.responseDays,
    };
  },
);
