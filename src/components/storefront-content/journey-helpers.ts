/**
 * Filtering, grouping and layout rules for the public travel journal. Pure, so
 * the page, its filter links and the places summary all agree.
 */

export const JOURNEY_VIEWS = ["gallery", "timeline", "places"] as const;
export type JourneyView = (typeof JOURNEY_VIEWS)[number];

export interface JourneyFilters {
  /** Destination slug. */
  destination: string | null;
  /** Category exactly as written on the entries. */
  category: string | null;
  view: JourneyView;
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Reads the journal's filters from the URL. Anything unrecognised falls back to "everything, as a gallery". */
export function parseJourneyFilters(params: SearchParams): JourneyFilters {
  const destination = first(params.destination).toLowerCase();
  const category = first(params.category);
  const view = first(params.view);
  return {
    destination: /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(destination) ? destination : null,
    category: category && category.length <= 60 ? category : null,
    view: (JOURNEY_VIEWS as readonly string[]).includes(view) ? (view as JourneyView) : "gallery",
  };
}

/** The journal URL for a set of filters; defaults are left out. */
export function journeyHref(filters: Partial<JourneyFilters>, base = "/journey"): string {
  const query = new URLSearchParams();
  if (filters.destination) query.set("destination", filters.destination);
  if (filters.category) query.set("category", filters.category);
  if (filters.view && filters.view !== "gallery") query.set("view", filters.view);
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}

interface EntryLike {
  visitedOn: string | null;
  category: string;
  destination: { slug: string } | null;
}

/** Entries that match the destination and category filters (either may be absent). */
export function filterEntries<T extends EntryLike>(entries: readonly T[], filters: Pick<JourneyFilters, "destination" | "category">): T[] {
  return entries.filter(
    (entry) =>
      (!filters.destination || entry.destination?.slug === filters.destination) && (!filters.category || entry.category === filters.category),
  );
}

export interface CategoryCount {
  name: string;
  count: number;
}

/** Distinct, non-empty categories with how many entries carry each, in alphabetical order. */
export function categoryCounts(entries: readonly EntryLike[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.category) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

export interface DestinationStats {
  count: number;
  /** Most recent visit among the destination's entries, or null when none is dated. */
  lastVisited: string | null;
}

/** Entry count and latest visit per destination slug. */
export function destinationStats(entries: readonly EntryLike[]): Map<string, DestinationStats> {
  const stats = new Map<string, DestinationStats>();
  for (const entry of entries) {
    const slug = entry.destination?.slug;
    if (!slug) continue;
    const current = stats.get(slug) ?? { count: 0, lastVisited: null };
    current.count += 1;
    if (entry.visitedOn && (!current.lastVisited || entry.visitedOn > current.lastVisited)) current.lastVisited = entry.visitedOn;
    stats.set(slug, current);
  }
  return stats;
}

export interface YearGroup<T> {
  /** Four-digit year, or null for entries without a visit date. */
  year: string | null;
  items: T[];
}

/** Entries grouped by visit year, newest year first; undated entries come last. Order inside a group is kept. */
export function groupByYear<T extends EntryLike>(entries: readonly T[]): YearGroup<T>[] {
  const groups = new Map<string, T[]>();
  const undated: T[] = [];
  for (const entry of entries) {
    if (!entry.visitedOn) {
      undated.push(entry);
      continue;
    }
    const year = entry.visitedOn.slice(0, 4);
    const list = groups.get(year) ?? [];
    list.push(entry);
    groups.set(year, list);
  }
  const dated: YearGroup<T>[] = [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([year, items]) => ({ year, items }));
  return undated.length > 0 ? [...dated, { year: null, items: undated }] : dated;
}

/** The tile shapes the design's masonry uses. */
export const TILE_RATIOS = [
  { className: "aspect-[4/5]", value: 4 / 5 },
  { className: "aspect-[3/4]", value: 3 / 4 },
  { className: "aspect-square", value: 1 },
  { className: "aspect-[16/11]", value: 16 / 11 },
] as const;

/**
 * The masonry tile shape closest to the photo's own proportions, so a
 * landscape cover is not cropped to a portrait. Without dimensions the shapes
 * rotate by position, which keeps the columns uneven as designed.
 */
export function tileRatioClass(width: number | null | undefined, height: number | null | undefined, index: number): string {
  if (!width || !height || width <= 0 || height <= 0) return TILE_RATIOS[Math.abs(index) % TILE_RATIOS.length]!.className;
  const ratio = width / height;
  let best: (typeof TILE_RATIOS)[number] = TILE_RATIOS[0];
  for (const candidate of TILE_RATIOS) {
    if (Math.abs(candidate.value - ratio) < Math.abs(best.value - ratio)) best = candidate;
  }
  return best.className;
}

interface Located {
  slug: string;
  latitude: number | null;
  longitude: number | null;
}

export interface MapPin {
  slug: string;
  /** Position inside the map panel, in percent from the left and top edges. */
  x: number;
  y: number;
}

/**
 * Places destinations inside a panel by their coordinates relative to each
 * other: the group is scaled to fill the panel with a margin. This is a
 * schematic of where places lie in relation to one another, not a map.
 */
export function projectPins(destinations: readonly Located[], margin = 14): MapPin[] {
  const located = destinations.filter(
    (destination): destination is Located & { latitude: number; longitude: number } =>
      typeof destination.latitude === "number" && typeof destination.longitude === "number",
  );
  if (located.length === 0) return [];

  const lats = located.map((destination) => destination.latitude);
  const lngs = located.map((destination) => destination.longitude);
  const [south, north] = [Math.min(...lats), Math.max(...lats)];
  const [west, east] = [Math.min(...lngs), Math.max(...lngs)];
  const span = 100 - margin * 2;
  const round = (value: number) => Math.round(value * 10) / 10;

  return located.map((destination) => ({
    slug: destination.slug,
    // A single place, or places sharing a line, sit in the middle of that axis.
    x: round(east === west ? 50 : margin + ((destination.longitude - west) / (east - west)) * span),
    // North is up, so a higher latitude is a smaller offset from the top.
    y: round(north === south ? 50 : margin + ((north - destination.latitude) / (north - south)) * span),
  }));
}

interface MediaLike {
  url: string;
}

/**
 * The entry's photo set with the cover first, without showing the cover twice.
 * When the cover is also one of the photos, the photo's own record leads.
 */
export function entryMedia<T extends MediaLike>(cover: T | null, photos: readonly T[]): T[] {
  if (!cover) return [...photos];
  const sameAsCover = photos.find((photo) => photo.url === cover.url);
  return [sameAsCover ?? cover, ...photos.filter((photo) => photo.url !== cover.url)];
}
