import { bigint, foreignKey, index, integer, pgEnum, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, updatedAt } from "./columns";
import { users } from "./identity";
import { integrations } from "./platform";
import { tenants } from "./tenancy";

export const mediaFolders = pgTable(
  "media_folders",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("media_folders_tenant_id_id_key").on(t.tenantId, t.id), uniqueIndex("media_folders_tenant_name_key").on(t.tenantId, t.name)],
);

export const mediaResourceType = pgEnum("media_resource_type", ["image", "video"]);
/** Whose provider account stores the bytes. */
export const mediaStorageOwner = pgEnum("media_storage_owner", ["tenant", "platform"]);

/**
 * Catalogue of uploaded files. The bytes live with the storage provider; this
 * row is the proof of ownership every read, replace and delete is checked
 * against.
 */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id"),
    storageOwner: mediaStorageOwner("storage_owner").notNull(),
    /** Tenant integration used for the upload; null for platform storage. */
    integrationId: uuid("integration_id"),
    provider: text("provider").notNull(),
    /** Provider resource id. Always inside this tenant's folder prefix. */
    publicId: text("public_id").notNull(),
    resourceType: mediaResourceType("resource_type").notNull(),
    format: text("format").notNull().default(""),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    url: text("url").notNull(),
    originalFilename: text("original_filename").notNull().default(""),
    alt: text("alt").notNull().default(""),
    /** Attribution the licence requires, e.g. "Photo: A. Author, CC BY-SA 4.0". Empty when none is needed. */
    credit: text("credit").notNull().default(""),
    /** Where the original and its licence can be found. */
    creditUrl: text("credit_url").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("media_assets_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("media_assets_tenant_public_id_key").on(t.tenantId, t.provider, t.publicId),
    index("media_assets_tenant_folder_idx").on(t.tenantId, t.folderId),
    foreignKey({
      name: "media_assets_folder_fk",
      columns: [t.tenantId, t.folderId],
      foreignColumns: [mediaFolders.tenantId, mediaFolders.id],
    }),
    foreignKey({
      name: "media_assets_integration_fk",
      columns: [t.tenantId, t.integrationId],
      foreignColumns: [integrations.tenantId, integrations.id],
    }),
  ],
);
