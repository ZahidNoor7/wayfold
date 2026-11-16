"use server";

import { z } from "zod";
import { isAutomatedSubmission } from "@/lib/spam-trap";
import { siteAction } from "@/server/actions";
import { recordAudit } from "@/server/audit";
import { submitInquiry } from "@/server/content/inquiries";
import { RATE_LIMITS } from "@/server/rate-limit";

/**
 * Only size limits here: `submitInquiry` owns the real rules and answers with
 * a message per field. `topic` is the form's hidden trap field and
 * `elapsedMs` how long the visitor took to fill the form in.
 */
const contactMessageSchema = z.object({
  name: z.string().max(400),
  email: z.string().max(400),
  phone: z.string().max(400).optional(),
  tourId: z.string().max(100).nullish(),
  preferredDate: z.string().max(40).nullish(),
  message: z.string().max(5000),
  topic: z.string().max(400).optional(),
  elapsedMs: z.number().min(0).max(1e10).nullish(),
});

/**
 * The storefront contact form. The business comes from the request's host and
 * every visitor is rate-limited per site. A submission that looks automated
 * (see `isAutomatedSubmission`) is dropped and answered exactly like a real
 * one, so the script learns nothing; the drop is recorded in the activity log
 * so a wrongly blocked visitor can still be noticed. A filled trap from
 * someone who took their time is kept: that is browser autofill, not a bot.
 */
export const sendInquiryAction = siteAction(RATE_LIMITS.inquiry, contactMessageSchema, async ({ scope, input, ip }) => {
  const { topic, elapsedMs, ...message } = input;
  if (isAutomatedSubmission({ trap: topic, elapsedMs })) {
    await recordAudit(scope, { action: "inquiry.blocked_as_spam", ip, metadata: { elapsedMs: elapsedMs ?? null } });
    return { sent: true as const };
  }
  await submitInquiry(scope, message);
  return { sent: true as const };
});
