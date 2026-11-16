/**
 * Storefront routes whose page starts with a dark, full-bleed hero. On these
 * the header begins transparent over the hero and turns solid after 40px of
 * scroll; everywhere else it is solid from the start.
 *
 * Patterns are paths relative to the storefront root. `[name]` matches any
 * single segment. A page listed here MUST open with a `bg-hero` section that
 * leaves room for the 80px header (the home hero uses `pt-32`), including in
 * its loading, error and not-found states, or the light header text will sit
 * on a light surface.
 */
export const HERO_ROUTES: readonly string[] = ["/"];

/** Route groups and framework-internal segments never appear in a URL. */
function isVisible(segment: string): boolean {
  return segment !== "" && !segment.startsWith("(") && !segment.startsWith("__") && !segment.startsWith("@");
}

/** The storefront path for the segments below the `[site]` layout, e.g. `["experiences", "sheki"]` → `/experiences/sheki`. */
export function pathFromSegments(segments: readonly string[]): string {
  return `/${segments.flatMap((segment) => segment.split("/")).filter(isVisible).join("/")}`;
}

function matches(pattern: string, path: string): boolean {
  const wanted = pattern.split("/").filter(Boolean);
  const actual = path.split("/").filter(Boolean);
  if (wanted.length !== actual.length) return false;
  return wanted.every((part, index) => (part.startsWith("[") && part.endsWith("]")) || part === actual[index]);
}

/** True when the page at `path` starts with a dark hero. */
export function isHeroRoute(path: string, routes: readonly string[] = HERO_ROUTES): boolean {
  const clean = path.split(/[?#]/)[0] ?? "";
  return routes.some((pattern) => matches(pattern, clean));
}

/** The first path segment as a path (`/experiences/sheki` → `/experiences`), for marking the current navigation item. */
export function sectionOf(path: string): string {
  const [first] = path.split("/").filter(Boolean);
  return first ? `/${first}` : "/";
}
