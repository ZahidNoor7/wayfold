import { sql } from "drizzle-orm";
import { withoutTenant } from "@/server/db/context";

/**
 * Liveness for uptime monitors. Says only whether the app can reach its
 * database through the runtime role (which also proves that role is safe);
 * detailed health lives in the platform back office.
 */
export async function GET() {
  try {
    await withoutTenant((tx) => tx.execute(sql`select 1`));
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
