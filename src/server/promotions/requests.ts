import "server-only";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { addDays } from "../../lib/dates";
import { recordAudit } from "../audit";
import { generateToken, hashToken, safeEqual } from "../auth/tokens";
import { assertFeature } from "../billing/limits";
import type { TenantScope } from "../db/context";
import { bookings, discountRequests, tours, users } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { enqueueNotification } from "../notifications";
import { getPromotionSettings } from "../settings/tenant-settings";
import {
  discountTypeSchema,
  formatDiscount,
  lockInTenant,
  parse,
  partyBaseAmount,
  tenantProfile,
  type DiscountType,
} from "./shared";

type Row = typeof discountRequests.$inferSelect;

export type DiscountRequestStatus = Row["status"];

/** One wording for "too large", whichever rule was hit, so the private maximum cannot be probed. */
const TOO_LARGE = "We can’t consider a discount this large for this trip. Please request a smaller amount.";
const FIRST_REFERENCE_NUMBER = 1001;

export const discountRequestInputSchema = z.object({
  tourId: z.uuid("This tour can’t be found."),
  name: z.string().trim().min(1, "Tell us your name.").max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Add a valid email so we can reply.")),
  phone: z.string().trim().max(40).default(""),
  adults: z.number().int().min(1).max(100),
  children: z.number().int().min(0).max(100).default(0),
  type: discountTypeSchema,
  /** Whole percent for `percent`; minor units for `fixed`. */
  value: z.number("Please enter a valid discount.").int("Please enter a valid discount.").positive("Please enter a valid discount."),
  reason: z.string().trim().max(1000).default(""),
});

export type DiscountRequestInput = z.input<typeof discountRequestInputSchema>;

export interface SubmittedDiscountRequest {
  /** Human reference, e.g. `DR-1042`. */
  reference: string;
  /** Shown to the requester once. With the reference it unlocks the status page. */
  accessToken: string;
}

async function nextReference(scope: TenantScope): Promise<string> {
  const [row] = await scope.tx
    .select({ last: sql<number | null>`max(substring(${discountRequests.reference} from 4)::int)` })
    .from(discountRequests)
    .where(and(eq(discountRequests.tenantId, scope.tenantId), sql`${discountRequests.reference} ~ '^DR-[0-9]{1,9}$'`));
  return `DR-${row?.last ? row.last + 1 : FIRST_REFERENCE_NUMBER}`;
}

/**
 * A customer asks for a discount on the storefront. Every rule is enforced
 * here; nothing the browser computed is trusted. `today` is the tenant's
 * current date and sets the reply-by day quoted in the confirmation.
 */
export async function submitDiscountRequest(scope: TenantScope, input: DiscountRequestInput, today: string): Promise<SubmittedDiscountRequest> {
  await assertFeature(scope, "promotions");
  const settings = await getPromotionSettings(scope);
  if (!settings.requestsEnabled) throw new ForbiddenError("Discount requests aren’t available at the moment.");

  const data = parse(discountRequestInputSchema, input);

  const [tour] = await scope.tx
    .select({ id: tours.id, title: tours.title, priceAdult: tours.priceAdult, childPricePercent: tours.childPricePercent })
    .from(tours)
    .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.id, data.tourId), eq(tours.status, "published")))
    .limit(1);
  // Drafts, archived tours and other tenants' tours all look the same from here.
  if (!tour) throw new NotFoundError("Tour");

  // Children are priced as the booking will price them, so the limit is a
  // share of what this party would really pay.
  const base = partyBaseAmount(tour, data.adults, data.children);
  const overLimit =
    data.type === "fixed" ? data.value >= base || data.value * 100 > settings.maxRequestPercent * base : data.value > settings.maxRequestPercent;
  if (base <= 0 || overLimit) throw new ValidationError(TOO_LARGE, { value: [TOO_LARGE] });

  // One submission at a time per tenant: the pending check and the next
  // reference number are both read-then-write.
  await lockInTenant(scope, "discount-request");

  const [pending] = await scope.tx
    .select({ id: discountRequests.id })
    .from(discountRequests)
    .where(
      and(
        eq(discountRequests.tenantId, scope.tenantId),
        eq(discountRequests.tourId, tour.id),
        eq(discountRequests.email, data.email),
        eq(discountRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (pending) throw new ConflictError("You already have a discount request waiting for this tour.");

  const reference = await nextReference(scope);
  const accessToken = generateToken();
  const [row] = (await scope.tx
    .insert(discountRequests)
    .values({
      tenantId: scope.tenantId,
      reference,
      accessTokenHash: hashToken(accessToken),
      name: data.name,
      email: data.email,
      phone: data.phone,
      tourId: tour.id,
      guests: data.adults + data.children,
      adults: data.adults,
      children: data.children,
      type: data.type,
      value: data.value,
      reason: data.reason,
    })
    .returning({ id: discountRequests.id })) as [{ id: string }];

  const tenant = await tenantProfile(scope);
  const asked = formatDiscount(data.type, data.value, tenant.currency);
  const related = { relatedType: "discount_request", relatedId: row.id };
  // The access token is deliberately left out of the message: the outbox
  // stores bodies in plain text, and only the token's hash may be stored.
  await enqueueNotification(scope, {
    kind: "discount_request.received",
    toEmail: data.email,
    subject: `We received your discount request ${reference}`,
    bodyText: [
      `Hi ${data.name},`,
      "",
      `Thanks for your request: ${asked} on ${tour.title}.`,
      `Your reference is ${reference}. ${tenant.name} will reply by ${addDays(today, settings.responseDays)}.`,
      "",
      "Your booking request is separate and is not affected. If the discount is approved it applies automatically when you book with this e-mail address.",
    ].join("\n"),
    ...related,
  });
  if (tenant.email !== "") {
    await enqueueNotification(scope, {
      kind: "discount_request.received",
      toEmail: tenant.email,
      subject: `New discount request ${reference}`,
      bodyText: [
        `${data.name} asked for ${asked} on ${tour.title} (${data.adults + data.children} guests).`,
        "",
        `Reply within ${settings.responseDays} day(s) in Promotions → Requests.`,
      ].join("\n"),
      ...related,
    });
  }

  await recordAudit(scope, {
    action: "promotions.request_submitted",
    targetType: "discount_request",
    targetId: row.id,
    metadata: { reference, tourId: tour.id, type: data.type, value: data.value, adults: data.adults, children: data.children },
    actorType: "system",
  });
  return { reference, accessToken };
}

export interface DiscountRequestPublicStatus {
  reference: string;
  status: DiscountRequestStatus;
  tourTitle: string;
  requested: { type: DiscountType; value: number };
  createdAt: Date;
  decidedAt: Date | null;
  /** What was granted. Present once approved; may be less than requested. */
  approved: { type: DiscountType; value: number } | null;
  /** The reason given to the customer. Present once rejected. */
  rejectionReason: string | null;
  /** True once the approved discount has been spent on a booking. */
  used: boolean;
  /** Promised response time in days. */
  responseDays: number;
}

export const discountRequestLookupSchema = z.object({
  reference: z.string().trim().toUpperCase().min(1).max(20),
  accessToken: z.string().min(1).max(200),
});

/**
 * Status tracker for the requester. The reference alone is guessable (it is
 * sequential), so the secret issued at submission is required as well, and a
 * wrong reference, a wrong secret and another tenant's request are all the
 * same "not found". The requester's e-mail, name and phone are never returned.
 */
export async function getDiscountRequestStatus(
  scope: TenantScope,
  lookup: { reference: string; accessToken: string },
): Promise<DiscountRequestPublicStatus> {
  const parsed = discountRequestLookupSchema.safeParse(lookup);
  if (!parsed.success) throw new NotFoundError("Discount request");

  const [found] = await scope.tx
    .select({ request: discountRequests, tourTitle: tours.title })
    .from(discountRequests)
    .innerJoin(tours, and(eq(tours.tenantId, discountRequests.tenantId), eq(tours.id, discountRequests.tourId)))
    .where(and(eq(discountRequests.tenantId, scope.tenantId), eq(discountRequests.reference, parsed.data.reference)))
    .limit(1);

  // Compare even when there is no row, so the response time does not tell a
  // caller whether the reference exists.
  const matches = safeEqual(hashToken(parsed.data.accessToken), found?.request.accessTokenHash ?? hashToken(""));
  if (!found || !matches) throw new NotFoundError("Discount request");

  const { request } = found;
  const { responseDays } = await getPromotionSettings(scope);
  return {
    reference: request.reference,
    status: request.status,
    tourTitle: found.tourTitle,
    requested: { type: request.type, value: request.value },
    createdAt: request.createdAt,
    decidedAt: request.decidedAt,
    approved:
      request.status === "approved" && request.decidedType && request.decidedValue ? { type: request.decidedType, value: request.decidedValue } : null,
    // An approval's note is internal; only a rejection's reason is for the customer.
    rejectionReason: request.status === "rejected" ? request.decisionNote : null,
    used: request.usedByBookingId !== null,
    responseDays,
  };
}

export interface DiscountRequestView {
  id: string;
  reference: string;
  name: string;
  email: string;
  phone: string;
  tourId: string;
  tourTitle: string;
  /** Total party size: adults + children. */
  guests: number;
  adults: number;
  children: number;
  type: DiscountType;
  value: number;
  reason: string;
  status: DiscountRequestStatus;
  decidedType: DiscountType | null;
  decidedValue: number | null;
  /** Internal note on an approval; the customer-facing reason on a rejection. */
  decisionNote: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  usedByBookingId: string | null;
  usedByBookingReference: string | null;
  createdAt: Date;
}

interface LoadedRequest {
  view: DiscountRequestView;
  tour: { priceAdult: number; childPricePercent: number };
}

async function loadRequests(scope: TenantScope, filter: { id?: string; status?: DiscountRequestStatus }): Promise<LoadedRequest[]> {
  const rows = await scope.tx
    .select({
      request: discountRequests,
      tourTitle: tours.title,
      priceAdult: tours.priceAdult,
      childPricePercent: tours.childPricePercent,
      bookingReference: bookings.reference,
      decidedByName: users.name,
    })
    .from(discountRequests)
    .innerJoin(tours, and(eq(tours.tenantId, discountRequests.tenantId), eq(tours.id, discountRequests.tourId)))
    .leftJoin(bookings, and(eq(bookings.tenantId, discountRequests.tenantId), eq(bookings.id, discountRequests.usedByBookingId)))
    .leftJoin(users, eq(users.id, discountRequests.decidedBy))
    .where(
      and(
        eq(discountRequests.tenantId, scope.tenantId),
        filter.id ? eq(discountRequests.id, filter.id) : undefined,
        filter.status ? eq(discountRequests.status, filter.status) : undefined,
      ),
    )
    .orderBy(desc(discountRequests.createdAt), discountRequests.id);

  // Field by field on purpose: the access token hash never leaves this module.
  return rows.map(({ request, tourTitle, priceAdult, childPricePercent, bookingReference, decidedByName }) => ({
    view: {
      id: request.id,
      reference: request.reference,
      name: request.name,
      email: request.email,
      phone: request.phone,
      tourId: request.tourId,
      tourTitle,
      guests: request.guests,
      adults: request.adults,
      children: request.children,
      type: request.type,
      value: request.value,
      reason: request.reason,
      status: request.status,
      decidedType: request.decidedType,
      decidedValue: request.decidedValue,
      decisionNote: request.decisionNote,
      decidedBy: request.decidedBy,
      decidedByName,
      decidedAt: request.decidedAt,
      usedByBookingId: request.usedByBookingId,
      usedByBookingReference: bookingReference,
      createdAt: request.createdAt,
    },
    tour: { priceAdult, childPricePercent },
  }));
}

async function findRequest(scope: TenantScope, id: string): Promise<LoadedRequest> {
  const [found] = await loadRequests(scope, { id });
  // Same answer whether the id is unknown or belongs to another tenant.
  if (!found) throw new NotFoundError("Discount request");
  return found;
}

/** Requests for the dashboard, newest first, optionally one status only. */
export async function listDiscountRequests(scope: TenantScope, filter: { status?: DiscountRequestStatus } = {}): Promise<DiscountRequestView[]> {
  return (await loadRequests(scope, { status: filter.status })).map((loaded) => loaded.view);
}

/** For the sidebar badge and the Requests tab pill. */
export async function countPendingDiscountRequests(scope: TenantScope): Promise<number> {
  const [row] = await scope.tx
    .select({ n: count() })
    .from(discountRequests)
    .where(and(eq(discountRequests.tenantId, scope.tenantId), eq(discountRequests.status, "pending")));
  return row?.n ?? 0;
}

export interface ApprovalLimits {
  /** What the requesting party pays before any discount, at the tour's current price. Minor units. */
  base: number;
  /** The most that can be approved without exceeding what was asked. */
  asked: { percent: number; fixed: number };
  /** The most the workspace's private maximum allows. */
  cap: { percent: number; fixed: number };
  /** The smaller of the two, per type: what an approval may actually be. */
  maxPercent: number;
  maxFixed: number;
}

/**
 * How much of a request may be approved, as a whole percentage or as a fixed
 * amount. A percentage and an amount are compared through `base`, the price
 * of the requesting party; every conversion rounds down, so neither what was
 * asked nor the private maximum can be exceeded by a rounding step. The
 * maximum used is the current one, not the one in force when the request was
 * submitted.
 */
export function approvalLimits(request: { type: DiscountType; value: number }, base: number, maxRequestPercent: number): ApprovalLimits {
  const amountOf = (percent: number) => Math.floor((percent * base) / 100);
  const asked =
    request.type === "percent"
      ? { percent: request.value, fixed: amountOf(request.value) }
      : { percent: base > 0 ? Math.floor((request.value * 100) / base) : 0, fixed: request.value };
  const cap = { percent: maxRequestPercent, fixed: amountOf(maxRequestPercent) };
  return { base, asked, cap, maxPercent: Math.min(asked.percent, cap.percent), maxFixed: Math.min(asked.fixed, cap.fixed) };
}

/** The request's party at the tour's current prices, children at the tour's child rate. */
function limitsFor({ view, tour }: LoadedRequest, maxRequestPercent: number): ApprovalLimits {
  return approvalLimits(view, partyBaseAmount(tour, view.adults, view.children), maxRequestPercent);
}

export interface DiscountRequestDetail extends DiscountRequestView {
  /** What the current rules allow an approval to be. */
  limits: ApprovalLimits;
  /** Whether the request can be approved exactly as asked. */
  canApproveInFull: boolean;
}

export async function getDiscountRequest(scope: TenantScope, id: string): Promise<DiscountRequestDetail> {
  const loaded = await findRequest(scope, id);
  const { view } = loaded;
  const { maxRequestPercent } = await getPromotionSettings(scope);
  const limits = limitsFor(loaded, maxRequestPercent);
  return { ...view, limits, canApproveInFull: view.value <= (view.type === "percent" ? limits.maxPercent : limits.maxFixed) };
}

const NO_APPROVED_VALUE = "Enter the discount you’re approving.";

export const approveDiscountRequestSchema = z.object({
  type: discountTypeSchema,
  /** Whole percent for `percent`; minor units for `fixed`. */
  value: z.number(NO_APPROVED_VALUE).int(NO_APPROVED_VALUE).positive(NO_APPROVED_VALUE),
  /** Internal. Never shown to the customer. */
  note: z.string().trim().max(1000).optional(),
});
export type ApproveDiscountRequestInput = z.input<typeof approveDiscountRequestSchema>;

export const rejectDiscountRequestSchema = z.object({
  /** Shown to the customer. */
  reason: z.string().trim().min(1, "Add a reason so the customer understands.").max(1000),
});
export type RejectDiscountRequestInput = z.input<typeof rejectDiscountRequestSchema>;

const ALREADY_DECIDED = "This request has already been decided.";

/** Writes the decision only if the request is still pending; a decision is final. */
async function decide(
  scope: TenantScope,
  id: string,
  decision: Pick<Row, "status" | "decidedType" | "decidedValue" | "decisionNote">,
): Promise<void> {
  const decided = await scope.tx
    .update(discountRequests)
    .set({ ...decision, decidedBy: scope.userId, decidedAt: new Date() })
    .where(and(eq(discountRequests.tenantId, scope.tenantId), eq(discountRequests.id, id), eq(discountRequests.status, "pending")))
    .returning({ id: discountRequests.id });
  // Two people deciding at once: the second finds nothing left to decide.
  if (decided.length === 0) throw new ConflictError(ALREADY_DECIDED);
}

/**
 * Approves a pending request, in full or for less. The approved discount can
 * exceed neither what the customer asked for nor the workspace's current
 * maximum, in whichever type it is granted. It becomes a single-use discount
 * for that e-mail on that tour.
 */
export async function approveDiscountRequest(scope: TenantScope, id: string, input: ApproveDiscountRequestInput): Promise<DiscountRequestView> {
  await assertFeature(scope, "promotions");
  const loaded = await findRequest(scope, id);
  const { view } = loaded;
  if (view.status !== "pending") throw new ConflictError(ALREADY_DECIDED);
  const data = parse(approveDiscountRequestSchema, input);

  const { maxRequestPercent } = await getPromotionSettings(scope);
  const limits = limitsFor(loaded, maxRequestPercent);
  const key = data.type === "percent" ? "percent" : "fixed";
  if (data.value > limits.asked[key]) {
    const message = "You can’t approve more than the customer asked for.";
    throw new ValidationError(message, { value: [message] });
  }
  if (data.value > limits.cap[key]) {
    // Staff-facing, so naming the maximum is fine here.
    const message = `That’s above your maximum of ${maxRequestPercent}%. Approve ${maxRequestPercent}% or less, or reject.`;
    throw new ValidationError(message, { value: [message] });
  }

  await decide(scope, id, { status: "approved", decidedType: data.type, decidedValue: data.value, decisionNote: data.note || null });

  const tenant = await tenantProfile(scope);
  const granted = formatDiscount(data.type, data.value, tenant.currency);
  const partial = data.type !== view.type || data.value !== view.value;
  await enqueueNotification(scope, {
    kind: "discount_request.approved",
    toEmail: view.email,
    subject: `Your discount request ${view.reference} was approved`,
    bodyText: [
      `Hi ${view.name},`,
      "",
      partial
        ? `You asked for ${formatDiscount(view.type, view.value, tenant.currency)} on ${view.tourTitle}. ${tenant.name} can offer ${granted}.`
        : `${tenant.name} approved ${granted} on ${view.tourTitle}.`,
      "It applies automatically when you book this tour with this e-mail address, and can be used once.",
    ].join("\n"),
    relatedType: "discount_request",
    relatedId: id,
  });
  await recordAudit(scope, {
    action: "promotions.request_approved",
    targetType: "discount_request",
    targetId: id,
    metadata: { reference: view.reference, type: data.type, value: data.value, requestedType: view.type, requestedValue: view.value, partial },
  });
  return (await findRequest(scope, id)).view;
}

/** Rejects a pending request. The reason is required and is shown to the customer. */
export async function rejectDiscountRequest(scope: TenantScope, id: string, input: RejectDiscountRequestInput): Promise<DiscountRequestView> {
  await assertFeature(scope, "promotions");
  const { view } = await findRequest(scope, id);
  if (view.status !== "pending") throw new ConflictError(ALREADY_DECIDED);
  const data = parse(rejectDiscountRequestSchema, input);

  await decide(scope, id, { status: "rejected", decidedType: null, decidedValue: null, decisionNote: data.reason });

  const tenant = await tenantProfile(scope);
  await enqueueNotification(scope, {
    kind: "discount_request.rejected",
    toEmail: view.email,
    subject: `About your discount request ${view.reference}`,
    bodyText: [
      `Hi ${view.name},`,
      "",
      `${tenant.name} could not approve your discount request for ${view.tourTitle}.`,
      `Reason: ${data.reason}`,
      "",
      "Any current offer still applies automatically when you book.",
    ].join("\n"),
    relatedType: "discount_request",
    relatedId: id,
  });
  await recordAudit(scope, {
    action: "promotions.request_rejected",
    targetType: "discount_request",
    targetId: id,
    metadata: { reference: view.reference },
  });
  return (await findRequest(scope, id)).view;
}
