import { Circle, CircleCheck, Mail, MessageCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { ConfirmBookingButton, DeclineBookingButton } from "@/components/workspace/bookings/booking-actions";
import type { BookingRowView } from "@/components/workspace/bookings/view-models";
import { BOOKING_STATUS_BADGES, TREND_CLASSES, bookingHref, clashHeadline, hrefWith, type Trend } from "@/lib/booking-display";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------- KPIs */

export interface Kpi {
  label: string;
  value: string;
  trend: Trend;
  /** Background class of the status dot, e.g. `bg-highlight`. */
  dot: string;
  /** Where the card leads; omitted when the member cannot open that area. */
  href?: string;
}

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-[13px] font-medium text-muted-foreground">
        {kpi.label}
        <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", kpi.dot)} />
      </span>
      <span className="font-display text-[38px] font-semibold leading-none text-primary">{kpi.value}</span>
      <span className={TREND_CLASSES[kpi.trend.tone]}>{kpi.trend.text}</span>
    </>
  );
  return kpi.href ? (
    <Link href={kpi.href} className="card flex flex-col gap-2 p-5 transition-shadow hover:shadow-md">
      {body}
    </Link>
  ) : (
    <div className="card flex flex-col gap-2 p-5">{body}</div>
  );
}

/* ------------------------------------------------------------ clash banner */

export function ClashBanner({ count }: { count: number }) {
  return (
    <div role="alert" className="alert alert-destructive mb-5 flex flex-wrap items-center justify-between gap-3">
      <span className="flex items-center gap-2 font-semibold">
        <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
        {clashHeadline(count)} — overlapping or over-capacity requests for the same date.
      </span>
      <Link href={hrefWith("/workspace/bookings", { clash: true })} className="btn btn-outline btn-sm bg-background text-foreground">
        Review conflicts
      </Link>
    </div>
  );
}

/* ---------------------------------------------------------- upcoming tours */

export interface UpcomingTour {
  id: string;
  month: string;
  day: string;
  title: string;
  detail: string;
}

export function UpcomingTours({ tours }: { tours: UpcomingTour[] }) {
  return (
    <section aria-labelledby="overview-upcoming" className="card">
      <div className="card-header">
        <h2 id="overview-upcoming" className="card-title">
          Upcoming tours
        </h2>
      </div>
      {tours.length > 0 ? (
        <ul className="card-content flex flex-col gap-4">
          {tours.map((tour) => (
            <li key={tour.id}>
              <Link href={bookingHref(tour.id)} className="group flex items-center gap-3">
                <span className="w-12 shrink-0 rounded-md border py-1 text-center">
                  <span className="block text-[11px] font-bold uppercase text-eyebrow">{tour.month}</span>
                  <span className="block font-display text-[22px] font-semibold leading-none">{tour.day}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold underline-offset-4 group-hover:underline">{tour.title}</span>
                  <span className="text-[13px] text-muted-foreground">{tour.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card-content text-sm leading-relaxed text-muted-foreground">No confirmed tours ahead. Confirmed bookings appear here, soonest first.</p>
      )}
    </section>
  );
}

/* -------------------------------------------------------- needs your reply */

export function NeedsReply({ bookings, total, canManage }: { bookings: BookingRowView[]; total: number; canManage: boolean }) {
  return (
    <section aria-labelledby="overview-pending" className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-5 pb-3 sm:p-6 sm:pb-3">
        <h2 id="overview-pending" className="card-title flex flex-wrap items-center gap-2">
          Needs your reply
          {total > 0 ? <span className="badge badge-pending">{total} pending</span> : null}
        </h2>
        {total > 0 ? (
          <Link href={hrefWith("/workspace/bookings", { status: "pending" })} className="btn btn-ghost btn-sm">
            View all
          </Link>
        ) : null}
      </div>
      {bookings.length > 0 ? (
        <ul className="divide-y">
          {bookings.map((booking) => {
            const ref = { id: booking.id, reference: booking.reference, name: booking.name };
            return (
              <li key={booking.id} className="flex flex-col gap-3 px-5 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={bookingHref(booking.id)} className="font-bold underline-offset-4 hover:underline">
                        {booking.name}
                      </Link>
                      {booking.clashes.length > 0 ? (
                        <span className="badge badge-cancelled" title={booking.clashes.join(" · ")}>
                          <TriangleAlert aria-hidden="true" className="size-3" />
                          Clash
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      {booking.tourTitle} · {booking.date}
                      {booking.time ? ` · ${booking.time}` : ""} · {booking.guests} · {booking.total}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{booking.requested}</span>
                </div>
                {booking.notes ? <p className="line-clamp-3 rounded-md bg-muted/60 p-2 text-xs leading-relaxed">“{booking.notes}”</p> : null}
                <div className="flex flex-wrap gap-2">
                  {canManage ? (
                    <>
                      <ConfirmBookingButton booking={ref} className="btn btn-default btn-sm" label="Confirm" />
                      <DeclineBookingButton booking={ref} className="btn btn-ghost btn-sm text-destructive hover:text-destructive" label="Decline" />
                    </>
                  ) : null}
                  <Link href={bookingHref(booking.id)} className="btn btn-outline btn-sm">
                    Open<span className="sr-only"> {booking.reference}</span>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-5 pb-8 pt-4 text-center sm:px-6">
          <p className="font-bold">All caught up</p>
          <p className="text-sm text-muted-foreground">No pending requests right now.</p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------- recent booking activity */

export function RecentBookings({ bookings }: { bookings: BookingRowView[] }) {
  return (
    <section aria-labelledby="overview-recent" className="card overflow-hidden">
      <div className="flex items-center justify-between p-5 pb-3 sm:p-6 sm:pb-3">
        <h2 id="overview-recent" className="card-title">
          Recent booking activity
        </h2>
        <Link href="/workspace/bookings" className="btn btn-ghost btn-sm">
          View all
        </Link>
      </div>
      {bookings.length > 0 ? (
        <>
          <ul className="divide-y md:hidden">
            {bookings.map((booking) => (
              <li key={booking.id}>
                <Link href={bookingHref(booking.id)} className="flex flex-col gap-1 px-5 py-3.5 hover:bg-muted/50">
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-bold">{booking.name}</span>
                    <span className={BOOKING_STATUS_BADGES[booking.status]}>{booking.statusLabel}</span>
                  </span>
                  <span className="text-[13px] text-muted-foreground">{booking.tourTitle}</span>
                  <span className="text-xs text-muted-foreground">
                    {booking.reference} · {booking.date}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="table min-w-[600px]">
              <thead>
                <tr>
                  <th scope="col" className="pl-6">
                    Reference
                  </th>
                  <th scope="col">Guest</th>
                  <th scope="col">Tour</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="pr-6">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td className="pl-6 font-semibold">
                      <Link href={bookingHref(booking.id)} className="text-primary underline-offset-4 hover:underline">
                        {booking.reference}
                      </Link>
                    </td>
                    <td>{booking.name}</td>
                    <td className="text-muted-foreground">{booking.tourTitle}</td>
                    <td className="whitespace-nowrap text-muted-foreground">{booking.date}</td>
                    <td className="pr-6">
                      <span className={BOOKING_STATUS_BADGES[booking.status]}>{booking.statusLabel}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="px-5 pb-6 text-sm leading-relaxed text-muted-foreground sm:px-6">
          No bookings yet. Requests made on your website show up here as they arrive.
        </p>
      )}
    </section>
  );
}

/* --------------------------------------------------------- recent enquiries */

export interface EnquiryPreview {
  id: string;
  name: string;
  when: string;
  message: string;
  mailto: string;
  /** Chat link, only when the workspace has a messaging integration and the sender left a number. */
  whatsapp: string | null;
}

export function RecentEnquiries({ enquiries, newCount }: { enquiries: EnquiryPreview[]; newCount: number }) {
  return (
    <section aria-labelledby="overview-enquiries" className="card">
      <div className="card-header flex-row items-center justify-between gap-3 space-y-0">
        <h2 id="overview-enquiries" className="card-title flex flex-wrap items-center gap-2">
          Recent enquiries
          {newCount > 0 ? <span className="badge badge-pending">{newCount} new</span> : null}
        </h2>
        <Link href="/workspace/inquiries" className="btn btn-ghost btn-sm">
          View all
        </Link>
      </div>
      {enquiries.length > 0 ? (
        <ul className="card-content flex flex-col divide-y">
          {enquiries.map((enquiry) => (
            <li key={enquiry.id} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex justify-between gap-2 text-sm">
                <strong className="min-w-0 truncate">{enquiry.name}</strong>
                <span className="shrink-0 text-xs text-muted-foreground">{enquiry.when}</span>
              </div>
              <p className="mb-2 mt-1 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">{enquiry.message}</p>
              <div className="flex flex-wrap gap-2">
                {enquiry.whatsapp ? (
                  <a href={enquiry.whatsapp} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                    <MessageCircle aria-hidden="true" />
                    WhatsApp<span className="sr-only"> {enquiry.name} (opens in a new tab)</span>
                  </a>
                ) : null}
                <a href={enquiry.mailto} className={enquiry.whatsapp ? "btn btn-ghost btn-sm" : "btn btn-outline btn-sm"}>
                  <Mail aria-hidden="true" />
                  Email<span className="sr-only"> {enquiry.name}</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card-content text-sm leading-relaxed text-muted-foreground">No enquiries yet. Messages from your website’s contact form arrive here.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ usage meters */

export interface UsageMeterView {
  label: string;
  /** `3 of 5`, `120 MB of 1 GB`, `12 · unlimited`. */
  text: string;
  /** 0–100, or null when the plan sets no limit. */
  percent: number | null;
}

export function UsageMeters({ planName, meters }: { planName: string; meters: UsageMeterView[] }) {
  return (
    <section aria-labelledby="overview-usage" className="card">
      <div className="card-header flex-row items-center justify-between gap-3 space-y-0">
        <h2 id="overview-usage" className="card-title flex flex-wrap items-center gap-2">
          Plan usage
          <span className="badge badge-outline">{planName}</span>
        </h2>
        <Link href="/workspace/billing" className="btn btn-ghost btn-sm">
          Plan &amp; billing
        </Link>
      </div>
      <ul className="card-content flex flex-col gap-4">
        {meters.map((meter) => {
          const percent = meter.percent === null ? null : Math.min(100, Math.max(0, meter.percent));
          const tone = percent === null ? "" : percent >= 100 ? "bg-destructive" : percent >= 80 ? "bg-amber-500" : "bg-primary";
          return (
            <li key={meter.label} className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{meter.label}</span>
                <span className="text-[13px] text-muted-foreground">{meter.text}</span>
              </div>
              {percent === null ? null : (
                <div className="progress" role="progressbar" aria-label={meter.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-valuetext={meter.text}>
                  <div className={cn("h-full rounded-full", tone)} style={{ width: `${percent}%` }} />
                </div>
              )}
              {percent !== null && percent >= 100 ? <p className="text-xs font-semibold text-destructive">Limit reached</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------- onboarding checklist */

export interface ChecklistStep {
  title: string;
  description: string;
  done: boolean;
  href: string;
  action: string;
}

/** The empty state of a brand-new workspace: what to set up before the first booking. */
export function OnboardingChecklist({ workspaceName, steps }: { workspaceName: string; steps: ChecklistStep[] }) {
  const remaining = steps.filter((step) => !step.done).length;
  return (
    <section aria-labelledby="overview-setup" className="card mb-5 border-dashed">
      <div className="card-header">
        <h2 id="overview-setup" className="font-display text-2xl font-semibold text-primary sm:text-3xl">
          Get {workspaceName} ready for its first booking
        </h2>
        <p className="card-description max-w-2xl">
          {remaining === 1 ? "One step left." : `${remaining} steps left.`} Each one opens the page where it is done; this list disappears once bookings start
          arriving.
        </p>
      </div>
      <ul className="card-content flex flex-col divide-y">
        {steps.map((step) => (
          <li key={step.title} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              {step.done ? (
                <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Circle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <p className="font-semibold">
                  {step.title}
                  <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                </p>
                <p className="text-[13px] leading-relaxed text-muted-foreground">{step.description}</p>
              </div>
            </div>
            <Link href={step.href} className={cn("btn btn-sm shrink-0 self-start sm:self-auto", step.done ? "btn-ghost" : "btn-default")}>
              {step.done ? "Review" : step.action}
              <span className="sr-only">{step.done ? `: ${step.title}` : ""}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
