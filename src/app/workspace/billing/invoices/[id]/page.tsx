import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { INVOICE_STATUS, invoiceDay } from "@/components/workspace/billing/billing-display";
import { PrintButton } from "@/components/workspace/billing/print-button";
import { PageSkeleton } from "@/components/workspace/page-header";
import { formatDate, formatDateRange } from "@/lib/booking-display";
import { formatMoney, todayIn } from "@/lib/dates";
import { requireWorkspace } from "@/server/auth/guards";
import { inWorkspace } from "@/server/auth/workspace";
import { getInvoice } from "@/server/billing/overview";
import { NotFoundError } from "@/server/errors";

export const metadata = { title: "Invoice" };

export default function InvoicePage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const workspace = await requireWorkspace("billing.view");
  const { id } = await params;

  const invoice = await inWorkspace(workspace, (scope) => getInvoice(scope, id)).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const { timezone } = workspace.tenant;
  const issued = formatDate(todayIn(timezone, invoice.issuedAt));
  const status = INVOICE_STATUS[invoice.status];
  const total = formatMoney(invoice.amount, invoice.currency);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/workspace/billing" className="btn btn-ghost btn-sm -ml-2">
          <ArrowLeft aria-hidden="true" />
          Plan & billing
        </Link>
        <PrintButton />
      </div>

      <article aria-labelledby="invoice-title" className="card p-6 sm:p-10 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b pb-6">
          <div>
            <p className="text-[13px] font-medium text-muted-foreground">Invoice</p>
            <h1 id="invoice-title" className="font-display text-3xl font-semibold text-primary sm:text-4xl">
              {invoice.number}
            </h1>
          </div>
          <span className={status.badge}>{status.label}</span>
        </header>

        <dl className="grid gap-6 border-b py-6 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">From</dt>
            <dd className="mt-1 font-semibold">Wayfold</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Billed to</dt>
            <dd className="mt-1 font-semibold">{workspace.tenant.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Issued</dt>
            <dd className="mt-1">{issued}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{invoice.status === "paid" ? "Paid" : "Status"}</dt>
            <dd className="mt-1">{invoice.paidAt ? formatDate(todayIn(timezone, invoice.paidAt)) : status.label}</dd>
          </div>
        </dl>

        <table className="table mt-2">
          <thead>
            <tr>
              <th scope="col" className="pl-0">
                Description
              </th>
              <th scope="col">Period</th>
              <th scope="col" className="pr-0 text-right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pl-0">{invoice.description}</td>
              <td className="whitespace-nowrap text-muted-foreground">{formatDateRange(invoiceDay(invoice.periodStart), invoiceDay(invoice.periodEnd))}</td>
              <td className="pr-0 text-right tabular-nums">{total}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2} className="pl-0 text-right">
                Total
              </th>
              <td className="pr-0 text-right text-lg font-bold tabular-nums">{total}</td>
            </tr>
          </tfoot>
        </table>

        {invoice.status === "void" ? (
          <p className="alert mt-6 text-muted-foreground">This invoice was voided and is not payable.</p>
        ) : invoice.status === "open" ? (
          <p className="alert alert-warning mt-6">This invoice has not been paid yet.</p>
        ) : null}
      </article>
    </div>
  );
}
