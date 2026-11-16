-- Row-level security for the business tables. Every one of them is
-- tenant-owned and gets the standard contract from app_enable_tenant_rls:
-- forced RLS, current-tenant-only for the runtime role.

SELECT app_enable_tenant_rls('media_folders');
--> statement-breakpoint
SELECT app_enable_tenant_rls('media_assets');
--> statement-breakpoint
SELECT app_enable_tenant_rls('tour_categories');
--> statement-breakpoint
SELECT app_enable_tenant_rls('destinations');
--> statement-breakpoint
SELECT app_enable_tenant_rls('tours');
--> statement-breakpoint
SELECT app_enable_tenant_rls('tour_itinerary_days');
--> statement-breakpoint
SELECT app_enable_tenant_rls('tour_media');
--> statement-breakpoint
SELECT app_enable_tenant_rls('tour_departures');
--> statement-breakpoint
SELECT app_enable_tenant_rls('availability_blocks');
--> statement-breakpoint
SELECT app_enable_tenant_rls('customers');
--> statement-breakpoint
SELECT app_enable_tenant_rls('customer_notes');
--> statement-breakpoint
SELECT app_enable_tenant_rls('bookings');
--> statement-breakpoint
-- Booking timeline is append-only for the runtime role.
SELECT app_enable_tenant_rls('booking_events', 'SELECT, INSERT');
--> statement-breakpoint
SELECT app_enable_tenant_rls('waitlist_entries');
--> statement-breakpoint
SELECT app_enable_tenant_rls('campaigns');
--> statement-breakpoint
SELECT app_enable_tenant_rls('campaign_tours');
--> statement-breakpoint
SELECT app_enable_tenant_rls('personal_discounts');
--> statement-breakpoint
SELECT app_enable_tenant_rls('discount_requests');
--> statement-breakpoint
SELECT app_enable_tenant_rls('reviews');
--> statement-breakpoint
SELECT app_enable_tenant_rls('journey_entries');
--> statement-breakpoint
SELECT app_enable_tenant_rls('journey_entry_media');
--> statement-breakpoint
SELECT app_enable_tenant_rls('inquiries');
--> statement-breakpoint
SELECT app_enable_tenant_rls('tenant_settings');
--> statement-breakpoint
SELECT app_enable_tenant_rls('notification_outbox');
