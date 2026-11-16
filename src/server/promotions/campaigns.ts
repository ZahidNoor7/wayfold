import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import { assertFeature } from "../billing/limits";
import type { TenantScope } from "../db/context";
import { campaigns, campaignTours, tours } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import {
  checkPercentCap,
  discountTypeSchema,
  discountValueSchema,
  emailSchema,
  FOREIGN_KEY_VIOLATION,
  isoDateSchema,
  parse,
  pgError,
  type DiscountType,
} from "./shared";

type Row = typeof campaigns.$inferSelect;

export type CampaignStatus = "inactive" | "scheduled" | "active" | "expired";

/**
 * A campaign's status is never stored: it follows from the pause switch and
 * the inclusive date window. Switched off wins over both date states.
 */
export function campaignStatus(campaign: Pick<Row, "isActive" | "startsOn" | "endsOn">, today: string): CampaignStatus {
  if (!campaign.isActive) return "inactive";
  if (campaign.endsOn < today) return "expired";
  if (campaign.startsOn > today) return "scheduled";
  return "active";
}

export const campaignInputSchema = z
  .object({
    name: z.string().trim().min(3, "Give the campaign a name.").max(120),
    /** A label only. Campaigns apply automatically; nobody types a code. */
    code: z
      .string()
      .trim()
      .toUpperCase()
      .max(40)
      .nullish()
      .transform((value) => value || null),
    blurb: z.string().trim().max(500).default(""),
    type: discountTypeSchema,
    /** Whole percent for `percent`; minor units for `fixed`. */
    value: discountValueSchema,
    appliesToAllTours: z.boolean().default(true),
    tourIds: z.array(z.uuid()).max(500).default([]),
    visibility: z.enum(["public", "private"]).default("public"),
    assignedEmails: z.array(emailSchema).max(500).default([]),
    minGuests: z.number().int().min(0).max(100).default(0),
    minChildren: z.number().int().min(0).max(100).default(0),
    bookAheadDays: z.number().int().min(0).max(730).default(0),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    checkPercentCap(value, ctx);
    if (value.endsOn < value.startsOn) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: "End date must be on or after the start date." });
    }
    if (!value.appliesToAllTours && value.tourIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["tourIds"], message: "Choose at least one tour." });
    }
    if (value.visibility === "private" && value.assignedEmails.length === 0) {
      ctx.addIssue({ code: "custom", path: ["assignedEmails"], message: "Add at least one customer email." });
    }
  });

export type CampaignInput = z.input<typeof campaignInputSchema>;

export interface CampaignView {
  id: string;
  name: string;
  code: string | null;
  blurb: string;
  type: DiscountType;
  value: number;
  appliesToAllTours: boolean;
  /** Empty when the campaign covers every tour. */
  tours: { id: string; title: string }[];
  visibility: "public" | "private";
  assignedEmails: string[];
  minGuests: number;
  minChildren: number;
  bookAheadDays: number;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
  /** Bookings that received this campaign's discount. */
  uses: number;
  status: CampaignStatus;
  createdAt: Date;
  updatedAt: Date;
}

function toView(row: Row, covered: { id: string; title: string }[], today: string): CampaignView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    blurb: row.blurb,
    type: row.type,
    value: row.value,
    appliesToAllTours: row.appliesToAllTours,
    tours: covered,
    visibility: row.visibility,
    assignedEmails: row.assignedEmails,
    minGuests: row.minGuests,
    minChildren: row.minChildren,
    bookAheadDays: row.bookAheadDays,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    isActive: row.isActive,
    uses: row.uses,
    status: campaignStatus(row, today),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findRow(scope: TenantScope, id: string): Promise<Row> {
  const [row] = await scope.tx
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.tenantId, scope.tenantId), eq(campaigns.id, id)))
    .limit(1);
  // Same answer whether the id is unknown or belongs to another tenant.
  if (!row) throw new NotFoundError("Campaign");
  return row;
}

async function toViews(scope: TenantScope, rows: Row[], today: string): Promise<CampaignView[]> {
  if (rows.length === 0) return [];
  const links = await scope.tx
    .select({ campaignId: campaignTours.campaignId, id: tours.id, title: tours.title })
    .from(campaignTours)
    .innerJoin(tours, and(eq(tours.tenantId, campaignTours.tenantId), eq(tours.id, campaignTours.tourId)))
    .where(
      and(
        eq(campaignTours.tenantId, scope.tenantId),
        inArray(
          campaignTours.campaignId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(tours.title);
  const byCampaign = new Map<string, { id: string; title: string }[]>();
  for (const { campaignId, ...tour } of links) byCampaign.set(campaignId, [...(byCampaign.get(campaignId) ?? []), tour]);
  return rows.map((row) => toView(row, byCampaign.get(row.id) ?? [], today));
}

/** Every campaign of the workspace, newest first, with derived status and use counts. */
export async function listCampaigns(scope: TenantScope, today: string): Promise<CampaignView[]> {
  const rows = await scope.tx
    .select()
    .from(campaigns)
    .where(eq(campaigns.tenantId, scope.tenantId))
    .orderBy(desc(campaigns.createdAt), campaigns.id);
  return toViews(scope, rows, today);
}

export async function getCampaign(scope: TenantScope, id: string, today: string): Promise<CampaignView> {
  const [view] = await toViews(scope, [await findRow(scope, id)], today);
  return view!;
}

type ParsedCampaign = z.output<typeof campaignInputSchema>;

/** Scope and audience in their stored form: no tour list when all tours, no e-mails when public. */
function normalise(data: ParsedCampaign) {
  const { tourIds, ...columns } = data;
  return {
    columns: { ...columns, assignedEmails: data.visibility === "private" ? [...new Set(data.assignedEmails)] : [] },
    tourIds: data.appliesToAllTours ? [] : [...new Set(tourIds)],
  };
}

async function replaceTours(scope: TenantScope, campaignId: string, tourIds: string[]): Promise<void> {
  await scope.tx.delete(campaignTours).where(and(eq(campaignTours.tenantId, scope.tenantId), eq(campaignTours.campaignId, campaignId)));
  if (tourIds.length === 0) return;
  try {
    await scope.tx.insert(campaignTours).values(tourIds.map((tourId) => ({ tenantId: scope.tenantId, campaignId, tourId })));
  } catch (error) {
    // The composite foreign key only accepts this tenant's tours, so an id
    // that is unknown or belongs to someone else lands here.
    if (pgError(error).code === FOREIGN_KEY_VIOLATION) {
      throw new ValidationError(undefined, { tourIds: ["Choose tours from your own catalogue."] });
    }
    throw error;
  }
}

function auditMetadata(row: Row, tourCount: number) {
  return {
    name: row.name,
    type: row.type,
    value: row.value,
    visibility: row.visibility,
    appliesToAllTours: row.appliesToAllTours,
    tourCount,
    assignedCount: row.assignedEmails.length,
    isActive: row.isActive,
  };
}

export async function createCampaign(scope: TenantScope, input: CampaignInput, today: string): Promise<CampaignView> {
  await assertFeature(scope, "promotions");
  const { columns, tourIds } = normalise(parse(campaignInputSchema, input));

  const [row] = (await scope.tx
    .insert(campaigns)
    .values({ tenantId: scope.tenantId, ...columns })
    .returning()) as [Row];
  await replaceTours(scope, row.id, tourIds);

  await recordAudit(scope, {
    action: "promotions.campaign_created",
    targetType: "campaign",
    targetId: row.id,
    metadata: auditMetadata(row, tourIds.length),
  });
  return getCampaign(scope, row.id, today);
}

/** Replaces every editable field. The use count is never touched by an edit. */
export async function updateCampaign(scope: TenantScope, id: string, input: CampaignInput, today: string): Promise<CampaignView> {
  await assertFeature(scope, "promotions");
  await findRow(scope, id);
  const { columns, tourIds } = normalise(parse(campaignInputSchema, input));

  const [row] = (await scope.tx
    .update(campaigns)
    .set(columns)
    .where(and(eq(campaigns.tenantId, scope.tenantId), eq(campaigns.id, id)))
    .returning()) as [Row];
  await replaceTours(scope, id, tourIds);

  await recordAudit(scope, {
    action: "promotions.campaign_updated",
    targetType: "campaign",
    targetId: id,
    metadata: auditMetadata(row, tourIds.length),
  });
  return getCampaign(scope, id, today);
}

/** The pause switch. An inactive campaign is hidden and never applied. */
export async function setCampaignActive(scope: TenantScope, id: string, isActive: boolean, today: string): Promise<CampaignView> {
  await assertFeature(scope, "promotions");
  const existing = await findRow(scope, id);
  await scope.tx
    .update(campaigns)
    .set({ isActive })
    .where(and(eq(campaigns.tenantId, scope.tenantId), eq(campaigns.id, id)));
  await recordAudit(scope, {
    action: isActive ? "promotions.campaign_activated" : "promotions.campaign_deactivated",
    targetType: "campaign",
    targetId: id,
    metadata: { name: existing.name },
  });
  return getCampaign(scope, id, today);
}

/**
 * Removes a campaign for good. Bookings that already used it keep their
 * price: they carry their own snapshot of the discount.
 */
export async function deleteCampaign(scope: TenantScope, id: string): Promise<void> {
  await assertFeature(scope, "promotions");
  const existing = await findRow(scope, id);
  await scope.tx.delete(campaigns).where(and(eq(campaigns.tenantId, scope.tenantId), eq(campaigns.id, id)));
  await recordAudit(scope, {
    action: "promotions.campaign_deleted",
    targetType: "campaign",
    targetId: id,
    metadata: { name: existing.name, uses: existing.uses },
  });
}
