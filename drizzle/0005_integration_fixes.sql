-- Added with a temporary default so the statement is valid on a table that
-- already has rows; the default is dropped again because the application
-- always supplies the value.
ALTER TABLE "discount_requests" ADD COLUMN "adults" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_requests" ALTER COLUMN "adults" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "discount_requests" ADD COLUMN "children" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "preferred_date" date;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_single_default_key" ON "plans" USING btree ("is_default") WHERE "plans"."is_default";--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_range_check" CHECK ("availability_blocks"."end_date" >= "availability_blocks"."start_date");--> statement-breakpoint
ALTER TABLE "tour_departures" ADD CONSTRAINT "tour_departures_capacity_check" CHECK ("tour_departures"."capacity" >= 1);--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_price_check" CHECK ("tours"."price_adult" >= 0 and "tours"."child_price_percent" between 0 and 100);--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_duration_check" CHECK ("tours"."duration_days" >= 1);--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_group_check" CHECK ("tours"."min_group_size" >= 1 and "tours"."max_group_size" >= "tours"."min_group_size");--> statement-breakpoint

-- Deleting a tour should not be blocked by content that merely mentions it.
-- These links clear themselves instead. Only the referencing column is
-- nulled (PostgreSQL 15+ column list): tenant_id is NOT NULL and must stay.
-- Bookings and discounts keep their blocking keys: money is attached to them.
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_tour_fk";--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tour_fk" FOREIGN KEY ("tenant_id","tour_id")
  REFERENCES "public"."tours"("tenant_id","id") ON DELETE SET NULL ("tour_id");--> statement-breakpoint
ALTER TABLE "inquiries" DROP CONSTRAINT "inquiries_tour_fk";--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_tour_fk" FOREIGN KEY ("tenant_id","tour_id")
  REFERENCES "public"."tours"("tenant_id","id") ON DELETE SET NULL ("tour_id");--> statement-breakpoint
ALTER TABLE "journey_entries" DROP CONSTRAINT "journey_entries_tour_fk";--> statement-breakpoint
ALTER TABLE "journey_entries" ADD CONSTRAINT "journey_entries_tour_fk" FOREIGN KEY ("tenant_id","related_tour_id")
  REFERENCES "public"."tours"("tenant_id","id") ON DELETE SET NULL ("related_tour_id");--> statement-breakpoint

-- Lets the platform health check compare applied migrations with the journal.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
    GRANT USAGE ON SCHEMA drizzle TO wayfold_platform;
    GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO wayfold_platform;
  END IF;
END
$$;
