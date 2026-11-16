/**
 * Client-side helpers for the workspace address field. The server decides
 * what is valid and free (`checkSlugAvailability`); these only tidy typing so
 * the field never holds characters an address cannot contain.
 */
export const SLUG_MAX_LENGTH = 40;

/** Tidies what someone types into the address field as they type it. */
export function normaliseSlugInput(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_.]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX_LENGTH);
}

export type SlugProblem = "invalid" | "reserved" | "taken";

/** Plain-language reason an address cannot be used. */
export function slugProblemMessage(reason: SlugProblem | undefined): string {
  switch (reason) {
    case "taken":
      return "That address is already taken.";
    case "reserved":
      return "That address is reserved. Choose another.";
    default:
      return "Use 3 to 40 lowercase letters, numbers and single hyphens, starting and ending with a letter or number.";
  }
}
