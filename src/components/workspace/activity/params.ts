import { firstParam, hrefWith, type SearchParams } from "@/lib/booking-display";
import { isAuditArea } from "@/lib/audit-labels";
import { addDays, isIsoDate } from "@/lib/dates";

export const ACTIVITY_PATH = "/workspace/activity";
export const ACTIVITY_PAGE_SIZE = 50;

/** Who the "person" filter can name besides individual members. */
export const ACTOR_KINDS = {
  support: { actorType: "support_session", label: "Wayfold support" },
  wayfold: { actorType: "platform_admin", label: "Wayfold" },
  system: { actorType: "system", label: "System" },
} as const;
export type ActorKind = keyof typeof ACTOR_KINDS;

export interface ActivityView {
  area?: string;
  /** A member's user id, or one of the ACTOR_KINDS keys. */
  person?: string;
  /** `YYYY-MM-DD` in the workspace's timezone, inclusive. */
  from?: string;
  to?: string;
  cursor?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;

function isActorKind(value: string): value is ActorKind {
  return Object.hasOwn(ACTOR_KINDS, value);
}

/**
 * Reads the filters from the URL. Anything a hand-edited link could put
 * there that is not a valid choice is dropped, so the service only ever
 * receives well-formed input. A reversed date range is put the right way round.
 */
export function parseActivityParams(params: SearchParams): ActivityView {
  const area = firstParam(params.area);
  const person = firstParam(params.person);
  let from = firstParam(params.from);
  let to = firstParam(params.to);
  const cursor = firstParam(params.cursor);
  if (!isIsoDate(from)) from = undefined;
  if (!isIsoDate(to)) to = undefined;
  if (from && to && from > to) [from, to] = [to, from];
  return {
    area: isAuditArea(area) ? area : undefined,
    person: person && (UUID.test(person) || isActorKind(person)) ? person.toLowerCase() : undefined,
    from,
    to,
    cursor: cursor && CURSOR.test(cursor) ? cursor : undefined,
  };
}

export function activityHref(view: ActivityView): string {
  return hrefWith(ACTIVITY_PATH, { area: view.area, person: view.person, from: view.from, to: view.to, cursor: view.cursor });
}

/** How many filters are narrowing the list (the page cursor is not a filter). */
export function activeFilterCount(view: ActivityView): number {
  return [view.area, view.person, view.from, view.to].filter(Boolean).length;
}

/** Offset of `timezone` from UTC at `instant`, in milliseconds. */
function offsetAt(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant a calendar day begins in a timezone: `2027-03-28` in
 * `Europe/London` is 00:00 GMT, the day after it 23:00 UTC the day before.
 * Correct across daylight-saving changes.
 */
export function zonedDayStart(date: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetAt(new Date(guess), timezone);
  // The offset at the guessed instant can differ from the offset at the
  // real one when a clock change falls in between; one correction settles it.
  const second = guess - offsetAt(new Date(first), timezone);
  return new Date(second);
}

export interface ActivityQuery {
  action?: string;
  actorUserId?: string;
  actorType?: (typeof ACTOR_KINDS)[ActorKind]["actorType"];
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}

/** The service filter for a view: whole days in the workspace's timezone, `to` inclusive. */
export function activityQuery(view: ActivityView, timezone: string): ActivityQuery {
  const person = view.person;
  return {
    action: view.area,
    actorUserId: person && !isActorKind(person) ? person : undefined,
    actorType: person && isActorKind(person) ? ACTOR_KINDS[person].actorType : undefined,
    from: view.from ? zonedDayStart(view.from, timezone) : undefined,
    to: view.to ? zonedDayStart(addDays(view.to, 1), timezone) : undefined,
    cursor: view.cursor,
    limit: ACTIVITY_PAGE_SIZE,
  };
}
