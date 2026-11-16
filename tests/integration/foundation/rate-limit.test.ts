import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rateLimits } from "@/server/db/schema";
import { AppError, toActionError } from "@/server/errors";
import { withPlatform } from "@/server/platform/db";
import { enforceRateLimit, hitRateLimit, RATE_LIMITS, RateLimitError, type RateLimitRule } from "@/server/rate-limit";
import { unique } from "../../helpers/fixtures";
import { rejection } from "./support";

const rule = (limit: number, windowSeconds: number): RateLimitRule => ({ name: unique("rule"), limit, windowSeconds });

const keyOf = (r: RateLimitRule, subject: string) => createHash("sha256").update(`${r.name}:${subject}`).digest("base64url");

/** Moves a counter's window start into the past, as if time had gone by. */
async function age(r: RateLimitRule, subject: string, seconds: number): Promise<void> {
  const updated = await withPlatform((tx) =>
    tx
      .update(rateLimits)
      .set({ windowStart: sql`now() - make_interval(secs => ${seconds})` })
      .where(eq(rateLimits.key, keyOf(r, subject)))
      .returning({ key: rateLimits.key }),
  );
  expect(updated).toHaveLength(1);
}

async function stored(r: RateLimitRule, subject: string) {
  const [row] = await withPlatform((tx) => tx.select().from(rateLimits).where(eq(rateLimits.key, keyOf(r, subject))));
  return row ?? null;
}

describe("hitRateLimit", () => {
  it("allows exactly `limit` hits in a window and blocks the next", async () => {
    const r = rule(3, 60);
    const subject = unique("ip");

    for (let i = 0; i < 3; i++) {
      expect(await hitRateLimit(r, subject)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    }
    const blocked = await hitRateLimit(r, subject);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(58);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);

    // Still blocked on every further attempt in the same window.
    expect((await hitRateLimit(r, subject)).allowed).toBe(false);
    expect((await stored(r, subject))?.hits).toBe(5);
  });

  it("starts a fresh window once the old one has passed", async () => {
    const r = rule(2, 60);
    const subject = unique("ip");
    await hitRateLimit(r, subject);
    await hitRateLimit(r, subject);
    expect((await hitRateLimit(r, subject)).allowed).toBe(false);

    await age(r, subject, 61);

    expect(await hitRateLimit(r, subject)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    const row = await stored(r, subject);
    expect(row?.hits).toBe(1);
    expect(Date.now() - row!.windowStart.getTime()).toBeLessThan(10_000);
  });

  it("does not reset while the window is still open", async () => {
    const r = rule(1, 60);
    const subject = unique("ip");
    await hitRateLimit(r, subject);
    await age(r, subject, 30);
    expect((await hitRateLimit(r, subject)).allowed).toBe(false);
    expect((await stored(r, subject))?.hits).toBe(2);
  });

  it("reports how long is left in the window", async () => {
    const r = rule(1, 60);
    const subject = unique("ip");
    await hitRateLimit(r, subject);
    await age(r, subject, 45);

    const blocked = await hitRateLimit(r, subject);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(13);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(15);
  });

  it("never reports a retry delay below one second", async () => {
    const r = rule(1, 60);
    const subject = unique("ip");
    await hitRateLimit(r, subject);
    await age(r, subject, 59.55);
    expect(await hitRateLimit(r, subject)).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("resets by itself after a short real window", async () => {
    const r = rule(1, 1);
    const subject = unique("ip");
    expect((await hitRateLimit(r, subject)).allowed).toBe(true);
    expect((await hitRateLimit(r, subject)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect((await hitRateLimit(r, subject)).allowed).toBe(true);
  });

  it("counts each subject separately", async () => {
    const r = rule(1, 60);
    const first = unique("ip");
    const second = unique("ip");
    expect((await hitRateLimit(r, first)).allowed).toBe(true);
    expect((await hitRateLimit(r, first)).allowed).toBe(false);
    expect((await hitRateLimit(r, second)).allowed).toBe(true);
  });

  it("counts each rule separately for the same subject", async () => {
    const subject = unique("ip");
    const login = rule(1, 60);
    const reset = rule(1, 60);
    expect((await hitRateLimit(login, subject)).allowed).toBe(true);
    expect((await hitRateLimit(login, subject)).allowed).toBe(false);
    expect((await hitRateLimit(reset, subject)).allowed).toBe(true);
  });

  it("counts concurrent hits atomically", async () => {
    const r = rule(5, 60);
    const subject = unique("ip");
    const outcomes = await Promise.all(Array.from({ length: 12 }, () => hitRateLimit(r, subject)));
    expect(outcomes.filter((outcome) => outcome.allowed)).toHaveLength(5);
    expect((await stored(r, subject))?.hits).toBe(12);
  });

  it("stores only a hash of the subject", async () => {
    const r = rule(5, 60);
    const subject = `ada.lovelace+${unique("who")}@example.test`;
    await hitRateLimit(r, subject);

    const row = await stored(r, subject);
    expect(row?.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const leaked = await withPlatform((tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from rate_limits where key like ${`%${subject}%`} or key like ${`%${r.name}%`}`),
    );
    expect(leaked.rows[0]).toEqual({ n: 0 });
  });
});

describe("enforceRateLimit", () => {
  it("resolves while under the limit and throws RateLimitError once over it", async () => {
    const r = rule(2, 120);
    const subject = unique("ip");
    await expect(enforceRateLimit(r, subject)).resolves.toBeUndefined();
    await expect(enforceRateLimit(r, subject)).resolves.toBeUndefined();

    const error = await rejection(enforceRateLimit(r, subject));
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.name).toBe("RateLimitError");
    expect(error.message).toBe("Too many attempts. Please wait and try again.");
    expect((error as RateLimitError).retryAfterSeconds).toBeGreaterThanOrEqual(118);
    expect((error as RateLimitError).retryAfterSeconds).toBeLessThanOrEqual(120);
  });

  it("raises an error the action layer shows to the visitor instead of logging as a crash", async () => {
    const error = new RateLimitError(30);
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(429);

    const logged: unknown[] = [];
    expect(toActionError(error, (e) => logged.push(e))).toEqual({
      ok: false,
      code: "rate_limited",
      error: "Too many attempts. Please wait and try again.",
    });
    expect(logged).toEqual([]);
  });
});

describe("RATE_LIMITS", () => {
  it("defines a positive limit and window for every bucket, with unique names", () => {
    const rules = Object.values(RATE_LIMITS);
    expect(rules.length).toBeGreaterThanOrEqual(10);
    for (const entry of rules) {
      expect(entry.limit).toBeGreaterThan(0);
      expect(entry.windowSeconds).toBeGreaterThan(0);
      expect(entry.name).toMatch(/^[a-z-]+$/);
    }
    expect(new Set(rules.map((entry) => entry.name)).size).toBe(rules.length);
  });
});
