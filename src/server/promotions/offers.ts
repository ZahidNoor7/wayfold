import "server-only";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { TenantScope } from "../db/context";
import { campaigns, campaignTours, tours } from "../db/schema";
import { getPromotionSettings } from "../settings/tenant-settings";
import { discountAmount } from "./engine";
import { promotionsEnabled, type DiscountType } from "./shared";

type CampaignRow = typeof campaigns.$inferSelect;

export interface PublicOfferTour {
  id: string;
  slug: string;
  title: string;
  /** List price for one adult, minor units. */
  priceAdult: number;
  /**
   * What one adult pays under this offer, or null when no honest per-adult
   * price exists: a fixed amount applies once per booking, and a conditional
   * offer only applies to parties that meet its conditions.
   */
  discountedPriceAdult: number | null;
}

/** What the public may know about a campaign. No audience, no code, no use count. */
export interface PublicOffer {
  id: string;
  name: string;
  blurb: string;
  type: DiscountType;
  value: number;
  startsOn: string;
  endsOn: string;
  appliesToAllTours: boolean;
  /** Zero means no such condition. */
  minGuests: number;
  minChildren: number;
  bookAheadDays: number;
  /** True when any of the three conditions is set. */
  isConditional: boolean;
  /** Published tours the offer covers. */
  tours: PublicOfferTour[];
}

interface PublishedTour {
  id: string;
  slug: string;
  title: string;
  priceAdult: number;
}

function isConditional(campaign: Pick<CampaignRow, "minGuests" | "minChildren" | "bookAheadDays">): boolean {
  return campaign.minGuests > 0 || campaign.minChildren > 0 || campaign.bookAheadDays > 0;
}

/** Campaigns that are switched on, inside their window today, and public. Newest first. */
async function activePublicCampaigns(scope: TenantScope, today: string): Promise<CampaignRow[]> {
  if (!(await promotionsEnabled(scope))) return [];
  return scope.tx
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.tenantId, scope.tenantId),
        eq(campaigns.isActive, true),
        eq(campaigns.visibility, "public"),
        lte(campaigns.startsOn, today),
        gte(campaigns.endsOn, today),
      ),
    )
    .orderBy(desc(campaigns.createdAt), campaigns.id);
}

/** Tour ids each campaign is limited to. Campaigns covering all tours have no entry. */
async function tourScopes(scope: TenantScope, rows: CampaignRow[]): Promise<Map<string, Set<string>>> {
  const scoped = rows.filter((row) => !row.appliesToAllTours).map((row) => row.id);
  const byCampaign = new Map<string, Set<string>>();
  if (scoped.length === 0) return byCampaign;
  const links = await scope.tx
    .select({ campaignId: campaignTours.campaignId, tourId: campaignTours.tourId })
    .from(campaignTours)
    .where(and(eq(campaignTours.tenantId, scope.tenantId), inArray(campaignTours.campaignId, scoped)));
  for (const link of links) byCampaign.set(link.campaignId, (byCampaign.get(link.campaignId) ?? new Set()).add(link.tourId));
  return byCampaign;
}

function publishedTours(scope: TenantScope, ids?: string[]): Promise<PublishedTour[]> {
  return scope.tx
    .select({ id: tours.id, slug: tours.slug, title: tours.title, priceAdult: tours.priceAdult })
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.status, "published"), ids ? inArray(tours.id, ids) : undefined))
    .orderBy(tours.sortOrder, tours.title);
}

/**
 * Live public offers for the Offers page, each with the published tours it
 * covers. An offer whose tours are all unpublished is left out, so the list
 * and the navigation count never advertise something that cannot be booked.
 */
export async function listPublicOffers(scope: TenantScope, today: string): Promise<PublicOffer[]> {
  const rows = await activePublicCampaigns(scope, today);
  if (rows.length === 0) return [];
  const [scopes, catalogue] = [await tourScopes(scope, rows), await publishedTours(scope)];

  return rows
    .map((row) => {
      const conditional = isConditional(row);
      const covered = row.appliesToAllTours ? catalogue : catalogue.filter((tour) => scopes.get(row.id)?.has(tour.id));
      return {
        id: row.id,
        name: row.name,
        blurb: row.blurb,
        type: row.type,
        value: row.value,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        appliesToAllTours: row.appliesToAllTours,
        minGuests: row.minGuests,
        minChildren: row.minChildren,
        bookAheadDays: row.bookAheadDays,
        isConditional: conditional,
        tours: covered.map((tour) => ({
          ...tour,
          discountedPriceAdult:
            row.type === "percent" && !conditional ? tour.priceAdult - discountAmount("percent", row.value, tour.priceAdult) : null,
        })),
      };
    })
    .filter((offer) => offer.tours.length > 0);
}

/** Number of live public offers, for the navigation badge. Matches `listPublicOffers`. */
export async function countPublicOffers(scope: TenantScope, today: string): Promise<number> {
  return (await listPublicOffers(scope, today)).length;
}

export interface PublicTourPrice {
  tourId: string;
  /** List price for one adult, minor units. */
  priceAdult: number;
  /**
   * The "from" price to show struck against the list price, or null when the
   * list price stands: no offer, or a fixed offer (which comes off the booking,
   * not off each adult).
   */
  discountedPriceAdult: number | null;
  /** The offer behind the badge, if any. */
  offer: { id: string; name: string; type: DiscountType; value: number; endsOn: string } | null;
}

/**
 * Card pricing for tour lists. Only unconditional public campaigns count: a
 * price that needs six guests, a child, or booking weeks ahead is not a price
 * every visitor can get, so it is never shown as one. The best offer is the
 * one worth most on a single adult ticket; newest wins a tie. Ids that are
 * not this tenant's published tours are simply absent from the result.
 */
export async function bestPublicPriceFor(scope: TenantScope, tourIds: readonly string[], today: string): Promise<Record<string, PublicTourPrice>> {
  const result: Record<string, PublicTourPrice> = {};
  if (tourIds.length === 0) return result;

  const catalogue = await publishedTours(scope, [...new Set(tourIds)]);
  if (catalogue.length === 0) return result;
  const unconditional = (await activePublicCampaigns(scope, today)).filter((row) => !isConditional(row));
  const scopes = await tourScopes(scope, unconditional);

  for (const tour of catalogue) {
    let best: { campaign: CampaignRow; amount: number } | null = null;
    for (const campaign of unconditional) {
      if (!campaign.appliesToAllTours && !scopes.get(campaign.id)?.has(tour.id)) continue;
      const amount = discountAmount(campaign.type, campaign.value, tour.priceAdult);
      if (amount > 0 && (!best || amount > best.amount)) best = { campaign, amount };
    }
    result[tour.id] = {
      tourId: tour.id,
      priceAdult: tour.priceAdult,
      discountedPriceAdult: best?.campaign.type === "percent" ? tour.priceAdult - best.amount : null,
      offer: best
        ? { id: best.campaign.id, name: best.campaign.name, type: best.campaign.type, value: best.campaign.value, endsOn: best.campaign.endsOn }
        : null,
    };
  }
  return result;
}

/** The only promotion settings a storefront may see. The request maximum is never among them. */
export async function getPublicRequestSettings(scope: TenantScope): Promise<{ requestsEnabled: boolean; responseDays: number }> {
  const { requestsEnabled, responseDays } = await getPromotionSettings(scope);
  return { requestsEnabled, responseDays };
}
