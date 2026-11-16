"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { deleteCampaignAction, setCampaignActiveAction } from "@/app/workspace/promotions/actions";
import { ConfirmDialog } from "@/components/overlays";
import { EmptyState } from "@/components/workspace/page-header";
import { useAction } from "@/hooks/use-action";
import {
  CAMPAIGN_FILTERS,
  CAMPAIGN_STATUS_BADGES,
  CAMPAIGN_STATUS_LABELS,
  campaignWindow,
  countBy,
  eligibilityText,
  filterByStatus,
  formatDiscountLabel,
  scopeText,
  type CampaignFilter,
} from "@/lib/promotion-display";
import type { CampaignView } from "@/server/promotions/campaigns";
import { CampaignEditor } from "./campaign-editor";
import type { PromotionsContext } from "./promotions-view";
import { AccessNote, FilterChips } from "./shared";

interface CampaignsTabProps extends PromotionsContext {
  campaigns: CampaignView[];
  filter: CampaignFilter;
  onFilter: (filter: CampaignFilter) => void;
}

const MANAGE_NOTE = "Only members who can manage discounts can create, switch or edit campaigns.";

export function CampaignsTab({ campaigns, filter, onFilter, ...context }: CampaignsTabProps) {
  const { access, currency } = context;
  const [editing, setEditing] = useState<CampaignView | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleting, setDeleting] = useState<CampaignView | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const toggle = useAction(setCampaignActiveAction, {
    success: (data) => (data.isActive ? `“${data.name}” activated` : `“${data.name}” deactivated — removed from website`),
    onSuccess: () => setToggling(null),
  });
  const remove = useAction(deleteCampaignAction, { success: "Campaign deleted", onSuccess: () => setDeleting(null) });

  const counts = countBy(campaigns, CAMPAIGN_FILTERS);
  const shown = filterByStatus(campaigns, filter);

  function openEditor(campaign: CampaignView | null) {
    setEditing(campaign);
    setEditorOpen(true);
  }

  async function setActive(campaign: CampaignView) {
    setToggling(campaign.id);
    const result = await toggle.run({ id: campaign.id, isActive: !campaign.isActive });
    if (!result.ok) setToggling(null);
  }

  const newButton = (
    <button type="button" onClick={() => openEditor(null)} disabled={!access.manage} className="btn btn-default">
      <Plus aria-hidden="true" />
      New campaign
    </button>
  );

  if (campaigns.length === 0) {
    return (
      <>
        <EmptyState
          title="No campaigns yet"
          description="A campaign takes a percentage or a fixed amount off chosen tours for a date window: an early-bird offer, a family discount or a private deal for returning guests. Only the best discount ever applies to a booking."
          action={access.manage ? newButton : <AccessNote>{MANAGE_NOTE}</AccessNote>}
        />
        <CampaignEditor open={editorOpen} onOpenChange={setEditorOpen} campaign={editing} {...context} />
      </>
    );
  }

  function activeSwitch(campaign: CampaignView) {
    const busy = toggle.pending && toggling === campaign.id;
    return (
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={campaign.isActive}
        aria-label={`Active: ${campaign.name}`}
        aria-busy={busy || undefined}
        disabled={!access.manage || busy}
        onClick={() => void setActive(campaign)}
      >
        <span className="switch-thumb" />
      </button>
    );
  }

  function visibility(campaign: CampaignView) {
    return campaign.visibility === "public" ? (
      <span className="badge badge-secondary">Public</span>
    ) : (
      <span className="badge badge-outline">
        Private · {campaign.assignedEmails.length} {campaign.assignedEmails.length === 1 ? "guest" : "guests"}
      </span>
    );
  }

  const status = (campaign: CampaignView) => <span className={CAMPAIGN_STATUS_BADGES[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</span>;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips label="Filter campaigns" filters={CAMPAIGN_FILTERS} counts={counts} value={filter} onChange={onFilter} />
        {newButton}
      </div>
      {!access.manage ? (
        <div className="mb-4">
          <AccessNote>{MANAGE_NOTE}</AccessNote>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <ul className="divide-y lg:hidden">
          {shown.map((campaign) => (
            <li key={campaign.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold">{campaign.name}</p>
                  <p className="text-xs text-muted-foreground">{campaignWindow(campaign.startsOn, campaign.endsOn)}</p>
                </div>
                {status(campaign)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="badge badge-highlight">{formatDiscountLabel(campaign.type, campaign.value, currency)}</span>
                {visibility(campaign)}
                <span className="badge badge-outline">
                  {campaign.uses} {campaign.uses === 1 ? "use" : "uses"}
                </span>
              </div>
              <p className="text-[13px] text-muted-foreground">
                {scopeText(campaign.appliesToAllTours, campaign.tours)} · {eligibilityText(campaign)}
              </p>
              <div className="flex items-center gap-2 pt-1">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {activeSwitch(campaign)}
                  Active
                </span>
                <button type="button" onClick={() => openEditor(campaign)} disabled={!access.manage} className="btn btn-outline btn-sm ml-auto">
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(campaign)}
                  disabled={!access.manage}
                  aria-label={`Delete ${campaign.name}`}
                  className="btn btn-ghost btn-sm text-destructive hover:text-destructive"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto lg:block">
          <table className="table min-w-[1040px]">
            <thead>
              <tr>
                <th className="pl-6">Campaign</th>
                <th>Discount</th>
                <th>Applies to</th>
                <th>Valid</th>
                <th>Visibility</th>
                <th>Eligibility</th>
                <th>Uses</th>
                <th>Status</th>
                <th>Active</th>
                <th className="pr-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((campaign) => (
                <tr key={campaign.id}>
                  <td className="pl-6">
                    <span className="block font-bold">{campaign.name}</span>
                    {campaign.code ? <span className="font-mono text-xs text-muted-foreground">{campaign.code}</span> : null}
                  </td>
                  <td className="whitespace-nowrap font-semibold">{formatDiscountLabel(campaign.type, campaign.value, currency)}</td>
                  <td className="max-w-[200px] text-[13px] text-muted-foreground">{scopeText(campaign.appliesToAllTours, campaign.tours)}</td>
                  <td className="whitespace-nowrap text-[13px]">{campaignWindow(campaign.startsOn, campaign.endsOn)}</td>
                  <td>{visibility(campaign)}</td>
                  <td className="text-[13px] text-muted-foreground">{eligibilityText(campaign)}</td>
                  <td>{campaign.uses}</td>
                  <td>{status(campaign)}</td>
                  <td>{activeSwitch(campaign)}</td>
                  <td className="whitespace-nowrap pr-6 text-right">
                    <button type="button" onClick={() => openEditor(campaign)} disabled={!access.manage} className="btn btn-outline btn-sm">
                      Edit
                    </button>{" "}
                    <button
                      type="button"
                      onClick={() => setDeleting(campaign)}
                      disabled={!access.manage}
                      aria-label={`Delete ${campaign.name}`}
                      className="btn btn-ghost btn-sm text-destructive hover:text-destructive"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {shown.length === 0 ? <p className="p-10 text-center text-muted-foreground">No campaigns in this view.</p> : null}
      </div>
      <p className="mt-3 text-[13px] text-muted-foreground">
        Expired, scheduled and inactive campaigns are hidden from the website and can’t be applied. Only one discount applies per booking — the best one.
      </p>

      <CampaignEditor open={editorOpen} onOpenChange={setEditorOpen} campaign={editing} {...context} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.pending) setDeleting(null);
        }}
        title={deleting ? `Delete “${deleting.name}”?` : "Delete campaign?"}
        description="It will stop applying immediately. Past bookings keep their price and the change stays in the activity log."
        confirmLabel="Delete campaign"
        destructive
        pending={remove.pending}
        onConfirm={() => {
          if (deleting) void remove.run({ id: deleting.id });
        }}
      />
    </>
  );
}
