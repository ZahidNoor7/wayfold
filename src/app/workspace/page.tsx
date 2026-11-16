import Link from "next/link";
import { Suspense } from "react";
import { toRowView } from "@/components/workspace/bookings/view-models";
import { BookingsChart } from "@/components/workspace/overview/bookings-chart";
import {
  ClashBanner,
  KpiCard,
  NeedsReply,
  OnboardingChecklist,
  RecentBookings,
  RecentEnquiries,
  UpcomingTours,
  UsageMeters,
  type ChecklistStep,
  type EnquiryPreview,
  type Kpi,
  type UsageMeterView,
} from "@/components/workspace/overview/sections";
import { PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import {
  dateTileParts,
  firstName,
  formatCompactMoney,
  formatCount,
  formatDate,
  formatGuestCount,
  formatLongDate,
  formatRelative,
  formatStorage,
  greeting,
  hourIn,
  hrefWith,
  lastMonths,
  mailtoLink,
  trend,
  type ChartPoint,
} from "@/lib/booking-display";
import { todayIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { getEntitlements } from "@/server/billing/limits";
import { getUsage } from "@/server/billing/usage";
import { bookingSeries, bookingStats, findClashes, listBookings, type BookingSeriesPoint } from "@/server/bookings/service";
import { getTourCounts } from "@/server/catalog/tours";
import { countNewInquiries, listInquiries } from "@/server/content/inquiries";
import { getReviewSummary } from "@/server/content/reviews";
import { listCustomers } from "@/server/customers/service";
import { listIntegrations } from "@/server/integrations";
import { whatsappChatLink } from "@/server/integrations/adapters/whatsapp";
import { listInvitations } from "@/server/team/invitations";
import { listMembers } from "@/server/team/members";

export const metadata = { title: "Overview" };

/** Months on the chart, ending with the current one. */
const CHART_MONTHS = 6;
const BYTES_PER_MB = 1024 * 1024;

export default function OverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const workspace = await requireWorkspace();
  const now = new Date();
  const timezone = workspace.tenant.timezone;
  const today = todayIn(timezone, now);
  const months = lastMonths(today, CHART_MONTHS);

  const allow = {
    bookings: can(workspace, "bookings.view"),
    manageBookings: can(workspace, "bookings.manage"),
    customers: can(workspace, "customers.view"),
    tours: can(workspace, "tours.view"),
    manageTours: can(workspace, "tours.manage"),
    reviews: can(workspace, "reviews.manage"),
    enquiries: can(workspace, "content.manage"),
    billing: can(workspace, "billing.view"),
    integrations: can(workspace, "integrations.view"),
    manageIntegrations: can(workspace, "integrations.manage"),
    manageTeam: can(workspace, "team.manage"),
  };

  // One transaction is one connection, so the reads run one after another.
  // Each is skipped unless the member's role covers what it shows.
  const data = await inWorkspace(workspace, async (scope) => {
    const allTime = allow.bookings ? await bookingStats(scope, { from: "1900-01-01", to: "2999-12-31", today, upcomingLimit: 5 }) : null;
    const hasBookings = (allTime?.counts.all ?? 0) > 0;

    // Requests by the month they arrived, in the workspace's timezone.
    const monthly: BookingSeriesPoint[] =
      allTime && hasBookings ? await bookingSeries(scope, { from: months[0]!.from, to: months.at(-1)!.to, bucket: "month", by: "created" }) : [];
    const pending = allTime && allTime.counts.pending > 0 ? await listBookings(scope, { status: "pending", sort: "oldest", limit: 5 }, { now }) : null;
    const recent = allTime && hasBookings ? await listBookings(scope, { sort: "newest", limit: 5 }, { now }) : null;
    const clashes = allTime && hasBookings ? await findClashes(scope, { now }) : [];

    const customers = allow.customers ? await listCustomers(scope, { sort: "newest", limit: 1 }) : null;
    const tourCounts = allow.tours || allow.manageTours ? await getTourCounts(scope) : null;
    const reviews = await getReviewSummary(scope);

    const enquiries = allow.enquiries ? await listInquiries(scope, { limit: 3 }) : null;
    const newEnquiries = allow.enquiries ? await countNewInquiries(scope) : 0;

    const usage = allow.billing ? await getUsage(scope, { today, now }) : null;
    const entitlements = allow.billing ? await getEntitlements(scope) : null;

    // The setup checklist is for a workspace that has not had a booking yet.
    const isNew = allTime !== null && !hasBookings;
    const needsIntegrations = (isNew && (allow.integrations || allow.manageIntegrations)) || (enquiries?.items.some((item) => item.phone) ?? false);
    const integrations = needsIntegrations ? await listIntegrations(scope) : [];
    const members = isNew && allow.manageTeam ? await listMembers(scope) : null;
    const invitations = isNew && allow.manageTeam ? await listInvitations(scope) : null;

    return { allTime, monthly, pending, recent, clashes, customers, tourCounts, reviews, enquiries, newEnquiries, usage, entitlements, isNew, integrations, members, invitations };
  });

  const { allTime, monthly } = data;
  const connected = (category: string) => data.integrations.some((integration) => integration.category === category && integration.status !== "disabled");
  const hasMessaging = connected("messaging");
  const currentMonth = months.at(-1)!;
  const previousMonth = months.at(-2)!;
  const byMonth = new Map(monthly.map((point) => [point.bucket, point]));
  const current = byMonth.get(currentMonth.key);
  const previous = byMonth.get(previousMonth.key);

  /* ------------------------------------------------------------------ KPIs */
  const kpis: Kpi[] = [];
  if (allTime) {
    const bookingsHref = "/workspace/bookings";
    const next = allTime.upcoming[0];
    const monthTrend = trend(current?.requests ?? 0, previous?.requests ?? 0, previousMonth.long);
    const requestTrend = { tone: monthTrend.tone, text: `${formatCount(current?.requests ?? 0)} in ${currentMonth.long} · ${monthTrend.text}` };
    kpis.push(
      {
        label: "Booking requests",
        value: formatCount(allTime.counts.all),
        trend: requestTrend,
        dot: "bg-highlight",
        href: bookingsHref,
      },
      {
        label: "Pending",
        value: formatCount(allTime.counts.pending),
        trend:
          data.clashes.length > 0
            ? { text: `${data.clashes.length} date ${data.clashes.length === 1 ? "clash" : "clashes"} to resolve`, tone: "warn" }
            : { text: allTime.counts.pending > 0 ? "Waiting for your reply" : "All caught up", tone: "neutral" },
        dot: "bg-amber-500",
        href: hrefWith(bookingsHref, { status: "pending" }),
      },
      {
        label: "Confirmed",
        value: formatCount(allTime.counts.confirmed),
        trend: { text: next ? `Next: ${formatDate(next.startDate, "short")} · ${next.tourTitle}` : "No tours ahead", tone: "neutral" },
        dot: "bg-emerald-600",
        href: hrefWith(bookingsHref, { status: "confirmed" }),
      },
      {
        label: "Completed tours",
        value: formatCount(allTime.counts.completed),
        trend: { text: `${formatCount(allTime.counts.cancelled)} cancelled or declined`, tone: "neutral" },
        dot: "bg-sky-600",
        href: hrefWith(bookingsHref, { status: "completed" }),
      },
    );
  }
  if (data.customers) {
    const newest = data.customers.rows[0];
    kpis.push({
      label: "Customers",
      value: formatCount(data.customers.total),
      trend: { text: newest ? `Newest: ${formatRelative(newest.createdAt, now, timezone)}` : "None yet", tone: "neutral" },
      dot: "bg-primary",
      href: "/workspace/customers",
    });
  }
  if (data.tourCounts && allow.tours) {
    kpis.push({
      label: "Tours",
      value: formatCount(data.tourCounts.published + data.tourCounts.draft),
      trend: { text: `${data.tourCounts.published} published · ${data.tourCounts.draft} ${data.tourCounts.draft === 1 ? "draft" : "drafts"}`, tone: "neutral" },
      dot: "bg-primary",
      href: "/workspace/tours",
    });
  }
  kpis.push({
    label: "Average rating",
    value: data.reviews.total > 0 ? data.reviews.average.toFixed(1) : "—",
    trend: { text: data.reviews.total === 1 ? "1 published review" : `${formatCount(data.reviews.total)} published reviews`, tone: "neutral" },
    dot: "bg-highlight",
    href: allow.reviews ? "/workspace/reviews" : undefined,
  });
  if (allTime) {
    kpis.push({
      label: `Booked value (${currentMonth.short})`,
      value: formatCompactMoney(current?.revenue ?? 0, allTime.currency),
      trend: trend(current?.revenue ?? 0, previous?.revenue ?? 0, previousMonth.long),
      dot: "bg-highlight",
      href: hrefWith("/workspace/bookings", { from: currentMonth.from, to: currentMonth.to }),
    });
  }

  /* ----------------------------------------------------------------- lists */
  const points: ChartPoint[] = months.map((month) => ({
    label: month.short,
    longLabel: month.long,
    requests: byMonth.get(month.key)?.requests ?? 0,
    confirmed: byMonth.get(month.key)?.confirmed ?? 0,
  }));

  const upcoming = (allTime?.upcoming ?? []).map((booking) => {
    const tile = dateTileParts(booking.startDate);
    return {
      id: booking.id,
      month: tile.month,
      day: tile.day,
      title: booking.tourTitle,
      detail: `${booking.contactName} · ${formatGuestCount(booking.guests)}${booking.slotTime ? ` · ${booking.slotTime}` : ""}`,
    };
  });

  const enquiries: EnquiryPreview[] = (data.enquiries?.items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    when: formatRelative(item.createdAt, now, timezone),
    message: item.message,
    mailto: mailtoLink(item.email, `Re: your enquiry to ${workspace.tenant.name}`),
    whatsapp: hasMessaging && item.phone ? whatsappChatLink(item.phone) : null,
  }));

  const meters: UsageMeterView[] = [];
  if (data.usage && data.entitlements) {
    const { usage } = data;
    const { limits } = data.entitlements;
    const percent = (used: number, limit: number | null) => (limit === null ? null : limit <= 0 ? (used > 0 ? 100 : 0) : (used / limit) * 100);
    const of = (used: string, limit: number | null, unit = "") => (limit === null ? `${used} · unlimited` : `${used} of ${formatCount(limit)}${unit}`);
    const seats = usage.teamMembers + usage.pendingInvitations;
    meters.push(
      { label: "Team members", text: of(formatCount(seats), limits.maxTeamMembers), percent: percent(seats, limits.maxTeamMembers) },
      { label: "Published tours", text: of(formatCount(usage.publishedTours), limits.maxPublishedTours), percent: percent(usage.publishedTours, limits.maxPublishedTours) },
      { label: "Bookings this month", text: of(formatCount(usage.bookingsThisMonth), limits.maxBookingsPerMonth), percent: percent(usage.bookingsThisMonth, limits.maxBookingsPerMonth) },
      { label: "Media storage", text: of(formatStorage(usage.storageBytes), limits.maxStorageMb, " MB"), percent: percent(usage.storageBytes / BYTES_PER_MB, limits.maxStorageMb) },
    );
  }

  /* ------------------------------------------------------------- checklist */
  const steps: ChecklistStep[] = [];
  if (data.isNew) {
    if (allow.manageTours && data.tourCounts) {
      const tours = data.tourCounts.published + data.tourCounts.draft + data.tourCounts.archived;
      steps.push({
        title: "Add a tour",
        description: "Describe it, set the price and dates, then publish it to your website.",
        done: tours > 0,
        href: "/workspace/tours/new",
        action: "Add a tour",
      });
    }
    if (allow.manageIntegrations) {
      steps.push(
        {
          title: "Connect e-mail",
          description: "Booking confirmations and enquiry alerts are sent from your own address.",
          done: connected("email"),
          href: "/workspace/settings/integrations",
          action: "Connect e-mail",
        },
        {
          title: "Connect media storage",
          description: "Tour photos and videos are kept in your own media account.",
          done: connected("media"),
          href: "/workspace/settings/integrations",
          action: "Connect storage",
        },
      );
    }
    if (allow.manageTeam && data.members && data.invitations) {
      const others = data.members.length - 1 + data.invitations.filter((invitation) => invitation.status === "pending").length;
      steps.push({
        title: "Invite the team",
        description: "Give colleagues their own sign-in and a role that fits what they do.",
        done: others > 0,
        href: "/workspace/team",
        action: "Invite someone",
      });
    }
  }
  const showChecklist = steps.some((step) => !step.done);

  // The side cards a member's role allows; the grids below close up around a missing one.
  const usageCard = meters.length > 0 && data.entitlements ? <UsageMeters planName={data.entitlements.plan.name} meters={meters} /> : null;
  const enquiriesCard = data.enquiries ? <RecentEnquiries enquiries={enquiries} newCount={data.newEnquiries} /> : null;

  return (
    <>
      <PageHeader
        title={`${greeting(hourIn(timezone, now))}, ${firstName(workspace.user.name)}`}
        description={formatLongDate(today)}
        actions={
          allow.manageTours ? (
            <Link href="/workspace/tours/new" className="btn btn-default">
              Add a tour
            </Link>
          ) : null
        }
      />

      {data.clashes.length > 0 ? <ClashBanner count={data.clashes.length} /> : null}
      {showChecklist ? <OnboardingChecklist workspaceName={workspace.tenant.name} steps={steps} /> : null}

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      {allTime && !showChecklist ? (
        <>
          <div className="mb-5 grid gap-5 xl:grid-cols-[3fr_2fr]">
            <BookingsChart points={points} />
            <UpcomingTours tours={upcoming} />
          </div>
          <div className={cn("mb-5 grid gap-5", usageCard || enquiriesCard ? "xl:grid-cols-[3fr_2fr]" : null)}>
            <NeedsReply
              bookings={(data.pending?.rows ?? []).map((row) => toRowView(row, { now, timezone }))}
              total={allTime.counts.pending}
              canManage={allow.manageBookings}
            />
            {usageCard ?? enquiriesCard}
          </div>
          <div className={cn("grid gap-5", usageCard && enquiriesCard ? "xl:grid-cols-[3fr_2fr]" : null)}>
            <RecentBookings bookings={(data.recent?.rows ?? []).map((row) => toRowView(row, { now, timezone }))} />
            {usageCard ? enquiriesCard : null}
          </div>
        </>
      ) : (
        <div className={cn("grid gap-5", usageCard && enquiriesCard ? "xl:grid-cols-2" : null)}>
          {usageCard}
          {enquiriesCard}
        </div>
      )}
    </>
  );
}
