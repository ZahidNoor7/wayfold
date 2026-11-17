CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"booking_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"review_id" uuid,
	"uploaded_media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"upload_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_booking_fk" FOREIGN KEY ("tenant_id","booking_id") REFERENCES "public"."bookings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_booking_key" ON "review_requests" USING btree ("tenant_id","booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_token_key" ON "review_requests" USING btree ("token_hash");--> statement-breakpoint
-- Tenant-owned: same isolation contract as every other tenant table.
SELECT app_enable_tenant_rls('review_requests');
