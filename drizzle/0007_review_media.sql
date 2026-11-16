-- The composite key first: review_media references it.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE TABLE "review_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"review_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_review_fk" FOREIGN KEY ("tenant_id","review_id") REFERENCES "public"."reviews"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_media_fk" FOREIGN KEY ("tenant_id","media_id") REFERENCES "public"."media_assets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_media_key" ON "review_media" USING btree ("tenant_id","review_id","media_id");--> statement-breakpoint
-- Tenant-owned: same isolation contract as every other tenant table.
SELECT app_enable_tenant_rls('review_media');
