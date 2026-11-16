import "server-only";
import { z } from "zod";
import type { TenantScope } from "../db/context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { isIsoDate } from "@/lib/dates";

/** Field errors keyed by dotted path (`seo.home.title`, `stats.0.label`). */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Parses at the service boundary; bad input becomes a ValidationError. */
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new ValidationError(undefined, toFieldErrors(result.error));
  return result.data;
}

const uuid = z.uuid();

/**
 * Ids arrive from URLs and form posts. One that is not even a UUID cannot
 * name a record, so it gets the ordinary "not found" instead of reaching the
 * database and failing there as a malformed query.
 */
export function requireId(id: unknown, what: string): string {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) throw new NotFoundError(what);
  return parsed.data;
}

const HTML_TAG = /<\/?[a-z!][^>]*>/i;
// Control characters except newline and tab, which multi-line text keeps.
const CONTROL_EXCEPT_BREAKS = /[^\P{Cc}\n\t]/gu;
const CONTROL = /\p{Cc}/gu;

function clean(value: string, multiline: boolean): string {
  if (multiline) return value.replace(/\r\n?/g, "\n").replace(CONTROL_EXCEPT_BREAKS, "").trim();
  return value.replace(/\s+/g, " ").replace(CONTROL, "").trim();
}

export interface PlainTextOptions {
  min?: number;
  /** Shown when the value is shorter than `min`. */
  minMessage?: string;
  /** Keep line breaks (paragraph fields). Single-line fields collapse whitespace. */
  multiline?: boolean;
}

/**
 * A text field that is stored and rendered as plain text. Control characters
 * are dropped and anything that looks like markup is refused, so no HTML is
 * ever persisted for a template to render by mistake.
 */
export function plainText(max: number, options: PlainTextOptions = {}) {
  const min = options.min ?? 0;
  return z
    .string()
    .transform((value) => clean(value, options.multiline ?? false))
    .pipe(
      z
        .string()
        .min(min, options.minMessage ?? `Use at least ${min} characters.`)
        .max(max, `Keep this under ${max} characters.`)
        .refine((value) => !HTML_TAG.test(value), "Plain text only: HTML tags are not allowed."),
    );
}

export const isoDate = z.string().refine(isIsoDate, "Use a date in YYYY-MM-DD format.");

export const pageSchema = (defaultLimit: number, maxLimit: number) => ({
  limit: z.number().int().min(1).max(maxLimit).default(defaultLimit),
  offset: z.number().int().min(0).max(100_000).default(0),
});

export interface Page<T> {
  items: T[];
  /** Rows matching the filters, ignoring limit and offset. */
  total: number;
}

/** Lower-cases a title down to a URL-safe slug. May return an empty string. */
export function slugify(input: string, maxLength = 80): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/** Escapes `%`, `_` and `\` so user text matches literally inside ILIKE. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

/** PostgreSQL error code and constraint, wherever the driver put them. */
export function pgErrorOf(error: unknown): { code?: string; constraint?: string } {
  let current = error as { code?: unknown; constraint?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 4; depth++) {
    if (typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) {
      return { code: current.code, constraint: typeof current.constraint === "string" ? current.constraint : undefined };
    }
    current = current.cause as typeof current;
  }
  return {};
}

export interface ConstraintMap {
  /** Foreign-key constraint name → the input field it guards. */
  foreignKeys?: Record<string, { field: string; message: string }>;
  /** Unique constraint or index name → message for the conflict. */
  unique?: Record<string, string>;
}

/**
 * Runs a write inside a savepoint and translates constraint violations into
 * errors the user can act on. Links to tours, media and destinations are
 * composite `(tenant_id, id)` foreign keys, so an id from another tenant fails
 * here exactly like an id that does not exist, and the caller's transaction
 * stays usable afterwards.
 */
export async function guardedWrite<T>(
  scope: TenantScope,
  constraints: ConstraintMap,
  write: (tx: TenantScope["tx"]) => Promise<T>,
): Promise<T> {
  try {
    return await scope.tx.transaction((savepoint) => write(savepoint));
  } catch (error) {
    const pg = pgErrorOf(error);
    if (pg.code === FOREIGN_KEY_VIOLATION && pg.constraint) {
      const hit = constraints.foreignKeys?.[pg.constraint];
      if (hit) throw new ValidationError(undefined, { [hit.field]: [hit.message] });
    }
    if (pg.code === UNIQUE_VIOLATION && pg.constraint) {
      const message = constraints.unique?.[pg.constraint];
      if (message) throw new ConflictError(message);
    }
    throw error;
  }
}
