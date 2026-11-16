"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { platformAction } from "@/server/actions";
import { cancelSubscription, issueInvoice, issueInvoiceSchema, renewSubscription } from "@/server/platform/billing";
import { PLATFORM_LINKS } from "@/server/platform/mailer";
import { requestSupportAccess } from "@/server/platform/support";
import {
  activateTenant,
  changeTenantPlan,
  createTenantManually,
  createTenantSchema,
  limitOverridesSchema,
  setLimitOverrides,
  setTenantOwner,
  suspendTenant,
  updateTenant,
  updateTenantSchema,
} from "@/server/platform/tenants";
import { toActor } from "../../_lib/guard";

const tenantId = z.uuid();

/** Everything under /platform reads these tables, so the whole area is refreshed. */
function refresh(): void {
  revalidatePath("/platform", "layout");
}

export const createTenantAction = platformAction("owner", createTenantSchema, async ({ admin, input }) => {
  const created = await createTenantManually(toActor(admin), input);
  refresh();
  return {
    tenantId: created.tenantId,
    slug: created.slug,
    ownerCreated: created.ownerCreated,
    setupEmailDelivered: created.setupEmailDelivered,
    // Only present when a new owner's e-mail could not be sent. Shown once, never stored.
    setupUrl: created.setupToken ? PLATFORM_LINKS.resetPassword(created.setupToken) : null,
  };
});

export const updateTenantAction = platformAction("owner", updateTenantSchema.extend({ tenantId }), async ({ admin, input }) => {
  const { tenantId: id, ...changes } = input;
  const updated = await updateTenant(toActor(admin), id, changes);
  refresh();
  return updated;
});

export const suspendTenantAction = platformAction("owner", z.object({ tenantId, reason: z.string() }), async ({ admin, input }) => {
  await suspendTenant(toActor(admin), input.tenantId, input.reason);
  refresh();
});

export const activateTenantAction = platformAction("owner", z.object({ tenantId }), async ({ admin, input }) => {
  await activateTenant(toActor(admin), input.tenantId);
  refresh();
});

export const changeTenantPlanAction = platformAction(
  "owner",
  z.object({ tenantId, planId: z.uuid(), cycle: z.enum(["monthly", "yearly"]).optional() }),
  async ({ admin, input }) => {
    const changed = await changeTenantPlan(toActor(admin), input.tenantId, { planId: input.planId, cycle: input.cycle });
    refresh();
    return changed;
  },
);

export const setLimitOverridesAction = platformAction("owner", z.object({ tenantId, overrides: limitOverridesSchema }), async ({ admin, input }) => {
  const overrides = await setLimitOverrides(toActor(admin), input.tenantId, input.overrides);
  refresh();
  return overrides;
});

export const setTenantOwnerAction = platformAction("owner", z.object({ tenantId, email: z.string() }), async ({ admin, input }) => {
  const result = await setTenantOwner(toActor(admin), input.tenantId, { email: input.email });
  refresh();
  return { ownerUserId: result.ownerUserId, previousOwners: result.previousOwnerUserIds.length };
});

export const issueInvoiceAction = platformAction("owner", issueInvoiceSchema.extend({ tenantId }), async ({ admin, input }) => {
  const { tenantId: id, ...invoice } = input;
  const issued = await issueInvoice(toActor(admin), id, invoice);
  refresh();
  return { number: issued.number };
});

export const renewSubscriptionAction = platformAction(
  "owner",
  z.object({ tenantId, cycle: z.enum(["monthly", "yearly"]).optional() }),
  async ({ admin, input }) => {
    const { subscription, checkout } = await renewSubscription(toActor(admin), input.tenantId, { cycle: input.cycle });
    refresh();
    return {
      periodEnd: subscription.currentPeriodEnd,
      billing: checkout.kind,
      invoiceNumber: checkout.kind === "invoice" ? checkout.invoice.number : null,
    };
  },
);

export const cancelSubscriptionAction = platformAction("owner", z.object({ tenantId, immediately: z.boolean() }), async ({ admin, input }) => {
  const subscription = await cancelSubscription(toActor(admin), input.tenantId, { immediately: input.immediately });
  refresh();
  return { status: subscription.status, periodEnd: subscription.currentPeriodEnd };
});

/** Open to the support role: asking changes nothing until the workspace approves. */
export const requestSupportAccessAction = platformAction("support", z.object({ tenantId, reason: z.string() }), async ({ admin, input, ip }) => {
  const result = await requestSupportAccess(toActor(admin), input.tenantId, input.reason, { ip });
  refresh();
  return result;
});
