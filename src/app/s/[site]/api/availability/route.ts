import { NextResponse, type NextRequest } from "next/server";
import { MAX_WINDOW_DAYS } from "@/lib/calendar";
import { diffDays, isIsoDate } from "@/lib/dates";
import { requestMeta } from "@/server/auth/guards";
import { getTourAvailability } from "@/server/bookings/availability";
import { getPublishedTourBySlug } from "@/server/catalog/storefront";
import { AppError, toActionError } from "@/server/errors";
import { hitRateLimit, type RateLimitRule } from "@/server/rate-limit";
import { inSite, requireActiveSite, siteToday } from "@/server/storefront/context";

/**
 * Live availability for the storefront calendar:
 *
 *   GET /api/availability?tour=<slug>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The tenant comes from the `[site]` segment the proxy derived from the host,
 * never from the query. Only published tours answer; a draft, an archived tour
 * and another business's tour are all the same 404. Nothing is cached: seats
 * change with every request another visitor sends.
 */
const AVAILABILITY_RATE_LIMIT: RateLimitRule = { name: "availability", limit: 120, windowSeconds: 600 };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

const invalid = (error: string) => json({ error, code: "validation" }, 400);

export async function GET(request: NextRequest, { params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  // Unknown and suspended sites answer 404 here, before anything else is read.
  const tenant = await requireActiveSite(site);

  const { ip } = await requestMeta();
  const limit = await hitRateLimit(AVAILABILITY_RATE_LIMIT, `${tenant.id}:${ip}`);
  if (!limit.allowed) {
    return json({ error: "Too many requests. Please wait a moment and try again.", code: "rate_limited" }, 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const query = request.nextUrl.searchParams;
  const slug = (query.get("tour") ?? "").trim().toLowerCase();
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";

  if (!slug || slug.length > 200 || !SLUG.test(slug)) return invalid("Choose a tour.");
  if (!isIsoDate(from) || !isIsoDate(to)) return invalid("Enter valid dates.");
  if (to < from) return invalid("The end date must not be before the start date.");
  if (diffDays(from, to) >= MAX_WINDOW_DAYS) return invalid(`Ask for at most ${MAX_WINDOW_DAYS} days at a time.`);

  try {
    const today = siteToday(tenant);
    const availability = await inSite(tenant, async (scope) => {
      const tour = await getPublishedTourBySlug(scope, slug, { today });
      return getTourAvailability(scope, tour.id, { from, to, today });
    });
    return json(availability);
  } catch (error) {
    // Logs anything unexpected without its payload and answers generically.
    const failure = toActionError(error);
    return json({ error: failure.error, code: failure.code }, error instanceof AppError ? error.status : 500);
  }
}
