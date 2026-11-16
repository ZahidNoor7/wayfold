import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { PromotionsView, type RequestItem, type TourOption } from "@/components/workspace/promotions/promotions-view";
import { enumParam, uuidParam, type SearchParams } from "@/lib/booking-display";
import { todayIn } from "@/lib/dates";
import { ACTIVITY_AREA_PREFIX, ACTIVITY_PAGE_SIZE, PROMOTION_TABS } from "@/lib/promotion-display";
import { listAuditEntries } from "@/server/audit/read";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { getEntitlements } from "@/server/billing/limits";
import { listTours, type TourListItem } from "@/server/catalog/tours";
import type { TenantScope } from "@/server/db/context";
import { listCampaigns } from "@/server/promotions/campaigns";
import { findEligibleDiscounts } from "@/server/promotions/engine";
import { listPersonalDiscounts } from "@/server/promotions/personal-discounts";
import { getDiscountRequest, listDiscountRequests } from "@/server/promotions/requests";
import { getPromotionSettings } from "@/server/settings/tenant-settings";

export const metadata = { title: "Discounts & offers" };

const TOUR_PAGE = 100;

export default function PromotionsPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

/** Every tour of the workspace, for the campaign and personal-discount tour pickers. */
async function allTours(scope: TenantScope): Promise<TourListItem[]> {
  const items: TourListItem[] = [];
  for (let offset = 0; ; offset += TOUR_PAGE) {
    const page = await listTours(scope, { limit: TOUR_PAGE, offset });
    items.push(...page.items);
    if (page.items.length < TOUR_PAGE || items.length >= page.total) return items;
  }
}

async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const workspace = await requireWorkspace("promotions.view");
  const params = await searchParams;
  const tab = enumParam(params.tab, PROMOTION_TABS) ?? "campaigns";
  const requestId = uuidParam(params.request) ?? null;
  const today = todayIn(workspace.tenant.timezone);

  const header = (
    <PageHeader
      title="Discounts & offers"
      description="Campaigns, personal discounts and customer requests. Changes go live on your website instantly."
    />
  );

  // One transaction is one connection: its queries run one after another.
  const data = await inWorkspace(workspace, async (scope) => {
    const { features, plan } = await getEntitlements(scope);
    if (!features.promotions) return { locked: true as const, planName: plan.name };

    const campaigns = await listCampaigns(scope, today);
    const personal = await listPersonalDiscounts(scope, today);
    const requests = await listDiscountRequests(scope);
    const settings = await getPromotionSettings(scope);
    const tours = await allTours(scope);

    // Pending requests carry what may be approved and which offers already
    // apply, so the decision panel opens with everything it needs.
    const items: RequestItem[] = [];
    for (const request of requests) {
      if (request.status !== "pending") {
        items.push({ ...request, detail: null });
        continue;
      }
      const detail = await getDiscountRequest(scope, request.id);
      const offers = await findEligibleDiscounts(scope, {
        tourId: request.tourId,
        email: request.email,
        adults: request.adults,
        children: request.children,
        baseAmount: detail.limits.base,
        // No travel date is known yet, so offers that need booking ahead are not counted.
        travelDate: today,
        today,
      });
      items.push({ ...request, detail: { limits: detail.limits, canApproveInFull: detail.canApproveInFull, offers: offers.map((o) => o.label) } });
    }

    const activity = await listAuditEntries(scope, { action: ACTIVITY_AREA_PREFIX.all, limit: ACTIVITY_PAGE_SIZE });

    return { locked: false as const, campaigns, personal, requests: items, settings, tours, activity };
  });

  if (data.locked) {
    const canBill = can(workspace, "billing.view");
    return (
      <>
        {header}
        <EmptyState
          title="Discounts aren’t in your plan"
          description={`Your ${data.planName} plan doesn’t include discounts and offers. Upgrade to run campaigns, give customers personal discounts and answer discount requests from your website.${
            canBill ? "" : " Ask the workspace owner to upgrade."
          }`}
          action={
            canBill ? (
              <Link href="/workspace/billing" className="btn btn-default">
                See plans
              </Link>
            ) : null
          }
        />
      </>
    );
  }

  const tours: TourOption[] = data.tours.map((tour) => ({ id: tour.id, title: tour.title, status: tour.status, priceAdult: tour.priceAdult }));

  return (
    <>
      {header}
      <PromotionsView
        initialTab={tab}
        initialRequestId={requestId}
        campaigns={data.campaigns}
        personal={data.personal}
        requests={data.requests}
        settings={data.settings}
        activity={data.activity}
        tours={tours}
        access={{ manage: can(workspace, "promotions.manage"), decide: can(workspace, "promotions.decide") }}
        currency={workspace.tenant.currency}
        timezone={workspace.tenant.timezone}
        today={today}
        nowIso={new Date().toISOString()}
      />
    </>
  );
}
