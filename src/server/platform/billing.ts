import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { isIsoDate } from "../../lib/dates";
import { invoices, plans, subscriptions, tenants } from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { asPlatform, parse, requireId, type PlatformActor, type PlatformTx } from "./access";
import { recordPlatformAudit } from "./audit";
import { withPlatform } from "./db";

type InvoiceRow = typeof invoices.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;
export type BillingCycle = "monthly" | "yearly";

export interface InvoiceView {
  id: string;
  tenantId: string;
  /** `INV-YYYY-NNNNNN`, sequential within the year. */
  number: string;
  description: string;
  /** Minor units. */
  amount: number;
  currency: string;
  status: "open" | "paid" | "void";
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  paidAt: Date | null;
  provider: string;
}

export interface SubscriptionView {
  tenantId: string;
  planId: string;
  status: "trialing" | "active" | "past_due" | "cancelled";
  cycle: BillingCycle;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  provider: string;
}

function toInvoiceView(row: InvoiceRow): InvoiceView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    number: row.number,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    issuedAt: row.issuedAt,
    paidAt: row.paidAt,
    provider: row.provider,
  };
}

function toSubscriptionView(row: SubscriptionRow): SubscriptionView {
  return {
    tenantId: row.tenantId,
    planId: row.planId,
    status: row.status,
    cycle: row.cycle,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    provider: row.provider,
  };
}

/* -------------------------------------------------------------- providers */

export interface CheckoutRequest {
  tenantId: string;
  plan: { id: string; name: string; currency: string };
  cycle: BillingCycle;
  /** Minor units for the whole period. */
  amount: number;
  periodStart: Date;
  periodEnd: Date;
}

export type CheckoutResult =
  /** Nothing to collect (a free plan). */
  | { kind: "none" }
  /** An invoice was issued and awaits payment. */
  | { kind: "invoice"; invoice: InvoiceView }
  /** The customer has to finish payment on the provider's hosted page. */
  | { kind: "redirect"; url: string; providerRef: string };

/** What a provider tells us happened, in provider-neutral terms. */
export type BillingEvent =
  | { type: "invoice.paid"; providerRef: string }
  | { type: "subscription.past_due"; providerRef: string }
  | { type: "subscription.cancelled"; providerRef: string };

export interface BillingWebhookRequest {
  headers: Record<string, string>;
  /** Exactly as received: signatures are computed over the raw bytes. */
  rawBody: string;
}

/**
 * A way of collecting subscription payments. Subscription and invoice state
 * live in this module; a provider only starts a payment, cancels on its side,
 * and translates its webhooks into `BillingEvent`s. Adding a gateway means
 * registering one object: nothing below changes.
 */
export interface BillingProvider {
  id: string;
  name: string;
  /** Starts collecting payment for one billing period. */
  createCheckout(tx: PlatformTx, request: CheckoutRequest): Promise<CheckoutResult>;
  /** Stops future charges on the provider's side. */
  cancel(tx: PlatformTx, subscription: { tenantId: string; providerRef: string | null; immediately: boolean }): Promise<void>;
  /** Verifies a webhook's authenticity and returns the events it carries. Must throw when it is not genuine. */
  handleWebhook(request: BillingWebhookRequest): Promise<BillingEvent[]>;
}

const providers = new Map<string, BillingProvider>();

export function registerBillingProvider(provider: BillingProvider): void {
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(provider.id)) throw new Error(`Invalid billing provider id: ${provider.id}`);
  if (providers.has(provider.id)) throw new Error(`Billing provider ${provider.id} is already registered`);
  providers.set(provider.id, provider);
}

export function getBillingProvider(id: string): BillingProvider | undefined {
  return providers.get(id);
}

export function listBillingProviders(): BillingProvider[] {
  return [...providers.values()];
}

/** Test hook. */
export function unregisterBillingProvider(id: string): void {
  if (id !== manualBillingProvider.id) providers.delete(id);
}

function requireProvider(id: string): BillingProvider {
  const provider = providers.get(id);
  if (!provider) throw new ConflictError("This subscription uses a billing provider that is not available.", "billing_provider_unavailable");
  return provider;
}

/* --------------------------------------------------------------- invoices */

const MAX_AMOUNT = 2_000_000_000;

/** Invoice numbers are a gapless-looking sequence per year, so issuing is serialised. */
async function nextInvoiceNumber(tx: PlatformTx, now: Date): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('wayfold:invoice-number'))`);
  const prefix = `INV-${now.getUTCFullYear()}-`;
  // Only numbers of exactly this shape take part, so a hand-entered or imported number cannot derail the sequence.
  const result = await tx.execute<{ last: string | null }>(
    sql`select max(number) as last from invoices where number ~ ${`^${prefix}[0-9]{6}$`}`,
  );
  const last = result.rows[0]?.last;
  const next = last ? Number(last.slice(prefix.length)) + 1 : 1;
  if (next > 999_999) throw new ConflictError("The invoice sequence for this year is exhausted.");
  return `${prefix}${String(next).padStart(6, "0")}`;
}

interface NewInvoice {
  tenantId: string;
  description: string;
  amount: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  provider: string;
  providerRef?: string | null;
}

async function insertInvoice(tx: PlatformTx, invoice: NewInvoice): Promise<InvoiceRow> {
  const now = new Date();
  const [row] = (await tx
    .insert(invoices)
    .values({ ...invoice, number: await nextInvoiceNumber(tx, now), issuedAt: now })
    .returning()) as [InvoiceRow];
  return row;
}

const isoDate = z.string().refine(isIsoDate, "Use a date like 2026-01-31.");

export const issueInvoiceSchema = z.object({
  description: z.string().trim().min(3, "Describe what is being invoiced.").max(200),
  amount: z.number().int("Use whole minor units.").min(1, "The amount must be more than zero.").max(MAX_AMOUNT),
  /** Inclusive calendar dates the invoice covers. */
  period: z
    .object({ start: isoDate, end: isoDate })
    .refine((period) => period.end >= period.start, { path: ["end"], message: "The period cannot end before it starts." }),
  /** Defaults to the currency of the workspace's plan. */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.")
    .optional(),
});
export type IssueInvoiceInput = z.input<typeof issueInvoiceSchema>;

async function requireTenantPlan(tx: PlatformTx, tenantId: string) {
  requireId(tenantId, "Tenant");
  const [row] = await tx
    .select({ tenantId: tenants.id, planId: plans.id, planName: plans.name, currency: plans.currency })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!row) throw new NotFoundError("Tenant");
  return row;
}

/** Issues an open invoice to a workspace. The platform owner marks it paid once money arrives. */
export async function issueInvoice(admin: PlatformActor, tenantId: string, input: IssueInvoiceInput): Promise<InvoiceView> {
  return asPlatform(admin, "owner", async (tx) => {
    const data = parse(issueInvoiceSchema, input);
    const tenant = await requireTenantPlan(tx, tenantId);

    const row = await insertInvoice(tx, {
      tenantId,
      description: data.description,
      amount: data.amount,
      currency: data.currency ?? tenant.currency,
      periodStart: new Date(`${data.period.start}T00:00:00Z`),
      periodEnd: new Date(`${data.period.end}T00:00:00Z`),
      provider: manualBillingProvider.id,
    });
    await recordPlatformAudit(tx, {
      admin,
      action: "invoice.issued",
      tenantId,
      targetType: "invoice",
      targetId: row.id,
      metadata: { number: row.number, amount: row.amount, currency: row.currency },
    });
    return toInvoiceView(row);
  });
}

async function requireInvoice(tx: PlatformTx, id: string): Promise<InvoiceRow> {
  requireId(id, "Invoice");
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1).for("update");
  if (!row) throw new NotFoundError("Invoice");
  return row;
}

/** Shared by the manual "mark paid" button and by provider webhooks. */
async function settleInvoice(tx: PlatformTx, invoice: InvoiceRow): Promise<InvoiceRow> {
  const [paid] = (await tx.update(invoices).set({ status: "paid", paidAt: new Date() }).where(eq(invoices.id, invoice.id)).returning()) as [
    InvoiceRow,
  ];
  // Money arriving clears an overdue subscription; other states are left alone.
  await tx
    .update(subscriptions)
    .set({ status: "active" })
    .where(and(eq(subscriptions.tenantId, invoice.tenantId), eq(subscriptions.status, "past_due")));
  return paid;
}

export async function markInvoicePaid(admin: PlatformActor, invoiceId: string): Promise<InvoiceView> {
  return asPlatform(admin, "owner", async (tx) => {
    const invoice = await requireInvoice(tx, invoiceId);
    if (invoice.status !== "open") throw new ConflictError(`This invoice is already ${invoice.status}.`);
    const paid = await settleInvoice(tx, invoice);
    await recordPlatformAudit(tx, {
      admin,
      action: "invoice.paid",
      tenantId: invoice.tenantId,
      targetType: "invoice",
      targetId: invoice.id,
      metadata: { number: invoice.number, amount: invoice.amount, currency: invoice.currency },
    });
    return toInvoiceView(paid);
  });
}

/** Cancels an unpaid invoice. A paid invoice is a financial record and cannot be voided. */
export async function voidInvoice(admin: PlatformActor, invoiceId: string): Promise<InvoiceView> {
  return asPlatform(admin, "owner", async (tx) => {
    const invoice = await requireInvoice(tx, invoiceId);
    if (invoice.status !== "open") throw new ConflictError(`This invoice is already ${invoice.status}.`);
    const [voided] = (await tx.update(invoices).set({ status: "void" }).where(eq(invoices.id, invoice.id)).returning()) as [InvoiceRow];
    await recordPlatformAudit(tx, {
      admin,
      action: "invoice.voided",
      tenantId: invoice.tenantId,
      targetType: "invoice",
      targetId: invoice.id,
      metadata: { number: invoice.number },
    });
    return toInvoiceView(voided);
  });
}

export const listInvoicesSchema = z.object({
  tenantId: z.uuid().optional(),
  status: z.enum(["open", "paid", "void"]).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});
export type ListInvoicesInput = z.input<typeof listInvoicesSchema>;

/** An invoice as the platform's billing list shows it: with the workspace it was issued to. */
export interface InvoiceListItem extends InvoiceView {
  tenantName: string;
  tenantSlug: string;
}

/** Invoices across workspaces, newest number first. */
export async function listInvoices(admin: PlatformActor, input: ListInvoicesInput = {}): Promise<{ items: InvoiceListItem[]; total: number }> {
  return asPlatform(admin, "support", async (tx) => {
    const query = parse(listInvoicesSchema, input);
    const filters: SQL[] = [];
    if (query.tenantId) filters.push(eq(invoices.tenantId, query.tenantId));
    if (query.status) filters.push(eq(invoices.status, query.status));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await tx
      .select({ invoice: invoices, tenantName: tenants.name, tenantSlug: tenants.slug })
      .from(invoices)
      .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
      .where(where)
      .orderBy(desc(invoices.number), desc(invoices.id))
      .limit(query.limit)
      .offset(query.offset);
    const [counted] = await tx.select({ n: sql<number>`count(*)::int` }).from(invoices).where(where);
    return {
      items: rows.map((row) => ({ ...toInvoiceView(row.invoice), tenantName: row.tenantName, tenantSlug: row.tenantSlug })),
      total: counted?.n ?? 0,
    };
  });
}

/* ---------------------------------------------------------- subscriptions */

async function requireSubscription(tx: PlatformTx, tenantId: string): Promise<SubscriptionRow> {
  requireId(tenantId, "Tenant");
  const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1).for("update");
  if (!row) throw new NotFoundError("Subscription");
  return row;
}

function addCycle(from: Date, cycle: BillingCycle): Date {
  const next = new Date(from);
  if (cycle === "yearly") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export const renewSubscriptionSchema = z.object({ cycle: z.enum(["monthly", "yearly"]).optional() });
export type RenewSubscriptionInput = z.input<typeof renewSubscriptionSchema>;

/**
 * Starts the next billing period. It follows straight on from the current one
 * (or from now, if that has already lapsed), re-activates the subscription,
 * and asks the subscription's billing provider to collect for the new period.
 */
export async function renewSubscription(
  admin: PlatformActor,
  tenantId: string,
  input: RenewSubscriptionInput = {},
): Promise<{ subscription: SubscriptionView; checkout: CheckoutResult }> {
  return asPlatform(admin, "owner", async (tx) => {
    const data = parse(renewSubscriptionSchema, input);
    const current = await requireSubscription(tx, tenantId);
    const provider = requireProvider(current.provider);

    const [plan] = await tx.select().from(plans).where(eq(plans.id, current.planId)).limit(1);
    const cycle = data.cycle ?? current.cycle;
    const now = new Date();
    const periodStart = current.currentPeriodEnd > now ? current.currentPeriodEnd : now;
    const periodEnd = addCycle(periodStart, cycle);

    const [updated] = (await tx
      .update(subscriptions)
      .set({ status: "active", cycle, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false })
      .where(eq(subscriptions.tenantId, tenantId))
      .returning()) as [SubscriptionRow];

    const checkout = await provider.createCheckout(tx, {
      tenantId,
      plan: { id: plan!.id, name: plan!.name, currency: plan!.currency },
      cycle,
      amount: cycle === "yearly" ? plan!.priceYearly : plan!.priceMonthly,
      periodStart,
      periodEnd,
    });

    await recordPlatformAudit(tx, {
      admin,
      action: "subscription.renewed",
      tenantId,
      targetType: "subscription",
      targetId: tenantId,
      metadata: { cycle, periodEnd, billing: checkout.kind, provider: provider.id },
    });
    return { subscription: toSubscriptionView(updated), checkout };
  });
}

/** Ends a subscription now, or (the default) lets it run to the end of the paid period. */
export async function cancelSubscription(
  admin: PlatformActor,
  tenantId: string,
  options: { immediately?: boolean } = {},
): Promise<SubscriptionView> {
  return asPlatform(admin, "owner", async (tx) => {
    const immediately = options.immediately === true;
    const current = await requireSubscription(tx, tenantId);
    if (current.status === "cancelled") throw new ConflictError("This subscription is already cancelled.");
    await requireProvider(current.provider).cancel(tx, { tenantId, providerRef: current.providerRef, immediately });

    const [updated] = (await tx
      .update(subscriptions)
      .set(immediately ? { status: "cancelled", cancelAtPeriodEnd: false } : { cancelAtPeriodEnd: true })
      .where(eq(subscriptions.tenantId, tenantId))
      .returning()) as [SubscriptionRow];
    await recordPlatformAudit(tx, {
      admin,
      action: "subscription.cancelled",
      tenantId,
      targetType: "subscription",
      targetId: tenantId,
      metadata: { immediately },
    });
    return toSubscriptionView(updated);
  });
}

/* --------------------------------------------------------------- webhooks */

async function applyBillingEvent(tx: PlatformTx, providerId: string, event: BillingEvent): Promise<boolean> {
  if (event.type === "invoice.paid") {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.provider, providerId), eq(invoices.providerRef, event.providerRef)))
      .limit(1)
      .for("update");
    // Providers redeliver webhooks; an invoice that is no longer open has been handled already.
    if (!invoice || invoice.status !== "open") return false;
    await settleInvoice(tx, invoice);
    await recordPlatformAudit(tx, {
      admin: null,
      action: "invoice.paid",
      tenantId: invoice.tenantId,
      targetType: "invoice",
      targetId: invoice.id,
      metadata: { number: invoice.number, provider: providerId },
    });
    return true;
  }

  const status = event.type === "subscription.cancelled" ? "cancelled" : "past_due";
  const [subscription] = await tx
    .update(subscriptions)
    .set({ status })
    .where(and(eq(subscriptions.provider, providerId), eq(subscriptions.providerRef, event.providerRef), sql`${subscriptions.status} <> ${status}`))
    .returning({ tenantId: subscriptions.tenantId });
  if (!subscription) return false;
  await recordPlatformAudit(tx, {
    admin: null,
    action: event.type,
    tenantId: subscription.tenantId,
    targetType: "subscription",
    targetId: subscription.tenantId,
    metadata: { provider: providerId },
  });
  return true;
}

/**
 * System-only (webhook route): hands a provider's webhook to that provider
 * for verification, then applies the events it reports. Returns how many
 * events changed anything; redeliveries change nothing.
 */
export async function handleBillingWebhook(providerId: string, request: BillingWebhookRequest): Promise<{ received: number; applied: number }> {
  const provider = providers.get(providerId);
  if (!provider) throw new NotFoundError("Billing provider");
  const events = await provider.handleWebhook(request);
  if (events.length === 0) return { received: 0, applied: 0 };

  return withPlatform(async (tx) => {
    let applied = 0;
    for (const event of events) {
      if (await applyBillingEvent(tx, provider.id, event)) applied += 1;
    }
    return { received: events.length, applied };
  });
}

/* ----------------------------------------------------------------- manual */

/**
 * Billing without a payment gateway: the platform owner issues invoices and
 * marks them paid when the money arrives (bank transfer, cash, an external
 * tool). Complete on its own, and the default for every new subscription.
 */
export const manualBillingProvider: BillingProvider = {
  id: "manual",
  name: "Manual invoicing",

  async createCheckout(tx, request) {
    if (request.amount <= 0) return { kind: "none" };
    if (request.amount > MAX_AMOUNT) throw new ValidationError("That amount is too large to invoice.");
    const day = (date: Date) => date.toISOString().slice(0, 10);
    const row = await insertInvoice(tx, {
      tenantId: request.tenantId,
      description: `${request.plan.name} plan, ${request.cycle} (${day(request.periodStart)} to ${day(request.periodEnd)})`,
      amount: request.amount,
      currency: request.plan.currency,
      periodStart: request.periodStart,
      periodEnd: request.periodEnd,
      provider: "manual",
    });
    return { kind: "invoice", invoice: toInvoiceView(row) };
  },

  // Nothing is charged automatically, so there is nothing to stop on a provider's side.
  async cancel() {},

  // No external system reports on manual invoices; payment is recorded with markInvoicePaid.
  async handleWebhook() {
    return [];
  },
};

registerBillingProvider(manualBillingProvider);
