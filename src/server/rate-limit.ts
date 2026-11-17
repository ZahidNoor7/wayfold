import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withoutTenant } from "./db/context";
import { AppError } from "./errors";

// An AppError, so the action layer shows this message to the visitor instead
// of logging a crash and answering with the generic one.
export class RateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("rate_limited", "Too many attempts. Please wait and try again.", 429);
  }
}

export interface RateLimitRule {
  /** Logical bucket, e.g. `login`. */
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  login: { name: "login", limit: 8, windowSeconds: 600 },
  register: { name: "register", limit: 5, windowSeconds: 3600 },
  passwordReset: { name: "password-reset", limit: 5, windowSeconds: 3600 },
  emailVerification: { name: "email-verification", limit: 6, windowSeconds: 3600 },
  bookingRequest: { name: "booking-request", limit: 10, windowSeconds: 3600 },
  inquiry: { name: "inquiry", limit: 6, windowSeconds: 3600 },
  reviewSubmission: { name: "review-submission", limit: 10, windowSeconds: 3600 },
  reviewUpload: { name: "review-upload", limit: 40, windowSeconds: 3600 },
  discountRequest: { name: "discount-request", limit: 5, windowSeconds: 3600 },
  discountStatus: { name: "discount-status", limit: 20, windowSeconds: 600 },
  integrationTest: { name: "integration-test", limit: 20, windowSeconds: 600 },
  invitation: { name: "invitation", limit: 30, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counter in PostgreSQL: correct across serverless instances
 * without extra infrastructure. `subject` (IP, e-mail, tenant id, ...) is
 * hashed, so the table holds no personal data.
 */
export async function hitRateLimit(rule: RateLimitRule, subject: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const key = createHash("sha256").update(`${rule.name}:${subject}`).digest("base64url");
  const result = await withoutTenant((tx) =>
    tx.execute<{ hits: number; elapsed: number }>(sql`
      insert into rate_limits (key, window_start, hits) values (${key}, now(), 1)
      on conflict (key) do update set
        hits = case when rate_limits.window_start < now() - make_interval(secs => ${rule.windowSeconds}) then 1 else rate_limits.hits + 1 end,
        window_start = case when rate_limits.window_start < now() - make_interval(secs => ${rule.windowSeconds}) then now() else rate_limits.window_start end
      returning hits, extract(epoch from now() - window_start)::int as elapsed
    `),
  );
  const row = result.rows[0]!;
  const allowed = row.hits <= rule.limit;
  return { allowed, retryAfterSeconds: allowed ? 0 : Math.max(1, rule.windowSeconds - row.elapsed) };
}

export async function enforceRateLimit(rule: RateLimitRule, subject: string): Promise<void> {
  const outcome = await hitRateLimit(rule, subject);
  if (!outcome.allowed) throw new RateLimitError(outcome.retryAfterSeconds);
}
