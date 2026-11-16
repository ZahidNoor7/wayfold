-- Moved first: later foreign keys in this migration reference this key.
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
CREATE TYPE "public"."media_resource_type" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."media_storage_owner" AS ENUM('tenant', 'platform');--> statement-breakpoint
CREATE TYPE "public"."tour_kind" AS ENUM('day', 'departure', 'private');--> statement-breakpoint
CREATE TYPE "public"."tour_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."booking_cancel_kind" AS ENUM('declined', 'by_customer', 'by_business', 'expired');--> statement-breakpoint
CREATE TYPE "public"."booking_event_kind" AS ENUM('created', 'status', 'reschedule', 'payment', 'note', 'notification');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."contact_method" AS ENUM('email', 'whatsapp', 'phone');--> statement-breakpoint
CREATE TYPE "public"."discount_source" AS ENUM('campaign', 'personal', 'request');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'deposit_paid', 'paid', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."campaign_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."discount_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."inquiry_status" AS ENUM('new', 'read', 'archived');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"folder_id" uuid,
	"storage_owner" "media_storage_owner" NOT NULL,
	"integration_id" uuid,
	"provider" text NOT NULL,
	"public_id" text NOT NULL,
	"resource_type" "media_resource_type" NOT NULL,
	"format" text DEFAULT '' NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"url" text NOT NULL,
	"original_filename" text DEFAULT '' NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "media_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_folders_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "availability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"tour_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover_media_id" uuid,
	"latitude" double precision,
	"longitude" double precision,
	"is_published" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "destinations_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "tour_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tour_categories_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "tour_departures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"tour_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"start_time" time,
	"capacity" smallint NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tour_departures_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "tour_itinerary_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"tour_id" uuid NOT NULL,
	"day_number" smallint NOT NULL,
	"title" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"meta" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tour_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"tour_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" uuid,
	"destination_id" uuid,
	"place" text DEFAULT '' NOT NULL,
	"kind" "tour_kind" DEFAULT 'private' NOT NULL,
	"duration_days" integer DEFAULT 1 NOT NULL,
	"duration_label" text DEFAULT '' NOT NULL,
	"price_adult" integer DEFAULT 0 NOT NULL,
	"child_price_percent" smallint DEFAULT 50 NOT NULL,
	"child_max_age" smallint DEFAULT 11 NOT NULL,
	"min_group_size" smallint DEFAULT 1 NOT NULL,
	"max_group_size" smallint DEFAULT 8 NOT NULL,
	"schedule" jsonb DEFAULT '{"weekdays":[1,2,3,4,5,6,7],"slots":[]}'::jsonb NOT NULL,
	"languages" text[] DEFAULT '{}' NOT NULL,
	"highlights" text[] DEFAULT '{}' NOT NULL,
	"inclusions" text[] DEFAULT '{}' NOT NULL,
	"exclusions" text[] DEFAULT '{}' NOT NULL,
	"good_to_know" text[] DEFAULT '{}' NOT NULL,
	"faq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meeting_point" text DEFAULT '' NOT NULL,
	"meeting_latitude" double precision,
	"meeting_longitude" double precision,
	"cancellation_policy" text DEFAULT '' NOT NULL,
	"cover_media_id" uuid,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_popular" boolean DEFAULT false NOT NULL,
	"status" "tour_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tours_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "booking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "booking_event_kind" NOT NULL,
	"message" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"reference" text NOT NULL,
	"tour_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"departure_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"slot_time" time,
	"alternative_date" date,
	"adults" smallint NOT NULL,
	"children" smallint DEFAULT 0 NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"cancel_kind" "booking_cancel_kind",
	"cancel_reason" text,
	"hold_expires_at" timestamp with time zone,
	"currency" text NOT NULL,
	"unit_price_adult" integer NOT NULL,
	"unit_price_child" integer NOT NULL,
	"base_amount" integer NOT NULL,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"discount_source" "discount_source",
	"discount_ref_id" uuid,
	"discount_label" text,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"amount_paid" integer DEFAULT 0 NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"language" text DEFAULT '' NOT NULL,
	"pickup" text DEFAULT '' NOT NULL,
	"contact_method" "contact_method" DEFAULT 'email' NOT NULL,
	"customer_notes" text DEFAULT '' NOT NULL,
	"tour_title" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "bookings_party_check" CHECK ("bookings"."adults" >= 1 and "bookings"."children" >= 0),
	CONSTRAINT "bookings_amounts_check" CHECK ("bookings"."base_amount" >= 0 and "bookings"."discount_amount" >= 0 and "bookings"."discount_amount" <= "bookings"."base_amount" and "bookings"."total_amount" = "bookings"."base_amount" - "bookings"."discount_amount"),
	CONSTRAINT "bookings_dates_check" CHECK ("bookings"."end_date" >= "bookings"."start_date")
);
--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"customer_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"language" text DEFAULT '' NOT NULL,
	"preferred_contact" "contact_method" DEFAULT 'email' NOT NULL,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"tour_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot_time" time,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"party_size" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_tours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"tour_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"blurb" text DEFAULT '' NOT NULL,
	"type" "discount_type" NOT NULL,
	"value" integer NOT NULL,
	"applies_to_all_tours" boolean DEFAULT true NOT NULL,
	"visibility" "campaign_visibility" DEFAULT 'public' NOT NULL,
	"assigned_emails" text[] DEFAULT '{}' NOT NULL,
	"min_guests" smallint DEFAULT 0 NOT NULL,
	"min_children" smallint DEFAULT 0 NOT NULL,
	"book_ahead_days" smallint DEFAULT 0 NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "campaigns_value_check" CHECK ("campaigns"."value" > 0 and ("campaigns"."type" <> 'percent' or "campaigns"."value" <= 90)),
	CONSTRAINT "campaigns_window_check" CHECK ("campaigns"."ends_on" >= "campaigns"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "discount_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"reference" text NOT NULL,
	"access_token_hash" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"tour_id" uuid NOT NULL,
	"guests" smallint NOT NULL,
	"type" "discount_type" NOT NULL,
	"value" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "discount_request_status" DEFAULT 'pending' NOT NULL,
	"decided_type" "discount_type",
	"decided_value" integer,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"used_by_booking_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_requests_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "personal_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"customer_name" text NOT NULL,
	"email" text NOT NULL,
	"tour_id" uuid,
	"type" "discount_type" NOT NULL,
	"value" integer NOT NULL,
	"expires_on" date,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"used_by_booking_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_discounts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "personal_discounts_value_check" CHECK ("personal_discounts"."value" > 0 and ("personal_discounts"."type" <> 'percent' or "personal_discounts"."value" <= 90))
);
--> statement-breakpoint
CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"tour_id" uuid,
	"message" text NOT NULL,
	"status" "inquiry_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"destination_id" uuid,
	"location" text DEFAULT '' NOT NULL,
	"visited_on" date,
	"category" text DEFAULT '' NOT NULL,
	"teaser" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"highlights" text[] DEFAULT '{}' NOT NULL,
	"cover_media_id" uuid,
	"related_tour_id" uuid,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_entries_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "journey_entry_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"entry_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"kind" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"related_type" text,
	"related_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"tour_id" uuid,
	"customer_name" text NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"rating" smallint NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"reviewed_on" date DEFAULT now() NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"avatar_media_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid PRIMARY KEY DEFAULT app_current_tenant() NOT NULL,
	"booking" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"promotions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"site" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "tenant_id" SET DEFAULT app_current_tenant();--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_folder_fk" FOREIGN KEY ("tenant_id","folder_id") REFERENCES "public"."media_folders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_integration_fk" FOREIGN KEY ("tenant_id","integration_id") REFERENCES "public"."integrations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_tour_fk" FOREIGN KEY ("tenant_id","tour_id") REFERENCES "public"."tours"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_cover_fk" FOREIGN KEY ("tenant_id","cover_media_id") REFERENCES "public"."media_assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_categories" ADD CONSTRAINT "tour_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_departures" ADD CONSTRAINT "tour_departures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_departures" ADD CONSTRAINT "tour_departures_tour_fk" FOREIGN KEY ("tenant_id","tour_id") REFERENCES "public"."tours"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_itinerary_days" ADD CONSTRAINT "tour_itinerary_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_itinerary_days" ADD CONSTRAINT "tour_itinerary_days_tour_fk" FOREIGN KEY ("tenant_id","tour_id") REFERENCES "public"."tours"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_media" ADD CONSTRAINT "tour_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_media" ADD CONSTRAINT "tour_media_tour_fk" FOREIGN KEY ("tenant_id","tour_id") REFERENCES "public"."tours"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_media" ADD CONSTRAINT "tour_media_media_fk" FOREIGN KEY ("tenant_id","media_id") REFERENCES "public"."media_assets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."tour_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_destination_fk" FOREIGN KEY ("tenant_id","destination_id") REFERENCES "public"."destinations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_cover_fk" FOREIGN KEY ("tenant_id","cover_media_id") REFERENCES "public"."media_assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_fk" FOREIGN KEY ("tenant_id","booking_id") REFERENCES "public"."bookings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tour_fk" FOREIGN KEY ("tenant_id","tour_id") REFERENCES "public"."tours"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_departure_fk" FOREIGN KEY ("tenant_id","departure_id") REFERENCES "public"."tour_departures"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_tour_fk" FOREIGN KEY ("tenant_id","tour_id") REFERENCES "public"."tours"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_tours" ADD CONSTRAINT "campaign_tours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_tours" ADD CONSTRAINT "campaign_tours_campaign_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_tours" ADD CONSTRAINT "campaign_tours_tour_fk" FOREIGN KEY ("tenant_id","tour_id") REFERENCES "public"."tours"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_tour_fk" FOREIGN KEY ("tenant_id","tour_id") REFERENCES "public"."tours"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_booking_fk" FOREIGN KEY ("tenant_id","used_by_booking_id") REFERENCES "public"."bookings"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_discounts" ADD CONSTRAINT "personal_discounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_discounts" ADD CONSTRAINT "personal_discounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_discounts" ADD CONSTRAINT "personal_discounts_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_discounts" ADD CONSTRAINT "personal_discounts_tour_fk" FOREIGN KEY ("tenant_id","tour_id") REFERENCES "public"."tours"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_discounts" ADD CONSTRAINT "personal_discounts_booking_fk" FOREIGN KEY ("tenant_id","used_by_booking_id") REFERENCES "public"."bookings"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_tour_fk" FOREIGN KEY ("tenant_id","tour_id") REFERENCES "public"."tours"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_entries" ADD CONSTRAINT "journey_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_entries" ADD CONSTRAINT "journey_entries_destination_fk" FOREIGN KEY ("tenant_id","destination_id") REFERENCES "public"."destinations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_entries" ADD CONSTRAINT "journey_entries_cover_fk" FOREIGN KEY ("tenant_id","cover_media_id") REFERENCES "public"."media_assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_entries" ADD CONSTRAINT "journey_entries_tour_fk" FOREIGN KEY ("tenant_id","related_tour_id") REFERENCES "public"."tours"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_entry_media" ADD CONSTRAINT "journey_entry_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_entry_media" ADD CONSTRAINT "journey_entry_media_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."journey_entries"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_entry_media" ADD CONSTRAINT "journey_entry_media_media_fk" FOREIGN KEY ("tenant_id","media_id") REFERENCES "public"."media_assets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tour_fk" FOREIGN KEY ("tenant_id","tour_id") REFERENCES "public"."tours"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_avatar_fk" FOREIGN KEY ("tenant_id","avatar_media_id") REFERENCES "public"."media_assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_tenant_public_id_key" ON "media_assets" USING btree ("tenant_id","provider","public_id");--> statement-breakpoint
CREATE INDEX "media_assets_tenant_folder_idx" ON "media_assets" USING btree ("tenant_id","folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_folders_tenant_name_key" ON "media_folders" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "availability_blocks_tenant_dates_idx" ON "availability_blocks" USING btree ("tenant_id","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "destinations_tenant_slug_key" ON "destinations" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tour_categories_tenant_slug_key" ON "tour_categories" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tour_departures_tour_date_key" ON "tour_departures" USING btree ("tenant_id","tour_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "tour_itinerary_days_tour_day_key" ON "tour_itinerary_days" USING btree ("tenant_id","tour_id","day_number");--> statement-breakpoint
CREATE UNIQUE INDEX "tour_media_tour_media_key" ON "tour_media" USING btree ("tenant_id","tour_id","media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tours_tenant_slug_key" ON "tours" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "tours_tenant_status_idx" ON "tours" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "booking_events_booking_idx" ON "booking_events" USING btree ("tenant_id","booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_tenant_reference_key" ON "bookings" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "bookings_tenant_status_idx" ON "bookings" USING btree ("tenant_id","status","start_date");--> statement-breakpoint
CREATE INDEX "bookings_tenant_tour_date_idx" ON "bookings" USING btree ("tenant_id","tour_id","start_date");--> statement-breakpoint
CREATE INDEX "bookings_tenant_customer_idx" ON "bookings" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "bookings_tenant_created_idx" ON "bookings" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_notes_customer_idx" ON "customer_notes" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_email_key" ON "customers" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_unique_key" ON "waitlist_entries" USING btree ("tenant_id","tour_id","date","email");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_tours_key" ON "campaign_tours" USING btree ("tenant_id","campaign_id","tour_id");--> statement-breakpoint
CREATE INDEX "campaigns_tenant_window_idx" ON "campaigns" USING btree ("tenant_id","starts_on","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_requests_tenant_reference_key" ON "discount_requests" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_requests_one_pending_key" ON "discount_requests" USING btree ("tenant_id","tour_id","email") WHERE "discount_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "personal_discounts_tenant_email_idx" ON "personal_discounts" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "inquiries_tenant_status_idx" ON "inquiries" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "journey_entries_tenant_slug_key" ON "journey_entries" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "journey_entry_media_key" ON "journey_entry_media" USING btree ("tenant_id","entry_id","media_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_tenant_status_idx" ON "notification_outbox" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "reviews_tenant_published_idx" ON "reviews" USING btree ("tenant_id","is_published","reviewed_on");