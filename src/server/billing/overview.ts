import "server-only";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import { withoutTenant, type TenantScope } from "../db/context";
import { invoices, plans, subscriptions, type PlanFeatures } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import type { Permission } from "../rbac/permissions";
import { getEntitlements, type Entitlements, type LimitKey } from "./limits";
import { getUsage, type Usage, type UsageOptions } from "./usage";

export interface PlanView {
  id: string;
  code: string;
  name: string;
  description: string;
  /** Minor units. */
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  /** `null` = unlimited. The plan's own limits, before any per-workspace override. */
  limits: Record<LimitKey, number | null>;
  features: PlanFeatures;
}

export interface SubscriptionView {
  status: "trialing" | "active" | "past_due" | "cancelled";
  cycle: "monthly" | "yearly";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

export interface UsageMeter {
  used: number;
  /** `null` = unlimited. */
  limit: number | null;
  /** One decimal place; above 100 when over the allowance; `null` when unlimited. */
  percent: number | null;
}

export interface InvoiceView {
  id: string;
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
}

export interface InvoicePage {
  items: InvoiceView[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface BillingOverview {
  plan: PlanView;
  /** Null only for a workspace the platform has not given a subscription yet. */
  subscription: SubscriptionView | null;
  entitlements: Entitlements;
  usage: Usage;
  /** Usage against the effective limits, in the unit each limit is sold in. */
  meters: Record<LimitKey, UsageMeter>;
  invoices: InvoicePage;
}

const planColumns = {
  id: plans.id,
  code: plans.code,
  name: plans.name,
  description: plans.description,
  priceMonthly: plans.priceMonthly,
  priceYearly: plans.priceYearly,
  currency: plans.currency,
  maxTeamMembers: plans.maxTeamMembers,
  maxPublishedTours: plans.maxPublishedTours,
  maxStorageMb: plans.maxStorageMb,
  maxBookingsPerMonth: plans.maxBookingsPerMonth,
  features: plans.features,
};

type PlanRow = Omit<PlanView, "limits"> & Record<LimitKey, number | null>;

function toPlanView({ maxTeamMembers, maxPublishedTours, maxStorageMb, maxBookingsPerMonth, ...row }: PlanRow): PlanView {
  return { ...row, limits: { maxTeamMembers, maxPublishedTours, maxStorageMb, maxBookingsPerMonth } };
}

const invoiceColumns = {
  id: invoices.id,
  number: invoices.number,
  description: invoices.description,
  amount: invoices.amount,
  currency: invoices.currency,
  status: invoices.status,
  periodStart: invoices.periodStart,
  periodEnd: invoices.periodEnd,
  issuedAt: invoices.issuedAt,
  paidAt: invoices.paidAt,
};

export const listInvoicesSchema = z.object({
  page: z.int().min(1).max(10_000).default(1),
  pageSize: z.int().min(1).max(100).default(20),
});
export type ListInvoicesInput = z.input<typeof listInvoicesSchema>;

function parsePaging(raw: ListInvoicesInput): z.output<typeof listInvoicesSchema> {
  const result = listInvoicesSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(undefined, z.flattenError(result.error).fieldErrors as Record<string, string[]>);
  }
  return result.data;
}

/** The workspace's invoices, newest first. */
export async function listInvoices(scope: TenantScope, raw: ListInvoicesInput = {}): Promise<InvoicePage> {
  const { page, pageSize } = parsePaging(raw);
  const [counted] = await scope.tx.select({ n: count() }).from(invoices).where(eq(invoices.tenantId, scope.tenantId));
  const items = await scope.tx
    .select(invoiceColumns)
    .from(invoices)
    .where(eq(invoices.tenantId, scope.tenantId))
    .orderBy(desc(invoices.issuedAt), desc(invoices.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const total = counted?.n ?? 0;
  return { items, total, page, pageSize, pageCount: Math.ceil(total / pageSize) };
}

export async function getInvoice(scope: TenantScope, invoiceId: string): Promise<InvoiceView> {
  // A malformed id cannot name an invoice; answer exactly as for a foreign one.
  if (!z.uuid().safeParse(invoiceId).success) throw new NotFoundError("Invoice");
  const [row] = await scope.tx
    .select(invoiceColumns)
    .from(invoices)
    .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, invoiceId)))
    .limit(1);
  if (!row) throw new NotFoundError("Invoice");
  return row;
}

const BYTES_PER_MB = 1024 * 1024;

export function meter(used: number, limit: number | null): UsageMeter {
  if (limit === null) return { used, limit, percent: null };
  // A zero allowance is full as soon as anything is used.
  if (limit <= 0) return { used, limit, percent: used > 0 ? 100 : 0 };
  return { used, limit, percent: Math.round((used / limit) * 1000) / 10 };
}

export interface BillingOverviewOptions extends UsageOptions {
  invoices?: ListInvoicesInput;
}

/**
 * Everything the billing page shows: plan, subscription, what the workspace
 * is entitled to, how much of it is used, and its invoices. Read-only; the
 * runtime database role cannot write any of these tables.
 */
export async function getBillingOverview(scope: TenantScope, options: BillingOverviewOptions): Promise<BillingOverview> {
  const entitlements = await getEntitlements(scope);
  const usage = await getUsage(scope, options);

  const [plan] = await scope.tx.select(planColumns).from(plans).where(eq(plans.id, entitlements.plan.id)).limit(1);
  if (!plan) throw new ForbiddenError("This workspace is not available.");

  const [subscription] = await scope.tx
    .select({
      status: subscriptions.status,
      cycle: subscriptions.cycle,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, scope.tenantId))
    .limit(1);

  const { limits } = entitlements;
  return {
    plan: toPlanView(plan),
    subscription: subscription ?? null,
    entitlements,
    usage,
    meters: {
      // Seats, as the invitation limit counts them: members plus pending invitations.
      maxTeamMembers: meter(usage.teamMembers + usage.pendingInvitations, limits.maxTeamMembers),
      maxPublishedTours: meter(usage.publishedTours, limits.maxPublishedTours),
      maxStorageMb: meter(Math.round((usage.storageBytes / BYTES_PER_MB) * 100) / 100, limits.maxStorageMb),
      maxBookingsPerMonth: meter(usage.bookingsThisMonth, limits.maxBookingsPerMonth),
    },
    invoices: await listInvoices(scope, options.invoices),
  };
}

/**
 * Plans offered in the plan picker. `plans` is a global, read-only table for
 * the runtime role, so this needs no workspace.
 */
export async function listPublicPlans(): Promise<PlanView[]> {
  const rows = await withoutTenant((tx) =>
    tx.select(planColumns).from(plans).where(eq(plans.isPublic, true)).orderBy(asc(plans.sortOrder), asc(plans.priceMonthly), asc(plans.code)),
  );
  return rows.map(toPlanView);
}

export interface BillingActor {
  userId: string;
  permissions: readonly Permission[];
  isOwner: boolean;
}

const planCodeSchema = z.string().trim().min(1).max(64);

/**
 * Records that the workspace asked to move to another plan and returns that
 * plan. Nothing changes here: plan, limits and subscription are written by
 * the platform alone, and the runtime database role has no privilege to
 * write them even if this code tried.
 */
export async function requestPlanChange(scope: TenantScope, actor: BillingActor, planCode: string): Promise<PlanView> {
  if (!actor.isOwner && !actor.permissions.includes("billing.manage")) throw new ForbiddenError();
  const code = planCodeSchema.safeParse(planCode);
  if (!code.success) throw new ValidationError(undefined, { planCode: ["Choose a plan."] });

  const [target] = await scope.tx
    .select(planColumns)
    .from(plans)
    .where(and(eq(plans.code, code.data), eq(plans.isPublic, true)))
    .limit(1);
  // Private plans are arranged by the platform; from here they do not exist.
  if (!target) throw new NotFoundError("Plan");

  const { plan: current } = await getEntitlements(scope);
  if (current.id === target.id) throw new ConflictError("Your workspace is already on this plan.", "same_plan");

  await recordAudit(scope, {
    action: "billing.plan_change_requested",
    targetType: "plan",
    targetId: target.id,
    metadata: { fromPlan: current.code, toPlan: target.code, requestedBy: actor.userId },
  });
  return toPlanView(target);
}
