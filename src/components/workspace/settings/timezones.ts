/**
 * Time zone list and search for the Profile tab. The list comes from the
 * runtime's own tz database (`Intl.supportedValuesOf("timeZone")`), filtered
 * to the shape the server accepts.
 */

// Mirrors the server's check: "UTC" or Area/Location(/Sub-location).
const ZONE_SHAPE = /^(?:UTC|[A-Z][A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

/** Every zone a workspace can choose, sorted, with UTC always present. */
export function selectableTimezones(supported: readonly string[]): string[] {
  const zones = new Set(supported.filter((zone) => ZONE_SHAPE.test(zone)));
  zones.add("UTC");
  return [...zones].sort((a, b) => a.localeCompare(b));
}

/** "America/Argentina/Buenos_Aires" → "America / Argentina / Buenos Aires". */
export function timezoneLabel(zone: string): string {
  return zone.replaceAll("_", " ").split("/").join(" / ");
}

/** The zone's current offset from UTC, e.g. "GMT+4" or "GMT-3:30". Empty when unknown. */
export function utcOffset(zone: string, now: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(now)
      .find((item) => item.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

const searchable = (value: string) => value.toLowerCase().replaceAll("_", " ").replaceAll("/", " ");

/**
 * Zones matching every word of the query, best first: a city that starts
 * with the query, then any part that starts with it, then anything else.
 */
export function searchTimezones(zones: readonly string[], query: string, limit = 60): string[] {
  const words = searchable(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return zones.slice(0, limit);

  const scored: { zone: string; score: number }[] = [];
  for (const zone of zones) {
    const text = searchable(zone);
    if (!words.every((word) => text.includes(word))) continue;
    const parts = text.split(" ");
    const city = searchable(zone.split("/").at(-1) ?? zone);
    const first = words[0]!;
    const score = city.startsWith(first) ? 0 : parts.some((part) => part.startsWith(first)) ? 1 : 2;
    scored.push({ zone, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.zone.localeCompare(b.zone))
    .slice(0, limit)
    .map((item) => item.zone);
}
