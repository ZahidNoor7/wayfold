import { redirect } from "next/navigation";
import { MAX_SEARCH_LENGTH } from "@/components/workspace/customers/params";
import { exportFileName, firstParam } from "@/lib/booking-display";
import { todayIn } from "@/lib/dates";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { exportCustomersCsv } from "@/server/customers/service";
import { AppError } from "@/server/errors";

/**
 * CSV of the customers matching the list's current search. It holds personal
 * data, so it needs both the export permission and the right to see
 * customers, and no cache may keep a copy.
 */
export async function GET(request: Request): Promise<Response> {
  const workspace = await requireWorkspace("exports.run");
  if (!can(workspace, "customers.view")) redirect("/workspace/forbidden");

  const search = (firstParam(new URL(request.url).searchParams.get("q") ?? undefined) ?? "").slice(0, MAX_SEARCH_LENGTH).trim();

  let csv: string;
  try {
    csv = await inWorkspace(workspace, (scope) => exportCustomersCsv(scope, search ? { search } : {}));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return new Response(error.message, {
      status: error.status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName("customers", todayIn(workspace.tenant.timezone))}"`,
      "Cache-Control": "no-store",
    },
  });
}
