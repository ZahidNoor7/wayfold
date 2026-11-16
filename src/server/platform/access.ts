import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { platformAdmins } from "../db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { withPlatform } from "./db";

export type PlatformRole = "owner" | "support";

/**
 * Who is acting on the platform. Built from the verified session
 * (`getPlatformAdmin()`), never from request input.
 */
export interface PlatformActor {
  userId: string;
  role: PlatformRole;
}

/** The cross-tenant transaction handed out by `withPlatform`. */
export type PlatformTx = Parameters<Parameters<typeof withPlatform>[0]>[0];

const idSchema = z.uuid();

export function isUuid(value: unknown): value is string {
  return idSchema.safeParse(value).success;
}

/** An id that is not a UUID cannot name a record, so it is simply not found. */
export function requireId(value: unknown, what: string): asserts value is string {
  if (!isUuid(value)) throw new NotFoundError(what);
}

export function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(undefined, z.flattenError(result.error).fieldErrors as Record<string, string[]>);
  }
  return result.data;
}

/**
 * Checks the role the caller claims. `support` may read; anything that
 * changes state needs `owner`.
 */
export function assertPlatformRole(admin: PlatformActor, minimum: PlatformRole): void {
  const role = admin?.role;
  if (role !== "owner" && role !== "support") throw new ForbiddenError();
  if (minimum === "owner" && role !== "owner") throw new ForbiddenError("Only a platform owner can do that.");
}

/**
 * Second fence behind `assertPlatformRole`: the role is read again from
 * `platform_admins` inside the transaction, so a stale or hand-built actor
 * cannot act with powers the table no longer grants.
 */
export async function authorize(tx: PlatformTx, admin: PlatformActor, minimum: PlatformRole): Promise<void> {
  assertPlatformRole(admin, minimum);
  if (!isUuid(admin.userId)) throw new ForbiddenError();
  const [row] = await tx
    .select({ role: platformAdmins.role })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, admin.userId))
    .limit(1);
  if (!row) throw new ForbiddenError();
  if (minimum === "owner" && row.role !== "owner") throw new ForbiddenError("Only a platform owner can do that.");
}

/** Runs `fn` in a cross-tenant transaction after authorising `admin`. */
export function asPlatform<T>(admin: PlatformActor, minimum: PlatformRole, fn: (tx: PlatformTx) => Promise<T>): Promise<T> {
  // Fail before opening a connection when the claimed role is already too low.
  assertPlatformRole(admin, minimum);
  return withPlatform(async (tx) => {
    await authorize(tx, admin, minimum);
    return fn(tx);
  });
}

/** Escapes `%`, `_` and `\` so user text matches literally inside ILIKE. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}
