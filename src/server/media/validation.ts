import "server-only";
import type { z } from "zod";
import { ValidationError } from "../errors";

/** Parses service input, turning Zod issues into per-field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    (fieldErrors[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
  }
  throw new ValidationError(undefined, fieldErrors);
}

/** Postgres error code of a failed statement, wherever the driver put it. */
export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

export const FOREIGN_KEY_VIOLATION = "23503";
