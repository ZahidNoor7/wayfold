import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { withTenant } from "@/server/db/context";
import { auditLogs, invoices, plans, subscriptions } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  cancelSubscription,
  getBillingProvider,
  handleBillingWebhook,
  issueInvoice,
  listBillingProviders,
  listInvoices,
  manualBillingProvider,
  markInvoicePaid,
  registerBillingProvider,
  renewSubscription,
  unregisterBillingProvider,
  voidInvoice,
  type BillingEvent,
  type BillingProvider,
} from "@/server/platform/billing";
import { withPlatform } from "@/server/platform/db";
import { createPlan, createTenant, randomId, unique } from "../../helpers/fixtures";
import { auditBy, caught, createAdmin, holdInvoiceNumberLock } from "./helpers";

const period = { start: "2026-01-01", end: "2026-01-31" };

async function tenantOnPaidPlan(prices: { priceMonthly: number; priceYearly: number; currency?: string }) {
  const tenant = await createTenant();
  await withPlatform((tx) => tx.update(plans).set(prices).where(eq(plans.id, tenant.planId)));
  return tenant;
}

holdInvoiceNumberLock();

async function subscriptionOf(tenantId: string) {
  const [row] = await withPlatform((tx) => tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)));
  return row!;
}

describe("invoices", () => {
  it("issues sequential INV-YYYY-NNNNNN numbers", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();
    const year = new Date().getUTCFullYear();

    const first = await issueInvoice(owner, tenant.tenantId, { description: "Setup fee", amount: 15_000, period });
    const second = await issueInvoice(owner, tenant.tenantId, { description: "Extra storage", amount: 2_500, period, currency: "eur" });

    expect(first.number).toMatch(new RegExp(`^INV-${year}-\\d{6}$`));
    expect(Number(second.number.slice(-6))).toBe(Number(first.number.slice(-6)) + 1);
    expect(first).toMatchObject({ tenantId: tenant.tenantId, amount: 15_000, currency: "USD", status: "open", paidAt: null, provider: "manual" });
    expect(first.periodStart.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(first.periodEnd.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(second.currency).toBe("EUR");

    const audit = (await auditBy(owner.userId)).filter((row) => row.action === "invoice.issued");
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ tenantId: tenant.tenantId, actorType: "platform_admin", targetType: "invoice" });
  });

  it("is not thrown off by invoice numbers of another shape", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();
    const year = new Date().getUTCFullYear();
    const before = await issueInvoice(owner, tenant.tenantId, { description: "Before imports", amount: 100, period });

    // Imported or gateway-issued numbers that merely look similar.
    const foreign = (number: string) => ({
      tenantId: tenant.tenantId,
      number,
      description: "Imported",
      amount: 1,
      currency: "USD",
      periodStart: new Date(),
      periodEnd: new Date(),
    });
    const tag = unique("x").slice(-6).toUpperCase().replace(/[0-9-]/g, "Z");
    await withPlatform((tx) =>
      tx.insert(invoices).values([foreign(`INV-${year}-${tag}`), foreign(`INV-${year}-9999999-${tag}`), foreign(`INV-${year}-999999${tag}`)]),
    );

    const after = await issueInvoice(owner, tenant.tenantId, { description: "After imports", amount: 100, period });
    expect(Number(after.number.slice(-6))).toBe(Number(before.number.slice(-6)) + 1);
  });

  it("never hands out the same number twice when issued concurrently", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();
    const issued = await Promise.all(
      Array.from({ length: 6 }, (_, index) => issueInvoice(owner, tenant.tenantId, { description: `Batch ${index}`, amount: 100 + index, period })),
    );
    const numbers = issued.map((invoice) => Number(invoice.number.slice(-6))).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(6);
    expect(numbers[5]! - numbers[0]!).toBe(5);
  });

  it("validates the invoice and the workspace", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();
    const bad = [
      { description: "ok description", amount: 0, period },
      { description: "ok description", amount: 10.5, period },
      { description: "ok description", amount: -100, period },
      { description: "", amount: 100, period },
      { description: "ok description", amount: 100, period: { start: "2026-02-30", end: "2026-03-01" } },
      { description: "ok description", amount: 100, period: { start: "2026-03-02", end: "2026-03-01" } },
      { description: "ok description", amount: 100, period, currency: "dollars" },
    ];
    for (const input of bad) expect(await caught(() => issueInvoice(owner, tenant.tenantId, input))).toBeInstanceOf(ValidationError);
    expect(await caught(() => issueInvoice(owner, randomId(), { description: "Nobody", amount: 100, period }))).toBeInstanceOf(NotFoundError);
    expect(await caught(() => issueInvoice(owner, "nope", { description: "Nobody", amount: 100, period }))).toBeInstanceOf(NotFoundError);
  });

  it("marks an open invoice paid once, and clears an overdue subscription", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();
    await withPlatform((tx) => tx.update(subscriptions).set({ status: "past_due" }).where(eq(subscriptions.tenantId, tenant.tenantId)));
    const invoice = await issueInvoice(owner, tenant.tenantId, { description: "January", amount: 4_900, period });

    const paid = await markInvoicePaid(owner, invoice.id);
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).toBeInstanceOf(Date);
    expect((await subscriptionOf(tenant.tenantId)).status).toBe("active");

    expect(await caught(() => markInvoicePaid(owner, invoice.id))).toBeInstanceOf(ConflictError);
    expect(await caught(() => voidInvoice(owner, invoice.id))).toBeInstanceOf(ConflictError);
    expect(await caught(() => markInvoicePaid(owner, randomId()))).toBeInstanceOf(NotFoundError);
  });

  it("does not revive a cancelled subscription when an old invoice is paid", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();
    const invoice = await issueInvoice(owner, tenant.tenantId, { description: "Final month", amount: 4_900, period });
    await cancelSubscription(owner, tenant.tenantId, { immediately: true });
    await markInvoicePaid(owner, invoice.id);
    expect((await subscriptionOf(tenant.tenantId)).status).toBe("cancelled");
  });

  it("voids an open invoice and keeps it out of paid totals", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();
    const invoice = await issueInvoice(owner, tenant.tenantId, { description: "Issued by mistake", amount: 9_900, period });

    expect((await voidInvoice(owner, invoice.id)).status).toBe("void");
    expect(await caught(() => markInvoicePaid(owner, invoice.id))).toBeInstanceOf(ConflictError);
    expect(await caught(() => voidInvoice(owner, invoice.id))).toBeInstanceOf(ConflictError);
    expect(await caught(() => voidInvoice(owner, randomId()))).toBeInstanceOf(NotFoundError);

    const actions = (await auditBy(owner.userId)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["invoice.issued", "invoice.voided"]));
  });

  it("lists invoices by workspace and status, newest number first", async () => {
    const owner = await createAdmin();
    const support = await createAdmin("support");
    const tenant = await createTenant();
    const other = await createTenant();
    const a = await issueInvoice(owner, tenant.tenantId, { description: "First", amount: 100, period });
    const b = await issueInvoice(owner, tenant.tenantId, { description: "Second", amount: 200, period });
    await issueInvoice(owner, other.tenantId, { description: "Elsewhere", amount: 300, period });
    await markInvoicePaid(owner, a.id);

    const all = await listInvoices(support, { tenantId: tenant.tenantId });
    expect(all.total).toBe(2);
    expect(all.items.map((invoice) => invoice.id)).toEqual([b.id, a.id]);
    expect(all.items[0]).toMatchObject({ tenantId: tenant.tenantId, tenantSlug: tenant.slug, tenantName: `Business ${tenant.slug}` });
    const elsewhere = await listInvoices(support, { tenantId: other.tenantId });
    expect(elsewhere.items).toEqual([expect.objectContaining({ tenantId: other.tenantId, tenantSlug: other.slug })]);
    expect((await listInvoices(support, { tenantId: tenant.tenantId, status: "open" })).total).toBe(1);
    expect((await listInvoices(support, { tenantId: tenant.tenantId, status: "void" })).total).toBe(0);
    expect((await listInvoices(support, { tenantId: tenant.tenantId, status: "paid" })).items.map((invoice) => invoice.id)).toEqual([a.id]);
    expect((await listInvoices(support, { tenantId: tenant.tenantId, limit: 1, offset: 1 })).items.map((invoice) => invoice.id)).toEqual([a.id]);
    expect((await listInvoices(support)).total).toBeGreaterThanOrEqual(3);
    expect(await caught(() => listInvoices(support, { status: "refunded" as never }))).toBeInstanceOf(ValidationError);

    // The tenant sees its own invoices and nobody else's.
    const seen = await withTenant(tenant.tenantId, ({ tx }) => tx.select({ id: invoices.id }).from(invoices));
    expect(seen.map((row) => row.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe("subscriptions", () => {
  it("renews from the end of the current period and invoices the plan price", async () => {
    const owner = await createAdmin();
    const tenant = await tenantOnPaidPlan({ priceMonthly: 4_900, priceYearly: 49_000, currency: "EUR" });
    const before = await subscriptionOf(tenant.tenantId);

    const { subscription, checkout } = await renewSubscription(owner, tenant.tenantId);
    expect(subscription.status).toBe("active");
    expect(subscription.currentPeriodStart.getTime()).toBe(before.currentPeriodEnd.getTime());
    const expectedEnd = new Date(before.currentPeriodEnd);
    expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 1);
    expect(subscription.currentPeriodEnd.getTime()).toBe(expectedEnd.getTime());

    expect(checkout.kind).toBe("invoice");
    if (checkout.kind !== "invoice") throw new Error("unreachable");
    expect(checkout.invoice).toMatchObject({ tenantId: tenant.tenantId, amount: 4_900, currency: "EUR", status: "open", provider: "manual" });
    expect(checkout.invoice.description).toContain("monthly");
    expect(checkout.invoice.periodStart.getTime()).toBe(subscription.currentPeriodStart.getTime());

    const audit = (await auditBy(owner.userId)).find((row) => row.action === "subscription.renewed")!;
    expect(audit).toMatchObject({ tenantId: tenant.tenantId });
    expect(audit.metadata).toMatchObject({ cycle: "monthly", billing: "invoice", provider: "manual" });
  });

  it("restarts a lapsed or cancelled subscription from now, on the requested cycle", async () => {
    const owner = await createAdmin();
    const tenant = await tenantOnPaidPlan({ priceMonthly: 4_900, priceYearly: 49_000 });
    await withPlatform((tx) =>
      tx
        .update(subscriptions)
        .set({ status: "cancelled", cancelAtPeriodEnd: true, currentPeriodEnd: new Date("2020-01-01T00:00:00Z") })
        .where(eq(subscriptions.tenantId, tenant.tenantId)),
    );

    const started = Date.now();
    const { subscription, checkout } = await renewSubscription(owner, tenant.tenantId, { cycle: "yearly" });
    expect(subscription).toMatchObject({ status: "active", cycle: "yearly", cancelAtPeriodEnd: false });
    expect(subscription.currentPeriodStart.getTime()).toBeGreaterThanOrEqual(started - 1_000);
    expect(subscription.currentPeriodEnd.getUTCFullYear()).toBe(subscription.currentPeriodStart.getUTCFullYear() + 1);
    expect(checkout.kind === "invoice" && checkout.invoice.amount).toBe(49_000);
  });

  it("renews a free plan without issuing an invoice", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();
    const { checkout } = await renewSubscription(owner, tenant.tenantId);
    expect(checkout).toEqual({ kind: "none" });
    expect((await listInvoices(owner, { tenantId: tenant.tenantId })).total).toBe(0);
  });

  it("cancels at period end by default, or immediately on request", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();

    expect(await cancelSubscription(owner, tenant.tenantId)).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    expect(await cancelSubscription(owner, tenant.tenantId, { immediately: true })).toMatchObject({ status: "cancelled", cancelAtPeriodEnd: false });
    expect(await caught(() => cancelSubscription(owner, tenant.tenantId))).toBeInstanceOf(ConflictError);
    expect((await auditBy(owner.userId)).filter((row) => row.action === "subscription.cancelled")).toHaveLength(2);
  });

  it("answers not-found without a subscription and refuses an unknown billing provider", async () => {
    const owner = await createAdmin();
    const tenant = await createTenant();
    expect(await caught(() => renewSubscription(owner, randomId()))).toBeInstanceOf(NotFoundError);
    expect(await caught(() => cancelSubscription(owner, "nope"))).toBeInstanceOf(NotFoundError);
    expect(await caught(() => renewSubscription(owner, tenant.tenantId, { cycle: "weekly" as never }))).toBeInstanceOf(ValidationError);

    await withPlatform((tx) => tx.update(subscriptions).set({ provider: "gone_gateway" }).where(eq(subscriptions.tenantId, tenant.tenantId)));
    const error = await caught(() => renewSubscription(owner, tenant.tenantId));
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe("billing_provider_unavailable");
  });

  it("requires an owner for every billing change", async () => {
    const support = await createAdmin("support");
    const tenant = await createTenant();
    expect(await caught(() => issueInvoice(support, tenant.tenantId, { description: "Nope", amount: 100, period }))).toBeInstanceOf(ForbiddenError);
    expect(await caught(() => renewSubscription(support, tenant.tenantId))).toBeInstanceOf(ForbiddenError);
    expect(await caught(() => cancelSubscription(support, tenant.tenantId))).toBeInstanceOf(ForbiddenError);
  });
});

describe("billing providers", () => {
  const registered: string[] = [];
  afterEach(() => {
    for (const id of registered.splice(0)) unregisterBillingProvider(id);
  });

  /** A stand-in payment gateway, built only from the public provider interface. */
  function fakeGateway(events: () => BillingEvent[]): BillingProvider & { cancelled: unknown[] } {
    const id = `gw_${unique("x").slice(-8)}`;
    registered.push(id);
    const cancelled: unknown[] = [];
    return {
      id,
      name: "Fake gateway",
      cancelled,
      async createCheckout(_tx, request) {
        return { kind: "redirect", url: `https://pay.example.test/${request.tenantId}`, providerRef: `cs_${request.tenantId}` };
      },
      async cancel(_tx, subscription) {
        cancelled.push(subscription);
      },
      async handleWebhook(request) {
        if (request.headers["x-signature"] !== "valid") throw new ForbiddenError("Bad signature");
        return events();
      },
    };
  }

  it("ships with the manual provider registered", async () => {
    expect(getBillingProvider("manual")).toBe(manualBillingProvider);
    expect(listBillingProviders().map((provider) => provider.id)).toContain("manual");
    // The manual provider has no external system: webhooks carry nothing.
    expect(await handleBillingWebhook("manual", { headers: {}, rawBody: "{}" })).toEqual({ received: 0, applied: 0 });
    unregisterBillingProvider("manual");
    expect(getBillingProvider("manual")).toBe(manualBillingProvider);
    expect(() => registerBillingProvider(manualBillingProvider)).toThrow(/already registered/);
    expect(() => registerBillingProvider({ ...manualBillingProvider, id: "Not Valid" })).toThrow(/Invalid billing provider id/);
    expect(await caught(() => handleBillingWebhook("unknown_gateway", { headers: {}, rawBody: "" }))).toBeInstanceOf(NotFoundError);
  });

  it("runs renewals, cancellations and webhooks through a newly registered gateway unchanged", async () => {
    const owner = await createAdmin();
    const tenant = await tenantOnPaidPlan({ priceMonthly: 7_900, priceYearly: 79_000 });
    let events: BillingEvent[] = [];
    const gateway = fakeGateway(() => events);
    registerBillingProvider(gateway);

    const providerRef = `sub_${unique("ref")}`;
    await withPlatform((tx) => tx.update(subscriptions).set({ provider: gateway.id, providerRef }).where(eq(subscriptions.tenantId, tenant.tenantId)));

    // Renewal asks the gateway, not the manual provider: no invoice is issued by us.
    const { checkout } = await renewSubscription(owner, tenant.tenantId);
    expect(checkout).toEqual({ kind: "redirect", url: `https://pay.example.test/${tenant.tenantId}`, providerRef: `cs_${tenant.tenantId}` });
    expect((await listInvoices(owner, { tenantId: tenant.tenantId })).total).toBe(0);

    // A gateway invoice arrives and is later reported as paid.
    const invoiceRef = `in_${unique("ref")}`;
    const [invoice] = await withPlatform((tx) =>
      tx
        .insert(invoices)
        .values({
          tenantId: tenant.tenantId,
          number: `GW-${unique("n")}`,
          description: "Gateway invoice",
          amount: 7_900,
          currency: "USD",
          periodStart: new Date(),
          periodEnd: new Date(),
          provider: gateway.id,
          providerRef: invoiceRef,
        })
        .returning(),
    );

    expect(await caught(() => handleBillingWebhook(gateway.id, { headers: { "x-signature": "forged" }, rawBody: "{}" }))).toBeInstanceOf(ForbiddenError);

    events = [{ type: "subscription.past_due", providerRef }];
    expect(await handleBillingWebhook(gateway.id, { headers: { "x-signature": "valid" }, rawBody: "{}" })).toEqual({ received: 1, applied: 1 });
    expect((await subscriptionOf(tenant.tenantId)).status).toBe("past_due");

    events = [{ type: "invoice.paid", providerRef: invoiceRef }];
    expect(await handleBillingWebhook(gateway.id, { headers: { "x-signature": "valid" }, rawBody: "{}" })).toEqual({ received: 1, applied: 1 });
    const [paid] = await withPlatform((tx) => tx.select().from(invoices).where(eq(invoices.id, invoice!.id)));
    expect(paid!.status).toBe("paid");
    expect((await subscriptionOf(tenant.tenantId)).status).toBe("active");

    // Redelivery, and references that match nothing, change nothing.
    events = [
      { type: "invoice.paid", providerRef: invoiceRef },
      { type: "invoice.paid", providerRef: "in_unknown" },
      { type: "subscription.cancelled", providerRef: "sub_unknown" },
    ];
    expect(await handleBillingWebhook(gateway.id, { headers: { "x-signature": "valid" }, rawBody: "{}" })).toEqual({ received: 3, applied: 0 });

    await cancelSubscription(owner, tenant.tenantId);
    expect(gateway.cancelled).toEqual([{ tenantId: tenant.tenantId, providerRef, immediately: false }]);

    events = [{ type: "subscription.cancelled", providerRef }];
    expect(await handleBillingWebhook(gateway.id, { headers: { "x-signature": "valid" }, rawBody: "{}" })).toEqual({ received: 1, applied: 1 });
    expect((await subscriptionOf(tenant.tenantId)).status).toBe("cancelled");

    // Webhook-driven changes are recorded as system events in the tenant's log.
    const log = await withPlatform((tx) => tx.select().from(auditLogs).where(eq(auditLogs.tenantId, tenant.tenantId)));
    const system = log.filter((row) => row.actorType === "system").map((row) => row.action);
    expect(system.sort()).toEqual(["invoice.paid", "subscription.cancelled", "subscription.past_due"]);
  });

  it("refuses to invoice an amount the manual provider cannot store", async () => {
    const tenant = await createTenant();
    const plan = await createPlan();
    const request = {
      tenantId: tenant.tenantId,
      plan: { id: plan.id, name: "Huge", currency: "USD" },
      cycle: "monthly" as const,
      amount: 3_000_000_000,
      periodStart: new Date(),
      periodEnd: new Date(),
    };
    expect(await caught(() => withPlatform((tx) => manualBillingProvider.createCheckout(tx, request)))).toBeInstanceOf(ValidationError);
    await withPlatform((tx) => manualBillingProvider.cancel(tx, { tenantId: tenant.tenantId, providerRef: null, immediately: true }));
  });
});
