import { formatMoney, isIsoDate } from "./dates";

/**
 * Display rules for the public storefront, kept free of React and of server
 * code so they can be unit-tested and shared by server and client components.
 */

/* ------------------------------------------------------------------ brand */

/** "Aurelia Journeys" → display word + tracked sub-label. One word has no sub-label. */
export function splitWordmark(name: string): { primary: string; rest: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return { primary: words[0] ?? "", rest: words.slice(1).join(" ") };
}

/** Up to two initials for avatar and portrait placeholders. */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s&+]+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (words.length === 0) return "";
  const letter = (word: string) => Array.from(word.replace(/[^\p{L}\p{N}]/gu, ""))[0]?.toUpperCase() ?? "";
  const first = words[0]!;
  const last = words[words.length - 1]!;
  return words.length === 1 ? letter(first) : letter(first) + letter(last);
}

export type SocialNetwork = "instagram" | "youtube" | "facebook" | "tiktok";

const SOCIAL_BASE: Record<SocialNetwork, (handle: string) => string> = {
  instagram: (handle) => `https://www.instagram.com/${handle}`,
  youtube: (handle) => `https://www.youtube.com/@${handle}`,
  facebook: (handle) => `https://www.facebook.com/${handle}`,
  tiktok: (handle) => `https://www.tiktok.com/@${handle}`,
};

const HANDLE = /^@?[A-Za-z0-9._-]{1,80}$/;
const WEB_ADDRESS = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:\/[^\s<>"'`]*)?$/i;

/**
 * A stored social value is a profile name or a web address. Anything that is
 * neither becomes no link at all, so a stored value can never produce a
 * non-http(s) href.
 */
export function socialUrl(network: SocialNetwork, value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  // A scheme, a path or a leading "www." marks an address; a bare dotted
  // word ("aurelia.travel") is a valid profile name and is read as one.
  const looksLikeAddress = /^https?:\/\//i.test(raw) || raw.includes("/") || /^www\./i.test(raw);
  if (!looksLikeAddress && HANDLE.test(raw)) return SOCIAL_BASE[network](raw.replace(/^@/, ""));
  if (!WEB_ADDRESS.test(raw)) return null;
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return URL.canParse(url) ? url : null;
}

export interface HeroCopy {
  kicker: string;
  headline: string;
  /** Italic tail of the headline. */
  emphasis: string;
  body: string;
}

/**
 * Home hero copy. What the business wrote for the hero wins; a business that
 * has written nothing yet still gets a real headline from its profile (its
 * tagline, or simply its name), never placeholder text.
 */
export function heroCopy(
  hero: { kicker: string; headline: string; headlineEmphasis: string; body: string },
  tenant: { name: string; tagline: string; description: string; regions: readonly string[] },
): HeroCopy {
  const headline = hero.headline || tenant.tagline || tenant.name;
  // The tagline is not repeated under itself when it already is the headline.
  const fallbackBody = tenant.description || (headline === tenant.tagline ? "" : tenant.tagline);
  return {
    kicker: hero.kicker || tenant.regions.slice(0, 3).join(" · "),
    headline,
    emphasis: hero.headline ? hero.headlineEmphasis : "",
    body: hero.body || fallbackBody,
  };
}

/** Only Cloudinary is allowed by the image optimiser and the content security policy. */
export function isCloudinaryUrl(url: string | null | undefined): url is string {
  if (!url || !URL.canParse(url)) return false;
  const parsed = new URL(url);
  return parsed.protocol === "https:" && parsed.hostname === "res.cloudinary.com";
}

/** Paragraph fields keep their line breaks; blank lines separate paragraphs. */
export function paragraphs(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function pluralize(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** `1,284` — counts are always shown grouped. */
export function formatCount(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}

/* ------------------------------------------------------------------ dates */

function calendarDate(date: string): Date | null {
  return isIsoDate(date) ? new Date(`${date}T00:00:00Z`) : null;
}

/** `15 December` (long) or `15 Dec` (short). Calendar dates are formatted in UTC so they never drift. */
export function formatDayMonth(date: string, month: "long" | "short" = "long"): string {
  const value = calendarDate(date);
  return value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month, timeZone: "UTC" }).format(value) : "";
}

/** `Oct 2026` (short) or `October 2026` (long). */
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Sep 2026" / "September 2026". A fixed table rather than Intl: engines
 * disagree on short month names ("Sep" or "Sept"), and this runs on both the
 * server and in the browser, where any difference breaks hydration.
 */
export function formatMonthYear(date: string | null | undefined, month: "long" | "short" = "short"): string {
  const value = date ? calendarDate(date) : null;
  if (!value) return "";
  const names = month === "long" ? MONTHS_LONG : MONTHS_SHORT;
  return `${names[value.getUTCMonth()]} ${value.getUTCFullYear()}`;
}

/* --------------------------------------------------------------- pricing */

export type DiscountKind = "percent" | "fixed";

/** `15% off` / `$300 off` */
export function discountLabel(type: DiscountKind, value: number, currency: string): string {
  return type === "percent" ? `${value}% off` : `${formatMoney(value, currency)} off`;
}

export interface CardOffer {
  name: string;
  type: DiscountKind;
  value: number;
  endsOn: string;
}

export interface CardPriceInput {
  discountedPriceAdult: number | null;
  offer: CardOffer | null;
}

export interface CardPrice {
  /** The "from" price a visitor pays. */
  now: string;
  /** List price to strike through; only when `now` is lower. */
  original: string | null;
  /** Corner badge: `−15%` or `$300 off per booking`. */
  badge: string | null;
  /** `Autumn in the Caucasus · Ends 15 Dec` */
  offerLine: string | null;
  onOffer: boolean;
}

/**
 * What a tour card shows. A percentage lowers the per-person price, so the
 * list price is struck through. A fixed amount comes off the whole booking,
 * so the per-person price stands and only the badge announces it.
 */
export function cardPrice(priceAdult: number, price: CardPriceInput | null | undefined, currency: string): CardPrice {
  const list = formatMoney(priceAdult, currency);
  const offer = price?.offer ?? null;
  if (!offer) return { now: list, original: null, badge: null, offerLine: null, onOffer: false };

  const ends = formatDayMonth(offer.endsOn, "short");
  const offerLine = ends ? `${offer.name} · Ends ${ends}` : offer.name;
  const discounted = price?.discountedPriceAdult ?? null;
  if (offer.type === "percent" && discounted !== null && discounted < priceAdult) {
    return { now: formatMoney(discounted, currency), original: list, badge: `−${offer.value}%`, offerLine, onOffer: true };
  }
  const badge = offer.type === "percent" ? `−${offer.value}%` : `${formatMoney(offer.value, currency)} off per booking`;
  return { now: list, original: null, badge, offerLine, onOffer: true };
}

export interface RankableOffer {
  type: DiscountKind;
  value: number;
  endsOn: string;
  isConditional: boolean;
  tours: readonly { priceAdult: number }[];
}

/** The most one adult ticket can save under an offer, in minor units. */
export function offerSaving(offer: RankableOffer): number {
  let best = 0;
  for (const tour of offer.tours) {
    if (tour.priceAdult <= 0 || offer.value <= 0) continue;
    const amount = Math.min(tour.priceAdult, offer.type === "percent" ? Math.round((tour.priceAdult * offer.value) / 100) : offer.value);
    if (amount > best) best = amount;
  }
  return best;
}

/**
 * The offer worth promoting: the largest saving on one adult ticket. On a
 * tie an offer everyone qualifies for beats a conditional one, then the one
 * ending soonest. Array order never decides.
 */
export function bestOffer<T extends RankableOffer>(offers: readonly T[]): T | null {
  let best: { offer: T; saving: number } | null = null;
  for (const offer of offers) {
    const saving = offerSaving(offer);
    if (saving <= 0) continue;
    if (!best) {
      best = { offer, saving };
      continue;
    }
    const wins =
      saving !== best.saving
        ? saving > best.saving
        : offer.isConditional !== best.offer.isConditional
          ? !offer.isConditional
          : offer.endsOn < best.offer.endsOn;
    if (wins) best = { offer, saving };
  }
  return best?.offer ?? null;
}

/** Which tours an offer covers, in words: `All experiences`, `A, B and 2 more`. */
export function offerCoverage(offer: { appliesToAllTours: boolean; tours: readonly { title: string }[] }, max = 2): string {
  if (offer.appliesToAllTours) return "All experiences";
  const titles = offer.tours.map((tour) => tour.title);
  if (titles.length <= max) return titles.join(", ");
  const rest = titles.length - max;
  return `${titles.slice(0, max).join(", ")} and ${rest} more`;
}

/* ------------------------------------------------------------------ stats */

export interface ParsedStat {
  prefix: string;
  /** The first number in the figure. */
  number: number;
  decimals: number;
  grouped: boolean;
  suffix: string;
}

/** Splits a typed figure such as `2,900+` or `4.9 / 5` around its first number. Null when it has none. */
export function parseStat(value: string): ParsedStat | null {
  const match = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/s.exec(value);
  if (!match) return null;
  const [, prefix = "", digits = "", suffix = ""] = match;
  const number = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  return { prefix, number, decimals: digits.includes(".") ? digits.length - digits.indexOf(".") - 1 : 0, grouped: digits.includes(","), suffix };
}

/** The figure at `progress` (0…1) of its count-up, formatted like the original. */
export function formatStat(stat: ParsedStat, progress: number): string {
  const k = Math.min(1, Math.max(0, progress));
  const figure = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: stat.decimals,
    maximumFractionDigits: stat.decimals,
    useGrouping: stat.grouped,
  }).format(stat.number * k);
  return `${stat.prefix}${figure}${stat.suffix}`;
}

/** Ease-out cubic, the curve the design's count-up uses. */
export function easeOutCubic(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return 1 - (1 - k) ** 3;
}

/* ---------------------------------------------------- experiences filters */

export const DURATION_OPTIONS = [
  { value: "any", label: "Any length" },
  { value: "day", label: "Up to 1 day" },
  { value: "short", label: "2–3 days" },
  { value: "long", label: "4+ days" },
] as const;
export type DurationFilter = (typeof DURATION_OPTIONS)[number]["value"];

export const SORT_OPTIONS = [
  { value: "popular", label: "Most popular" },
  { value: "rating", label: "Highest rated" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "duration", label: "Shortest first" },
] as const;
export type SortFilter = (typeof SORT_OPTIONS)[number]["value"];

export const PRICE_BANDS = ["any", "low", "mid", "high"] as const;
export type PriceFilter = (typeof PRICE_BANDS)[number];

export interface ExperienceFilters {
  q: string;
  /** Category slug, or "" for all. */
  category: string;
  /** Destination slug, or "" for all. */
  destination: string;
  duration: DurationFilter;
  price: PriceFilter;
  onOffer: boolean;
  sort: SortFilter;
  /** 1-based. */
  page: number;
}

export const DEFAULT_EXPERIENCE_FILTERS: ExperienceFilters = {
  q: "",
  category: "",
  destination: "",
  duration: "any",
  price: "any",
  onOffer: false,
  sort: "popular",
  page: 1,
};

export const EXPERIENCES_PAGE_SIZE = 24;

type SearchParams = Record<string, string | string[] | undefined>;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Search text as it is stored in the URL: trimmed, single-spaced, at most 100 characters. */
export function normaliseSearch(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 100);
}

/** Reads the filter state from the URL. Anything unrecognised falls back to its default. */
export function parseExperienceFilters(params: SearchParams): ExperienceFilters {
  const slug = (value: string) => {
    const lower = value.toLowerCase();
    return SLUG.test(lower) ? lower : "";
  };
  const page = Number.parseInt(single(params.page), 10);
  return {
    q: normaliseSearch(single(params.q)),
    category: slug(single(params.category)),
    destination: slug(single(params.destination)),
    duration: oneOf(
      single(params.duration),
      DURATION_OPTIONS.map((option) => option.value),
      "any",
    ),
    price: oneOf(single(params.price), PRICE_BANDS, "any"),
    onOffer: single(params.offer) === "1",
    sort: oneOf(
      single(params.sort),
      SORT_OPTIONS.map((option) => option.value),
      "popular",
    ),
    page: Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1,
  };
}

/** The query string for a filter state, defaults left out. Empty string when nothing is set. */
export function experienceSearch(filters: ExperienceFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.destination) params.set("destination", filters.destination);
  if (filters.duration !== "any") params.set("duration", filters.duration);
  if (filters.price !== "any") params.set("price", filters.price);
  if (filters.onOffer) params.set("offer", "1");
  if (filters.sort !== "popular") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** `/experiences` with the filter state in its query string. */
export function experiencesHref(filters: Partial<ExperienceFilters> = {}): string {
  return `/experiences${experienceSearch({ ...DEFAULT_EXPERIENCE_FILTERS, ...filters })}`;
}

/**
 * Filters that live inside the mobile sheet (destination, length, budget).
 * Sort order is not a filter, and search, category and "On offer" stay
 * visible outside the sheet, so none of them count towards its badge.
 */
export function sheetFilterCount(filters: ExperienceFilters): number {
  return Number(filters.destination !== "") + Number(filters.duration !== "any") + Number(filters.price !== "any");
}

/** True when anything narrows or reorders the list, i.e. "Clear all" has something to clear. */
export function hasActiveFilters(filters: ExperienceFilters): boolean {
  return (
    filters.q !== "" ||
    filters.category !== "" ||
    filters.destination !== "" ||
    filters.duration !== "any" ||
    filters.price !== "any" ||
    filters.onOffer ||
    filters.sort !== "popular"
  );
}

export interface PriceThresholds {
  /** Minor units. `low` band is below this. */
  low: number;
  /** Minor units. `high` band is above this. */
  high: number;
}

const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];

function niceNumber(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  let best = NICE_STEPS[0]!;
  for (const step of NICE_STEPS) if (Math.abs(step - scaled) < Math.abs(best - scaled)) best = step;
  return best * magnitude;
}

function minorUnit(currency: string): number {
  const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return 10 ** digits;
}

/**
 * Budget bands for a catalogue, from its cheapest and dearest list price.
 * The range is cut into three on a ratio scale and each cut rounded to a
 * friendly figure, so a catalogue from $85 to $3,200 gets $300 and $1,000 in
 * any currency's own magnitudes. Null when the prices are too close together
 * for three honest bands; the budget filter is then not offered.
 */
export function priceThresholds(minPrice: number, maxPrice: number, currency: string): PriceThresholds | null {
  if (!(minPrice > 0) || !(maxPrice > minPrice)) return null;
  const unit = minorUnit(currency);
  const ratio = maxPrice / minPrice;
  const low = Math.round(niceNumber((minPrice * ratio ** (1 / 3)) / unit) * unit);
  const high = Math.round(niceNumber((minPrice * ratio ** (2 / 3)) / unit) * unit);
  if (!(low > minPrice && high > low && high < maxPrice)) return null;
  return { low, high };
}

export function priceBandLabels(thresholds: PriceThresholds, currency: string): Record<Exclude<PriceFilter, "any">, string> {
  const low = formatMoney(thresholds.low, currency);
  const high = formatMoney(thresholds.high, currency);
  return { low: `Under ${low}`, mid: `${low} – ${high}`, high: `${high}+` };
}

export interface CatalogueQuery {
  category?: string;
  destination?: string;
  search?: string;
  minDuration?: number;
  maxDuration?: number;
  priceMin?: number;
  priceMax?: number;
  sort: SortFilter;
}

/**
 * Translates the URL state into catalogue query arguments. "On offer" and
 * paging are applied by the page, because offers are priced separately. A
 * budget band is ignored when the catalogue has no bands.
 */
export function catalogueQuery(filters: ExperienceFilters, thresholds: PriceThresholds | null): CatalogueQuery {
  const query: CatalogueQuery = { sort: filters.sort };
  if (filters.category) query.category = filters.category;
  if (filters.destination) query.destination = filters.destination;
  if (filters.q) query.search = filters.q;
  if (filters.duration === "day") query.maxDuration = 1;
  if (filters.duration === "short") Object.assign(query, { minDuration: 2, maxDuration: 3 });
  if (filters.duration === "long") query.minDuration = 4;
  if (thresholds) {
    if (filters.price === "low") query.priceMax = thresholds.low - 1;
    if (filters.price === "mid") Object.assign(query, { priceMin: thresholds.low, priceMax: thresholds.high });
    if (filters.price === "high") query.priceMin = thresholds.high + 1;
  }
  return query;
}

/** Page count and the slice bounds for a 1-based page, clamped to what exists. */
export function paginate(total: number, page: number, pageSize: number = EXPERIENCES_PAGE_SIZE): { page: number; pages: number; offset: number } {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return { page: current, pages, offset: (current - 1) * pageSize };
}

/* ------------------------------------------------------- manifest and SEO */

/** Home-screen label: the full name when it fits under an icon, otherwise its first word. */
export function shortAppName(name: string, max = 12): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  return splitWordmark(trimmed).primary.slice(0, max);
}

/** The single character drawn on a tenant's app icon. */
export function appIconLetter(name: string): string {
  return initials(name).slice(0, 1) || "•";
}

export interface SitemapEntry {
  /** Path on the storefront, starting with `/`. */
  path: string;
  lastModified?: Date | null;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}

/** The most recent of some dates, or null when there are none. */
export function latest(dates: readonly (Date | null | undefined)[]): Date | null {
  let newest: Date | null = null;
  for (const date of dates) if (date && (!newest || date > newest)) newest = date;
  return newest;
}

/** A sitemap document for `entries` on `origin` (scheme and host, no trailing slash). */
export function sitemapXml(origin: string, entries: readonly SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const location = `${origin}${entry.path.split("/").map(encodeURIComponent).join("/")}`;
    const modified = entry.lastModified ? `<lastmod>${entry.lastModified.toISOString()}</lastmod>` : "";
    return `  <url><loc>${escapeXml(location)}</loc>${modified}</url>`;
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, "</urlset>", ""].join("\n");
}

/** robots.txt that lets every crawler in and points at the sitemap on the same host. */
export function robotsTxt(origin: string | null): string {
  return ["User-agent: *", "Allow: /", ...(origin ? ["", `Sitemap: ${origin}/sitemap.xml`] : []), ""].join("\n");
}

/**
 * A language as people read it: "en" → "English", "az" → "Azerbaijani".
 * Values that are already names, or codes the runtime does not know, are
 * returned as written.
 */
export function languageName(value: string, locale = "en"): string {
  const trimmed = value.trim();
  if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(trimmed)) return trimmed;
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(trimmed);
    return name && name.toLowerCase() !== trimmed.toLowerCase() ? name : trimmed;
  } catch {
    return trimmed;
  }
}
