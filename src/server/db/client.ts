import "server-only";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface Handle {
  db: Database;
  end: () => Promise<void>;
}

type PoolName = "app" | "platform";

// Pools live on globalThis so dev hot-reload does not leak connections.
const registry = globalThis as typeof globalThis & { __wayfoldPools?: Partial<Record<PoolName, Handle>> };

function open(url: string): Handle {
  const { DATABASE_DRIVER, DATABASE_POOL_MAX } = env();
  const options = { connectionString: url, max: DATABASE_POOL_MAX, idleTimeoutMillis: 10_000 };

  if (DATABASE_DRIVER === "neon") {
    // WebSocket pool: required for the interactive transactions that carry
    // the per-request tenant context. The HTTP driver cannot hold one.
    const pool = new NeonPool(options);
    return { db: drizzleNeon({ client: pool, schema }) as unknown as Database, end: () => pool.end() };
  }

  const pool = new PgPool(options);
  return { db: drizzlePg({ client: pool, schema }), end: () => pool.end() };
}

function handle(name: PoolName): Handle {
  const pools = (registry.__wayfoldPools ??= {});
  return (pools[name] ??= open(name === "app" ? env().DATABASE_URL : env().DATABASE_PLATFORM_URL));
}

/**
 * Runtime connection (role `wayfold_app`). Never query it directly: go through
 * `withTenant` / `withUser` / `withAuthEmail` in `./context`, which open a
 * transaction and set the row-level-security context.
 */
export function appDatabase(): Database {
  return handle("app").db;
}

/**
 * Cross-tenant connection (role `wayfold_platform`). Import only from
 * `src/server/platform`; an ESLint rule enforces this.
 */
export function platformDatabase(): Database {
  return handle("platform").db;
}

export async function closeDatabases(): Promise<void> {
  const pools = registry.__wayfoldPools ?? {};
  registry.__wayfoldPools = {};
  await Promise.all(Object.values(pools).map((pool) => pool.end()));
}
