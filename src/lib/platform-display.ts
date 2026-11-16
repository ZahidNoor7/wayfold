/**
 * Pure display and form helpers for the platform back office (/platform).
 * No server imports: everything here runs in the browser and in unit tests.
 */

/* ------------------------------------------------------------ URL params */

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a query parameter, trimmed. Empty string when absent. */
export function firstParam(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : "";
}

/** The parameter, if it is one of the allowed values. */
export function pickParam<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  const first = firstParam(value);
  return (allowed as readonly string[]).includes(first) ? (first as T) : undefined;
}

const MAX_PAGE = 100_000;

/** 1-based page number from the URL. Anything unusable is page 1. */
export function pageParam(value: string | string[] | undefined): number {
  const first = firstParam(value);
  if (!/^\d{1,6}$/.test(first)) return 1;
  return Math.min(Math.max(Number(first), 1), MAX_PAGE);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value: string): boolean {
  return UUID.test(value);
}

/** A path with a query string, leaving out empty values and page 1. */
export function buildHref(path: string, params: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    if (key === "page" && Number(value) <= 1) continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export interface PageWindow {
  page: number;
  pages: number;
  /** 1-based index of the first and last row shown; both 0 when the page is empty. */
  from: number;
  to: number;
  offset: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function pageWindow(total: number, page: number, size: number): PageWindow {
  const pages = Math.max(1, Math.ceil(total / size));
  const offset = (page - 1) * size;
  const empty = total === 0 || offset >= total;
  return {
    page,
    pages,
    from: empty ? 0 : offset + 1,
    to: empty ? 0 : Math.min(offset + size, total),
    offset,
    hasPrevious: page > 1,
    hasNext: page < pages,
  };
}

/* ---------------------------------------------------------------- money */

export function isCurrencyCode(value: string): boolean {
  if (!/^[A-Z]{3}$/.test(value)) return false;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: value });
    return true;
  } catch {
    return false;
  }
}

/** Decimal places a currency is written with (USD 2, JPY 0, KWD 3). */
export function currencyDigits(currency: string): number {
  if (!isCurrencyCode(currency)) return 2;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

const MAX_MINOR = 2_000_000_000;

/**
 * Turns what someone typed ("29", "29.5", "1,290.00") into integer minor
 * units. Null when it is not a non-negative amount the currency can express.
 */
export function decimalToMinor(input: string, currency: string): number | null {
  const text = input.trim().replace(/,/g, "");
  const digits = currencyDigits(currency);
  const match = /^(\d{1,12})(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > digits) return null;
  const minor = Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) && minor <= MAX_MINOR ? minor : null;
}

/** Minor units as a plain decimal for an input field: 2900 → "29.00". */
export function minorToDecimal(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

/* --------------------------------------------------------- sizes, limits */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** index;
  const rounded = index === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${BYTE_UNITS[index]}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/** A plan or override limit. `null` is how the data says "no limit". */
export function formatLimit(value: number | null): string {
  return value === null ? "Unlimited" : formatCount(value);
}

export type UsageTone = "ok" | "warn" | "over";

export interface Usage {
  /** 0–100, or null when there is no limit to measure against. */
  percent: number | null;
  tone: UsageTone;
  /** Plain-language state, so the meter never relies on colour. */
  label: string;
}

export function usage(used: number, limit: number | null): Usage {
  if (limit === null) return { percent: null, tone: "ok", label: "No limit" };
  if (limit <= 0) return used > 0 ? { percent: 100, tone: "over", label: "Over the limit" } : { percent: 100, tone: "warn", label: "At the limit" };
  const percent = Math.min(100, Math.round((used / limit) * 100));
  if (used > limit) return { percent, tone: "over", label: "Over the limit" };
  if (used === limit) return { percent, tone: "warn", label: "At the limit" };
  if (used >= limit * 0.8) return { percent, tone: "warn", label: "Close to the limit" };
  return { percent, tone: "ok", label: "Within the limit" };
}

export const LIMIT_KEYS = ["maxTeamMembers", "maxPublishedTours", "maxStorageMb", "maxBookingsPerMonth"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const LIMIT_LABELS: Record<LimitKey, { label: string; unit: string }> = {
  maxTeamMembers: { label: "Team members", unit: "members" },
  maxPublishedTours: { label: "Published tours", unit: "tours" },
  maxStorageMb: { label: "Media storage", unit: "MB" },
  maxBookingsPerMonth: { label: "Bookings per month", unit: "bookings" },
};

const MAX_LIMIT = 2_000_000_000;

/** A whole number someone typed, or null. Accepts thousands separators. */
export function parseWholeNumber(input: string): number | null {
  const text = input.trim().replace(/,/g, "");
  if (!/^\d{1,10}$/.test(text)) return null;
  const value = Number(text);
  return value <= MAX_LIMIT ? value : null;
}

/** One limit as edited in a form: a number, or the "Unlimited" switch. */
export interface LimitDraft {
  unlimited: boolean;
  value: string;
}

export type LimitDrafts = Record<LimitKey, LimitDraft>;

export function limitDraft(value: number | null | undefined): LimitDraft {
  if (value === null) return { unlimited: true, value: "" };
  return { unlimited: false, value: value === undefined ? "" : String(value) };
}

const LIMIT_MESSAGE = "Enter a whole number from 0 to 2,000,000,000.";

/**
 * Plan limits: every limit is either a number or unlimited (`null`).
 * Returns the messages to show beside the fields when something is missing.
 */
export function limitsFromDrafts(
  drafts: LimitDrafts,
): { ok: true; limits: Record<LimitKey, number | null> } | { ok: false; errors: Partial<Record<LimitKey, string>> } {
  const limits = {} as Record<LimitKey, number | null>;
  const errors: Partial<Record<LimitKey, string>> = {};
  for (const key of LIMIT_KEYS) {
    const draft = drafts[key];
    if (draft.unlimited) {
      limits[key] = null;
      continue;
    }
    const value = parseWholeNumber(draft.value);
    if (value === null) errors[key] = draft.value.trim() === "" ? "Enter a limit, or switch on Unlimited." : LIMIT_MESSAGE;
    else limits[key] = value;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, limits };
}

/**
 * Per-tenant overrides: a blank field falls back to the plan (the key is left
 * out), a number replaces the plan's limit, and Unlimited sends `null`.
 */
export function overridesFromDrafts(
  drafts: LimitDrafts,
): { ok: true; overrides: Partial<Record<LimitKey, number | null>> } | { ok: false; errors: Partial<Record<LimitKey, string>> } {
  const overrides: Partial<Record<LimitKey, number | null>> = {};
  const errors: Partial<Record<LimitKey, string>> = {};
  for (const key of LIMIT_KEYS) {
    const draft = drafts[key];
    if (draft.unlimited) {
      overrides[key] = null;
      continue;
    }
    if (draft.value.trim() === "") continue;
    const value = parseWholeNumber(draft.value);
    if (value === null) errors[key] = LIMIT_MESSAGE;
    else overrides[key] = value;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, overrides };
}

/* ----------------------------------------------------------------- slugs */

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/**
 * Immediate feedback on a workspace address. Mirrors the server's shape rule;
 * the server still decides whether the address is reserved or taken.
 */
export function slugProblem(input: string): string | null {
  const slug = input.trim().toLowerCase();
  if (slug === "") return null;
  if (slug.length < 3) return "Use at least 3 characters.";
  if (slug.length > 40) return "Use 40 characters or fewer.";
  if (!SLUG.test(slug)) return "Use lower-case letters, digits and hyphens, starting and ending with a letter or digit.";
  if (slug.includes("--")) return "Use single hyphens only.";
  return null;
}

/* ----------------------------------------------------------------- dates */

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const LONG_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" });

function asDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
}

/** "Nov 14". The platform works in UTC throughout. */
export function formatDay(value: Date | string): string {
  return DAY_FORMAT.format(asDate(value));
}

/** "Nov 14, 2026". */
export function formatDate(value: Date | string): string {
  return DATE_FORMAT.format(asDate(value));
}

/** "Nov 14, 2026, 18:02 UTC". */
export function formatDateTime(value: Date | string): string {
  return `${DATE_TIME_FORMAT.format(asDate(value))} UTC`;
}

/** "Saturday 14 November 2026". */
export function formatLongDate(value: Date | string): string {
  return LONG_DATE_FORMAT.format(asDate(value)).replace(",", "");
}

/** "2026-11" → "Nov 2026". */
export function formatMonth(month: string): string {
  return /^\d{4}-\d{2}$/.test(month) ? MONTH_FORMAT.format(new Date(`${month}-01T00:00:00Z`)) : month;
}

/** How long is left until `end`, in the largest two units that matter. */
export function timeLeft(end: Date, now: Date = new Date()): string {
  if (end.getTime() <= now.getTime()) return "Ended";
  const minutes = Math.floor((end.getTime() - now.getTime()) / 60_000);
  if (minutes < 1) return "Less than a minute left";
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 === 0 ? `${hours} h left` : `${hours} h ${minutes % 60} min left`;
  return `${Math.floor(hours / 24)} days left`;
}

/* ---------------------------------------------------------------- charts */

export interface DailyPoint {
  date: string;
  count: number;
}

/**
 * Bar heights as percentages of the tallest bar. A non-zero day never drops
 * below `floor`, so a single booking next to a busy day is still visible.
 */
export function barHeights(counts: number[], floor = 4): number[] {
  const max = Math.max(0, ...counts);
  if (max === 0) return counts.map(() => 0);
  return counts.map((count) => (count <= 0 ? 0 : Math.max(floor, Math.round((count / max) * 100))));
}

/** One sentence that says what the chart shows, for people who cannot see it. */
export function summariseSeries(series: DailyPoint[], singular: string, plural: string): string {
  if (series.length === 0) return `No ${plural} to show.`;
  const total = series.reduce((sum, point) => sum + point.count, 0);
  const span = `${formatDay(series[0]!.date)} to ${formatDay(series.at(-1)!.date)}`;
  if (total === 0) return `No ${plural} from ${span}.`;
  const peak = series.reduce((best, point) => (point.count > best.count ? point : best), series[0]!);
  return `${formatCount(total)} ${total === 1 ? singular : plural} from ${span}. Busiest day: ${formatDay(peak.date)} with ${formatCount(peak.count)}.`;
}

/** Which bars carry a date label: the last one, and every `every`th counting back from it. */
export function tickIndexes(length: number, every = 7): Set<number> {
  const ticks = new Set<number>();
  for (let index = length - 1; index >= 0; index -= Math.max(1, every)) ticks.add(index);
  return ticks;
}

/* ------------------------------------------------------- summary tables */

export interface RevenueRow {
  month: string;
  currency: string;
  amount: number;
  invoices: number;
}

/** Paid revenue per currency across the rows given, largest first. */
export function revenueTotals(rows: RevenueRow[]): { currency: string; amount: number; invoices: number }[] {
  const totals = new Map<string, { currency: string; amount: number; invoices: number }>();
  for (const row of rows) {
    const entry = totals.get(row.currency) ?? { currency: row.currency, amount: 0, invoices: 0 };
    entry.amount += row.amount;
    entry.invoices += row.invoices;
    totals.set(row.currency, entry);
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
}

export type ConnectionStatus = "untested" | "connected" | "error" | "disabled";

export interface IntegrationUsage {
  provider: string;
  total: number;
  connected: number;
  error: number;
  untested: number;
  disabled: number;
}

/** Collapses provider × status rows into one line per provider, busiest first. */
export function groupIntegrationUsage(rows: { provider: string; status: ConnectionStatus; count: number }[]): IntegrationUsage[] {
  const byProvider = new Map<string, IntegrationUsage>();
  for (const row of rows) {
    const entry = byProvider.get(row.provider) ?? { provider: row.provider, total: 0, connected: 0, error: 0, untested: 0, disabled: 0 };
    entry[row.status] += row.count;
    entry.total += row.count;
    byProvider.set(row.provider, entry);
  }
  return [...byProvider.values()].sort((a, b) => b.total - a.total || a.provider.localeCompare(b.provider));
}

/* -------------------------------------------------------------- activity */

export type ActorType = "user" | "platform_admin" | "support_session" | "system";

const ACTOR_LABELS: Record<ActorType, string> = {
  user: "Workspace member",
  platform_admin: "Platform admin",
  support_session: "Support session",
  system: "System",
};

export function actorLabel(type: ActorType, isCurrentAdmin = false): string {
  return isCurrentAdmin && type !== "system" ? `You (${ACTOR_LABELS[type].toLowerCase()})` : ACTOR_LABELS[type];
}

/** `tenant.plan_changed` → "Tenant plan changed". */
export function describeAction(action: string): string {
  const words = action.replace(/[._]+/g, " ").trim();
  if (words === "") return "Unknown event";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* ---------------------------------------------------------------- health */

export type HealthState = "ok" | "warn" | "fail" | "unknown";

export interface HealthInput {
  database: { platformReachable: boolean; runtimeReachable: boolean };
  migrations: { expected: number; applied: number | null; pending: number | null };
  runtimeRole: { safe: boolean; problem: string | null };
  outbox: { pending: number; failed: number; oldestPendingAt: Date | null };
}

export interface HealthRow {
  key: "platform_db" | "runtime_db" | "migrations" | "runtime_role" | "outbox";
  label: string;
  state: HealthState;
  /** Short status word shown beside the icon. */
  status: string;
  detail: string;
}

const STALE_OUTBOX_MS = 15 * 60_000;

export function healthRows(health: HealthInput, now: Date = new Date()): HealthRow[] {
  const { database, migrations, runtimeRole, outbox } = health;

  const migrationRow: HealthRow =
    migrations.applied === null || migrations.pending === null
      ? {
          key: "migrations",
          label: "Database migrations",
          state: "unknown",
          status: "Unknown",
          detail: `This build ships ${migrations.expected}. The migration ledger could not be read.`,
        }
      : migrations.pending > 0
        ? {
            key: "migrations",
            label: "Database migrations",
            state: "fail",
            status: `${migrations.pending} pending`,
            detail: `${migrations.applied} of ${migrations.expected} applied. Run the migrations before serving this build.`,
          }
        : {
            key: "migrations",
            label: "Database migrations",
            state: "ok",
            status: "Up to date",
            detail: `${migrations.applied} applied, none pending.`,
          };

  const oldestAgeMs = outbox.oldestPendingAt ? now.getTime() - outbox.oldestPendingAt.getTime() : 0;
  const stale = outbox.pending > 0 && oldestAgeMs > STALE_OUTBOX_MS;
  const outboxParts = [`${formatCount(outbox.pending)} waiting`, `${formatCount(outbox.failed)} failed`];
  if (outbox.oldestPendingAt) outboxParts.push(`oldest queued ${formatDateTime(outbox.oldestPendingAt)}`);
  const outboxRow: HealthRow = {
    key: "outbox",
    label: "Notification queue",
    state: outbox.failed > 0 || stale ? "warn" : "ok",
    status: outbox.failed > 0 ? "Failures" : stale ? "Backlog" : outbox.pending > 0 ? "Sending" : "Empty",
    detail: `${outboxParts.join(", ")}.${stale ? " Messages are waiting longer than 15 minutes: check that the scheduled job is running." : ""}`,
  };

  return [
    {
      key: "platform_db",
      label: "Platform database connection",
      state: database.platformReachable ? "ok" : "fail",
      status: database.platformReachable ? "Reachable" : "Unreachable",
      detail: database.platformReachable ? "The cross-tenant connection answered." : "The cross-tenant connection did not answer.",
    },
    {
      key: "runtime_db",
      label: "Runtime database connection",
      state: database.runtimeReachable ? "ok" : "fail",
      status: database.runtimeReachable ? "Reachable" : "Unreachable",
      detail: database.runtimeReachable
        ? "The tenant-restricted connection answered."
        : "The tenant-restricted connection did not answer. Workspaces and storefronts cannot load.",
    },
    migrationRow,
    {
      key: "runtime_role",
      label: "Runtime role safety",
      state: runtimeRole.safe ? "ok" : "fail",
      status: runtimeRole.safe ? "Safe" : "Unsafe",
      detail: runtimeRole.safe
        ? "The runtime role is subject to row-level security."
        : (runtimeRole.problem ?? "The runtime role is not subject to row-level security."),
    },
    outboxRow,
  ];
}

/** The worst state in a set of rows: fail, then warn, then unknown, then ok. */
export function worstHealth(rows: Pick<HealthRow, "state">[]): HealthState {
  const order: HealthState[] = ["fail", "warn", "unknown", "ok"];
  return order.find((state) => rows.some((row) => row.state === state)) ?? "ok";
}

/* --------------------------------------------------------------- support */

export type GrantStatus = "requested" | "approved" | "denied" | "revoked" | "expired";

/** Only the admin who asked may use a grant, and only while it is live. */
export function canEnterWorkspace(
  grant: { status: GrantStatus; requestedBy: string; expiresAt: Date | null },
  adminUserId: string,
  now: Date = new Date(),
): boolean {
  return grant.status === "approved" && grant.requestedBy === adminUserId && grant.expiresAt !== null && grant.expiresAt.getTime() > now.getTime();
}

/* ---------------------------------------------------------- integrations */

export interface FieldShape {
  key: string;
  type: "text" | "password" | "number" | "boolean" | "select";
  secret: boolean;
  required: boolean;
}

/** Starting values for a connection form. Secret fields always start empty. */
export function integrationFormDefaults(fields: FieldShape[], config: Record<string, unknown>): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  for (const field of fields) {
    if (field.type === "boolean") values[field.key] = field.secret ? false : config[field.key] === true;
    else if (field.secret) values[field.key] = "";
    else values[field.key] = config[field.key] === undefined || config[field.key] === null ? "" : String(config[field.key]);
  }
  return values;
}

/**
 * Splits a connection form into what is stored in the open (`config`) and
 * what is encrypted (`secrets`). A blank secret is left out, which tells the
 * server to keep the stored value. `missing` lists required fields left empty;
 * a secret with a stored value (`storedSecrets`) is not missing.
 */
export function splitIntegrationForm(
  fields: FieldShape[],
  values: Record<string, string | boolean>,
  storedSecrets: readonly string[] = [],
): { config: Record<string, unknown>; secrets: Record<string, string>; missing: string[] } {
  const config: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  const missing: string[] = [];
  for (const field of fields) {
    const raw = values[field.key];
    if (field.type === "boolean") {
      if (!field.secret) config[field.key] = raw === true;
      continue;
    }
    const text = typeof raw === "string" ? (field.type === "password" ? raw : raw.trim()) : "";
    if (text === "") {
      if (field.required && !(field.secret && storedSecrets.includes(field.key))) missing.push(field.key);
      continue;
    }
    if (field.secret) secrets[field.key] = text;
    // Anything that is not a number is sent as typed, so the server can say what is wrong with it.
    else config[field.key] = field.type === "number" && /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
  }
  return { config, secrets, missing };
}
