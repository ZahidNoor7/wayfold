import { Download } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CustomersToolbar } from "@/components/workspace/customers/customers-toolbar";
import {
  customerHref,
  CUSTOMERS_PAGE_SIZE,
  customersExportHref,
  customersHref,
  pageOutOfRange,
  parseCustomerParams,
} from "@/components/workspace/customers/params";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { formatCount, formatDate, pageCount, pageSummary, type SearchParams } from "@/lib/booking-display";
import { formatMoney, todayIn } from "@/lib/dates";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { listCustomers } from "@/server/customers/service";

export const metadata = { title: "Customers" };

export default function CustomersPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const workspace = await requireWorkspace("customers.view");
  const view = parseCustomerParams(await searchParams);

  const { rows, total } = await inWorkspace(workspace, (scope) =>
    listCustomers(scope, {
      search: view.q || undefined,
      sort: view.sort,
      limit: CUSTOMERS_PAGE_SIZE,
      offset: (view.page - 1) * CUSTOMERS_PAGE_SIZE,
    }),
  );

  // A stale link past the end of the list lands on the last page instead of an empty one.
  const lastPage = pageOutOfRange(view.page, total);
  if (lastPage !== null) redirect(customersHref({ ...view, page: lastPage }));

  const { currency, timezone } = workspace.tenant;
  const pages = pageCount(total, CUSTOMERS_PAGE_SIZE);
  const lastBooking = (value: Date | null) => (value ? formatDate(todayIn(timezone, value)) : "No bookings yet");
  const bookingCount = (count: number) => `${formatCount(count)} ${count === 1 ? "booking" : "bookings"}`;

  const header = (
    <PageHeader
      title="Customers"
      description="Everyone who has sent a booking request, with what they booked and spent."
      actions={
        can(workspace, "exports.run") && total > 0 ? (
          <a href={customersExportHref(view.q)} download className="btn btn-outline">
            <Download aria-hidden="true" />
            Export CSV
          </a>
        ) : null
      }
    />
  );

  if (total === 0 && !view.q) {
    return (
      <>
        {header}
        <EmptyState
          title="No customers yet"
          description="A profile is created automatically the first time someone sends a booking request through your website. Their bookings, spend and your notes will collect here."
          action={
            can(workspace, "bookings.view") ? (
              <Link href="/workspace/bookings" className="btn btn-default">
                View bookings
              </Link>
            ) : undefined
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <CustomersToolbar q={view.q} sort={view.sort} />

      <div className="card overflow-hidden">
        {rows.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="table min-w-[760px]">
                <thead>
                  <tr>
                    <th scope="col" className="pl-6">
                      Customer
                    </th>
                    <th scope="col">Country</th>
                    <th scope="col">Bookings</th>
                    <th scope="col">Total spent</th>
                    <th scope="col">Last booking</th>
                    <th scope="col" className="pr-6">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="pl-6">
                        <Link href={customerHref(row.id)} className="block font-bold text-primary underline-offset-4 hover:underline">
                          {row.name}
                        </Link>
                        <span className="text-xs text-muted-foreground">{row.email}</span>
                      </td>
                      <td className="text-muted-foreground">{row.country || "—"}</td>
                      <td>{formatCount(row.bookingCount)}</td>
                      <td className="font-semibold">{formatMoney(row.totalSpent, currency)}</td>
                      <td className="whitespace-nowrap text-muted-foreground">{lastBooking(row.lastBookingAt)}</td>
                      <td className="pr-6 text-right">
                        <Link href={customerHref(row.id)} aria-label={`Open ${row.name}`} className="btn btn-outline btn-sm">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y md:hidden">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link href={customerHref(row.id)} className="flex w-full flex-col gap-1.5 p-4 text-left hover:bg-muted/50">
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-bold">{row.name}</span>
                      <span className="shrink-0 font-semibold">{formatMoney(row.totalSpent, currency)}</span>
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{row.email}</span>
                    <span className="flex w-full justify-between gap-3 text-[13px]">
                      <span>
                        {bookingCount(row.bookingCount)}
                        {row.country ? ` · ${row.country}` : ""}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{row.lastBookingAt ? lastBooking(row.lastBookingAt) : ""}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="p-14 text-center">
            <p className="font-bold">No customers match</p>
            <p className="text-sm text-muted-foreground">Try a different name, email address or phone number.</p>
            <Link href={customersHref({ sort: view.sort })} className="btn btn-outline btn-sm mt-4">
              Clear search
            </Link>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-[13px] text-muted-foreground sm:px-6">
          <span>{pageSummary(view.page, CUSTOMERS_PAGE_SIZE, total)} customers</span>
          {pages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center gap-2">
              {view.page > 1 ? (
                <Link href={customersHref({ ...view, page: view.page - 1 })} className="btn btn-outline btn-sm">
                  Previous
                </Link>
              ) : (
                <span className="btn btn-outline btn-sm" aria-disabled="true">
                  Previous
                </span>
              )}
              <span aria-current="page">
                Page {view.page} of {pages}
              </span>
              {view.page < pages ? (
                <Link href={customersHref({ ...view, page: view.page + 1 })} className="btn btn-outline btn-sm">
                  Next
                </Link>
              ) : (
                <span className="btn btn-outline btn-sm" aria-disabled="true">
                  Next
                </span>
              )}
            </nav>
          ) : null}
        </div>
      </div>
    </>
  );
}
