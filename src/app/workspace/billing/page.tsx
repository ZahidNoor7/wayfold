import { Check } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  CYCLE_LABELS,
  featureLines,
  INVOICE_STATUS,
  invoiceDay,
  invoiceHref,
  LIMIT_KEYS,
  limitLine,
  meterView,
  priceLine,
  renewalSentence,
  SUBSCRIPTION_STATUS,
  yearlySaving,
} from "@/components/workspace/billing/billing-display";
import { RequestPlanChange } from "@/components/workspace/billing/plan-change";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { formatDate, formatDateRange, hrefWith, pageSummary, parsePage, type SearchParams } from "@/lib/booking-display";
import { formatMoney, todayIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { getBillingOverview, listPublicPlans, type InvoiceView } from "@/server/billing/overview";

export const metadata = { title: "Plan & billing" };

const INVOICE_PAGE_SIZE = 10;
const BILLING_PATH = "/workspace/billing";

export default function BillingPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <Content {...props} />
    </Suspense>
  );
}


async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const workspace = await requireWorkspace("billing.view");
  // The service pages up to 10,000; anything beyond is a hand-edited link.
  const page = Math.min(parsePage((await searchParams).page), 10_000);
  const { timezone } = workspace.tenant;
  const today = todayIn(timezone);

  const overview = await inWorkspace(workspace, (scope) => getBillingOverview(scope, { today, invoices: { page, pageSize: INVOICE_PAGE_SIZE } }));
  const plans = await listPublicPlans();

  const { invoices } = overview;
  // A stale link past the last page of invoices lands on the last page.
  if (invoices.total > 0 && page > invoices.pageCount) redirect(hrefWith(BILLING_PATH, { page: invoices.pageCount > 1 ? invoices.pageCount : undefined }));

  const { plan, subscription } = overview;
  const cycle = subscription?.cycle ?? "monthly";
  const price = cycle === "yearly" ? plan.priceYearly : plan.priceMonthly;
  const canChange = can(workspace, "billing.manage");
  const periodDay = (value: Date) => formatDate(todayIn(timezone, value));
  const features = featureLines(overview.entitlements.features);
  const meters = LIMIT_KEYS.map((key) => ({ key, ...meterView(key, overview.meters[key]) }));

  return (
    <>
      <PageHeader title="Plan & billing" description="Your plan, what it includes, how much of it you are using, and your invoices." />

      <div className="mb-5 grid gap-5 xl:grid-cols-[3fr_2fr]">
        <section aria-labelledby="current-plan" className="card flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-muted-foreground">Current plan</p>
              <h2 id="current-plan" className="font-display text-3xl font-semibold text-primary">
                {plan.name}
              </h2>
              {plan.description ? <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">{plan.description}</p> : null}
            </div>
            <div className="text-right">
              <p className="font-display text-2xl font-semibold leading-none">{priceLine(price, plan.currency, cycle)}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Billed {CYCLE_LABELS[cycle].toLowerCase()}</p>
            </div>
          </div>

          {subscription ? (
            <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2.5 rounded-lg bg-muted/60 p-4 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <span className={SUBSCRIPTION_STATUS[subscription.status].badge}>{SUBSCRIPTION_STATUS[subscription.status].label}</span>
              </dd>
              <dt className="text-muted-foreground">Billing cycle</dt>
              <dd>{CYCLE_LABELS[subscription.cycle]}</dd>
              <dt className="text-muted-foreground">Current period</dt>
              <dd>
                {periodDay(subscription.currentPeriodStart)} – {periodDay(subscription.currentPeriodEnd)}
              </dd>
              <dt className="text-muted-foreground">Renewal</dt>
              <dd className={cn(subscription.cancelAtPeriodEnd || subscription.status === "past_due" ? "font-semibold" : undefined)}>
                {renewalSentence(subscription, periodDay(subscription.currentPeriodEnd))}
              </dd>
            </dl>
          ) : (
            <p className="alert">Wayfold has not started a subscription for this workspace yet. Your plan&rsquo;s limits already apply.</p>
          )}

          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Included</h3>
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              {LIMIT_KEYS.map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                  {limitLine(key, overview.entitlements.limits[key])}
                </li>
              ))}
              {features.map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="usage" className="card flex flex-col gap-5 p-5 sm:p-6">
          <div>
            <h2 id="usage" className="font-semibold">
              Usage
            </h2>
            <p className="text-[13px] text-muted-foreground">Seats count pending invitations. Bookings count this calendar month.</p>
          </div>
          <ul className="flex flex-col gap-5">
            {meters.map((meter) => (
              <li key={meter.key} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium" id={`meter-${meter.key}`}>
                    {meter.label}
                  </span>
                  <span
                    className={cn(
                      "tabular-nums",
                      meter.tone === "normal" ? "text-muted-foreground" : meter.tone === "warning" ? "font-semibold text-[var(--status-pending-fg)]" : "font-semibold text-destructive",
                    )}
                  >
                    {meter.value}
                    {meter.percentText ? ` · ${meter.percentText}` : ""}
                  </span>
                </div>
                {meter.percentText !== null ? (
                  <div
                    className="progress"
                    role="progressbar"
                    aria-labelledby={`meter-${meter.key}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(meter.barPercent)}
                    aria-valuetext={`${meter.value}, ${meter.percentText}`}
                  >
                    <div
                      className={cn("h-full rounded-full", meter.tone === "full" ? "bg-destructive" : meter.tone === "warning" ? "bg-[var(--status-pending-fg)]" : "bg-primary")}
                      style={{ width: `${meter.barPercent}%` }}
                    />
                  </div>
                ) : null}
                {meter.note ? <p className={cn("text-[13px]", meter.tone === "full" ? "text-destructive" : "text-[var(--status-pending-fg)]")}>{meter.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="plans" className="mb-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="plans" className="font-display text-2xl font-semibold text-primary">
              Plans
            </h2>
            <p className="text-sm text-muted-foreground">
              {canChange
                ? "Ask for a different plan and Wayfold will be in touch to make the change."
                : "Only people who can manage billing can ask for a plan change."}
            </p>
          </div>
        </div>
        {plans.length === 0 ? (
          <p className="card p-5 text-sm text-muted-foreground">No other plans are offered at the moment. Contact Wayfold if you need different limits.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {plans.map((option) => {
              const current = option.id === plan.id;
              const saving = yearlySaving(option.priceMonthly, option.priceYearly, option.currency);
              return (
                <li key={option.id} className={cn("card flex flex-col gap-4 p-5", current && "border-primary ring-1 ring-primary")}>
                  <div>
                    <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">
                      {option.name}
                      {current ? <span className="badge badge-default">Current plan</span> : null}
                    </h3>
                    {option.description ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{option.description}</p> : null}
                  </div>
                  <div>
                    <p className="font-display text-2xl font-semibold leading-tight">{priceLine(option.priceMonthly, option.currency, "monthly")}</p>
                    {option.priceYearly > 0 ? (
                      <p className="text-[13px] text-muted-foreground">
                        or {priceLine(option.priceYearly, option.currency, "yearly")}
                        {saving ? ` · ${saving}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {LIMIT_KEYS.map((key) => (
                      <li key={key} className="flex items-start gap-2">
                        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                        {limitLine(key, option.limits[key])}
                      </li>
                    ))}
                    {featureLines(option.features).map((line) => (
                      <li key={line} className="flex items-start gap-2">
                        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                        {line}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto">
                    {current ? (
                      <p className="text-[13px] text-muted-foreground">You are on this plan.</p>
                    ) : canChange ? (
                      <RequestPlanChange planCode={option.code} planName={option.name} currentPlanName={plan.name} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="invoices">
        <h2 id="invoices" className="mb-4 font-display text-2xl font-semibold text-primary">
          Invoices
        </h2>
        {invoices.total === 0 ? (
          <EmptyState title="No invoices yet" description="Invoices from Wayfold appear here once they are issued. Each one can be opened, printed or saved as a PDF." />
        ) : (
          <InvoiceList invoices={invoices.items} page={invoices.page} pageCount={invoices.pageCount} total={invoices.total} />
        )}
      </section>
    </>
  );
}

function InvoiceList({ invoices, page, pageCount, total }: { invoices: InvoiceView[]; page: number; pageCount: number; total: number }) {
  const period = (invoice: InvoiceView) => formatDateRange(invoiceDay(invoice.periodStart), invoiceDay(invoice.periodEnd));
  return (
    <div className="card overflow-hidden">
      <div className="hidden overflow-x-auto md:block">
        <table className="table min-w-[680px]">
          <thead>
            <tr>
              <th scope="col" className="pl-6">
                Invoice
              </th>
              <th scope="col">Period</th>
              <th scope="col">Amount</th>
              <th scope="col">Status</th>
              <th scope="col" className="pr-6">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="pl-6">
                  <Link href={invoiceHref(invoice.id)} className="block font-bold text-primary underline-offset-4 hover:underline">
                    {invoice.number}
                  </Link>
                  <span className="text-xs text-muted-foreground">{invoice.description}</span>
                </td>
                <td className="whitespace-nowrap text-muted-foreground">{period(invoice)}</td>
                <td className="font-semibold tabular-nums">{formatMoney(invoice.amount, invoice.currency)}</td>
                <td>
                  <span className={INVOICE_STATUS[invoice.status].badge}>{INVOICE_STATUS[invoice.status].label}</span>
                </td>
                <td className="pr-6 text-right">
                  <Link href={invoiceHref(invoice.id)} aria-label={`Open invoice ${invoice.number}`} className="btn btn-outline btn-sm">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y md:hidden">
        {invoices.map((invoice) => (
          <li key={invoice.id}>
            <Link href={invoiceHref(invoice.id)} className="flex w-full flex-col gap-1.5 p-4 text-left hover:bg-muted/50">
              <span className="flex w-full items-center justify-between gap-2">
                <span className="min-w-0 truncate font-bold">{invoice.number}</span>
                <span className={INVOICE_STATUS[invoice.status].badge}>{INVOICE_STATUS[invoice.status].label}</span>
              </span>
              <span className="truncate text-sm text-muted-foreground">{invoice.description}</span>
              <span className="flex w-full justify-between gap-3 text-[13px]">
                <span className="text-muted-foreground">{period(invoice)}</span>
                <span className="font-semibold tabular-nums">{formatMoney(invoice.amount, invoice.currency)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-[13px] text-muted-foreground sm:px-6">
        <span>{pageSummary(page, INVOICE_PAGE_SIZE, total)} invoices</span>
        {pageCount > 1 ? (
          <nav aria-label="Invoice pages" className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={hrefWith(BILLING_PATH, { page: page - 1 > 1 ? page - 1 : undefined })} className="btn btn-outline btn-sm" scroll={false}>
                Previous
              </Link>
            ) : (
              <span className="btn btn-outline btn-sm" aria-disabled="true">
                Previous
              </span>
            )}
            <span aria-current="page">
              Page {page} of {pageCount}
            </span>
            {page < pageCount ? (
              <Link href={hrefWith(BILLING_PATH, { page: page + 1 })} className="btn btn-outline btn-sm" scroll={false}>
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
  );
}
