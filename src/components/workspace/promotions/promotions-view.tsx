"use client";

import { Lock } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { SwapIn } from "@/components/motion";
import { hrefWith } from "@/lib/booking-display";
import {
  isOverMaximum,
  nextTabIndex,
  PROMOTION_TAB_LABELS,
  PROMOTION_TABS,
  type ApprovalLimits,
  type CampaignFilter,
  type PromotionTab,
  type RequestFilter,
} from "@/lib/promotion-display";
import type { AuditPage } from "@/server/audit/read";
import type { TourListItem } from "@/server/catalog/tours";
import type { CampaignView } from "@/server/promotions/campaigns";
import type { PersonalDiscountView } from "@/server/promotions/personal-discounts";
import type { DiscountRequestView } from "@/server/promotions/requests";
import type { PromotionSettings } from "@/server/settings/tenant-settings";
import { ActivityTab } from "./activity-tab";
import { CampaignsTab } from "./campaigns-tab";
import { PersonalTab } from "./personal-tab";
import { RequestsTab } from "./requests-tab";
import { SettingsTab } from "./settings-tab";

export interface TourOption {
  id: string;
  title: string;
  status: TourListItem["status"];
  priceAdult: number;
}

export interface RequestDetail {
  limits: ApprovalLimits;
  canApproveInFull: boolean;
  /** Labels of the offers that already apply to this party today, best first. */
  offers: string[];
}

/** A request as listed; pending ones carry their approval limits. */
export type RequestItem = DiscountRequestView & { detail: RequestDetail | null };

export interface PromotionsAccess {
  /** promotions.manage: campaigns, personal discounts and settings. */
  manage: boolean;
  /** promotions.decide: approving and rejecting requests. */
  decide: boolean;
}

export interface PromotionsContext {
  tours: TourOption[];
  access: PromotionsAccess;
  currency: string;
  timezone: string;
  today: string;
  nowIso: string;
}

interface PromotionsViewProps extends PromotionsContext {
  initialTab: PromotionTab;
  initialRequestId: string | null;
  campaigns: CampaignView[];
  personal: PersonalDiscountView[];
  requests: RequestItem[];
  settings: PromotionSettings;
  activity: AuditPage;
}

const PATH = "/workspace/promotions";
const tabId = (tab: PromotionTab) => `promotions-tab-${tab}`;
const panelId = (tab: PromotionTab) => `promotions-panel-${tab}`;

/** Writes the tab and open request into the address bar without a server round trip. */
function syncUrl(tab: PromotionTab, request: string | null): void {
  window.history.replaceState(null, "", hrefWith(PATH, { tab: tab === "campaigns" ? undefined : tab, request }));
}

function accessNotice(access: PromotionsAccess): string | null {
  if (access.manage && access.decide) return null;
  if (!access.manage && !access.decide) {
    return "Your role can see discounts and requests but can’t change them. Ask the workspace owner to update your role in Team & roles.";
  }
  if (!access.decide) return "Your role can manage campaigns and personal discounts, but can’t approve or reject requests.";
  return "Your role can approve or reject requests, but can’t change campaigns, personal discounts or settings.";
}

export function PromotionsView({ initialTab, initialRequestId, campaigns, personal, requests, settings, activity, ...context }: PromotionsViewProps) {
  const [tab, setTab] = useState<PromotionTab>(initialRequestId ? "requests" : initialTab);
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("all");
  const [requestFilter, setRequestFilter] = useState<RequestFilter>("pending");
  const [openRequestId, setOpenRequestId] = useState<string | null>(initialRequestId);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const pending = requests.filter((request) => request.status === "pending");
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === "active");
  const activePersonal = personal.filter((discount) => discount.status === "active");
  const notice = accessNotice(context.access);

  function selectTab(next: PromotionTab) {
    setTab(next);
    if (next !== "requests") setOpenRequestId(null);
    syncUrl(next, next === "requests" ? openRequestId : null);
  }

  function openRequest(id: string | null) {
    setOpenRequestId(id);
    syncUrl("requests", id);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = PROMOTION_TABS.indexOf(tab);
    const next = nextTabIndex(event.key, current, PROMOTION_TABS.length);
    if (next === null) return;
    event.preventDefault();
    selectTab(PROMOTION_TABS[next]!);
    tabRefs.current[next]?.focus();
  }

  const kpis: { label: string; value: string; sub: string; go: () => void }[] = [
    {
      label: "Active campaigns",
      value: String(activeCampaigns.length),
      sub: `${activeCampaigns.filter((c) => c.visibility === "public").length} public · ${activeCampaigns.filter((c) => c.visibility === "private").length} private`,
      go: () => {
        setCampaignFilter("active");
        selectTab("campaigns");
      },
    },
    {
      label: "Pending requests",
      value: String(pending.length),
      sub: `Reply within ${settings.responseDays} ${settings.responseDays === 1 ? "day" : "days"}`,
      go: () => {
        setRequestFilter("pending");
        selectTab("requests");
      },
    },
    {
      label: "Personal discounts",
      value: String(activePersonal.length),
      sub: `${personal.filter((discount) => discount.status === "used").length} used`,
      go: () => selectTab("personal"),
    },
    {
      label: "Redemptions",
      value: String(campaigns.reduce((sum, campaign) => sum + campaign.uses, 0)),
      sub: "Across all campaigns",
      go: () => {
        setCampaignFilter("all");
        selectTab("campaigns");
      },
    },
    {
      label: "Discount requests",
      value: settings.requestsEnabled ? "On" : "Off",
      sub: settings.requestsEnabled ? "Shown on website" : "Hidden from website",
      go: () => selectTab("settings"),
    },
  ];

  const pills: Partial<Record<PromotionTab, { n: number; className: string }>> = {
    campaigns: { n: campaigns.length, className: "ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 text-xs" },
    personal: { n: personal.length, className: "ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 text-xs" },
    requests: { n: pending.length, className: "ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs text-white" },
  };

  return (
    <>
      {notice ? (
        <div
          role="status"
          className="alert mb-5 flex items-center gap-3 border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <Lock aria-hidden="true" className="size-5 shrink-0" />
          <span>
            <strong>Limited access.</strong> {notice}
          </span>
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <button
            key={kpi.label}
            type="button"
            onClick={kpi.go}
            className="card flex flex-col gap-1 p-4 text-left transition-shadow hover:shadow-md active:scale-[0.99]"
          >
            <span className="text-[13px] font-medium text-muted-foreground">{kpi.label}</span>
            <span className="font-display text-[32px] font-semibold leading-none text-primary">{kpi.value}</span>
            <span className="text-xs text-muted-foreground">{kpi.sub}</span>
          </button>
        ))}
      </div>

      <div role="tablist" aria-label="Discount sections" className="tabs-list no-scrollbar mb-6 max-w-full justify-start overflow-x-auto" onKeyDown={onTabKeyDown}>
        {PROMOTION_TABS.map((key, index) => {
          const active = key === tab;
          const pill = pills[key];
          return (
            <button
              key={key}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={tabId(key)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId(key)}
              tabIndex={active ? 0 : -1}
              className="tabs-trigger"
              onClick={() => selectTab(key)}
            >
              {PROMOTION_TAB_LABELS[key]}
              {pill && pill.n > 0 ? (
                <span className={pill.className}>
                  {pill.n}
                  {key === "requests" ? <span className="sr-only"> pending</span> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
        <SwapIn key={tab}>
          {tab === "campaigns" ? <CampaignsTab campaigns={campaigns} filter={campaignFilter} onFilter={setCampaignFilter} {...context} /> : null}
          {tab === "personal" ? <PersonalTab discounts={personal} {...context} /> : null}
          {tab === "requests" ? (
            <RequestsTab
              requests={requests}
              requestsEnabled={settings.requestsEnabled}
              filter={requestFilter}
              onFilter={setRequestFilter}
              openRequestId={openRequestId}
              onOpenRequest={openRequest}
              onOpenSettings={() => selectTab("settings")}
              {...context}
            />
          ) : null}
          {tab === "activity" ? <ActivityTab initial={activity} personal={personal} requests={requests} {...context} /> : null}
          {tab === "settings" ? (
            <SettingsTab
              settings={settings}
              overMaximum={pending.filter((request) => request.detail && isOverMaximum(request.detail.limits)).length}
              {...context}
            />
          ) : null}
        </SwapIn>
      </div>
    </>
  );
}
