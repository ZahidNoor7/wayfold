import "server-only";
import { platformDatabase, type Transaction } from "../db/client";

/**
 * Cross-tenant transaction on the `wayfold_platform` connection.
 *
 * This is the only door past tenant row-level security. It is exported from
 * `src/server/platform` alone, and ESLint forbids importing it elsewhere, so
 * every cross-tenant code path is a short, reviewable list of files.
 */
export function withPlatform<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return platformDatabase().transaction(fn);
}
