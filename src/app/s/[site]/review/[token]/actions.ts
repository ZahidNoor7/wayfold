"use server";

import { z } from "zod";
import { siteAction } from "@/server/actions";
import {
  createCustomerUploadSignature,
  finalizeCustomerUpload,
  finalizeCustomerUploadSchema,
  submitCustomerReview,
  type CustomerUpload,
} from "@/server/content/review-requests";
import { uploadRequestSchema } from "@/server/media/service";
import { RATE_LIMITS } from "@/server/rate-limit";

/**
 * The customer review page. The business comes from the request's host and
 * the review link's token decides what may happen; the services check both.
 * The schemas here only bound sizes.
 */
const token = z.string().min(1).max(100);

/** Step 1 of an upload: permission to send one file straight to storage. */
export const customerUploadSignatureAction = siteAction(
  RATE_LIMITS.reviewUpload,
  uploadRequestSchema.omit({ folderId: true }).extend({ token }),
  async ({ scope, input }) => {
    const { token: value, ...request } = input;
    const signed = await createCustomerUploadSignature(scope, value, request);
    return { uploadUrl: signed.uploadUrl, fields: { ...signed.fields }, publicId: signed.publicId, resourceType: signed.resourceType };
  },
);

/** Step 3 of an upload: check what storage holds and keep it for the review. */
export const finalizeCustomerUploadAction = siteAction(
  RATE_LIMITS.reviewUpload,
  finalizeCustomerUploadSchema.extend({ token }),
  async ({ scope, input }): Promise<CustomerUpload> => {
    const { token: value, ...upload } = input;
    return finalizeCustomerUpload(scope, value, upload);
  },
);

export const submitCustomerReviewAction = siteAction(
  RATE_LIMITS.reviewSubmission,
  z.object({
    token,
    customerName: z.string().max(400),
    country: z.string().max(400).optional(),
    rating: z.number().int().min(0).max(10),
    title: z.string().max(1000).optional(),
    body: z.string().max(10_000),
    mediaIds: z.array(z.string().max(64)).max(20).optional(),
  }),
  async ({ scope, input }) => {
    const { token: value, ...review } = input;
    await submitCustomerReview(scope, value, review);
    return { sent: true as const };
  },
);
