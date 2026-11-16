import "server-only";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { TenantScope } from "../db/context";
import { inquiries, tenants, tours } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { enqueueNotification } from "../notifications";
import { isIsoDate, todayIn } from "@/lib/dates";
import { pageSchema, parseInput, requireId, type Page } from "./shared";

/** How far ahead a preferred travel date may lie. */
export const MAX_PREFERRED_DATE_YEARS = 3;

export const INQUIRY_STATUSES = ["new", "read", "archived"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

// Customer text is stored as written (minus control characters) and only ever
// rendered as text; a visitor is not turned away for typing an angle bracket.
const stripControls = (value: string) => value.replace(/[^\P{Cc}\n\t]/gu, "");

/** The storefront contact form. Same rules and messages as the design. */
export const submitInquirySchema = z.object({
  name: z
    .string()
    .transform((value) => stripControls(value).replace(/\s+/g, " ").trim())
    .pipe(z.string().min(2, "Please tell me your name.").max(200, "Keep your name under 200 characters.")),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address.").max(200, "Enter a valid email address.")),
  phone: z
    .string()
    .transform((value) => stripControls(value).replace(/\s+/g, " ").trim())
    .pipe(z.string().max(50, "Keep the phone number under 50 characters."))
    .optional(),
  /** A published tour of this site; empty means "not sure yet". */
  tourId: z.union([z.uuid(), z.literal("")]).nullish(),
  /** When the visitor would like to travel (`YYYY-MM-DD`); empty means no date yet. */
  preferredDate: z
    .union([z.literal(""), z.string().trim().refine(isIsoDate, "Choose a date in YYYY-MM-DD format.")])
    .nullish(),
  message: z
    .string()
    .transform((value) => stripControls(value.replace(/\r\n?/g, "\n")).trim())
    .pipe(
      z
        .string()
        .min(10, "A short message (10+ characters) helps me prepare.")
        .max(1000, "Keep your message under 1000 characters."),
    ),
});
export type SubmitInquiryInput = z.input<typeof submitInquirySchema>;

/**
 * Public contact form. Stores the message and, when the business has a
 * contact address, queues an alert to it in the same transaction, so an
 * inquiry is never saved without its alert or alerted without being saved.
 */
export async function submitInquiry(scope: TenantScope, input: SubmitInquiryInput): Promise<{ id: string }> {
  const data = parseInput(submitInquirySchema, input);

  let tour: { id: string; title: string } | null = null;
  if (data.tourId) {
    // Drafts, archived tours and other workspaces' tours all look the same
    // from here: not an option on this form.
    const [row] = await scope.tx
      .select({ id: tours.id, title: tours.title })
      .from(tours)
      .where(and(eq(tours.tenantId, scope.tenantId), eq(tours.id, data.tourId), eq(tours.status, "published")))
      .limit(1);
    if (!row) throw new ValidationError(undefined, { tourId: ["Choose one of the listed tours."] });
    tour = row;
  }

  // Read first: the time zone decides what "three years from today" means,
  // and the address is where the alert goes.
  const [business] = await scope.tx
    .select({ name: tenants.name, email: tenants.email, timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, scope.tenantId))
    .limit(1);

  const preferredDate = data.preferredDate || null;
  if (preferredDate) {
    const today = todayIn(business?.timezone ?? "UTC");
    // Compared as text, which is exact for `YYYY-MM-DD` and needs no care
    // over 29 February landing in a year that has none.
    const latest = `${Number(today.slice(0, 4)) + MAX_PREFERRED_DATE_YEARS}${today.slice(4)}`;
    if (preferredDate > latest) {
      throw new ValidationError(undefined, { preferredDate: [`Choose a date within the next ${MAX_PREFERRED_DATE_YEARS} years.`] });
    }
  }

  const [created] = await scope.tx
    .insert(inquiries)
    .values({
      tenantId: scope.tenantId,
      name: data.name,
      email: data.email,
      phone: data.phone ?? "",
      tourId: tour?.id ?? null,
      message: data.message,
      preferredDate,
    })
    .returning({ id: inquiries.id });
  const id = created!.id;

  if (business?.email) {
    await enqueueNotification(scope, {
      kind: "inquiry.staff_alert",
      toEmail: business.email,
      subject: `New inquiry from ${data.name}`,
      bodyText: [
        `${data.name} sent a message through the ${business.name} website.`,
        "",
        `Name: ${data.name}`,
        `Email: ${data.email}`,
        ...(data.phone ? [`Phone: ${data.phone}`] : []),
        ...(tour ? [`Tour: ${tour.title}`] : []),
        ...(preferredDate ? [`Preferred date: ${preferredDate}`] : []),
        "",
        data.message,
      ].join("\n"),
      relatedType: "inquiry",
      relatedId: id,
    });
  }
  return { id };
}

export interface InquiryView {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  /** `YYYY-MM-DD`, or null when the visitor gave no date. */
  preferredDate: string | null;
  status: InquiryStatus;
  tour: { id: string; title: string } | null;
  createdAt: Date;
}

const viewColumns = {
  id: inquiries.id,
  name: inquiries.name,
  email: inquiries.email,
  phone: inquiries.phone,
  message: inquiries.message,
  preferredDate: inquiries.preferredDate,
  status: inquiries.status,
  tourId: inquiries.tourId,
  tourTitle: tours.title,
  createdAt: inquiries.createdAt,
};

const tourJoin = and(eq(tours.tenantId, inquiries.tenantId), eq(tours.id, inquiries.tourId));

interface ViewRow extends Omit<InquiryView, "tour"> {
  tourId: string | null;
  tourTitle: string | null;
}

function toView(row: ViewRow): InquiryView {
  const { tourId, tourTitle, ...rest } = row;
  return { ...rest, tour: tourId && tourTitle !== null ? { id: tourId, title: tourTitle } : null };
}

export async function getInquiry(scope: TenantScope, id: string): Promise<InquiryView> {
  requireId(id, "Inquiry");
  const [row] = await scope.tx
    .select(viewColumns)
    .from(inquiries)
    .leftJoin(tours, tourJoin)
    .where(and(eq(inquiries.tenantId, scope.tenantId), eq(inquiries.id, id)))
    .limit(1);
  // Same answer whether the id is unknown or belongs to another workspace.
  if (!row) throw new NotFoundError("Inquiry");
  return toView(row);
}

export const listInquiriesSchema = z.object({
  status: z.enum(INQUIRY_STATUSES).optional(),
  ...pageSchema(50, 100),
});
export type ListInquiriesInput = z.input<typeof listInquiriesSchema>;

/** Dashboard inbox, newest first. */
export async function listInquiries(scope: TenantScope, input: ListInquiriesInput = {}): Promise<Page<InquiryView>> {
  const filters = parseInput(listInquiriesSchema, input);
  const conditions: SQL[] = [eq(inquiries.tenantId, scope.tenantId)];
  if (filters.status) conditions.push(eq(inquiries.status, filters.status));
  const where = and(...conditions);

  const rows = await scope.tx
    .select(viewColumns)
    .from(inquiries)
    .leftJoin(tours, tourJoin)
    .where(where)
    .orderBy(desc(inquiries.createdAt), desc(inquiries.id))
    .limit(filters.limit)
    .offset(filters.offset);
  const [totals] = await scope.tx.select({ total: count() }).from(inquiries).where(where);
  return { items: rows.map(toView), total: totals?.total ?? 0 };
}

/** Unread messages, for the navigation badge. */
export async function countNewInquiries(scope: TenantScope): Promise<number> {
  const [row] = await scope.tx
    .select({ total: count() })
    .from(inquiries)
    .where(and(eq(inquiries.tenantId, scope.tenantId), eq(inquiries.status, "new")));
  return row?.total ?? 0;
}

/** Inbox totals per status, for the dashboard tabs. One grouped query. */
export async function countInquiriesByStatus(scope: TenantScope): Promise<Record<InquiryStatus, number>> {
  const rows = await scope.tx
    .select({ status: inquiries.status, total: count() })
    .from(inquiries)
    .where(eq(inquiries.tenantId, scope.tenantId))
    .groupBy(inquiries.status);
  // Every status is present, even with no rows behind it.
  const totals: Record<InquiryStatus, number> = { new: 0, read: 0, archived: 0 };
  for (const row of rows) totals[row.status] = row.total;
  return totals;
}

export async function setInquiryStatus(scope: TenantScope, id: string, status: InquiryStatus): Promise<InquiryView> {
  requireId(id, "Inquiry");
  const next = parseInput(z.enum(INQUIRY_STATUSES), status);
  const updated = await scope.tx
    .update(inquiries)
    .set({ status: next })
    .where(and(eq(inquiries.tenantId, scope.tenantId), eq(inquiries.id, id)))
    .returning({ id: inquiries.id });
  if (updated.length === 0) throw new NotFoundError("Inquiry");
  return getInquiry(scope, id);
}

export const markInquiryRead = (scope: TenantScope, id: string) => setInquiryStatus(scope, id, "read");
export const archiveInquiry = (scope: TenantScope, id: string) => setInquiryStatus(scope, id, "archived");

/** Permanently removes a message. Audited without any of its content. */
export async function deleteInquiry(scope: TenantScope, id: string): Promise<void> {
  requireId(id, "Inquiry");
  const deleted = await scope.tx
    .delete(inquiries)
    .where(and(eq(inquiries.tenantId, scope.tenantId), eq(inquiries.id, id)))
    .returning({ id: inquiries.id });
  if (deleted.length === 0) throw new NotFoundError("Inquiry");
  await recordAudit(scope, { action: "inquiry.deleted", targetType: "inquiry", targetId: id });
}
