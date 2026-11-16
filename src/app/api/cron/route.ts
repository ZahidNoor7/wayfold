import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { runScheduledJobs } from "@/server/platform/jobs";

export const maxDuration = 300;

function authorised(request: Request): boolean {
  const secret = env().CRON_SECRET;
  // No secret configured means scheduled jobs are switched off, not open.
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scheduled work for every workspace: expire stale booking holds, deliver
 * queued notifications through each tenant's own e-mail connection, and clear
 * expired sessions. Called by the scheduler with the shared secret; the
 * response carries counts only.
 */
export async function GET(request: Request) {
  if (!authorised(request)) return new Response(null, { status: 404 });
  const result = await runScheduledJobs();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
