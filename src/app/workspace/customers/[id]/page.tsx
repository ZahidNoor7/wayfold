import { ArrowLeft, Mail, MessageCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CustomerNotes } from "@/components/workspace/customers/customer-notes";
import { CustomerPreferences } from "@/components/workspace/customers/customer-preferences";
import { CustomerProfileForm } from "@/components/workspace/customers/customer-profile-form";
import { CUSTOMERS_PATH } from "@/components/workspace/customers/params";
import { PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import {
  bookingHref,
  bookingStatusLabel,
  BOOKING_STATUS_BADGES,
  CONTACT_METHOD_LABELS,
  formatCount,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatGuests,
  mailtoLink,
  PAYMENT_STATUS_BADGES,
  PAYMENT_STATUS_LABELS,
} from "@/lib/booking-display";
import { formatMoney, todayIn } from "@/lib/dates";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { getCustomer } from "@/server/customers/service";
import { NotFoundError } from "@/server/errors";
import { listIntegrations } from "@/server/integrations";
import { whatsappChatLink } from "@/server/integrations/adapters/whatsapp";

export const metadata = { title: "Customer" };

export default function CustomerPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={6} />}>
      <Content {...props} />
    </Suspense>
  );
}

/** A number WhatsApp could open: anything shorter is not a full international number. */
const hasDialableNumber = (phone: string) => phone.replace(/\D/g, "").length >= 7;

async function loadCustomer(workspace: Awaited<ReturnType<typeof requireWorkspace>>, id: string) {
  try {
    return await inWorkspace(workspace, async (scope) => {
      const profile = await getCustomer(scope, id);
      // A chat link is offered only when the workspace has connected a messaging integration.
      const integrations = hasDialableNumber(profile.customer.phone) ? await listIntegrations(scope) : [];
      const messaging = integrations.some((integration) => integration.category === "messaging" && integration.status !== "disabled");
      return { profile, whatsappUrl: messaging ? whatsappChatLink(profile.customer.phone) : null };
    });
  } catch (error) {
    // Unknown ids, malformed ids and other workspaces' customers all read the same.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const workspace = await requireWorkspace("customers.view");
  const { id } = await params;
  const { profile, whatsappUrl } = await loadCustomer(workspace, id);
  const { customer, stats, bookings, notes } = profile;

  const { currency, timezone, name: workspaceName } = workspace.tenant;
  const canManage = can(workspace, "customers.manage");
  const canOpenBookings = can(workspace, "bookings.view");
  const day = (value: Date) => formatDate(todayIn(timezone, value));

  const figures = [
    { label: "Bookings", value: formatCount(stats.bookingCount), note: stats.bookingCount === 1 ? "request so far" : "requests so far", display: true },
    { label: "Total spent", value: formatMoney(stats.totalSpent, currency), note: "confirmed and completed tours", display: true },
    { label: "Last booking", value: stats.lastBookingAt ? day(stats.lastBookingAt) : "None yet", note: "when it was requested", display: false },
    { label: "Customer since", value: day(customer.createdAt), note: "first booking request", display: false },
  ];

  return (
    <>
      <Link href={CUSTOMERS_PATH} className="btn btn-ghost btn-sm -ml-3 mb-2 text-muted-foreground">
        <ArrowLeft aria-hidden="true" />
        All customers
      </Link>

      <PageHeader
        title={customer.name}
        description={[customer.email, customer.country].filter(Boolean).join(" · ")}
        actions={
          <>
            <a href={mailtoLink(customer.email, `A message from ${workspaceName}`)} className="btn btn-outline">
              <Mail aria-hidden="true" />
              Email
            </a>
            {whatsappUrl ? (
              <a href={whatsappUrl} target="_blank" rel="noreferrer" className="btn btn-default">
                <MessageCircle aria-hidden="true" />
                WhatsApp<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
          </>
        }
      />

      <dl className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.label} className="card flex flex-col gap-2 p-5">
            <dt className="text-[13px] font-medium text-muted-foreground">{figure.label}</dt>
            <dd
              className={
                figure.display
                  ? "font-display text-[38px] font-semibold leading-none text-primary"
                  : "font-display text-2xl font-semibold leading-[38px] text-primary"
              }
            >
              {figure.value}
            </dd>
            <dd className="text-xs font-semibold text-muted-foreground">{figure.note}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="customer-profile" className="card">
            <div className="card-header">
              <h2 id="customer-profile" className="card-title">
                Profile
              </h2>
              <p className="card-description">
                {canManage ? "Who this customer is and how to reach them." : "Your role can read this profile but not change it."}
              </p>
            </div>
            <div className="card-content">
              {canManage ? (
                <CustomerProfileForm
                  customer={{
                    id: customer.id,
                    name: customer.name,
                    email: customer.email,
                    phone: customer.phone,
                    country: customer.country,
                    language: customer.language,
                  }}
                />
              ) : (
                <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2.5 text-sm">
                  <dt className="text-muted-foreground">Full name</dt>
                  <dd className="font-semibold">{customer.name}</dd>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="break-all">
                    <a href={mailtoLink(customer.email)} className="text-primary underline-offset-4 hover:underline">
                      {customer.email}
                    </a>
                  </dd>
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd>{customer.phone || "—"}</dd>
                  <dt className="text-muted-foreground">Country</dt>
                  <dd>{customer.country || "—"}</dd>
                  <dt className="text-muted-foreground">Language</dt>
                  <dd>{customer.language || "—"}</dd>
                </dl>
              )}
            </div>
          </section>

          <section aria-labelledby="customer-bookings" className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-5 pb-3 sm:p-6 sm:pb-3">
              <h2 id="customer-bookings" className="card-title">
                Booking history
              </h2>
              {bookings.length > 0 ? <span className="badge badge-outline">{formatCount(bookings.length)}</span> : null}
            </div>
            {bookings.length > 0 ? (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="table min-w-[640px]">
                    <thead>
                      <tr>
                        <th scope="col" className="pl-6">
                          Reference
                        </th>
                        <th scope="col">Tour</th>
                        <th scope="col">Tour date</th>
                        <th scope="col">Guests</th>
                        <th scope="col">Total</th>
                        <th scope="col" className="pr-6">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.map((booking) => (
                        <tr key={booking.id}>
                          <td className="pl-6 font-bold">
                            {canOpenBookings ? (
                              <Link href={bookingHref(booking.id)} className="text-primary underline-offset-4 hover:underline">
                                {booking.reference}
                              </Link>
                            ) : (
                              booking.reference
                            )}
                            <span className="block text-xs font-normal text-muted-foreground">requested {day(booking.createdAt)}</span>
                          </td>
                          <td className="text-muted-foreground">{booking.tourTitle}</td>
                          <td className="whitespace-nowrap">
                            {formatDateRange(booking.startDate, booking.endDate)}
                            {booking.slotTime ? <span className="text-muted-foreground"> · {booking.slotTime}</span> : null}
                          </td>
                          <td>{formatGuests(booking.adults, booking.children)}</td>
                          <td className="font-semibold">{formatMoney(booking.totalAmount, booking.currency)}</td>
                          <td className="pr-6">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className={BOOKING_STATUS_BADGES[booking.status]}>{bookingStatusLabel(booking)}</span>
                              <span className={PAYMENT_STATUS_BADGES[booking.paymentStatus]}>{PAYMENT_STATUS_LABELS[booking.paymentStatus]}</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ul className="divide-y border-t md:hidden">
                  {bookings.map((booking) => {
                    const summary = (
                      <>
                        <span className="flex w-full items-center justify-between gap-2">
                          <span className="font-bold">{booking.reference}</span>
                          <span className={BOOKING_STATUS_BADGES[booking.status]}>{bookingStatusLabel(booking)}</span>
                        </span>
                        <span className="text-sm text-muted-foreground">{booking.tourTitle}</span>
                        <span className="flex w-full justify-between gap-3 text-[13px]">
                          <span>
                            {formatDateRange(booking.startDate, booking.endDate)} · {formatGuests(booking.adults, booking.children)}
                          </span>
                          <span className="shrink-0 font-semibold">{formatMoney(booking.totalAmount, booking.currency)}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">{PAYMENT_STATUS_LABELS[booking.paymentStatus]}</span>
                      </>
                    );
                    return (
                      <li key={booking.id}>
                        {canOpenBookings ? (
                          <Link href={bookingHref(booking.id)} className="flex w-full flex-col gap-1.5 p-4 text-left hover:bg-muted/50">
                            {summary}
                          </Link>
                        ) : (
                          <div className="flex w-full flex-col gap-1.5 p-4">{summary}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <div className="border-t p-10 text-center">
                <p className="font-bold">No bookings on this profile</p>
                <p className="text-sm text-muted-foreground">Requests sent with this email address will be listed here.</p>
              </div>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="customer-preferences" className="card">
            <div className="card-header">
              <h2 id="customer-preferences" className="card-title">
                Contact preferences
              </h2>
              <p className="card-description">How this customer asked to be reached.</p>
            </div>
            <div className="card-content">
              {canManage ? (
                <CustomerPreferences customerId={customer.id} preferredContact={customer.preferredContact} marketingOptIn={customer.marketingOptIn} />
              ) : (
                <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2.5 text-sm">
                  <dt className="text-muted-foreground">Preferred contact</dt>
                  <dd className="font-semibold">{CONTACT_METHOD_LABELS[customer.preferredContact]}</dd>
                  <dt className="text-muted-foreground">Marketing messages</dt>
                  <dd>{customer.marketingOptIn ? "Agreed to receive them" : "Has not agreed"}</dd>
                </dl>
              )}
              {customer.phone && !whatsappUrl ? (
                <p className="mt-5 flex justify-between gap-3 rounded-lg bg-muted/60 p-4 text-sm">
                  <span className="text-muted-foreground">Phone</span>
                  <span className="font-semibold">{customer.phone}</span>
                </p>
              ) : null}
            </div>
          </section>

          <section aria-labelledby="customer-notes" className="card">
            <div className="card-header">
              <h2 id="customer-notes" className="card-title">
                Internal notes
              </h2>
              <p className="card-description">Kept inside the workspace. The customer never sees these.</p>
            </div>
            <div className="card-content">
              <CustomerNotes
                customerId={customer.id}
                canManage={canManage}
                notes={notes.map((note) => ({
                  id: note.id,
                  body: note.body,
                  author: note.authorName,
                  // Formatted here so the server and the browser can never disagree on the text.
                  when: formatDateTime(note.createdAt, timezone),
                }))}
              />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
