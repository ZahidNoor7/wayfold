import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterBar } from "@/components/platform/filter-bar";
import { InvoiceActions } from "@/components/platform/invoice-actions";
import { KpiCard, Pagination, PlatformHeader, StatusBadge } from "@/components/platform/ui";
import { PageSkeleton } from "@/components/workspace/page-header";
import { formatMoney, todayIn } from "@/lib/dates";
import {
  buildHref,
  firstParam,
  formatCount,
  formatDate,
  isUuidLike,
  pageParam,
  pageWindow,
  pickParam,
  revenueTotals,
  type SearchParams,
} from "@/lib/platform-display";
import { getPlatformStats } from "@/server/platform/analytics";
import { listInvoices } from "@/server/platform/billing";
import { loadTenantDirectory } from "../../_lib/data";
import { platformGuard } from "../../_lib/guard";

export const metadata: Metadata = { title: "Billing" };

const PATH = "/platform/billing";
const PAGE_SIZE = 25;
const STATUSES = ["open", "paid", "void"] as const;

export default function BillingPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Billing {...props} />
    </Suspense>
  );
}

function money(entries: { currency: string; amount: number }[]): { value: string; rest: string | null } {
  const [first, ...others] = entries;
  if (!first) return { value: "0", rest: null };
  return {
    value: formatMoney(first.amount, first.currency),
    rest: others.length > 0 ? `Plus ${others.map((entry) => formatMoney(entry.amount, entry.currency)).join(", ")}` : null,
  };
}

async function Billing({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { actor, isOwner } = await platformGuard();
  const params = await searchParams;

  const status = pickParam(params.status, STATUSES);
  const tenantParam = firstParam(params.tenant);
  const tenantId = isUuidLike(tenantParam) ? tenantParam : undefined;
  const page = pageParam(params.page);
  const today = todayIn("UTC");

  const [invoices, open, stats, directory] = await Promise.all([
    listInvoices(actor, { status, tenantId, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    listInvoices(actor, { status: "open", limit: 1 }),
    getPlatformStats(actor, { today }),
    loadTenantDirectory(actor),
  ]);

  const pager = pageWindow(invoices.total, page, PAGE_SIZE);
  const query = { status, tenant: tenantId };
  const filtered = Boolean(status || tenantId);

  const mrr = money(stats.mrr);
  const thisMonth = money(revenueTotals(stats.revenueByMonth.filter((row) => row.month === today.slice(0, 7))));
  const lastYear = money(revenueTotals(stats.revenueByMonth));
  const paidInvoices = stats.revenueByMonth.reduce((sum, row) => sum + row.invoices, 0);

  return (
    <>
      <PlatformHeader kicker="Invoices across every workspace. Nothing is charged automatically: mark an invoice paid when the money arrives." title="Billing" />

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard href={PATH} label="Monthly recurring revenue" value={mrr.value} sub={mrr.rest ?? "Estimate from active subscriptions"} dot="bg-highlight" />
        <KpiCard href={buildHref(PATH, { status: "paid" })} label="Paid this month" value={thisMonth.value} sub={thisMonth.rest ?? "Invoices paid since the 1st, UTC"} dot="bg-emerald-600" />
        <KpiCard
          href={buildHref(PATH, { status: "paid" })}
          label="Paid, last 12 months"
          value={lastYear.value}
          sub={lastYear.rest ?? `${formatCount(paidInvoices)} ${paidInvoices === 1 ? "invoice" : "invoices"}`}
        />
        <KpiCard
          href={buildHref(PATH, { status: "open" })}
          label="Open invoices"
          value={formatCount(open.total)}
          sub={open.total > 0 ? "Waiting for payment" : "Nothing outstanding"}
          tone={open.total > 0 ? "warn" : "neutral"}
          dot="bg-amber-500"
        />
      </div>

      <FilterBar
        path={PATH}
        selects={[
          {
            name: "status",
            label: "Status",
            value: status ?? "",
            options: [
              { value: "", label: "All statuses" },
              { value: "open", label: "Open" },
              { value: "paid", label: "Paid" },
              { value: "void", label: "Void" },
            ],
          },
          {
            name: "tenant",
            label: "Tenant",
            value: tenantId ?? "",
            options: [
              { value: "", label: "All tenants" },
              // A tenant from the URL stays selectable even when it is beyond the directory's cut-off.
              ...(tenantId && !directory.byId.has(tenantId)
                ? [{ value: tenantId, label: invoices.items[0]?.tenantName ?? "Selected workspace" }]
                : []),
              ...directory.options.map((option) => ({ value: option.id, label: option.name })),
            ],
          },
        ]}
      />

      <div className="card overflow-hidden">
        {invoices.items.length === 0 ? (
          <div className="p-14 text-center">
            <p className="font-bold">{filtered ? "No invoices match" : page > 1 ? "Nothing on this page" : "No invoices yet"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered
                ? "Try another status or tenant."
                : page > 1
                  ? "The list is shorter than this page number."
                  : "Invoices appear when a paid subscription is renewed, or when you issue one from a tenant's page."}
            </p>
            {filtered || page > 1 ? (
              <Link href={filtered ? PATH : buildHref(PATH, query)} className="btn btn-outline btn-sm mt-5">
                {filtered ? "Clear filters" : "Back to the first page"}
              </Link>
            ) : (
              <Link href="/platform/tenants" className="btn btn-outline btn-sm mt-5">
                Go to tenants
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="table min-w-[960px]">
                <thead>
                  <tr>
                    <th scope="col" className="pl-6">
                      Invoice
                    </th>
                    <th scope="col">Tenant</th>
                    <th scope="col">Period</th>
                    <th scope="col">Issued</th>
                    <th scope="col" className="text-right">
                      Amount
                    </th>
                    <th scope="col">Status</th>
                    {isOwner ? (
                      <th scope="col" className="pr-6">
                        <span className="sr-only">Actions</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {invoices.items.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="pl-6">
                        <span className="block whitespace-nowrap font-bold">{invoice.number}</span>
                        <span className="block max-w-[260px] truncate text-xs text-muted-foreground" title={invoice.description}>
                          {invoice.description}
                        </span>
                      </td>
                      <td>
                        <Link href={`/platform/tenants/${invoice.tenantId}`} className="text-primary underline-offset-4 hover:underline">
                          {invoice.tenantName}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap text-muted-foreground">
                        {formatDate(invoice.periodStart)} to {formatDate(invoice.periodEnd)}
                      </td>
                      <td className="whitespace-nowrap text-muted-foreground">{formatDate(invoice.issuedAt)}</td>
                      <td className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(invoice.amount, invoice.currency)}</td>
                      <td>
                        <StatusBadge kind="invoice" status={invoice.status} />
                        {invoice.paidAt ? <span className="mt-0.5 block whitespace-nowrap text-xs text-muted-foreground">{formatDate(invoice.paidAt)}</span> : null}
                      </td>
                      {isOwner ? (
                        <td className="pr-6">
                          {invoice.status === "open" ? (
                            <InvoiceActions
                              invoiceId={invoice.id}
                              number={invoice.number}
                              amount={formatMoney(invoice.amount, invoice.currency)}
                              tenantName={invoice.tenantName}
                            />
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y md:hidden">
              {invoices.items.map((invoice) => (
                <li key={invoice.id} className="flex flex-col gap-1.5 p-4">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-bold">{invoice.number}</span>
                    <StatusBadge kind="invoice" status={invoice.status} />
                  </span>
                  <Link href={`/platform/tenants/${invoice.tenantId}`} className="text-sm text-primary underline-offset-4 hover:underline">
                    {invoice.tenantName}
                  </Link>
                  <span className="text-[13px] text-muted-foreground">{invoice.description}</span>
                  <span className="flex justify-between gap-3 text-[13px]">
                    <span className="text-muted-foreground">
                      {invoice.paidAt ? `Paid ${formatDate(invoice.paidAt)}` : `Issued ${formatDate(invoice.issuedAt)}`}
                    </span>
                    <span className="font-semibold tabular-nums">{formatMoney(invoice.amount, invoice.currency)}</span>
                  </span>
                  {isOwner && invoice.status === "open" ? (
                    <span className="pt-1">
                      <InvoiceActions
                        invoiceId={invoice.id}
                        number={invoice.number}
                        amount={formatMoney(invoice.amount, invoice.currency)}
                        tenantName={invoice.tenantName}
                      />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
        <Pagination path={PATH} params={query} pager={pager} total={invoices.total} noun={invoices.total === 1 ? "invoice" : "invoices"} />
      </div>
    </>
  );
}
