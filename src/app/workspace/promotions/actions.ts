"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { todayIn } from "@/lib/dates";
import { ACTIVITY_AREA_PREFIX, ACTIVITY_AREAS, ACTIVITY_PAGE_SIZE } from "@/lib/promotion-display";
import { workspaceAction, deliverNotificationsNow } from "@/server/actions";
import { listAuditEntries } from "@/server/audit/read";
import { createCampaign, deleteCampaign, setCampaignActive, updateCampaign, type CampaignInput } from "@/server/promotions/campaigns";
import { assignPersonalDiscount, revokePersonalDiscount, type PersonalDiscountInput } from "@/server/promotions/personal-discounts";
import { approveDiscountRequest, rejectDiscountRequest } from "@/server/promotions/requests";
import { changePromotionSettings } from "@/server/promotions/settings";

// The services answer "not found" for anything that is not one of this
// workspace's records, so ids only need to be plausible strings here.
const id = z.string().min(1).max(64);
const isObject = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value);

/** The sidebar badge counts pending requests, so the whole workspace shell refreshes. */
function refresh(): void {
  revalidatePath("/workspace", "layout");
}

/**
 * Creates a campaign, or replaces every editable field of an existing one.
 * The service validates the campaign itself and reports field errors by name.
 */
export const saveCampaignAction = workspaceAction(
  "promotions.manage",
  z.object({ id: id.optional(), campaign: z.custom<CampaignInput>(isObject) }),
  async ({ workspace, scope, input }) => {
    const today = todayIn(workspace.tenant.timezone);
    const campaign = input.id
      ? await updateCampaign(scope, input.id, input.campaign, today)
      : await createCampaign(scope, input.campaign, today);
    refresh();
    return { id: campaign.id, name: campaign.name, status: campaign.status, created: !input.id };
  },
);

export const setCampaignActiveAction = workspaceAction(
  "promotions.manage",
  z.object({ id, isActive: z.boolean() }),
  async ({ workspace, scope, input }) => {
    const campaign = await setCampaignActive(scope, input.id, input.isActive, todayIn(workspace.tenant.timezone));
    refresh();
    return { id: campaign.id, name: campaign.name, isActive: campaign.isActive, status: campaign.status };
  },
);

export const deleteCampaignAction = workspaceAction("promotions.manage", z.object({ id }), async ({ scope, input }) => {
  await deleteCampaign(scope, input.id);
  refresh();
  return { id: input.id };
});

export const assignPersonalDiscountAction = workspaceAction(
  "promotions.manage",
  z.custom<PersonalDiscountInput>(isObject),
  async ({ workspace, scope, input }) => {
    const { discount, replacedIds } = await assignPersonalDiscount(scope, input, todayIn(workspace.tenant.timezone));
    refresh();
    return { id: discount.id, customerName: discount.customerName, replaced: replacedIds.length };
  },
);

export const revokePersonalDiscountAction = workspaceAction("promotions.manage", z.object({ id }), async ({ scope, input }) => {
  await revokePersonalDiscount(scope, input.id);
  refresh();
  return { id: input.id };
});

export const approveDiscountRequestAction = workspaceAction(
  "promotions.decide",
  z.object({ id, type: z.enum(["percent", "fixed"]), value: z.number(), note: z.string().max(1000).optional() }),
  async ({ scope, input, afterCommit }) => {
    const { id: requestId, ...decision } = input;
    const request = await approveDiscountRequest(scope, requestId, decision);
    // The customer's decision e-mail goes out now, not at the next scheduled run.
    afterCommit(() => deliverNotificationsNow(scope.tenantId));
    refresh();
    return { id: request.id, reference: request.reference, name: request.name };
  },
);

export const rejectDiscountRequestAction = workspaceAction(
  "promotions.decide",
  z.object({ id, reason: z.string().max(1000) }),
  async ({ scope, input, afterCommit }) => {
    const request = await rejectDiscountRequest(scope, input.id, { reason: input.reason });
    afterCommit(() => deliverNotificationsNow(scope.tenantId));
    refresh();
    return { id: request.id, reference: request.reference, name: request.name };
  },
);

/**
 * One page of this area's history from the workspace audit log. Anyone who
 * can see discounts can read their history: the entries carry nothing the
 * tabs themselves do not already show (settings changes name fields, not values).
 */
export const loadPromotionActivityAction = workspaceAction(
  "promotions.view",
  z.object({ area: z.enum(ACTIVITY_AREAS), cursor: z.string().max(200).optional() }),
  async ({ scope, input }) => listAuditEntries(scope, { action: ACTIVITY_AREA_PREFIX[input.area], limit: ACTIVITY_PAGE_SIZE, cursor: input.cursor }),
);

/** Any subset of the request settings; the service validates and writes an audit entry. */
export const updatePromotionSettingsAction = workspaceAction(
  "promotions.manage",
  z.object({
    requestsEnabled: z.boolean().optional(),
    maxRequestPercent: z.number().optional(),
    responseDays: z.number().optional(),
  }),
  async ({ scope, input }) => {
    const settings = await changePromotionSettings(scope, input);
    refresh();
    return settings;
  },
);
