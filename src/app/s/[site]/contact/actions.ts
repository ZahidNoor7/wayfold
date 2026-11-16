"use server";

import { z } from "zod";
import { siteAction } from "@/server/actions";
import { submitInquiry } from "@/server/content/inquiries";
import { RATE_LIMITS } from "@/server/rate-limit";

/**
 * Only size limits here: `submitInquiry` owns the real rules and answers with
 * a message per field. `topic` is the form's honeypot.
 */
const contactMessageSchema = z.object({
  name: z.string().max(400),
  email: z.string().max(400),
  phone: z.string().max(400).optional(),
  tourId: z.string().max(100).nullish(),
  preferredDate: z.string().max(40).nullish(),
  message: z.string().max(5000),
  topic: z.string().optional(),
});

/**
 * The storefront contact form. The business comes from the request's host and
 * every visitor is rate-limited per site. A submission that fills the hidden
 * field is from a script: it is dropped, and answered exactly like a real one
 * so the script learns nothing.
 */
export const sendInquiryAction = siteAction(RATE_LIMITS.inquiry, contactMessageSchema, async ({ scope, input }) => {
  const { topic, ...message } = input;
  if (topic && topic.trim() !== "") return { sent: true as const };
  await submitInquiry(scope, message);
  return { sent: true as const };
});
