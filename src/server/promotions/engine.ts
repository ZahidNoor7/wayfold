import "server-only";
import { and, desc, eq, exists, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { diffDays } from "../../lib/dates";
import { recordAudit } from "../audit";
import { normaliseEmail, type TenantScope } from "../db/context";
import { campaigns, campaignTours, discountRequests, personalDiscounts } from "../db/schema";
import { ConflictError } from "../errors";
import { campaignStatus } from "./campaigns";
import { formatDiscount, promotionsEnabled, tenantProfile, type DiscountType } from "./shared";

/** Everything needed to decide which discount, if any, a booking gets. */
export interface DiscountContext {
  tourId: string;
  /** Lower-cased e-mail of the person booking. */
  email: string;
  adults: number;
  children: number;
  /** Price before discount, minor units. */
  baseAmount: number;
  /** `YYYY-MM-DD` */
  travelDate: string;
  /** `YYYY-MM-DD` in the tenant's timezone. */
  today: string;
}

export interface AppliedDiscount {
  source: "campaign" | "personal" | "request";
  /** Id of the campaign, personal discount, or discount request. */
  refId: string;
  /** Customer-facing label, e.g. "Autumn harvest — 15% off". */
  label: string;
  /** Minor units, already capped at the base amount. */
  amount: number;
}

/**
 * What a discount takes off a price. A percentage is rounded to a whole minor
 * unit; a fixed amount applies once per booking and never exceeds the price.
 */
export function discountAmount(type: DiscountType, value: number, base: number): number {
  if (base <= 0 || value <= 0) return 0;
  return Math.min(base, type === "percent" ? Math.round((base * value) / 100) : value);
}

const SOURCE_ORDER: Record<AppliedDiscount["source"], number> = { campaign: 0, personal: 1, request: 2 };

/**
 * Orders candidates best first: largest amount, and on a tie campaigns, then
 * personal discounts, then approved requests, so a shared offer is spent
 * before a customer's single-use one. Candidates worth nothing are dropped.
 * Within one source the given order is kept.
 */
export function rankDiscounts<T extends Pick<AppliedDiscount, "source" | "amount">>(candidates: readonly T[]): T[] {
  return candidates
    .filter((candidate) => candidate.amount > 0)
    .sort((a, b) => b.amount - a.amount || SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]);
}

type CampaignRow = typeof campaigns.$inferSelect;

export type CampaignRules = Pick<
  CampaignRow,
  "isActive" | "startsOn" | "endsOn" | "visibility" | "assignedEmails" | "minGuests" | "minChildren" | "bookAheadDays"
>;

/**
 * Whether a campaign that covers the tour applies to this party. The window
 * constrains the day of booking; `bookAheadDays` constrains the travel date.
 */
export function campaignApplies(
  campaign: CampaignRules,
  context: Pick<DiscountContext, "email" | "adults" | "children" | "travelDate" | "today">,
): boolean {
  if (campaignStatus(campaign, context.today) !== "active") return false;
  if (campaign.visibility === "private" && (context.email === "" || !campaign.assignedEmails.includes(context.email))) return false;
  if (context.adults + context.children < campaign.minGuests) return false;
  if (context.children < campaign.minChildren) return false;
  if (campaign.bookAheadDays > 0 && diffDays(context.today, context.travelDate) < campaign.bookAheadDays) return false;
  return true;
}

interface Candidate {
  source: AppliedDiscount["source"];
  refId: string;
  name: string;
  type: DiscountType;
  value: number;
}

async function loadCandidates(scope: TenantScope, context: DiscountContext): Promise<Candidate[]> {
  if (!(await promotionsEnabled(scope))) return [];
  const { tx, tenantId } = scope;
  const email = normaliseEmail(context.email);
  const party = { ...context, email };

  const coversTour = exists(
    tx
      .select({ one: sql`1` })
      .from(campaignTours)
      .where(and(eq(campaignTours.tenantId, tenantId), eq(campaignTours.campaignId, campaigns.id), eq(campaignTours.tourId, context.tourId))),
  );
  const live = await tx
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.tenantId, tenantId),
        eq(campaigns.isActive, true),
        lte(campaigns.startsOn, context.today),
        gte(campaigns.endsOn, context.today),
        or(eq(campaigns.appliesToAllTours, true), coversTour),
      ),
    )
    .orderBy(desc(campaigns.createdAt), campaigns.id);

  const candidates: Candidate[] = live
    .filter((campaign) => campaignApplies(campaign, party))
    .map((campaign) => ({ source: "campaign", refId: campaign.id, name: campaign.name, type: campaign.type, value: campaign.value }));

  // Single-use discounts belong to an e-mail address; without one none can match.
  if (email === "") return candidates;

  const personal = await tx
    .select({ id: personalDiscounts.id, type: personalDiscounts.type, value: personalDiscounts.value })
    .from(personalDiscounts)
    .where(
      and(
        eq(personalDiscounts.tenantId, tenantId),
        eq(personalDiscounts.email, email),
        isNull(personalDiscounts.usedByBookingId),
        isNull(personalDiscounts.revokedAt),
        // No expiry date means it never expires.
        or(isNull(personalDiscounts.expiresOn), gte(personalDiscounts.expiresOn, context.today)),
        or(isNull(personalDiscounts.tourId), eq(personalDiscounts.tourId, context.tourId)),
      ),
    )
    .orderBy(personalDiscounts.createdAt, personalDiscounts.id);
  for (const row of personal) candidates.push({ source: "personal", refId: row.id, name: "Personal discount", type: row.type, value: row.value });

  const approved = await tx
    .select({
      id: discountRequests.id,
      reference: discountRequests.reference,
      type: discountRequests.decidedType,
      value: discountRequests.decidedValue,
    })
    .from(discountRequests)
    .where(
      and(
        eq(discountRequests.tenantId, tenantId),
        eq(discountRequests.email, email),
        eq(discountRequests.tourId, context.tourId),
        eq(discountRequests.status, "approved"),
        isNull(discountRequests.usedByBookingId),
        isNotNull(discountRequests.decidedType),
        isNotNull(discountRequests.decidedValue),
      ),
    )
    .orderBy(discountRequests.createdAt, discountRequests.id);
  for (const row of approved) {
    candidates.push({ source: "request", refId: row.id, name: `Approved request ${row.reference}`, type: row.type!, value: row.value! });
  }
  return candidates;
}

/**
 * Every discount this booking qualifies for, best first. Only the first is
 * ever applied; the rest let a screen say how many offers were beaten.
 */
export async function findEligibleDiscounts(scope: TenantScope, context: DiscountContext): Promise<AppliedDiscount[]> {
  const candidates = await loadCandidates(scope, context);
  if (candidates.length === 0) return [];
  const { currency } = await tenantProfile(scope);
  return rankDiscounts(
    candidates.map((candidate) => ({
      source: candidate.source,
      refId: candidate.refId,
      label: `${candidate.name} — ${formatDiscount(candidate.type, candidate.value, currency)}`,
      amount: discountAmount(candidate.type, candidate.value, context.baseAmount),
    })),
  );
}

/**
 * Returns the single best discount for a booking, or null. Only one discount
 * ever applies; ties prefer campaigns, then personal discounts, then requests.
 */
export async function findBestDiscount(scope: TenantScope, context: DiscountContext): Promise<AppliedDiscount | null> {
  const [best] = await findEligibleDiscounts(scope, context);
  return best ?? null;
}

const NO_LONGER_AVAILABLE = "That discount is no longer available. Please review the price and try again.";

/**
 * Marks a discount as used by a booking, inside the booking's transaction:
 * single-use discounts are consumed atomically, campaign use counts go up.
 */
export async function consumeDiscount(scope: TenantScope, applied: AppliedDiscount, bookingId: string): Promise<void> {
  const { tx, tenantId } = scope;

  if (applied.source === "campaign") {
    const counted = await tx
      .update(campaigns)
      .set({ uses: sql`${campaigns.uses} + 1` })
      .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, applied.refId)))
      .returning({ id: campaigns.id });
    // Deleted between the quote and the booking: the price must be recomputed.
    if (counted.length === 0) throw new ConflictError(NO_LONGER_AVAILABLE);
    return;
  }

  // The `is null` guard is what makes the discount single-use: of two bookings
  // racing for it, the second waits for the first, sees it taken and updates
  // no row. Throwing rolls that booking back.
  const claimed =
    applied.source === "personal"
      ? await tx
          .update(personalDiscounts)
          .set({ usedByBookingId: bookingId })
          .where(
            and(
              eq(personalDiscounts.tenantId, tenantId),
              eq(personalDiscounts.id, applied.refId),
              isNull(personalDiscounts.usedByBookingId),
              isNull(personalDiscounts.revokedAt),
            ),
          )
          .returning({ id: personalDiscounts.id })
      : await tx
          .update(discountRequests)
          .set({ usedByBookingId: bookingId })
          .where(
            and(
              eq(discountRequests.tenantId, tenantId),
              eq(discountRequests.id, applied.refId),
              eq(discountRequests.status, "approved"),
              isNull(discountRequests.usedByBookingId),
            ),
          )
          .returning({ id: discountRequests.id });
  if (claimed.length === 0) throw new ConflictError(NO_LONGER_AVAILABLE);

  await recordAudit(scope, {
    action: "promotions.discount_redeemed",
    targetType: applied.source === "personal" ? "personal_discount" : "discount_request",
    targetId: applied.refId,
    metadata: { bookingId, amount: applied.amount },
  });
}
