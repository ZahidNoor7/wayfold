import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`);

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Every tenant-owned table carries this column. It defaults to the
 * transaction's tenant context, so an insert that forgets it still lands in
 * the caller's tenant, and an insert that lies about it is rejected by the
 * row-level security `WITH CHECK`.
 */
export const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .default(sql`app_current_tenant()`);
